// json-checksum.mjs — เขียน JSON พร้อม sidecar .sha256 (สัญญาเดียวกับ core-api saveJsonAtomic)
//
// ทำไมต้องมี: data-integrity.service.ts สแกน data/*.json ทุกครั้งที่ container บูต + ทุกสัปดาห์
// ถ้า host tool เขียน JSON ตรง ๆ โดยไม่อัปเดต sidecar → checksum ไม่ตรง → ระบบตีเป็น BIT_ROT
// (critical) แล้ว quarantine สำเนาไว้ทุกครั้ง — เจอจริง 276 ไฟล์ .corrupt-* ใน data/
// (nightly-history.json, ops-status.json, system-truth.json ที่ tools เขียนเอง)
//
// กติกา: เขียน tmp → เขียน sidecar (hash ของ body เดียวกันเป๊ะ) → rename ทับ
//   - body ที่เขียนกับ body ที่ hash ต้องเป็นสตริงเดียวกัน (รวม \n ท้ายไฟล์)
//   - ผู้อ่าน core-api (readJsonVerified) hash เนื้อไฟล์ทั้งก้อน → ต้องตรง
import { createHash } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * เขียน JSON แบบ atomic + sidecar checksum ที่ตรงกับเนื้อไฟล์จริง
 * @param {string} file  ปลายทาง (เช่น .../data/nightly-history.json)
 * @param {unknown} data ข้อมูลที่จะ JSON.stringify
 * @param {{ pretty?: boolean }} [opts] pretty=false → JSON แถวเดียว (แบบ ops-status เดิม)
 * @returns {string} body ที่เขียนจริง (ใช้ทดสอบได้)
 */
export function writeJsonWithChecksum(file, data, opts = {}) {
  const pretty = opts.pretty !== false;
  const body = pretty ? `${JSON.stringify(data, null, 2)}\n` : JSON.stringify(data);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, body, 'utf8');
  writeFileSync(`${file}.sha256`, sha256(body), 'utf8');
  renameSync(tmp, file);
  return body;
}
