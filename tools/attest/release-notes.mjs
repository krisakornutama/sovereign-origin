// ─────────────────────────────────────────────────────────────────────────────
// release-notes.mjs — ข้อความประกาศ fingerprint ที่ต่อท้าย release notes
//
// ทำไมต้องมี:
//   fingerprint ที่ประกาศไว้ในที่เดียว (repo) ไม่ช่วยอะไรถ้าคนที่ได้ไฟล์ไปไม่เห็นมัน
//   หน้านี้จึงถูกเขียนทุกครั้งที่ปล่อย release: ถ้ามีใบรับรอง → บอก fingerprint +
//   คำสั่งตรวจที่คัดลอกได้; ถ้าไม่มี (สวิตช์ปิด) → บอกตรง ๆ ว่าไม่มีใบรับรอง
//   ห้ามเงียบ: "ไม่มี" ต้องอ่านออก ไม่ใช่ปล่อยให้คนเดาว่ามี
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';

/** ข้อความคงที่ของคำสั่งตรวจ — ตรงกับที่หน้า portfolio/release-verify.html สอน */
export function verifyCommand(fingerprint, file = 'sovereign-attest.json') {
  return [
    'node tools/attest-release.mjs --verify ' + file + ' \\',
    '  --fingerprint=' + fingerprint + ' --dir=.',
  ].join('\n');
}

export function renderReleaseNotes({ tag, fingerprint, verifierUrl }) {
  if (!fingerprint) {
    return [
      '## Provenance',
      '',
      'รอบนี้ **ไม่มี** ใบรับรอง `sovereign-attest.json` (สวิตช์ `ATTEST_ENABLED` ปิดอยู่หรือเซ็นไม่สำเร็จ)',
      '⇒ ไม่มีการรับประกันว่าไฟล์ชุดนี้มาจากผู้พัฒนา — ตรวจ `SHA256SUMS.txt` ได้แค่ความสมบูรณ์ของไฟล์',
    ].join('\n');
  }
  const lines = [
    '## Provenance (signed release)',
    '',
    'ไฟล์ชุดนี้มาพร้อมใบรับรอง `sovereign-attest.json` ที่แนบอยู่ใน release นี้',
    'รายการไฟล์ข้างล่างคือไบต์ที่ถูกเซ็น — ตรวจได้โดยไม่ต้องเชื่อ GitHub และไม่ต้องต่อเน็ต',
    '',
    '**Release key fingerprint**',
    '',
    '```',
    fingerprint,
    '```',
    '',
    '**ตรวจไฟล์ที่ดาวน์โหลด** (Node 20 ขึ้นไป, ตัวตรวจสองไฟล์ไม่มี dependency)',
    '',
    '```bash',
    verifyCommand(fingerprint),
    '```',
    '',
    'ขั้นตอนเต็มและความหมายของผลตรวจ: ' + verifierUrl,
  ];
  if (tag) lines.splice(0, 0, '');
  return lines.join('\n');
}

/** อ่าน fingerprint จากเอกสาร attestation (ไม่ตรวจลายเซ็น — ตัวตรวจจริงอยู่ใน tool) */
export function fingerprintOfFile(file) {
  if (!fs.existsSync(file)) return null;
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  return typeof doc.fingerprint === 'string' ? doc.fingerprint : null;
}

const DEFAULT_VERIFIER = 'https://krisakornutama.github.io/project-sovereign/release-verify.html';

function argOf(argv, name, fallback) {
  const found = argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

if (process.argv[1] && process.argv[1].endsWith('release-notes.mjs')) {
  const argv = process.argv.slice(2);
  const doc = argOf(argv, 'doc', 'release-assets/sovereign-attest.json');
  const out = argOf(argv, 'out', 'release-notes.md');
  const fingerprint = fingerprintOfFile(doc);
  fs.writeFileSync(
    out,
    `${renderReleaseNotes({
      tag: argOf(argv, 'tag', undefined),
      fingerprint,
      verifierUrl: argOf(argv, 'verifier', DEFAULT_VERIFIER),
    })}\n`
  );
  console.log(
    fingerprint
      ? `release notes: ประกาศ fingerprint ${fingerprint} → ${out}`
      : `release notes: ไม่มีใบรับรอง (${doc} ไม่พบ) — เขียนหมายเหตุไว้ใน ${out}`
  );
}
