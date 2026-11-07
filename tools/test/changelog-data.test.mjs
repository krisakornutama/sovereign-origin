// ─────────────────────────────────────────────────────────────
// tools/test/changelog-data.test.mjs
// หน้า "ประวัติการพัฒนา" ในแอป (/changelog) ต้องเห็นทุกเวอร์ชันและสิ่งที่แก้
//
// ทำไมต้องมี: CHANGELOG.md อยู่นอก build context ของ frontend (Docker ใช้ context
// sovereign-frontend) ⇒ ต้อง generate JSON ไว้ใน repo — เทสต์นี้กันข้อมูลในแอป
// ตกหล่น/ค้างเก่าเมื่อมีคนแก้ CHANGELOG แล้วลืมรันตัว generate
// ─────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildChangelogData } from '../gen-changelog-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const DATA = path.join(ROOT, 'sovereign-frontend', 'src', 'data', 'changelog.json');

describe('ข้อมูลประวัติการพัฒนาในแอป', () => {
  test('มีไฟล์ข้อมูลและตรงกับ CHANGELOG.md (--check)', () => {
    assert.ok(
      fs.existsSync(DATA),
      'ยังไม่มี sovereign-frontend/src/data/changelog.json — รัน: node tools/gen-changelog-data.mjs',
    );
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'gen-changelog-data.mjs'), '--check'], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, `ข้อมูลไม่ตรงกับ CHANGELOG.md:\n${r.stderr || r.stdout}`);
  });

  test('แปลงเวอร์ชันครบ + v1.2.0 มีตารางบัค', () => {
    const data = buildChangelogData(read('CHANGELOG.md'), '1.2.0');
    const names = data.versions.map((v) => v.version);
    for (const v of ['Unreleased', 'v1.2.0', 'v1.1.1', 'v1.1.0', 'v1.0']) {
      assert.ok(names.includes(v), `ขาดเวอร์ชัน ${v} — parser/CHANGELOG ผิด`);
    }

    const current = data.versions.find((v) => v.version === 'v1.2.0');
    assert.ok(current, 'ต้องมี v1.2.0');
    assert.ok(current.sections.length >= 5, `v1.2.0 ต้องมีหลายหัวข้อ (ได้ ${current.sections.length})`);
    const bugs = current.sections.find((s) => s.title.includes('แก้บัค'));
    assert.ok(bugs, 'ต้องมีหัวข้อ "แก้บัคที่สำคัญ"');
    const table = bugs.blocks.find((b) => b.type === 'table');
    assert.ok(table, 'ตารางบัคต้องถูกแปลงเป็น block type=table');
    assert.ok(table.rows.length >= 5, `ตารางบัคต้องมีอย่างน้อย 5 แถว (ได้ ${table.rows.length})`);

    // inline markdown ต้องถูกทำให้อ่านได้ (ไม่มี ** หรือ ` ค้าง)
    const joined = JSON.stringify(data);
    assert.ok(!joined.includes('**'), 'ต้องล้าง ** ออกจากข้อความ');
    assert.ok(!joined.includes('`'), 'ต้องล้าง backtick ออกจากข้อความ');
  });

  test('หน้า /changelog อยู่ในเมนูและมี Sidebar (กฎหน้าใหม่)', () => {
    const nav = read('sovereign-frontend/src/lib/navigation.ts');
    assert.match(nav, /href: '\/changelog'/, 'ต้องมีเมนู /changelog');
    const page = read('sovereign-frontend/src/pages/changelog.tsx');
    assert.match(page, /<Sidebar\s*\/>/, 'หน้าต้องมี <Sidebar />');
    assert.match(page, /from '\.\.\/data\/changelog\.json'/, 'หน้าต้องอ่านข้อมูลที่ generate ไว้');
  });
});
