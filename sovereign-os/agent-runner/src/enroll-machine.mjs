// src/enroll-machine.mjs
//
// ── ลงทะเบียนเครื่องใหม่ด้วยตัวเอง (ไม่ต้องออกชุดทีละเครื่อง) ──────────���─────
// เดิม: ทุกเครื่องต้องมี join.json ที่ HUB ฝัง machineToken ไว้ก่อน
//   เพราะ HUB ระบุตัวเครื่องจาก token_hash ⇒ ก๊อปชุดเดียวไปหลายเครื่อง
//   จะกลายเป็นเครื่องเดียวในมุมมอง HUB (แยกไม่ออก / ถอนไม่ได้รายเครื่อง)
//
// ใหม่ (เจ้าของสั่ง 11/10/69 "ไฟล์เดียวจบ"): เครื่องใหม่เอา "รหัสเชิญ"
//   ไปขอ token ของตัวเองจาก HUB ครั้งแรก แล้วเขียน .env เหมือนเดิม
//
// ── ทำไมถึง "ไฟล์เดียวใช้ได้ทุกเครื่อง" ─────────────────────────────────
// ตัวที่ต้องเป็นของเฉพาะเครื่องมีแค่ token (64 ตัวอักษรใน .env)
// ส่วนโค้ด runner ทั้งหมดเหมือนกันหมด ⇒ ก๊อปชุดเดียวไปกี่เครื่องก็ได้
// แต่ละเครื่องจะได้ token ของตัวเองตอนรันครั้งแรก

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** ชื่อเครื่องเริ่มต้น = ชื่อเครื่องจริงของ Windows (อ่านง่ายกว่าตั้งเอง) */
export function defaultMachineName() {
  return String(os.hostname() || '').trim() || 'เครื่องใหม่';
}

/** ตัดชื่อให้สั้นและปลอดภัยก่อนส่ง (กันชื่อยาว/มีอักขระควบคุม) */
export function normalizeName(raw) {
  return String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

/**
 * สร้าง payload สำหรับ POST /api/agent-machines/enroll
 * @returns {{ok: true, body: object} | {ok: false, error: string}}
 */
export function buildEnrollBody({ hubUrl, code, name, os: osName, executors, version } = {}) {
  const hub = String(hubUrl ?? '').trim().replace(/\/+$/, '');
  if (!hub) return { ok: false, error: 'ไม่พบ HUB_URL — ต้องระบุที่อยู่ของเครื่อง HUB' };
  if (!/^https?:\/\//i.test(hub)) return { ok: false, error: `HUB_URL ไม่ใช่ URL ที่ถูกต้อง: ${hub}` };

  const machineName = normalizeName(name || defaultMachineName());
  if (!machineName) return { ok: false, error: 'คำนวณชื่อเครื่องไม่ได้' };

  const enrollCode = String(code ?? '').trim();
  if (!enrollCode) return { ok: false, error: 'ไม่พบรหัสเชิญ (MACHINE_ENROLL_CODE) — ขอรหัสจากเจ้าของ HUB' };

  return {
    ok: true,
    body: {
      code: enrollCode,
      name: machineName,
      os: String(osName || 'windows'),
      executors: Array.isArray(executors) && executors.length ? executors : ['echo'],
      version: String(version ?? ''),
    },
  };
}

/** URL ของ endpoint ลงทะเบียน */
export function enrollUrl(hubUrl) {
  return `${String(hubUrl).replace(/\/+$/, '')}/api/agent-machines/enroll`;
}

/**
 * แปลงคำตอบจาก HUB → {ok, token} | {ok:false, error}
 * แยกเป็นฟังก์ชันเพื่อเทสต์ได้โดยไม่ต้องเปิดเครือข่าย
 */
export function parseEnrollResponse(status, text) {
  let json = null;
  try {
    json = JSON.parse(String(text ?? ''));
  } catch {
    json = null;
  }
  if (status === 201 && json?.token) {
    return { ok: true, token: String(json.token), id: String(json.id ?? ''), name: String(json.name ?? '') };
  }
  // HUB ไม่คืนรหัสเชิญกลับมาเด็ดขาด (ดู machine-enroll.service) — เอาข้อความมาแสดงได้
  const why = String(json?.error ?? json?.message ?? '').trim();
  const statusText = {
    400: 'รหัสเชิญหรือชื่อเครื่องไม่ถูกต้อง',
    404: 'HUB ไม่ได้เปิดให้ลงทะเบียนเอง (ยังไม่ได้ตั้ง MACHINE_ENROLL_CODE)',
    429: 'ลองผิดหลายครั้งเกินไป — พักสักครู่แล้วลองใหม่',
    500: 'HUB มีข้อผิดพลาดฝั่งเซิร์ฟเวอร์',
  }[status];
  return { ok: false, error: why || statusText || `ลงทะเบียนไม่สำเร็จ (HTTP ${status})` };
}

/**
 * ขอ token จาก HUB
 * @param deps.fetch ใส่ fetch ปลอมในเทสต์ได้
 */
export async function enroll(opts, deps = {}) {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const built = buildEnrollBody(opts);
  if (!built.ok) return built;
  if (typeof doFetch !== 'function') return { ok: false, error: 'สภาพแวดล้อมนี้ไม่มี fetch' };

  const url = enrollUrl(opts.hubUrl);
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(built.body),
    });
    const text = await res.text();
    return parseEnrollResponse(res.status, text);
  } catch (err) {
    // ต่อ HUB ไม่ได้ = บอกให้ชัดว่าเป็นปัญหาเครือข่าย ไม่ใช่รหัสผิด
    return { ok: false, error: `ต่อ HUB ไม่ได้ (${url}) — ตรวจว่าเครื่อง HUB เปิดอยู่และอยู่ในเครือข่ายเดียวกัน` };
  }
}

/** เขียน .env ของ runner (รูปแบบเดียวกับที่ setup-machine.mjs เขียนตอนมี join.json) */
export function writeEnvFile(dir, { hubUrl, token, machineName, executors = ['echo'], fsRoots }) {
  const roots = Array.isArray(fsRoots) && fsRoots.length ? fsRoots : ['E:\\'];
  const body = [
    '# สร้างอัตโนมัติโดย enroll-machine.mjs — ลงทะเบียนกับ HUB เอง (แก้ได้ตามต้องการ ห้าม commit)',
    `HUB_URL=${String(hubUrl).replace(/\/+$/, '')}`,
    `MACHINE_TOKEN=${token}`,
    `MACHINE_NAME=${normalizeName(machineName) || defaultMachineName()}`,
    `ENABLED_EXECUTORS=${executors.join(',')}`,
    '',
    '# ช่องควบคุมระยะไกล — สั่งได้เฉพาะ SUPERADMIN ที่ผูกเครื่องนี้ไว้แล้ว',
    'ENABLE_REMOTE_CONTROL=true',
    'REMOTE_MAX_WIDTH=1280',
    `REMOTE_FS_ROOTS=${roots.join(';')}`,
    '',
    '# จับภาพหน้าจอตอนจบงาน + รอบดึงงาน',
    'CAPTURE_SCREENSHOT=true',
    'POLL_INTERVAL_MS=15000',
    '',
  ].join('\r\n');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.env'), body, 'utf8');
  return path.join(dir, '.env');
}