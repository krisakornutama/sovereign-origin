// verify-truth.mjs — สร้าง/เขียน data/system-truth.json (ผล quality gate ล่าสุด)
//
// แยกออกจาก verify.mjs เพื่อให้เทสต์ได้ตรง ๆ: ปัญหาเดิมคือ verify เขียนไฟล์นี้เฉพาะ
// เส้นทางที่จบสำเร็จ พอ step ใดล้ม (process.exit(1)) → ไฟล์ไม่ถูกเขียน → nightly อ่าน
// lastGateOk = null ติดกันหลายรอบโดยไม่มีใครรู้
//
// กติกา:
//   - results ว่าง = ยังไม่ได้รันอะไรเลย → ok=false (ไม่ใช่ "ผ่านโดยปริยาย")
//   - ok ต้องเป็น true ก็ต่อเมื่อมี step อย่างน้อย 1 และทุก step ผ่าน
//   - เขียนผ่าน writeJsonWithChecksum → มี .sha256 คู่ไฟล์ กัน data-integrity ตีเป็น BIT_ROT
import { existsSync, readFileSync } from 'node:fs';
import { computeDirFingerprintSync } from './fingerprint-lib.mjs';
import { writeJsonWithChecksum } from './json-checksum.mjs';

/**
 * @param {object} opts
 * @param {Array<{name:string, ok:boolean, skipped?:boolean}>} opts.results
 * @param {string} opts.truthPath  ปลายทาง data/system-truth.json
 * @param {string} opts.deployDist โฟลเดอร์ dist ที่ deploy จริง (ไว้เทียบ fingerprint)
 * @returns {object} ข้อมูลที่เขียน
 */
export function buildTruth({ results, truthPath, deployDist }) {
  let prevProdTruth = null;
  try {
    prevProdTruth = JSON.parse(readFileSync(truthPath, 'utf8'))?.prodTruth ?? null;
  } catch {
    /* รอบแรกยังไม่มีไฟล์ */
  }

  let diskFingerprint = null;
  let diskFiles = null;
  // ต้องเช็ค existsSync ก่อน: computeDirFingerprintSync ไม่ throw เมื่อโฟลเดอร์ไม่มี
  // (คืน hash ของ "ไม่มีอะไร" → health page จะโชว์ fingerprint ปลอม)
  if (existsSync(deployDist)) {
    try {
      const disk = computeDirFingerprintSync(deployDist);
      diskFingerprint = disk.fingerprint;
      diskFiles = disk.files;
    } catch {
      /* อ่าน dist ไม่ได้ = ไม่มีข้อมูลเทียบ (ไม่ทำให้เกตล้ม) */
    }
  }

  return {
    writtenAt: new Date().toISOString(),
    ok: results.length > 0 && results.every((r) => r.ok),
    steps: results.map((r) => ({ name: r.name, ok: r.ok, skipped: !!r.skipped })),
    prodTruth: {
      diskFingerprint,
      diskFiles,
      diskDir: 'sovereign-os/core-api/dist (deploy root)',
    },
    _prevProdTruth: prevProdTruth,
  };
}

export function writeSystemTruth(opts) {
  const data = buildTruth(opts);
  writeJsonWithChecksum(opts.truthPath, data);
  return data;
}
