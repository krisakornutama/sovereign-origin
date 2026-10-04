import { test as setup, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

// setup ครั้งแรก: ล็อกอิน e2e-bot ผ่าน UI แล้วเก็บ localStorage (token) ให้ suite อื่นใช้
// รอบถัดไป: ถ้า state.json มี token ที่ยังใช้ได้ → ข้าม login เลย
// เหตุผล (เคสจริง 23-09-26): login ต่อบัญชี rate limit 5 ครั้ง/15 นาที — verify:full ที่รัน setup
// ซ้ำรอบละครั้งโดนบล็อกในรอบที่ 6 ทั้งที่ระบบปกติ → reuse token = เกตเสถียร
// ใช้ GET /api/features/me เป็นตัวตรวจ token (เบา, ต้อง auth, SUPERADMIN ตอบ 200)

const STATE_PATH = 'e2e/.auth/state.json';
const RUN_CREDS_PATH = 'e2e/.auth/creds.json';
const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:3001';

// รหัสของ "รอบวิ่งนี้" มาจาก e2e/global-setup.ts (สุ่มใหม่ทุกครั้ง แล้วล็อกกลับตอนจบ — ดู global-teardown)
// ต้องอ่านก่อน .env.playwright เสมอ ไม่งั้นจะไปใช้รหัสเก่าที่บัญชีไม่รับแล้ว (ล้ม 401 เหมือนรอบ nightly ก่อน 2/10)
function loadRunCreds(): void {
  try {
    if (!existsSync(RUN_CREDS_PATH)) return;
    const j = JSON.parse(readFileSync(RUN_CREDS_PATH, 'utf8')) as { username?: string; password?: string };
    if (j.username) process.env.E2E_BOT_USER = j.username;
    if (j.password) process.env.E2E_BOT_PASS = j.password;
  } catch {
    // ไฟล์เสีย/ไม่มี = ไปใช้ทางสำรองด้านล่าง
  }
}

// self-contained credentials: ถ้า runner ไม่ยัด env (เคสจริง 27/9 — สาย task → nightly-verify →
// playwright ไม่มีตัวไหนโหลด .env.playwright เลย) → โหลดเองจากไฟล์ (gitignored เสมอ)
// env จาก process.env ยังชนะถ้ามี — จึง override ได้ตามปกติ
function loadEnvPlaywright(): void {
  if (process.env.E2E_BOT_USER && process.env.E2E_BOT_PASS) return;
  // ลำดับ: ไฟล์ใน repo นี้ก่อน — ถ้าไม่มี (worktree) ไปอ่านที่ MAIN tree (gitignored ไม่เดินทางกับ git)
  // (จาก <worktree>/sovereign-frontend → MAIN ต้องขึ้น 4 ชั้น: frontend → wt → worktrees → .freebuff → MAIN)
  const candidates = ['.env.playwright', '../../../../sovereign-frontend/.env.playwright'];
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const raw = readFileSync(p, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        if (!line.includes('=') || line.trim().startsWith('#')) continue;
        const k = line.slice(0, line.indexOf('=')).trim();
        let v = line.slice(line.indexOf('=') + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (k === 'E2E_BOT_USER' && !process.env.E2E_BOT_USER) process.env.E2E_BOT_USER = v;
        if (k === 'E2E_BOT_PASS' && !process.env.E2E_BOT_PASS) process.env.E2E_BOT_PASS = v;
      }
    } catch {
      continue; // ไฟล์ไหนอ่านไม่ได้ — ไปลำดับถัดไป
    }
  }
}
loadRunCreds();
loadEnvPlaywright();

function tokenFromState(): string | null {
  try {
    if (!existsSync(STATE_PATH)) return null;
    const saved = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    for (const origin of saved?.origins ?? []) {
      for (const ls of origin?.localStorage ?? []) {
        const v = String(ls?.value ?? '');
        // ค่าเดา 2 แบบ: JWT ตรง ๆ หรือ zustand persist ({state:{token}}) อย่าง sovereign-auth
        if (/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v)) return v;
        try {
          const j = JSON.parse(v);
          const inner = j?.state?.token ?? j?.state?.accessToken ?? null;
          if (typeof inner === 'string' && /^ey[A-Za-z0-9_-]+\./.test(inner)) return inner;
        } catch {
          /* ไม่ใช่ JSON — ข้าม */
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

setup('authenticate as e2e-bot', async ({ page, request }) => {
  // โครงเวลา (บทเรียน 27/9): test timeout 180s หมดตั้งแต่รอบแรก (goto 60 + waitForURL 120)
  // → retry ที่เขียนทับด้วย page.waitForTimeout โดนปิดพร้อม page → รอบ 2–3 ไม่เคยได้รัน
  // แก้: ยกเพดาน setup เป็น 360s + ต่อรอบจำกัดเวลาสั้นลง + หน่วงด้วย setTimeout ปกติ (ไม่พึ่ง page)
  setup.setTimeout(360_000);

  // ── fast path: token เดิมยังมีชีวิต → ข้าม login ──
  const token = tokenFromState();
  if (token) {
    try {
      const res = await request.get(`${API_BASE}/api/features/me`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10_000,
      });
      if (res.ok()) {
        console.log('[e2e-setup] state.json ยังใช้ได้ — ข้าม login (กัน rate limit ต่อบัญชี)');
        return;
      }
    } catch {
      // API ล่ม/ตอบไม่ทัน → ล็อกอินใหม่ผ่าน UI ตามปกติ
    }
  }

  // ── login ผ่าน UI — ลองซ้ำได้ 3 รอบ (เคสจริง 26/9: รอบ 02:15 เครื่องเพิ่งตื่นจาก sleep
  // หน้า dev server/build worker ยังอุ่นไม่สุด → waitForURL 120s timeout = suite ทั้ง 63 spec ไม่ได้รันเลย) ──
  // ── ลำดับใหม่ 2/10/69: API login ก่อนเสมอ (1 ครั้ง) แล้วค่อย fallback ไป UI ──
  // เหตุผล: account limiter = 5 ครั้ง/15 นาที ต่อ username (auth.routes.ts) — เดิม UI 3 รอบ + API 1 = 4
  // ครั้งต่อรอบ กินเกือบเต็มโควตา พอรันซ้ำก่อนครบ 15 นาที = 429 แล้ว suite ทั้งชุดล้ม (เจอจริงรอบนี้)
  // ตัว login ผ่าน UI ยังถูกทดสอบใน login.spec.ts (project anonymous) เหมือนเดิม
  let apiLogin = async (why: string): Promise<boolean> => {
    const res = await request.post(`${API_BASE}/api/auth/login`, {
      data: { username: process.env.E2E_BOT_USER ?? 'e2e-bot', password: process.env.E2E_BOT_PASS ?? '' },
      timeout: 15_000,
    });
    if (res.status() === 429) {
      // โดนแล้ว = ทาง UI ก็จะโดนเหมือนกัน (โหมดเดียวกัน) → หยุดทันที ไม่เผาโควตาต่อ
      throw new Error('โดน rate limit ต่อบัญชี (5 ครั้ง/15 นาที) — รอประมาณ 15 นาทีแล้วรันซ้ำ');
    }
    if (!res.ok()) {
      console.log(`[e2e-setup] API login ${why} ล้ม: HTTP ${res.status()}`);
      return false;
    }
    const j = (await res.json()) as { token?: string };
    if (!j.token) return false;
    // localStorage ใช้ไม่ได้บน about:blank (SecurityError) — API-first ไม่ได้ผ่านฟอร์ม UI
    // จึงต้องพาไปหน้าแอปก่อน 1 ครั้ง (เดิมโหมด fallback ได้ navigate มาแล้วตอนวน UI)
    if (!page.url().startsWith('http')) await page.goto('/', { timeout: 45_000 });
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      ['sovereign-auth', JSON.stringify({ state: { token: j.token }, version: 0 })],
    );
    await page.context().storageState({ path: STATE_PATH });
    console.log('[e2e-setup] API login สำเร็จ — storage state เขียนแล้ว');
    return true;
  };

  if (await apiLogin('รอบแรก')) return;

  let uiSucceeded = false;
  for (let attempt = 1; attempt <= 2 && !uiSucceeded; attempt++) {
    try {
      await page.goto('/', { timeout: 45_000 });
      await page.locator('input[autocomplete="username"]').fill(process.env.E2E_BOT_USER ?? 'e2e-bot');
      await page.locator('input[autocomplete="current-password"]').fill(process.env.E2E_BOT_PASS ?? '');
      await page.locator('button[type="submit"]').click();
      // รอ redirect ไป dashboard — ต่อรอบ ≤ 45s ให้ครบ 3 รอบในเพดาน 360s
      // trailingSlash เปิดอยู่ → redirect ได้ทั้ง /dashboard และ /dashboard/
      await page.waitForURL(/\/dashboard\/?$/, { timeout: 45_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 });
      await expect(page).toHaveURL(/dashboard/);
      await page.context().storageState({ path: STATE_PATH });
      uiSucceeded = true;
    } catch (e) {
      if (attempt === 2) break; // ออกจากลูป → ไหลต่อไป fallback API login ด้านล่าง (บั๊กเดิม: throw ที่นี่ทำ fallback ไม่มีวันรัน)
      console.log(`[e2e-setup] login รอบ ${attempt} พลาด (${e instanceof Error ? e.message.split('\n')[0] : e}) — ลองใหม่ใน 15 วิ`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }

  if (!uiSucceeded) {
    // ── fallback: API login + inject localStorage (เคสจริง 27/9 03:00) ──
    // อาการ: ฟอร์มกรอกครบ กดแล้ว "เงียบ" — trace ไม่มี POST /api/auth/login เลย เพราะหน้า dev
    // ไม่ hydrate (verify rebuild .next ทับระหว่าง dev server กำลัง serve → chunk ไม่ตรง)
    // แก้ที่ต้นทางไม่ได้ใน setup → login ผ่าน API จริงแทน (backend เดิม รหัสเดิม แค่ไม่ผ่าน UI)
    // แล้ว inject localStorage รูปร่างเดียวกับที่หน้า login เขียน (zustand persist sovereign-auth)
    // — ตัว login ผ่าน UI ยังถูกทดสอบเฉพาะใน login.spec.ts ตามเดิม
    console.log('[e2e-setup] UI login พัง 3 รอบ — สลับไป API login + inject localStorage (กันหน้า dev ไม่ hydrate)');
    const res = await request.post(`${API_BASE}/api/auth/login`, {
      data: { username: process.env.E2E_BOT_USER ?? 'e2e-bot', password: process.env.E2E_BOT_PASS ?? '' },
      timeout: 15_000,
    });
    if (!res.ok()) throw new Error(`API login ล้มเหลว: HTTP ${res.status()}`);
    const j = (await res.json()) as { token?: string };
    if (!j.token) throw new Error('API login ไม่คืน token');
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      ['sovereign-auth', JSON.stringify({ state: { token: j.token }, version: 0 })],
    );
    await page.context().storageState({ path: STATE_PATH });
    console.log('[e2e-setup] API login สำเร็จ — storage state เขียนแล้ว');
  }
});
