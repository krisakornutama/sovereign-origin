// indexnow-notify — ปักหมุด "default host" ให้เป็นโดเมนจริงที่เสิร์ฟไฟล์คีย์
//
// บั๊กเดิม (พบ 28/11/69): default เป็น `krisakornutama.github.io/project-sovereign`
// แต่ไฟล์คีย์ IndexNow อยู่บน custom domain (Pages ผูก CNAME) ⇒ github.io ตอบ 301
// ไปโดเมนจริง ⇒ URL ที่ส่งไปไม่ตรง host ของคีย์และถูกปฏิเสธ = ยิงเปล่าทุก deploy
//
// เทสต์นี้อ่านโค้ดจริงแล้วยืนยัน 3 อย่าง:
//   1. default HOST = sovereignoriginshop.dpdns.org
//   2. BASE สร้างจาก HOST (ไม่มีโดเมนที่สองฝังแยก ซึ่งจะหลุดจากกันได้อีก)
//   3. ไม่มี github.io ในโค้ดที่รันจริง (ความเห็นอธิบายบั๊กเดิมไม่นับ)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'indexnow-notify.mjs');
const src = fs.readFileSync(SRC, 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, ''); // ตัด block comment ออก เหลือแต่โค้ดที่รัน

function defaultOf(name) {
  const m = src.match(new RegExp(`const ${name} = process\\.env\\.\\w+ \\|\\| ([^;]+);`));
  assert.ok(m, `ต้องเจอบรรทัด default ของ ${name} ใน indexnow-notify.mjs`);
  return m[1].trim();
}

test('HOST default ต้องเป็นโดเมนจริง sovereignoriginshop.dpdns.org', () => {
  assert.equal(defaultOf('HOST'), "'sovereignoriginshop.dpdns.org'");
});

test('BASE ต้องสร้างจาก HOST — ไม่มีโดเมนฝังแยก', () => {
  assert.equal(defaultOf('BASE'), '`https://${HOST}`');
});

test('ไม่มี github.io ในโค้ดที่รัน (บั๊กเดิม: URL 301 = ยิงเปล่า)', () => {
  assert.doesNotMatch(code, /github\.io/, 'อย่าใส่ github.io กลับมา: ไฟล์คีย์อยู่บน custom domain เท่านั้น');
});
