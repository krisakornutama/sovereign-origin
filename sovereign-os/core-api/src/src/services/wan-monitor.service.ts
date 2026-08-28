// src/services/wan-monitor.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// WAN + Router Monitor — TP-Link Archer MR505 (4G SIM) ครอบคลุมทั้งเส้นทาง
// Phase 1: router_state — TCP probe ตัว router เอง (แยกปัญหา "สายแลน" ออกจาก "ซิม")
// Phase 2: lan_devices — สแกนอุปกรณ์ที่ต่อ router (TCP sweep พอร์ต 80) + เตือนอุปกรณ์ใหม่
// Phase 3: wan_downlink_mbps — speedtest โหลดจริงผ่านซิม (Cloudflare __down)
// Phase 0 (เดิม): wan_state/wan_latency_ms — HTTP probe ผ่านเน็ตทุก 60 วิ
// MR505 ไม่มี API เปิด → คุมผ่าน ROUTER_REBOOT_CMD (env) เท่านั้น
// ─────────────────────────────────────────────────────────────────────────────
import net from 'net';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { prisma } from '../lib/prisma';
import { sendTelegramAlert } from './telegram-alert.service';

const execAsync = promisify(exec);

export const WAN_PING_HOST = process.env.WAN_PING_HOST || '1.1.1.1';
export const WAN_PING_HOST_BACKUP = process.env.WAN_PING_HOST_BACKUP || 'www.google.com';
export const WAN_PING_TIMEOUT_MS = parseInt(process.env.WAN_PING_TIMEOUT_MS || '5000', 10);
export const ROUTER_HOST = process.env.ROUTER_HOST || '192.168.1.1';
export const ROUTER_REBOOT_CMD = process.env.ROUTER_REBOOT_CMD || '';
// Phase 2 config
export const ROUTER_SUBNET = process.env.ROUTER_SUBNET || ROUTER_HOST.split('.').slice(0, 3).join('.');
export const LAN_SCAN_PORT = parseInt(process.env.LAN_SCAN_PORT || '80', 10);
export const LAN_SCAN_ENABLED = (process.env.LAN_SCAN_ENABLED || 'true') === 'true';
// Phase 3 config
export const SPEEDTEST_ENABLED = (process.env.SPEEDTEST_ENABLED || 'true') === 'true';
export const SPEEDTEST_BYTES = parseInt(process.env.SPEEDTEST_BYTES || '2000000', 10); // 2MB

const NODE_ID = '11111111-1111-1111-1111-111111111111';
const KNOWN_DEVICES_KEY = 'router.knownDevices';

export interface WanState {
  up: boolean;
  since: string;
  lastCheck: string;
  latencyMs: number | null;
  host: string;
}

export interface RouterState {
  up: boolean;
  since: string;
  lastCheck: string;
  latencyMs: number | null;
}

export interface LanDevice { ip: string; latencyMs: number; firstSeen: string }
export interface SpeedtestResult { mbps: number; bytes: number; ms: number; at: string }

// ── Pure helpers (testable) ──
export function pingResultFromExit(code: number | null, latencyMs: number | null): boolean {
  return code === 0;
}

export function parsePingLatency(output: string): number | null {
  const m =
    output.match(/time[=<]\s*([\d.]+)\s*ms/i) ||
    output.match(/Average\s*=\s*(\d+)ms/i) ||
    output.match(/= (\d+)ms/i);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

/** สร้าง IP จาก subnet + เลขโฮสต์ — ipFromSubnet('192.168.1', 5) → '192.168.1.5' */
export function ipFromSubnet(subnet: string, hostNum: number): string {
  return `${subnet}.${hostNum}`;
}

/** จำแนกสาเหตุจากสถานะ router + wan — ใช้ตั้งข้อความ alert ให้ตรงจุด */
export function classifyWanIssue(routerUp: boolean, wanUp: boolean): 'OK' | 'LAN_DOWN' | 'SIM_DOWN' {
  if (routerUp && wanUp) return 'OK';
  if (!routerUp) return 'LAN_DOWN'; // router ไม่ตอบ = สายแลน/ตัว router มีปัญหา (ซิมตัดสินไม่ได้)
  return 'SIM_DOWN'; // router ปกติ แต่เน็ตหลุด = ซิม/สัญญาณ LTE
}

/** คำนวณ Mbps จาก bytes + มิลลิวินาที — parseSpeedtestMbps(2_000_000, 2000) → 8 */
export function parseSpeedtestMbps(bytes: number, ms: number): number {
  if (ms <= 0 || bytes <= 0) return 0;
  return Math.round(((bytes * 8) / (ms / 1000)) / 1_000_000 * 10) / 10;
}

// ── TCP probe (container ไม่มี ping binary — TCP connect วัดได้ทั้ง LAN และ internet) ──
export function probeTcp(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; latencyMs: number | null }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve({ ok, latencyMs: ok ? Date.now() - started : null });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/** HTTP probe ผ่านเน็ต — response อะไรก็ UP (แค่ network error = DOWN) */
export async function pingOnce(host: string): Promise<{ ok: boolean; latencyMs: number | null }> {
  const url = host.includes('://') ? host : `https://${host}`;
  const started = Date.now();
  try {
    await axios.get(url, {
      timeout: WAN_PING_TIMEOUT_MS,
      validateStatus: () => true,
      headers: { 'User-Agent': 'sovereign-os/1.0' },
    });
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

// ── State (in-memory) ──
let wanState: WanState = { up: true, since: new Date().toISOString(), lastCheck: new Date().toISOString(), latencyMs: null, host: WAN_PING_HOST };
let routerState: RouterState = { up: true, since: new Date().toISOString(), lastCheck: new Date().toISOString(), latencyMs: null };
let lanDevices: LanDevice[] = [];
let lastSpeedtest: SpeedtestResult | null = null;
let knownDevices = new Set<string>();
let started = false;

async function writeMetric(metric: string, value: number, deviceId = 'wan-monitor'): Promise<void> {
  try {
    await prisma.$queryRawUnsafe(
      `INSERT INTO sensor_telemetry (time, node_id, device_id, metric, value) VALUES (NOW(), '${NODE_ID}'::uuid, '${deviceId}', '${metric}', $1)`,
      value
    );
  } catch { /* DB ล่ม = offline-first — ข้าม */ }
}

export function getWanState(): WanState & {
  router: RouterState;
  lanDevices: LanDevice[];
  lastSpeedtest: SpeedtestResult | null;
  rebootConfigured: boolean;
  routerHost: string;
  subnet: string;
} {
  return {
    ...wanState,
    router: routerState,
    lanDevices,
    lastSpeedtest,
    rebootConfigured: !!ROUTER_REBOOT_CMD,
    routerHost: ROUTER_HOST,
    subnet: ROUTER_SUBNET,
  };
}

/** Phase 1: ตรวจตัว router เอง (TCP พอร์ต admin 80) — แยกปัญหา LAN ออกจากซิม */
export async function checkRouterNow(): Promise<RouterState> {
  const [admin] = await Promise.all([
    probeTcp(ROUTER_HOST, 80, 3000),
  ]);
  const ok = admin.ok;
  const now = new Date().toISOString();
  const prev = routerState.up;
  routerState = { up: ok, since: ok === prev ? routerState.since : now, lastCheck: now, latencyMs: admin.latencyMs };
  await writeMetric('router_state', ok ? 1 : 0, 'router-mr505');
  if (admin.latencyMs != null) await writeMetric('router_latency_ms', admin.latencyMs, 'router-mr505');
  if (ok !== prev) {
    const issue = classifyWanIssue(ok, wanState.up);
    const text = ok
      ? `🟢 Router กลับมา (${ROUTER_HOST}) ${admin.latencyMs ?? ''}ms — ฝั่ง LAN ปกติ`
      : `🔴 Router ไม่ตอบ (${ROUTER_HOST}) — สายแลน/ตัว router มีปัญหา (ไม่ใช่ซิม) — ตรวจสาย LAN กับโน้ตบุ๊ค`;
    await sendTelegramAlert({ text, severity: ok ? 'info' : 'critical', eventKey: `router_state:${ok ? 'up' : 'down'}:${now.slice(0, 10)}` }).catch(() => {});
    console.log(`🌐 Router ${ok ? 'UP' : 'DOWN'} (${issue})`);
  }
  return routerState;
}

/** Phase 2: สแกนอุปกรณ์ใน subnet (TCP sweep พอร์ต 80) — เตือนเมื่อเจออุปกรณ์ใหม่ */
export async function scanLanDevices(): Promise<LanDevice[]> {
  const found: LanDevice[] = [];
  const hosts: number[] = [];
  for (let i = 1; i <= 254; i++) hosts.push(i);
  // ยิงขนานทีละ 40 — 254 โฮสต์ × timeout 400ms ≈ 3 วิ
  const BATCH = 40;
  for (let i = 0; i < hosts.length; i += BATCH) {
    const batch = hosts.slice(i, i + BATCH).map(async (n) => {
      const r = await probeTcp(ipFromSubnet(ROUTER_SUBNET, n), LAN_SCAN_PORT, 400);
      if (r.ok && r.latencyMs != null) found.push({ ip: ipFromSubnet(ROUTER_SUBNET, n), latencyMs: r.latencyMs, firstSeen: new Date().toISOString() });
    });
    await Promise.all(batch);
  }
  lanDevices = found;
  await writeMetric('lan_devices', found.length, 'router-mr505');

  // เตือนอุปกรณ์ใหม่ (known set persist ใน SystemSetting — กัน spam หลัง restart)
  try {
    if (knownDevices.size === 0) {
      const row = await prisma.systemSetting.findUnique({ where: { key: KNOWN_DEVICES_KEY } });
      if (row?.value) knownDevices = new Set(JSON.parse(row.value) as string[]);
    }
    const newOnes = found.filter((d) => !knownDevices.has(d.ip));
    if (knownDevices.size > 0 && newOnes.length > 0) {
      await sendTelegramAlert({
        text: `🔍 เจออุปกรณ์ใหม่บนเน็ต router: ${newOnes.map((d) => d.ip).join(', ')} (รวม ${found.length} เครื่อง)`,
        severity: 'warn',
        eventKey: `lan_new_device:${newOnes.map((d) => d.ip).join(',')}:${new Date().toISOString().slice(0, 10)}`,
      }).catch(() => {});
    }
    knownDevices = new Set(found.map((d) => d.ip));
    await prisma.systemSetting.upsert({
      where: { key: KNOWN_DEVICES_KEY },
      update: { value: JSON.stringify([...knownDevices]) },
      create: { key: KNOWN_DEVICES_KEY, value: JSON.stringify([...knownDevices]) },
    });
  } catch { /* best-effort */ }
  return found;
}

/** Phase 3: speedtest — โหลดไฟล์จริงจาก Cloudflare วัด Mbps ผ่านซิม */
export async function runSpeedtest(): Promise<SpeedtestResult> {
  const started = Date.now();
  let bytes = 0;
  try {
    const res = await axios.get(`https://speed.cloudflare.com/__down?bytes=${SPEEDTEST_BYTES}`, {
      timeout: 30_000,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'sovereign-os/1.0' },
    });
    bytes = (res.data as ArrayBuffer).byteLength;
  } catch {
    lastSpeedtest = { mbps: 0, bytes: 0, ms: Date.now() - started, at: new Date().toISOString() };
    return lastSpeedtest;
  }
  const ms = Date.now() - started;
  lastSpeedtest = { mbps: parseSpeedtestMbps(bytes, ms), bytes, ms, at: new Date().toISOString() };
  await writeMetric('wan_downlink_mbps', lastSpeedtest.mbps);
  return lastSpeedtest;
}

/** Phase 0: ตรวจ WAN (HTTP ผ่านซิม) + ใช้ classify แจ้งเหตุผลตรงจุด */
export async function checkWanNow(): Promise<WanState> {
  let r = await pingOnce(WAN_PING_HOST);
  let usedHost = WAN_PING_HOST;
  if (!r.ok) {
    r = await pingOnce(WAN_PING_HOST_BACKUP);
    usedHost = WAN_PING_HOST_BACKUP;
  }
  const now = new Date().toISOString();
  const prevUp = wanState.up;
  wanState = { up: r.ok, since: r.ok === prevUp ? wanState.since : now, lastCheck: now, latencyMs: r.latencyMs, host: usedHost };
  await writeMetric('wan_state', r.ok ? 1 : 0);
  if (r.latencyMs != null) await writeMetric('wan_latency_ms', r.latencyMs);

  if (r.ok !== prevUp) {
    const issue = classifyWanIssue(routerState.up, r.ok);
    const reason = issue === 'LAN_DOWN'
      ? 'router เองไม่ตอบด้วย — ตรวจสาย LAN'
      : issue === 'SIM_DOWN'
        ? 'router ปกติ แต่ซิม/สัญญาณ LTE หลุด'
        : '';
    const text = r.ok
      ? `🟢 WAN กลับมา — ผ่าน ${usedHost} ${r.latencyMs ?? ''}ms · หลุดไป ${Math.round((Date.now() - new Date(wanState.since).getTime()) / 1000)}s`
      : `🔴 WAN หลุด — ${reason} ระบบทำงานต่อแบบ offline-first`;
    await sendTelegramAlert({ text, severity: r.ok ? 'info' : 'critical', eventKey: `wan_state:${r.ok ? 'up' : 'down'}:${now.slice(0, 10)}` }).catch(() => {});
  }
  return wanState;
}

/** ตรวจครบทั้ง router + WAN ในรอบเดียว (ให้ classify แม่น — router ต้องสดก่อนตัดสินซิม) */
export async function checkAllNow(): Promise<void> {
  await checkRouterNow();
  await checkWanNow();
}

/** เริ่ม cron ทั้งหมด (เรียกครั้งเดียวตอน boot จาก workers/start.ts) */
export function startWanMonitor(intervalMs = 60_000): void {
  if (started) return;
  started = true;
  checkAllNow().catch(() => {});
  setInterval(() => checkAllNow().catch(() => {}), intervalMs);
  if (LAN_SCAN_ENABLED) {
    scanLanDevices().catch(() => {});
    setInterval(() => scanLanDevices().catch(() => {}), 5 * 60_000); // ทุก 5 นาที
  }
  if (SPEEDTEST_ENABLED) {
    runSpeedtest().catch(() => {});
    setInterval(() => runSpeedtest().catch(() => {}), 30 * 60_000); // ทุก 30 นาที
  }
  console.log(`🌐 WAN+Router monitor started (MR505 @ ${ROUTER_HOST} · WAN ${Math.round(intervalMs / 1000)}s · LAN scan 5m · speedtest 30m)`);
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
