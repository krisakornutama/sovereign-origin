// tools/test/social-history-wiring.test.mjs
//
// ── เทสต์โครงของ "ประวัติการโพสต์" (Social Studio) ──────────────────────────
// เทสต์ backend (sovereign-os/core-api/tests/social-history.test.ts) พิสูจน์พฤติกรรม
// ของ service/routes แล้ว — ไฟล์นี้กันไม่ให้ "สายไฟ" หลุดตอน refactor:
//   · Social Studio ต้องมีแท็บประวัติและเรนเดอร์ PostHistory จริง
//   · ปุ่มบันทึกใน TextStudio/ClipStudio ต้องส่ง kind ถูก และมี targets
//   · client ต้องยิง endpoint ใต้ /api/ecosystem/social/posts
//   · routes.ts ต้อง mount router (ไม่งั้น 404 แม้โค้ดจะถูก)
//   · Prisma ต้องมีตาราง + FK ที่ถูกลบตาม/ไม่ลบประวัติ
//   · module-owners ต้องประกาศเจ้าของ เพื่อให้ arch-gate ไม่ฟ้องเส้นข้ามโมดูล
//
// รัน: npm run test:tools (หรือ node --test tools/test/social-history-wiring.test.mjs)
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STUDIO = path.join(ROOT, 'sovereign-frontend', 'src', 'components', 'ecosystem', 'studio');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const readStudio = (name) => fs.readFileSync(path.join(STUDIO, name), 'utf8');

describe('Social Studio — สายไฟของประวัติการโพสต์', () => {
  test('Social Studio มีโหมดที่ 3 “ประวัติการโพสต์” และเรนเดอร์ PostHistory', () => {
    const src = readStudio('SocialStudio.tsx');
    assert.match(src, /type StudioMode = 'text' \| 'clip' \| 'history'/);
    assert.match(src, /from '\.\/PostHistory'/, 'ต้อง import PostHistory');
    assert.match(src, /mode === 'history' && <PostHistory \/>/);
    assert.match(src, /ประวัติการโพสต์/);
  });

  test('TextStudio บันทึกเป็น kind "text" + target facebook พร้อมบัญชีที่เลือก', () => {
    const src = readStudio('TextStudio.tsx');
    assert.match(src, /createSocialPost\(/);
    assert.match(src, /kind: 'text'/);
    assert.match(src, /platform: 'facebook'/);
    assert.match(src, /accountId: selected\?\.id \|\| null/);
    assert.match(src, /บันทึกงานนี้ลงประวัติ/);
  });

  test('ClipStudio บันทึกเป็น kind "clip" + ปลายทางทุกแพลตฟอร์มที่ติ๊ก', () => {
    const src = readStudio('ClipStudio.tsx');
    assert.match(src, /createSocialPost\(/);
    assert.match(src, /kind: 'clip'/);
    assert.match(src, /platform: key/);
    assert.match(src, /draft\.targets\.map/);
    assert.match(src, /videoName: draft\.videoName/);
    assert.match(src, /บันทึกงานนี้ลงประวัติ/);
  });

  test('client ยิง endpoint ใต้ /api/ecosystem/social/posts ครบทั้ง 4 คำสั่ง', () => {
    const src = readStudio('social-history-client.ts');
    assert.match(src, /`\$\{getApiUrl\(\)\}\/api\/ecosystem\/social\/posts`/);
    assert.match(src, /method: 'POST'/);
    assert.match(src, /method: 'PATCH'/);
    assert.match(src, /method: 'DELETE'/);
    assert.match(src, /\/targets\/\$\{encodeURIComponent\(platform\)\}/);
    assert.match(src, /authFetch/, 'ต้องใช้ authFetch (แนบ token + จัดการ 401)');
  });

  test('routes.ts mount social router ใต้ /api/ecosystem/social', () => {
    const src = read('sovereign-os', 'core-api', 'src', 'routes.ts');
    assert.match(src, /import socialHistoryRoutes from '\.\/modules\/ecosystem\/social-history\.routes'/);
    assert.match(src, /app\.use\('\/api\/ecosystem\/social', socialHistoryRoutes\)/);
  });

  test('Prisma: ตารางประวัติ + FK cascade/set-null + unique ต่อ (post, platform)', () => {
    const schema = read('sovereign-os', 'core-api', 'prisma', 'schema.prisma');
    assert.match(schema, /model SocialPost \{/);
    assert.match(schema, /model SocialPostTarget \{/);
    assert.match(schema, /@@map\("social_posts"\)/);
    assert.match(schema, /@@map\("social_post_targets"\)/);
    assert.match(schema, /@@unique\(\[post_id, platform\]\)/);
    assert.match(schema, /post\s+SocialPost\s+@relation\([^)]*onDelete: Cascade/);
    assert.match(schema, /account UserEcosystemAccount\?\s+@relation\([^)]*onDelete: SetNull/);

    // 7 พ.ย. 69: migration เดิม 74 ตัวถูกย้ายไป prisma/migrations_archive (ไม่ถูก apply แล้ว)
    // → ตรวจ baseline ซึ่งเป็นไฟล์เดียวที่รันจริงบน DB ใหม่
    const migration = read(
      'sovereign-os',
      'core-api',
      'prisma',
      'migrations',
      '20261107190000_baseline',
      'migration.sql',
    );
    assert.match(migration, /CREATE TABLE "social_posts"/);
    assert.match(migration, /CREATE TABLE "social_post_targets"/);
    assert.match(migration, /ON DELETE CASCADE/);
    assert.match(migration, /ON DELETE SET NULL/);
  });

  test('module-owners ประกาศเจ้าของตาราง/บริการใหม่ (arch-gate ใช้ตัดสินเส้นข้าม)', () => {
    const owners = JSON.parse(read('tools', 'module-owners.json'));
    assert.equal(owners.owners.social_posts, 'ecosystem');
    assert.equal(owners.owners.social_post_targets, 'ecosystem');
    assert.equal(owners.serviceAliases['social-history.service'], 'ecosystem');
  });
});
