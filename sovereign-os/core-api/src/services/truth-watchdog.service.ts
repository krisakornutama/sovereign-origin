// src/services/truth-watchdog.service.ts
//
// Truth Watchdog — แจ้งเตือน Telegram ทันทีเมื่อ "ความจริง" ผิดปกติ (Phase 2 arch-hardening)
// ตรวจจาก data/system-truth.json ที่ tools/verify.mjs เขียนทุกรอบ verify:
//   1) codeMatch=false → prod รันโค้ดเก่า (disk fingerprint ≠ runtime fingerprint) — warn ทวนทุก 5 นาที (dedup)
//   2) lastGateRun.ok=false → เกตล่าสุดมีขั้นพัง — warn ทวนทุก 5 นาที
//   3) stale: truth file เก่าเกิน 48 ชม. → warn (เกตไม่เคยรัน = หลุมตาบอด)
//
// หลักการ: soft-fail ทั้งหมด — ไม่มี token/ไฟล์หาย/Telegram ล่ม = log เงียบ ไม่หยุดระบบ
// แจ้งครั้งแรกเมื่อพบปัญหา + ทวนตาม dedup window ของ dispatcher (TELEGRAM_DEDUP_WINDOW_MS)
// การแก้ไขที่ถูกต้องคือรัน verify:full (rebuild + restart ให้เอง) — ข้อความแจ้งระบุทางแก้ทุกครั้ง

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getTelegramAlertDispatcher } from './telegram-alert.service';

interface SystemTruth {
  writtenAt?: string;
  ok?: boolean;
  steps?: Array<{ name?: string; ok?: boolean; skipped?: boolean }>;
  prodTruth?: { diskFingerprint?: string | null; diskFiles?: number | null };
}

// fingerprint ของโค้ดที่โปรเซสนี้โหลด (แคช — โค้ดที่โหลดแล้วไม่เปลี่ยนกลางอากาศ)
let runtimeFp: string | null = null;
async function getRuntimeFp(): Promise<string | null> {
  if (runtimeFp) return runtimeFp;
  try {
    const { getSelfFingerprint } = await import('../lib/runtime-fingerprint');
    runtimeFp = (await getSelfFingerprint()).fingerprint;
    return runtimeFp;
  } catch {
    return null;
  }
}

function readTruth(): SystemTruth | null {
  try {
    const p = join(process.cwd(), 'data', 'system-truth.json');
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8')) as SystemTruth;
  } catch {
    return null;
  }
}

async function check(): Promise<void> {
  const truth = readTruth();
  if (!truth) return; // ยังไม่เคยรัน verify บนเครื่องนี้ — เงียบไว้ (ไม่ใช่ความผิดปกติ)

  // 1) prod รันโค้ดเก่า — disk fingerprint ≠ ที่โปรเซสโหลดจริง
  const diskFp = truth.prodTruth?.diskFingerprint ?? null;
  if (diskFp) {
    const rt = await getRuntimeFp();
    if (rt && diskFp !== rt) {
      await getTelegramAlertDispatcher().send({
        severity: 'warn',
        eventKey: 'truth:code-mismatch',
        text:
          `⚠️ <b>Prod รันโค้ดเก่า!</b>\n` +
          `runtime <code>${rt}</code> ≠ disk <code>${diskFp}</code>\n` +
          `→ แก้: รัน <code>npm run verify:full</code> (rebuild + restart ให้เอง)`,
      });
    }
  }

  // 2) เกตล่าสุดพัง
  if (truth.ok === false) {
    const failed = (truth.steps ?? [])
      .filter((s) => !s.ok && !s.skipped)
      .map((s) => s.name)
      .join(', ');
    await getTelegramAlertDispatcher().send({
      severity: 'warn',
      eventKey: 'truth:gate-failed',
      text:
        `⚠️ <b>เกตล่าสุดมีขั้นพัง</b>${failed ? `: ${failed}` : ''}\n` +
        `→ ดูรายละเอียด: หน้า /system-health หรือ log ของ npm run verify`,
    });
  }

  // 3) truth เก่าเกิน 48 ชม. — เกตไม่เคยรันนานเกิน (หลุมตาบอด)
  if (truth.writtenAt) {
    const ageMs = Date.now() - new Date(truth.writtenAt).getTime();
    if (ageMs > 48 * 60 * 60 * 1000) {
      await getTelegramAlertDispatcher().send({
        severity: 'warn',
        eventKey: 'truth:stale',
        text:
          `⚠️ <b>ไม่มีการรัน verify มา ${(ageMs / 3_600_000).toFixed(0)} ชม.</b>\n` +
          `→ ควรรัน <code>npm run verify</code> เพื่อยืนยันสุขภาพระบบ`,
      });
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
const startedAt = Date.now();

/** เริ่มตรวจทุก 5 นาที (เรียกจาก workers/start.ts) — idempotent */
export function startTruthWatchdog(intervalMs = 5 * 60_000): void {
  if (timer) return;
  // เช็คครั้งแรกหลังเปิดตัว 2 นาที (ให้ DB/บริการอื่นบูตเสร็จก่อน)
  const first = setTimeout(() => {
    check().catch(() => {});
  }, 2 * 60_000);
  if (typeof first.unref === 'function') first.unref();
  timer = setInterval(() => {
    // ยังไม่เคยมีผู้ใช้ / เพิ่งบูตใหม่ ไม่ต้องรบกวน — เริ่มหลังระบบ warm พอ
    check().catch(() => {});
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  void startedAt;
}
