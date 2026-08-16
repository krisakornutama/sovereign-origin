// Sovereign OS Launcher — ตัวติดตั้ง/ควบคุมแบบ GUI (single .exe, web UI ในตัว)
// รัน HTTP server ที่ 127.0.0.1:34700 แล้วเปิด browser อัตโนมัติ
// ควบคุม Docker compose + จัดการ infra/.env — ไม่แตะโค้ดรันจริง (Soak ไม่ถูกรบกวน)
package main

import (
	"bytes"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

//go:embed web/*
var webFS embed.FS

const listenAddr = "127.0.0.1:34700"

var (
	exeDir  string
	repoDir string
	infra   string
	envFile string
	compose string
)

type Feature struct {
	ID          string   `json:"id"`
	Label       string   `json:"label"`
	Desc        string   `json:"desc"`
	RamMB       int      `json:"ramMB"`
	RequiredRAM int      `json:"requiredRAM,omitempty"` // RAM ขั้นต่ำ (MiB) ถ้า > 0
	Locked      bool     `json:"locked"`                // core = บังคับรัน
	Enabled     bool     `json:"enabled"`
	Keys        []EnvKey `json:"keys"`
}

type EnvKey struct {
	Key    string `json:"key"`
	Value  string `json:"value"`
	Append string `json:"-"` // ถ้าตั้ง: ต่อท้ายค่าเดิม (ENABLED_MODULES)
}

// feature matrix — ตรงกับระบบจริง (ENABLED_MODULES / *_ENABLED flags)
var FEATURES = []Feature{
	{
		ID: "core", Label: "Core Guard", Locked: true,
		Desc:  "Security, Threat Intel, DEFCON (dry-run), Backup, Encrypted Offsite, Telegram Alerts",
		RamMB: 220,
		Keys: []EnvKey{
			{Key: "THREAT_DETECTION_ENABLED", Value: "true"},
			{Key: "RISK_MONITOR_ENABLED", Value: "true"},
			{Key: "DEFCON_ENABLED", Value: "true"},
			{Key: "DEFCON_DRY_RUN", Value: "true"},
			{Key: "MESH_ENABLED", Value: "true"},
			{Key: "OFFSITE_RETAIN", Value: "30"},
		},
	},
	{
		ID: "farm", Label: "Smart Farm & Livestock",
		Desc:  "ฟาร์ม/ปศุสัตว์: THI, FCR, วัคซีน, ดิน, แปลง",
		RamMB: 50,
		Keys:  []EnvKey{{Key: "ENABLED_MODULES", Value: "farm", Append: "farm"}},
	},
	{
		ID: "home", Label: "Physical Home & Sensors",
		Desc:  "Relay, กล้อง (Vision), MQTT Ingest, UPS+NUT (ถ้ามีฮาร์ดแวร์)",
		RamMB: 100,
		Keys:  []EnvKey{{Key: "ENABLED_MODULES", Value: "vision", Append: "vision"}},
	},
	{
		ID: "ai", Label: "Local AI Suite (Ollama)",
		Desc:  "Dhamma Companion, Agent, Vision OCR, Document Search — ต้องมี Ollama + RAM ≥ 8GB",
		RamMB: 800, RequiredRAM: 8192,
		Keys: []EnvKey{
			{Key: "AI_ANALYST_ENABLED", Value: "true"},
			{Key: "OLLAMA_MODEL", Value: "gemma3:4b"},
			{Key: "EMBED_MODEL", Value: "nomic-embed-text"},
		},
	},
	{
		ID: "wealth", Label: "Wealth & Investment",
		Desc:  "Portfolio Tracker, Price Feed, Risk Model, Property Strategy",
		RamMB: 50,
		Keys:  []EnvKey{{Key: "PORTFOLIO_ENABLED", Value: "true"}},
	},
	{
		ID: "knowledge", Label: "Knowledge & Documents",
		Desc:  "เก็บ/ค้นเอกสาร (knowledge/uploads) + semantic search",
		RamMB: 30,
		Keys:  []EnvKey{{Key: "ENABLED_MODULES", Value: "documents", Append: "documents"}},
	},
	{
		ID: "inventory", Label: "Inventory",
		Desc:  "สต็อกของใช้ภายในบ้าน",
		RamMB: 20,
		Keys:  []EnvKey{{Key: "ENABLED_MODULES", Value: "inventory", Append: "inventory"}},
	},
}

// ── โหลด/เขียน .env (กันยึดบรรทัดอื่น) ──
func loadEnv() (map[string]string, error) {
	out := map[string]string{}
	b, err := os.ReadFile(envFile)
	if err != nil {
		if os.IsNotExist(err) {
			return out, nil
		}
		return nil, err
	}
	for _, line := range strings.Split(string(b), "\n") {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "#") || !strings.Contains(t, "=") {
			continue
		}
		p := strings.SplitN(t, "=", 2)
		out[strings.TrimSpace(p[0])] = strings.TrimSpace(p[1])
	}
	return out, nil
}

func saveEnv(env map[string]string) error {
	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var sb strings.Builder
	for _, k := range keys {
		sb.WriteString(k + "=" + env[k] + "\n")
	}
	return os.WriteFile(envFile, []byte(sb.String()), 0o600)
}

func applyFeatures(ids []string) error {
	env, err := loadEnv()
	if err != nil {
		return err
	}
	if env["POSTGRES_PASSWORD"] == "" || env["JWT_SECRET"] == "" {
		if err := generateEnv(); err != nil {
			return err
		}
		env, err = loadEnv()
		if err != nil {
			return err
		}
	}
	for _, f := range FEATURES {
		on := false
		for _, id := range ids {
			if id == f.ID {
				on = true
			}
		}
		for _, k := range f.Keys {
			if k.Append != "" { // ต่อท้าย ENABLED_MODULES โดยไม่หลุดตัวอื่น
				mods := splitModules(env[k.Key])
				if on {
					mods[k.Append] = true
				} else {
					delete(mods, k.Append)
				}
				env[k.Key] = joinModules(mods)
			} else if on {
				env[k.Key] = k.Value
			} else {
				delete(env, k.Key) // ปิด feature = ลบคีย์ ให้ config ใช้ default (กันค่า "false" หลงในคีย์ model)
			}
		}
	}
	return saveEnv(env)
}

func splitModules(v string) map[string]bool {
	out := map[string]bool{}
	for _, m := range strings.Split(v, ",") {
		m = strings.TrimSpace(m)
		if m != "" {
			out[m] = true
		}
	}
	return out
}

func joinModules(m map[string]bool) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return strings.Join(keys, ",")
}

func featureState() ([]Feature, error) {
	env, err := loadEnv()
	if err != nil {
		return nil, err
	}
	out := make([]Feature, len(FEATURES))
	copy(out, FEATURES)
	for i := range out {
		on := true
		for _, k := range out[i].Keys {
			cur, _ := env[k.Key]
			if k.Append != "" {
				if !splitModules(cur)[k.Append] {
					on = false
				}
			} else if cur != k.Value {
				on = false
			}
		}
		out[i].Enabled = on || out[i].Locked
	}
	return out, nil
}

// ── สร้าง .env ครั้งแรก (สุ่ม secret — ตรงกับ tools/install) ──
func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return strings.Repeat("0", n*2)
	}
	return hex.EncodeToString(b)
}

func generateEnv() error {
	defaults := map[string]string{
		"POSTGRES_USER": "sovereign", "POSTGRES_DB": "sovereign_v2",
		"POSTGRES_PASSWORD": randomHex(12),
		"TIMESCALE_HOST": "timescaledb", "TIMESCALE_DB": "sovereign_v2",
		"TIMESCALE_USER": "sovereign", "TIMESCALE_PASSWORD": randomHex(12),
		"JWT_SECRET": randomHex(24), "SEED_ADMIN_PASSWORD": randomHex(8),
		"OTA_TOKEN": randomHex(16), "CORS_ORIGIN": "*",
		"EMQX_USERNAME": "sovereign", "EMQX_PASSWORD": randomHex(12),
		"THREAT_DETECTION_ENABLED": "true", "THREAT_INTEL_FEED_INTERVAL_HOURS": "24",
		"THREAT_INTEL_MAX_ITEMS": "100", "THREAT_CONNECTION_THRESHOLD": "50",
		"RISK_MONITOR_ENABLED": "true", "DEFCON_ENABLED": "true", "DEFCON_DRY_RUN": "true",
		"MESH_ENABLED": "true", "OFFSITE_RETAIN": "30",
		"TELEMETRY_FLUSH_MS": "60000",
		"UPS_ENABLED": "false", "UPS_HOST": "localhost", "UPS_PORT": "3493",
		"UPS_NAME": "ups", "UPS_SHUTDOWN_BATTERY_PCT": "15",
		"UPS_SHUTDOWN_RUNTIME_SEC": "180", "UPS_DRY_RUN": "true",
		"TELEGRAM_BOT_TOKEN": "", "TELEGRAM_CHAT_ID": "", "TELEGRAM_DASHBOARD_URL": "",
		"TELEGRAM_MIN_SEVERITY": "warn",
		"HOME_LATITUDE": "15.0", "HOME_LONGITUDE": "100.0",
		"LIFESTYLE_ENABLED": "true", "MANUAL_DAY_HOURS": "24",
		"ENERGY_CAPACITY_KWH": "5", "ELECTRICITY_PRICE_USD_PER_KWH": "0.12",
		"OLLAMA_URL": "http://127.0.0.1:11434", "AI_ANALYST_ENABLED": "false",
		"PORTFOLIO_ENABLED": "false", "PORTFOLIO_CASH_USD": "0",
		"PORTFOLIO_MONTHLY_EXPENSES_USD": "0",
		"ENABLED_MODULES": "",
	}
	if err := os.MkdirAll(infra, 0o755); err != nil {
		return err
	}
	return saveEnv(defaults)
}

// ── Docker orchestration ──
func docker(args ...string) (string, error) {
	cmd := exec.Command("docker", args...)
	cmd.Dir = infra
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	return out.String(), err
}

func composeUp(frontend bool) (string, error) {
	if frontend {
		out, err := docker("compose", "-f", compose, "up", "-d")
		if err != nil && strings.Contains(out, "ports are not available") {
			return out, fmt.Errorf("PORT_CONFLICT")
		}
		return out, err
	}
	return docker("compose", "-f", compose, "up", "-d", "core-api")
}

func composePs() []map[string]string {
	out, err := docker("compose", "-f", compose, "ps", "--format", "{{.Name}}|{{.State}}|{{.Status}}")
	if err != nil {
		return nil
	}
	var rows []map[string]string
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" || !strings.Contains(line, "|") {
			continue // ข้าม warning line ของ docker (เช่น version obsolete)
		}
		p := strings.SplitN(line, "|", 3)
		r := map[string]string{"name": p[0]}
		if len(p) > 1 {
			r["state"] = p[1]
		}
		if len(p) > 2 {
			r["status"] = p[2]
		}
		rows = append(rows, r)
	}
	return rows
}

// ── Pre-flight ──
type MemStatus struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

func systemRAM() (totalMB, freeMB uint64) {
	k32 := syscall.NewLazyDLL("kernel32.dll")
	proc := k32.NewProc("GlobalMemoryStatusEx")
	ms := &MemStatus{Length: uint32(unsafe.Sizeof(MemStatus{}))}
	proc.Call(uintptr(unsafe.Pointer(ms)))
	return ms.TotalPhys / 1024 / 1024, ms.AvailPhys / 1024 / 1024
}

func portInUse(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return true
	}
	ln.Close()
	return false
}

func healthOK() bool {
	cli := &http.Client{Timeout: 3 * time.Second}
	r, err := cli.Get("http://127.0.0.1:3001/healthz")
	if err != nil {
		return false
	}
	defer r.Body.Close()
	return r.StatusCode == 200
}

func preflight() map[string]any {
	// docker
	dockerInstalled := false
	dockerRunning := false
	dockerVersion := ""
	if _, err := exec.LookPath("docker"); err == nil {
		dockerInstalled = true
		if out, err := docker("--version"); err == nil {
			dockerVersion = strings.TrimSpace(out)
		}
		if out, err := docker("info"); err == nil {
			dockerRunning = strings.Contains(out, "Server Version")
		}
	}
	total, free := systemRAM()
	return map[string]any{
		"docker": map[string]any{
			"installed": dockerInstalled, "running": dockerRunning, "version": dockerVersion,
		},
		"ram":       map[string]any{"totalMB": total, "freeMB": free, "ok": free > 2048},
		"ports":     map[string]bool{"3000": portInUse(3000), "3001": portInUse(3001)},
		"envExists": fileExists(envFile),
		"repoOk":    fileExists(compose),
		"health":    healthOK(),
		"os":        runtime.GOOS + "/" + runtime.GOARCH,
	}
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// ── API ──
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(v)
}

func api() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/preflight", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, preflight())
	})
	mux.HandleFunc("GET /api/features", func(w http.ResponseWriter, r *http.Request) {
		fs, err := featureState()
		if err != nil {
			writeJSON(w, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, map[string]any{"features": fs})
	})
	mux.HandleFunc("POST /api/features", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Features []string `json:"features"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if err := applyFeatures(body.Features); err != nil {
			writeJSON(w, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, map[string]any{"ok": true, "envFile": envFile})
	})
	mux.HandleFunc("POST /api/start", func(w http.ResponseWriter, r *http.Request) {
		if !fileExists(envFile) {
			if err := generateEnv(); err != nil {
				writeJSON(w, map[string]any{"error": "สร้าง .env ล้มเหลว: " + err.Error()})
				return
			}
		}
		out, err := composeUp(true)
		if err != nil && err.Error() == "PORT_CONFLICT" {
			out2, err2 := composeUp(false)
			writeJSON(w, map[string]any{"ok": err2 == nil, "output": out2, "frontendSkipped": true, "error": err2Str(err2)})
			return
		}
		writeJSON(w, map[string]any{"ok": err == nil, "output": out, "error": err2Str(err)})
	})
	mux.HandleFunc("POST /api/stop", func(w http.ResponseWriter, r *http.Request) {
		out, err := docker("compose", "-f", compose, "stop")
		writeJSON(w, map[string]any{"ok": err == nil, "output": out, "error": err2Str(err)})
	})
	mux.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{
			"containers": composePs(), "health": healthOK(),
			"envExists": fileExists(envFile), "adminPassword": readAdminPassword(),
		})
	})
	mux.HandleFunc("GET /api/logs", func(w http.ResponseWriter, r *http.Request) {
		lines := r.URL.Query().Get("lines")
		if lines == "" {
			lines = "200"
		}
		out, err := docker("compose", "-f", compose, "logs", "--tail", lines, "core-api")
		writeJSON(w, map[string]any{"ok": err == nil, "logs": out, "error": err2Str(err)})
	})
	mux.HandleFunc("POST /api/dashboard", func(w http.ResponseWriter, r *http.Request) {
		exec.Command("cmd", "/c", "start", "", "http://localhost:3000").Start()
		writeJSON(w, map[string]any{"ok": true})
	})
	// static UI
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		p := "web/index.html"
		if r.URL.Path != "/" {
			p = "web" + strings.TrimPrefix(r.URL.Path, "/")
		}
		b, err := webFS.ReadFile(p)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", mimeOf(p))
		w.Write(b)
	})
	return mux
}

func err2Str(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func mimeOf(p string) string {
	switch {
	case strings.HasSuffix(p, ".html"):
		return "text/html; charset=utf-8"
	case strings.HasSuffix(p, ".js"):
		return "text/javascript; charset=utf-8"
	case strings.HasSuffix(p, ".css"):
		return "text/css; charset=utf-8"
	}
	return "text/plain; charset=utf-8"
}

func readAdminPassword() string {
	b, err := os.ReadFile(envFile)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "SEED_ADMIN_PASSWORD=") {
			return strings.TrimSpace(strings.TrimPrefix(line, "SEED_ADMIN_PASSWORD="))
		}
	}
	return ""
}

func main() {
	exe, err := os.Executable()
	if err != nil {
		fmt.Println("os.Executable:", err)
		os.Exit(1)
	}
	exeDir = filepath.Dir(exe)
	repoDir = filepath.Dir(filepath.Dir(exeDir))
	infra = filepath.Join(repoDir, "sovereign-os", "infra")
	envFile = filepath.Join(infra, ".env")
	compose = filepath.Join(infra, "docker-compose.yml")

	headless := false
	for _, a := range os.Args[1:] {
		if a == "--headless" {
			headless = true
		}
		if a == "--port" && len(os.Args) > 2 {
			_ = os.Args[2]
		}
	}

	srv := &http.Server{Addr: listenAddr, Handler: api()}
	ln, err := net.Listen("tcp", listenAddr)
	if err != nil {
		fmt.Println("พอร์ต 34700 ถูกใช้แล้ว — Sovereign Launcher อาจรันอยู่ (http://127.0.0.1:34700)")
		os.Exit(1)
	}
	if !headless {
		exec.Command("cmd", "/c", "start", "", "http://127.0.0.1:34700").Start()
	}
	fmt.Printf("Sovereign OS Launcher: http://%s (headless=%v)\n", listenAddr, headless)
	_ = srv.Serve(ln)
}
