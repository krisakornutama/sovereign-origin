#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// nightly-deadman.mjs — เตือน Telegram เมื่อ nightly ไม่ผ่าน/ไม่ส่งผลติดกัน N คืน
//
// ทำไมต้องมี: nightly-report ส่ง "ผลรอบล่าสุด" ทุกคืน แต่ถ้า nightly ไม่รันเลย
// (เครื่องหลับทั้งคืน / task ถูกปิด / process ค้าง) จะไม่มีใครส่งอะไรมาบอก
// ⇒ dead-man switch ตัวนี้เป็นคนนอกที่ตรวจ "ผลควรมีหรือยัง" จาก nightly-history.json
//
// ใช้: node tools/nightly-deadman.mjs           → ตรวจ + ส่ง Telegram (ถ้าถึงเกณฑ์)
//      node tools/nightly-deadman.mjs --dry     → พิมพ์ข้อความ ไม่ส่ง/ไม่เขียน state
//      node tools/nightly-deadman.mjs --today=2026-11-06  → ตรวจย้อนวันที่กำหนด (ทดสอบ)
//
// กติกาเวลา: nightly 02:00 เวลาไทย = 19:00 UTC · history เก็บ day ตาม UTC
// ⇒ รอบ 02:00 ของ 7/11 เวลาไทย เขียน day = 2026-11-06
// ⇒ "รอบล่าสุดที่ควรมีผล" = day ของ 19:00 UTC ล่าสุด + เผื่อเวลา 60 นาที
//
// soft-fail: อ่าน history/state ไม่ได้ = ถือว่าไม่มีข้อมูล (นับเป็นคืนที่ขาด)
// แต่ถ้าส่ง Telegram ไม่สำเร็จ = exit 1 เพื่อให้ Task Scheduler/ops-status เห็น
// ────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notify } from './verify/telegram-creds.mjs';

const DAY_MS = 86_400_000;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// log/state/history อยู่ MAIN เสมอ — deadman อาจถูกรันจาก worktree ตอนทดสอบ
const MAIN_ROOT = (() => {
  const i = REPO.indexOf('.freebuff');
  return i > 3 ? REPO.slice(0, i).replace(/[\\/]+$/, '') : REPO;
})();
const HISTORY = path.join(MAIN_ROOT, 'sovereign-os', 'core-api', 'data', 'nightly-history.json');
const LOGDIR = path.join(MAIN_ROOT, 'logs', 'nightly');
const STATE = path.join(LOGDIR, 'deadman-state.json');
const LOG = path.join(LOGDIR, 'deadman.log');

export const DEFAULT_THRESHOLD = 2; // 2 คืนติดตามข้อกำหนด P0
export const DEFAULT_MAX_DAYS = 14;
export const NIGHTLY_RUN_UTC_HOUR = 19; // 02:00 Asia/Bangkok (UTC+7)
export const NIGHTLY_RESULT_GRACE_MIN = 60; // เผื่อ nightly ใช้เวลาหลายนาที

/**
 * day (UTC) ของรอบ nightly ล่าสุดที่ "ควรมีผลแล้ว"
 * — ก่อน 20:00 UTC ของวันนั้น = ยังไม่ถึงรอบ 02:00 เวลาไทย จึงย้อนไปวันก่อน
 */
export function latestNightlyDay(now = new Date(), {
  runUtcHour = NIGHTLY_RUN_UTC_HOUR,
  graceMin = NIGHTLY_RESULT_GRACE_MIN,
} = {}) {
  const d = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(d.getTime())) return '';
  const cutoff = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    runUtcHour,
    graceMin,
    0,
    0,
  );
  const latest = d.getTime() >= cutoff ? d.getTime() : d.getTime() - DAY_MS;
  return new Date(latest).toISOString().slice(0, 10);
}

/**
 * นับคืนที่ไม่ผ่านติดกันจาก "รอบล่าสุดที่ควรมีผล" ย้อนหลัง
 * - entry ok=true = หยุดนับทันที
 * - entry ok=false หรือไม่มี entry = นับเป็นคืนที่ไม่ผ่าน
 */
export function consecutiveFailures(history, {
  now = new Date(),
  maxDays = DEFAULT_MAX_DAYS,
  runUtcHour = NIGHTLY_RUN_UTC_HOUR,
  graceMin = NIGHTLY_RESULT_GRACE_MIN,
} = {}) {
  const endDay = latestNightlyDay(now, { runUtcHour, graceMin });
  if (!endDay) return { endDay: '', streak: 0, days: [] };

  const entries = new Map();
  for (const e of Array.isArray(history) ? history : []) {
    const day = String(e?.day ?? '').slice(0, 10);
    if (day) entries.set(day, e);
  }

  const base = Date.parse(`${endDay}T00:00:00.000Z`);
  const limit = Math.max(1, Math.floor(Number(maxDays) || DEFAULT_MAX_DAYS));
  const days = [];
  for (let i = 0; i < limit; i += 1) {
    const day = new Date(base - i * DAY_MS).toISOString().slice(0, 10);
    const entry = entries.get(day);
    if (entry?.ok === true) break; // ผ่านคืนนี้ = streak ขาด
    days.push({ day, ok: entry ? entry.ok === true : null, missing: !entry });
  }
  return { endDay, streak: days.length, days };
}

/** ตัดสินว่าจะเตือนรอบนี้ไหม — dedup ตาม endDay (เตือนซ้ำได้วันละครั้ง) */
export function decideDeadman({
  history,
  now = new Date(),
  threshold = DEFAULT_THRESHOLD,
  maxDays = DEFAULT_MAX_DAYS,
  lastAlertDay = '',
  runUtcHour = NIGHTLY_RUN_UTC_HOUR,
  graceMin = NIGHTLY_RESULT_GRACE_MIN,
} = {}) {
  const limit = Math.max(1, Math.floor(Number(threshold) || DEFAULT_THRESHOLD));
  const { endDay, streak, days } = consecutiveFailures(history, { now, maxDays, runUtcHour, graceMin });
  const reached = streak >= limit;
  return {
    endDay,
    streak,
    days,
    threshold: limit,
    reached,
    alert: reached && lastAlertDay !== endDay,
    suppressed: reached && lastAlertDay === endDay,
  };
}

/** ข้อความ Telegram (plain text — ไม่ต้อง escape HTML) */
export function buildAlertText({ streak = 0, days = [], endDay = '', threshold = DEFAULT_THRESHOLD } = {}) {
  const shown = days.slice(0, 7).map((d) => `• ${d.day} — ${d.missing ? 'ไม่พบผล (nightly ไม่รัน/ค้าง)' : 'ไม่ผ่าน'}`);
  const more = days.length > 7 ? `\n… และอีก ${days.length - 7} คืน` : '';
  return `🚨 Nightly ไม่ผ่านติดกัน ${streak} คืน (เกณฑ์ ${threshold})\n\n` +
    `รอบล่าสุดที่ควรมีผล: ${endDay || '—'}\n` +
    `${shown.join('\n')}${more}\n\n` +
    'ดู logs/nightly/status.json · logs/nightly/last-run.log';
}

function positiveInt(value, fallback) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readHistory(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) || {}; } catch { return {}; }
}

function writeState(state) {
  try {
    fs.mkdirSync(LOGDIR, { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
  } catch { /* เขียนไม่ได้ = รอบหน้าอาจเตือนซ้ำ (ยอมรับได้) */ }
}

function log(entry) {
  try {
    fs.mkdirSync(LOGDIR, { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch { /* log ไม่ได้ = ข้าม */ }
}

async function main() {
  const dry = process.argv.includes('--dry');
  const todayArg = process.argv.find((a) => a.startsWith('--today='));
  const now = todayArg
    ? new Date(`${todayArg.slice('--today='.length)}T12:00:00.000Z`)
    : new Date();
  const threshold = positiveInt(process.env.NIGHTLY_DEADMAN_THRESHOLD, DEFAULT_THRESHOLD);
  const maxDays = positiveInt(process.env.NIGHTLY_DEADMAN_MAX_DAYS, DEFAULT_MAX_DAYS);
  const history = readHistory(HISTORY);
  const state = readState();
  const d = decideDeadman({
    history,
    now,
    threshold,
    maxDays,
    lastAlertDay: typeof state.lastAlertDay === 'string' ? state.lastAlertDay : '',
  });

  console.log(
    `deadman: streak=${d.streak}/${threshold} · endDay=${d.endDay || '—'} · ` +
    `alert=${d.alert}${d.suppressed ? ' (dedup วันนี้แล้ว)' : ''}`,
  );
  log({
    streak: d.streak,
    threshold,
    endDay: d.endDay,
    alert: d.alert,
    suppressed: d.suppressed,
    dry,
    days: d.days.map((x) => x.day),
  });

  if (!d.alert) {
    process.exitCode = 0;
    return;
  }

  const text = buildAlertText(d);
  if (dry) {
    console.log(`[dry] จะส่งข้อความ:\n${text}`);
    process.exitCode = 0;
    return;
  }

  const sent = await notify(text);
  if (sent.ok) {
    writeState({
      lastAlertDay: d.endDay,
      lastAlertAt: new Date().toISOString(),
      lastStreak: d.streak,
      threshold,
    });
    console.log('ส่งแจ้งเตือน dead-man เข้า Telegram แล้ว');
    log({ sent: true, endDay: d.endDay, streak: d.streak });
    process.exitCode = 0;
    return;
  }

  // ส่งไม่ได้ = ปล่อยให้ Task Scheduler เห็นเป็นงานล้ม เพื่อไม่ให้ความพังเงียบ
  console.error(`ส่งแจ้งเตือนไม่สำเร็จ (จะลองใหม่รอบหน้า): ${sent.error}`);
  log({ sent: false, endDay: d.endDay, streak: d.streak, error: sent.error });
  process.exitCode = 1;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
const self = path.resolve(fileURLToPath(import.meta.url));
if (entry && entry.toLowerCase() === self.toLowerCase()) {
  main().catch((err) => {
    console.error(`deadman runner error: ${err instanceof Error ? err.stack : String(err)}`);
    process.exitCode = 1;
  });
}
