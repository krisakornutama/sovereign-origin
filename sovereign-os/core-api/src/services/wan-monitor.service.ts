// src/services/wan-monitor.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// WAN Monitor — TP-Link Archer MR505 (4G SIM) failover guard
// - ping ผ่านเน็ตซิมทุก 60 วิ → state UP/DOWN + alert เปลี่ยนสถานะ (Telegram)
// - บันทึก metric 'wan_state' (1/0) ลง sensor_telemetry → dashboard ใช้ได้ทันที
// - ROUTER_REBOOT_CMD (env) = คำสั่งรีบูต router (SUPERADMIN เรียกผ่าน API เท่านั้น)
//   เช่น: curl -u admin:pass "http://192.168.1.1/cgi-bin/..." (แล้วแต่ firmware)
// - MR505 ไม่มี API เปิด → คุมผ่านคำสั่งภายนอก/relay ได้ ส่วน monitoring ใช้ ping ผ่านซิม
// ─────────────────────────────────────────────────────────────────────────────
import { exec } from 'child_process';
import { promisify } from 'util';
import { prisma } from '../lib/prisma';
import { sendTelegramAlert } from './telegram-alert.service';

const execAsync = promisify(exec);

export const WAN_PING_HOST = process.env.WAN_PING_HOST || '1.1.1.1';
export const WAN_PING_HOST_BACKUP = process.env.WAN_PING_HOST_BACKUP || '8.8.8.8';
export const WAN_PING_TIMEOUT_MS = parseInt(process.env.WAN_PING_TIMEOUT_MS || '5000', 10);
export const ROUTER_HOST = process.env.ROUTER_HOST || '192.168.1.1'; // Archer admin
export const ROUTER_REBOOT_CMD = process.env.ROUTER_REBOOT_CMD || ''; // ว่าง = ปิด

export interface WanState {
  up: boolean;
  since: string; // ISO เวลาที่เข้าสถานะปัจจุบัน
  lastCheck: string;
  latencyMs: number | null;
  host: string;
}

// ── Pure: ping exit code → ผล (testable) ──
export function pingResultFromExit(code: number | null, latencyMs: number | null): boolean {
  return code === 0;
}

/** parse เวลา (ms) จาก output ของ ping (Windows/Linux) — null ถ้าไม่เจอ */
export function parsePingLatency(output: string): number | null {
  const m =
    output.match(/time[=<]\s*([\d.]+)\s*ms/i) || // Linux: time=12.3 ms
    output.match(/Average\s*=\s*(\d+)ms/i) || // Windows: Average = 15ms
    output.match(/= (\d+)ms/i);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

// ── State (in-memory + telemetry) ──
let state: WanState = { up: true, since: new Date().toISOString(), lastCheck: new Date().toISOString(), latencyMs: null, host: WAN_PING_HOST };
let started = false;

export function getWanState(): WanState & { rebootConfigured: boolean; routerHost: string } {
  return { ...state, rebootConfigured: !!ROUTER_REBOOT_CMD, routerHost: ROUTER_HOST };
}

/** ping ครั้งเดียว — คืน { ok, latencyMs } */
export async function pingOnce(host: string): Promise<{ ok: boolean; latencyMs: number | null }> {
  const flag = process.platform === 'win32' ? '-n' : '-c';
  const wflag = process.platform === 'win32' ? '-w' : '-W';
  const timeoutSec = Math.ceil(WAN_PING_TIMEOUT_MS / 1000);
  try {
    const { stdout } = await execAsync(`ping ${flag} 1 ${wflag} ${timeoutSec} ${host}`, {
      timeout: WAN_PING_TIMEOUT_MS + 2000,
    });
    return { ok: true, latencyMs: parsePingLatency(stdout) };
  } catch (err: any) {
    // exit code != 0 = หลุด — ยังพยายาม parse latency (อาจ timeout ระหว่างทาง)
    const latencyMs = err?.stdout ? parsePingLatency(err.stdout) : null;
    return { ok: pingResultFromExit(err?.code ?? null, latencyMs), latencyMs };
  }
}

/** ตรวจ WAN ครั้งเดียว: host หลัก → ถ้าหลุดลอง backup → ตัดสิน UP/DOWN + alert เปลี่ยนสถานะ */
export async function checkWanNow(): Promise<WanState> {
  let r = await pingOnce(WAN_PING_HOST);
  let usedHost = WAN_PING_HOST;
  if (!r.ok) {
    r = await pingOnce(WAN_PING_HOST_BACKUP); // กัน DNS/CDN ตัวเดียวล่ม
    usedHost = WAN_PING_HOST_BACKUP;
  }
  const now = new Date().toISOString();
  const prevUp = state.up;

  state = {
    up: r.ok,
    since: r.ok === prevUp ? state.since : now,
    lastCheck: now,
    latencyMs: r.latencyMs,
    host: usedHost,
  };

  // เปลี่ยนสถานะ → Telegram (dedup ผ่าน eventKey + วันที่)
  if (r.ok !== prevUp) {
    const text = r.ok
      ? `🟢 WAN กลับมาออนไลน์ — Archer MR505 (${ROUTER_HOST}) ping ${WAN_PING_HOST} สำเร็จ ${r.latencyMs != null ? `${r.latencyMs}ms` : ''} · หลุดไป ${Math.round((Date.now() - new Date(prevUp ? state.since : now).getTime()) / 1000)}s`
      : `🔴 WAN หลุด — Archer MR505 (${ROUTER_HOST}) ping ${WAN_PING_HOST} + ${WAN_PING_HOST_BACKUP} ไม่ตอบ (ซิม/สัญญาณ LTE มีปัญหา?) — ระบบทำงานต่อแบบ offline-first`;
    await sendTelegramAlert({ text, severity: r.ok ? 'info' : 'critical', eventKey: `wan_state:${r.ok ? 'up' : 'down'}:${now.slice(0, 10)}` }).catch(() => {});
  }

  // บันทึก telemetry (best-effort — ไม่ให้พัง loop)
  try {
    await prisma.$queryRawUnsafe(
      `INSERT INTO sensor_telemetry (time, node_id, device_id, metric, value) VALUES (NOW(), '11111111-1111-1111-1111-111111111111'::uuid, 'wan-monitor', 'wan_state', $1)`,
      r.ok ? 1 : 0
    );
    if (r.latencyMs != null) {
      await prisma.$queryRawUnsafe(
        `INSERT INTO sensor_telemetry (time, node_id, device_id, metric, value) VALUES (NOW(), '11111111-1111-1111-1111-111111111111'::uuid, 'wan-monitor', 'wan_latency_ms', $1)`,
        r.latencyMs
      );
    }
  } catch {
    // DB ล่ม = อยู่แล้ว (offline-first) — ข้าม
  }
  return state;
}

/** เริ่ม cron ทุก 60 วิ (เรียกครั้งเดียวตอน boot จาก workers/start.ts) */
export function startWanMonitor(intervalMs = 60_000): void {
  if (started) return;
  started = true;
  checkWanNow().catch(() => {});
  setInterval(() => checkWanNow().catch(() => {}), intervalMs);
  console.log(`🌐 WAN monitor started (Archer MR505 @ ${ROUTER_HOST} · ping ${WAN_PING_HOST} ทุก ${Math.round(intervalMs / 1000)}s)`);
}

/** รีบูต router — เฉพาะเมื่อตั้ง ROUTER_REBOOT_CMD (SUPERADMIN API เรียก) */
export async function rebootRouter(): Promise<{ ok: boolean; error?: string }> {
  if (!ROUTER_REBOOT_CMD) {
    return { ok: false, error: 'ROUTER_REBOOT_CMD ยังไม่ตั้ง — MR505 ไม่มี API เปิด ให้ใส่คำสั่ง curl/relay ใน .env ก่อน' };
  }
  try {
    await execAsync(ROUTER_REBOOT_CMD, { timeout: 20000 });
    await sendTelegramAlert({ text: `🔄 สั่งรีบูต Archer MR505 (${ROUTER_HOST}) แล้ว — รอ ~60s เน็ตจะกลับมา`, severity: 'warn', eventKey: `router_reboot:${new Date().toISOString().slice(0, 10)}` }).catch(() => {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'reboot failed' };
  }
}
