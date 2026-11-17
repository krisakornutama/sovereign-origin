// ────────────────────────────────────────────────────────────────────────────
// verify-fail-log.mjs — บันทึก output ของขั้นที่พังใน `npm run verify`
//
// ทำไมต้องมี: `tools/verify.mjs` เดิมรันแต่ละขั้นด้วย stdio 'pipe' แล้วกลืน output ทิ้ง
// เมื่อขั้นล้มจะพิมพ์แค่ `▶ tools: unit tests ... พัง (exit 1)` ⇒ แยกไม่ออกว่า
//   · เทสต์ไฟล์ไหนล้ม เพราะอะไร (assertion / timeout / port ซ้ำ)
//   · หรือเป็นความพังจริงของโค้ด
// เคสจริง 17/11/69: ขั้น tools ล้มครั้งแรกติด 3 verify run แล้วผ่านตอน flake guard
// โดยไม่มีหลักฐานเหลือเลย — ต้องรันทั้ง gate ใหม่เพื่อเดา
// และเคส 17/11/69 (รอบ 2): ล้มซ้ำอีก แต่ log ที่ได้ **0 ไบต์** ⇒ spawn ล้มก่อนโปรเซสลูกจะเขียนอะไร
//   ⇒ ต้องเก็บ metadata (cmd/args/cwd/status/signal/error) ไว้ด้วย ไม่ใช่แค่ stdout/stderr
//
// กติกา: ตัวนี้ต้องไม่ทำให้ด่านที่กำลังรายงานผล "ล้มเพราะ log"
//   ⇒ เขียนไฟล์ไม่ได้ = คืน null + พิมพ์ต่อ ไม่ throw
// ────────────────────────────────────────────────────────────────────────────
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** ชื่อขั้น → ส่วนของชื่อไฟล์ที่อ่านออก (ตัดอักขระที่ Windows ห้าม) */
function slug(name) {
  const s = String(name ?? 'step')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'step';
}

/**
 * เขียน stdout+stderr ของขั้นที่พังลงไฟล์ แล้วพิมพ์เฉพาะท้ายออกจอ
 *
 * @param {{name?: string, stdout?: string, stderr?: string}} step ขั้นที่พัง
 * @param {{dir: string, now?: number, log?: (s: string) => void, tailLines?: number}} opts
 * @returns {string | null} path ของ log (null = เขียนไม่ได้)
 */
export function dumpVerifyFailure(step, opts) {
  const { dir, now = Date.now(), log = (s) => console.log(s), tailLines = 40 } = opts ?? {};
  const text = `${step?.stdout ?? ''}${step?.stderr ?? ''}`.trimEnd();
  const meta = step?.meta ? `${String(step.meta).trimEnd()}\n` : '';
  const file = join(dir, `verify-fail-${slug(step?.name)}-${now}.log`);

  let path = null;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${meta}${text}\n`, 'utf8');
    path = file;
    log(`   ↳ log ของขั้นที่พัง: ${file} (${Buffer.byteLength(text, 'utf8')} ไบต์${meta ? ' + metadata' : ''})`);
  } catch (err) {
    log(`   ↳ เขียน log ไม่ได้: ${err instanceof Error ? err.message : String(err)}`);
  }

  const lines = text.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const tail = lines.slice(-tailLines);
  if (tail.length) {
    log(`   ┌─ ท้าย output (${tail.length} บรรทัด) ─`);
    for (const line of tail) log(`   │ ${line}`);
    log('   └─');
  }
  return path;
}
