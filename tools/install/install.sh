#!/usr/bin/env bash
# ============================================================================
# Sovereign OS — One-Click Installer (Linux / macOS)
#
#   bash tools/install/install.sh              # ติดตั้งเต็มขั้น (ถามโจทย์)
#   bash tools/install/install.sh --auto       # เงียบสนิท ใช้ค่า default + สุ่ม secret
#   bash tools/install/install.sh --prod       # ใช้ docker-compose.prod.yml (build images)
#   bash tools/install/install.sh --no-frontend # ข้าม dashboard (กันชน port 3000)
#   bash tools/install/install.sh --dry-run    # ดูแผน + .env ที่จะสร้าง (ไม่ลงมือ)
#
# สิ่งที่ทำ: ตรวจ Docker → สร้าง infra/.env (สุ่ม secret) → compose up → รอ healthy
#           → พิมพ์ URL + รหัสเข้าใช้ (บันทึกใน infra/.credentials)
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
INFRA="$ROOT/sovereign-os/infra"
ENV_FILE="$INFRA/.env"
TEMPLATE="$(dirname "$0")/sovereign.env.template"
CREDS="$INFRA/.credentials"
COMPOSE="$INFRA/docker-compose.yml"
COMPOSE_PROD="$INFRA/docker-compose.prod.yml"

MODE_DEV=true MODE_AUTO=false MODE_FRONTEND=true MODE_DRYRUN=false FORCE=false
TELEGRAM_TOKEN="" TELEGRAM_CHAT="" DASHBOARD_URL=""

for arg in "$@"; do
  case "$arg" in
    --auto) MODE_AUTO=true ;;
    --prod) MODE_DEV=false ;;
    --no-frontend) MODE_FRONTEND=false ;;
    --dry-run) MODE_DRYRUN=true ;;
    --force) FORCE=true ;;
    --telegram-token=*) TELEGRAM_TOKEN="${arg#*=}" ;;
    --telegram-chat=*) TELEGRAM_CHAT="${arg#*=}" ;;
    --dashboard-url=*) DASHBOARD_URL="${arg#*=}" ;;
    -h|--help)
      grep '^#' "$0" | head -n 30; exit 0 ;;
    *) echo "unknown flag: $arg (ดู --help)"; exit 1 ;;
  esac
done

log()  { printf '\033[1;32m✔\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m⚠\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31m✘ %s\n\033[0m' "$1" >&2; exit 1; }

gen() { openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

echo ""
echo "══════════════════════════════════════════════"
echo "  Sovereign OS — One-Click Install"
echo "══════════════════════════════════════════════"

# ── 1. Prerequisites ──
command -v docker >/dev/null 2>&1 || die "ไม่พบ Docker — ติดตั้งก่อน: https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || die "Docker ต้องมี compose v2 plugin"
docker info >/dev/null 2>&1 || die "Docker daemon ไม่รัน — เปิด Docker Desktop / systemctl start docker"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) log "สถาปัตยกรรม: x86_64" ;;
  aarch64|arm64) warn "arm64: บาง image (timescaledb) อาจไม่รองรับ — ลองได้ แต่ถ้าล้มแนะนำใช้เครื่อง x86_64" ;;
  *) warn "สถาปัตยกรรม $ARCH ยังไม่ผ่านการทดสอบ" ;;
esac

# ── 2. พอร์ตตรวจสอบ (แค่เตือน) ──
for p in 3001 3000; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then exec 3>&- 3<&-; warn "พอร์ต $p มีโปรแกรมอื่นใช้อยู่ (ถ้าคือ 3000 → ใช้ --no-frontend ได้)"; fi
done

# ── 3. สร้าง infra/.env ──
if [ -f "$ENV_FILE" ] && [ "$FORCE" = false ]; then
  log ".env มีอยู่แล้ว — ใช้ค่าที่ตั้งไว้ ($ENV_FILE)"
elif [ -f "$ENV_FILE" ] && [ "$FORCE" = true ]; then
  warn "--force: จะสร้าง .env ใหม่ (สำรองไฟล์เก่าที่ .env.bak)"
  cp "$ENV_FILE" "$ENV_FILE.bak"
  create_env=1
else
  create_env=1
fi

if [ "${create_env:-0}" = "1" ] || [ "$MODE_DRYRUN" = true ]; then
  [ -f "$TEMPLATE" ] || die "ไม่พบ template: $TEMPLATE"
  BODY="$(cat "$TEMPLATE")"
  # สุ่ม secret ทุกตัว
  BODY="${BODY//__GEN_SECRET_24__/$(gen 12)}"
  BODY="${BODY//__GEN_SECRET_32__/$(gen 16)}"
  BODY="${BODY//__GEN_SECRET_48__/$(gen 24)}"
  BODY="${BODY//__GEN_PASSWORD_16__/$(gen 8)}"

  # ── 4. คำถามที่จำเป็น (ข้ามเมื่อ --auto) ──
  if [ "$MODE_AUTO" = false ] && [ -z "$TELEGRAM_TOKEN" ]; then
    printf "Telegram Bot Token (ว่าง = ข้าม): "; read -r TELEGRAM_TOKEN
  fi
  if [ -n "$TELEGRAM_TOKEN" ] && [ -z "$TELEGRAM_CHAT" ]; then
    printf "Telegram Chat ID: "; read -r TELEGRAM_CHAT
  fi
  if [ -n "$TELEGRAM_TOKEN" ] && [ -z "$DASHBOARD_URL" ]; then
    printf "Dashboard URL (เช่น http://192.168.1.10:3000, ว่าง = ข้าม): "; read -r DASHBOARD_URL
  fi
  if [ "$MODE_AUTO" = false ] && [ -z "$TELEGRAM_TOKEN" ]; then
    printf "มี UPS + NUT server ไหม? (y/N): "; read -r has_ups
    [ "$has_ups" = "y" ] || [ "$has_ups" = "Y" ] && BODY="${BODY/UPS_ENABLED=false/UPS_ENABLED=true}"
  fi

  if [ -n "$TELEGRAM_TOKEN" ]; then
    BODY="${BODY/TELEGRAM_BOT_TOKEN=/TELEGRAM_BOT_TOKEN=$TELEGRAM_TOKEN}"
    [ -n "$TELEGRAM_CHAT" ]   && BODY="${BODY/TELEGRAM_CHAT_ID=/TELEGRAM_CHAT_ID=$TELEGRAM_CHAT}"
    [ -n "$DASHBOARD_URL" ]   && BODY="${BODY/TELEGRAM_DASHBOARD_URL=/TELEGRAM_DASHBOARD_URL=$DASHBOARD_URL}"
  fi

  if [ "$MODE_DRYRUN" = true ]; then
    echo "── .env ที่จะสร้าง (dry-run) ──────────────────────"
    echo "$BODY" | sed -E 's/^(.*PASSWORD|.*SECRET|.*TOKEN)=.*/\1=<hidden>/'
    echo "──────────────────────────────────────────────────"
    echo "dry-run จบ — ไม่ได้เขียนไฟล์ ไม่ได้รัน container"
    exit 0
  fi

  echo "$BODY" > "$ENV_FILE"
  log "สร้าง infra/.env แล้ว (secret สุ่มทั้งหมด)"
fi

# ── 5. บันทึก credentials (สำหรับล็อกอินครั้งแรก) ──
JWT="$(grep -E '^JWT_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
ADMIN="$(grep -E '^SEED_ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
printf 'SEED_ADMIN_PASSWORD=%s\nJWT_SECRET=%s\n' "$ADMIN" "$JWT" > "$CREDS"
chmod 600 "$CREDS" 2>/dev/null || true
log "credentials บันทึกที่ infra/.credentials (สิทธิ์ 600)"

# ── 6. Compose up ──
CMD_UP=(docker compose -f "$INFRA/docker-compose.yml")
if [ "$MODE_DEV" = false ]; then CMD_UP=(docker compose -f "$COMPOSE_PROD" --env-file "$ENV_FILE"); fi

if [ "$MODE_FRONTEND" = true ]; then
  echo "→ docker compose up -d (full stack)"
  UP_LOG="/tmp/sovereign-up.log"
  if "${CMD_UP[@]}" up -d 2>&1 | tee "$UP_LOG"; then
    :
  elif grep -qi "ports are not available" "$UP_LOG"; then
    warn "พอร์ต 3000 ชน — ติดตั้งเฉพาะ core services (ข้าม dashboard)"
    "${CMD_UP[@]}" up -d core-api || die "compose up ล้มเหลว — ดู log: docker compose logs core-api"
  else
    die "compose up ล้มเหลว — ดู log ด้านบน ($UP_LOG)"
  fi
else
  echo "→ docker compose up -d core-api (--no-frontend)"
  "${CMD_UP[@]}" up -d core-api || die "compose up ล้มเหลว — ดู log: docker compose logs core-api"
fi

# ── 7. รอ healthy ──
echo "→ รอระบบพร้อม (build ครั้งแรก ~2-10 นาที)…"
OK=""
for i in $(seq 1 180); do
  if curl -sf -o /dev/null "http://127.0.0.1:3001/healthz" 2>/dev/null; then OK=1; break; fi
  [ $((i % 10)) -eq 0 ] && echo "  …ยังไม่พร้อม (${i}0s)"
  sleep 5
done
[ -n "$OK" ] || die "รอ 15 นาทีแล้วระบบยังไม่พร้อม — ดู log: docker compose -f $COMPOSE logs -f core-api"

# ── 8. สรุป ──
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
echo ""
echo "══════════════════════════════════════════════"
log "ติดตั้งเสร็จสมบูรณ์ — Sovereign OS รันแล้ว!"
echo "  Dashboard : ${DASHBOARD_URL:-http://localhost:3000}  (หรือ http://$LAN_IP:3000)"
echo "  API       : http://localhost:3001"
echo "  ล็อกอิน   : admin / $(cat "$CREDS" | grep SEED_ADMIN | cut -d= -f2-)  (ดู infra/.credentials)"
echo "  Telegram  : $(grep -q '^TELEGRAM_BOT_TOKEN=.' "$ENV_FILE" && echo 'เปิดแล้ว' || echo 'ยังปิด — ใส่ token แล้ว docker compose up -d')"
echo "  UPS       : $(grep -q '^UPS_ENABLED=true' "$ENV_FILE" && echo 'เปิด (dry-run)' || echo 'ปิด (ต้องมี NUT server)')"
echo "══════════════════════════════════════════════"
echo "ขั้นถัดไป: ดู docs/SERIES_RED_DMS_BLUEPRINT.md (ชุด 🔴) หรือตั้ง AI: bash tools/install/install.sh --help"
