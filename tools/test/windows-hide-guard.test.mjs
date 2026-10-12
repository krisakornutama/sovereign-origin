#!/usr/bin/env node
/* ── เฝ้าระวังตัวเอง: เครื่องมือแก้โค้ดอัตโนมัติห้ามแตะคำสั่งระบบ ──────────────
   เคสจริง 12/10/69 (ทำเครื่องเจ้าของพังจริง):
     ผมรันสคริปต์เติม `windowsHide: true` ให้ทุก spawn ใน tools/
     สคริปต์ตัวนั้นหา "วงเล็บเปิด { ตัวแรก" แล้วแทรกโดยไม่สนใจว่าอยู่ใน string
     ⇒ `docker ps --format "{{.Names}}"` กลายเป็น
        `docker ps --format "{ windowsHide: true,{.Names}}"`
     ⇒ docker คืนค่าผิดรูป ⇒ machine-health.mjs คิดว่า container ทั้งหมดล่ม
     ⇒ แจ้งเตือน "ระบบล่ม" ทุกรอบ ทั้งที่ระบบปกติ
     และยังพังไฟล์อื่นอีก 10+ ไฟล์ กว่าจะกู้คืนได้

   เทสต์นี้ล็อก: ไม่มี windowsHide หลุดเข้า string/template ในไฟล์เครื่องมือใดๆ
   + คำสั่ง docker ที่สำคัญต้องยังเป็นรูปแบบมาตรฐาน
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const TOOLS = path.join(REPO, 'tools');

const files = fs.readdirSync(TOOLS).filter((f) => /\.(mjs|js)$/.test(f));

describe('windowsHide ห้ามหลุดเข้า string คำสั่ง', () => {
  test('ทุกไฟล์เครื่องมือ: ไม่มี windowsHide ติดกับ { หรือ $', () => {
    const bad = [];
    for (const f of files) {
      const lines = fs.readFileSync(path.join(TOOLS, f), 'utf8').split('\n');
      lines.forEach((l, i) => {
        const m = /windowsHide: true,\s*([{$])/.exec(l);
        if (m) bad.push(`${f}:${i + 1}: ${l.trim().slice(0, 90)}`);
      });
    }
    assert.deepEqual(bad, [], `windowsHide หลุดเข้า string/template:\n${bad.join('\n')}`);
  });

  test('ไม่มี windowsHide ที่อยู่ใน string คำสั่งของ docker/ps เด็ดขาด', () => {
    // ดูเฉพาะบรรทัดที่ "สร้างคำสั่ง" — คอมเมนต์ที่พูดถึง windowsHide ไม่เกี่ยว
    for (const f of ['machine-health.mjs', 'prune-wal.mjs', 'system-health.mjs']) {
      const lines = fs.readFileSync(path.join(TOOLS, f), 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (l.trim().startsWith('//') || l.trim().startsWith('*')) return;
        if (!/docker ps|--format|docker',\s*\[/.test(l)) return;
        // เอาเฉพาะส่วนที่เป็น string จริง
        for (const m of l.matchAll(/'([^']*)'|"([^"]*)"/g)) {
          const s = m[1] ?? m[2] ?? '';
          assert.ok(
            !s.includes('windowsHide'),
            `${f}:${i + 1}: windowsHide หลุดเข้า string คำสั่ง → "${s}"`,
          );
        }
      });
    }
  });
});

describe('รูปแบบ docker ps ต้องเป็นมาตรฐาน', () => {
  test('machine-health ใช้ {{.Names}}\\t{{.Status}} (วงปีกกาศสองชั้น)', () => {
    const text = fs.readFileSync(path.join(TOOLS, 'machine-health.mjs'), 'utf8');
    const m = /docker ps --format ["']([^"']+)["']/.exec(text);
    assert.ok(m, 'ต้องมีคำสั่ง docker ps --format');
    // เทียบกับ "ข้อความในไฟล์" (ไม่ใช่ค่าหลังแปลง escape) ⇒ ต้องมี \\ สองตัวตามที่เขียนไว้
    assert.equal(m[1], '{{.Names}}\\\\t{{.Status}}', `รูปแบบผิด: "${m[1]}"`);
  });

  test('prune-wal ใช้ {{.Names}}', () => {
    const text = fs.readFileSync(path.join(TOOLS, 'prune-wal.mjs'), 'utf8');
    const m = /--format["'],?\s*["']([^"']+)["']/.exec(text);
    assert.ok(m, 'ต้องมี --format');
    assert.equal(m[1], '{{.Names}}', `รูปแบบผิด: "${m[1]}"`);
  });

  test('system-health ใช้ {{.Names}}: {{.Status}}', () => {
    const text = fs.readFileSync(path.join(TOOLS, 'system-health.mjs'), 'utf8');
    const m = /--format["'],?\s*["']([^"']+)["']/.exec(text);
    assert.ok(m, 'ต้องมี --format');
    assert.equal(m[1], '{{.Names}}: {{.Status}}', `รูปแบบผิด: "${m[1]}"`);
  });
});

describe('machine-health ต้องเฝ้าที่ที่ของจริงถูกเขียน', () => {
  const src = () => fs.readFileSync(path.join(TOOLS, 'machine-health.mjs'), 'utf8');

  test('ต้องดู backups/postgres (ที่ backup-db.ps1 เขียนจริง)', () => {
    assert.match(src(), /MH_LIVE_BACKUP_DIR \|\| join\(MAIN_ROOT, 'backups\/postgres'\)/);
  });

  test('โฟลเดอร์เก่าต้องยังเป็นทางสำรอง (มี 29 ไฟล์เก่าอยู่)', () => {
    assert.match(src(), /LEGACY_BACKUP_DIR/);
  });

  test('offsite log ต้องอ่านจากโฟลเดอร์เก่า (ที่มันถูกเขียนจริง)', () => {
    // เคสจริง 12/10/69: เปลี่ยน DB_BACKUP_DIR แล้วลืมย้าย OFFSITE_LOG ตาม
    //   ⇒ "ไม่เคยสำรองนอกเครื่องเลย" ทั้งที่มี log อยู่จริง
    const m = /MH_OFFSITE_LOG \|\| join\((\w+), 'offsite-log\.jsonl'\)/.exec(src());
    assert.ok(m, 'ต้องมี OFFSITE_LOG');
    assert.equal(m[1], 'LEGACY_BACKUP_DIR', `offsite log ต้องอ่านจาก ${m[1]} — ย้ายตาม DB_BACKUP_DIR ไม่ได้`);
  });
});

describe('เครื่องมือที่ระบบพึ่ง ต้องอยู่ใน git (ไม่ใช่ถูก ignore)', () => {
  // เคสจริง 12/10/69: .gitignore มีบรรทัด "frontend-watchdog.mjs" ทับ whitelist
  //   ⇒ ไฟล์หายจาก git แต่ Architecture Gate จับได้ตอน verify (ช้าเกินไป)
  //   และถ้าไม่มี gate: watchdog หาย = เว็บไม่ฟื้นเองหลังเครื่องตาย โดยไม่มีใครรู้
  const essential = [
    'tools/frontend-watchdog.mjs',
    'tools/docker-watchdog.mjs',
    'tools/machine-health.mjs',
    'tools/machine-alert.mjs',
    'tools/verify.mjs',
    'tools/system-health.mjs',
  ];
  for (const f of essential) {
    test(`${f} ต้องไม่ถูก .gitignore บล็อก`, () => {
      // check-ignore: exit 0 = ถูก ignore (แย่) · exit 1 = ไม่ถูก ignore (ถูกต้อง)
      const r = spawnSync('git', ['check-ignore', '-q', f], { cwd: REPO, windowsHide: true });
      assert.notEqual(r.status, 0, `${f} ถูก .gitignore ตัดทิ้ง — ระบบจะขาดไฟล์นี้เงียบๆ`);
    });
  }

  test('.gitignore ต้องไม่มีบรรทัดที่ตัดชื่อไฟล์นี้ทิ้งแบบเปล่าๆ', () => {
    const text = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
    const bare = text.split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('!') && /[\w.-]+\.(mjs|js|ps1)$/.test(l));
    assert.deepEqual(bare, [], `บรรทัดเหล่านี้ตัดไฟล์เครื่องมือทิ้ง: ${bare.join(', ')}`);
  });

  test('watchdog ทุกตัวต้องถูก track จริง', () => {
    const tracked = execFileSync('git', ['ls-files', 'tools/'], { cwd: REPO, encoding: 'utf8' });
    for (const f of ['tools/frontend-watchdog.mjs', 'tools/docker-watchdog.mjs']) {
      assert.ok(tracked.includes(f), `${f} ไม่อยู่ใน git — watchdog จะหายเวลาเครื่องรีสตาร์ท`);
    }
  });
});

describe('watchdog ห้ามใช้ detached:true คู่กับ windowsHide (เคสจริง 12/10/69)', () => {
  // detached บน Windows แปลว่า "สร้าง console ใหม่ให้ลูก" ซึ่งขัดกับ windowsHide
  //   (ที่แปลว่า "อย่าสร้างหน้าต่าง") ⇒ ได้ console ที่ซ่อนไม่ได้ = หน้าต่างเด้ง
  //   พิสูจน์แล้วด้วยการฆ่าเซิร์ฟเวอร์แล้วรอ watchdog เปิดใหม่ — ยังเหลือหน้าต่าง
  //   แก้โดยตัด detached ออก ใช้ stdio:'ignore' + unref() แทน (ยังเบื้องหลังได้)
  for (const f of ['frontend-watchdog.mjs', 'docker-watchdog.mjs', 'verify.mjs', 'setup-node.mjs']) {
    test(`${f}: spawn ที่เปิด process ยาวต้องไม่มี detached:true`, () => {
      const lines = fs.readFileSync(path.join(TOOLS, f), 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (l.trim().startsWith('//') || l.trim().startsWith('*') || l.trim().startsWith('//  ')) return;
        // มองเฉพาะบรรทัดที่มี windowsHide และ spawn/spawnSync จริง
        if (!/windowsHide/.test(l)) return;
        assert.ok(
          !/detached:\s*true/.test(l),
          `${f}:${i + 1}: detached:true คู่กับ windowsHide → หน้าต่างยังเด้ง\n  ${l.trim().slice(0, 100)}`,
        );
      });
    });
  }

  test('frontend-watchdog ต้องซ่อนหน้าต่างจริง (windowsHide + stdio ignore)', () => {
    const text = fs.readFileSync(path.join(TOOLS, 'frontend-watchdog.mjs'), 'utf8');
    const m = /spawn\('cmd'[\s\S]{0,220}?\}\)\.unref\(\)/.exec(text);
    assert.ok(m, 'ต้องมีการ spawn เซิร์ฟเวอร์');
    assert.match(m[0], /windowsHide:\s*true/, 'ต้องมี windowsHide');
    assert.match(m[0], /stdio:\s*'ignore'/, 'ต้องตัด stdio ไม่ให้ผูกกับ console');
  });
});

describe('ผลจริงบนเครื่องนี้ (กันแจ้งเตือนปลอม)', () => {
  const runHealth = () => execFileSync('node', [path.join(TOOLS, 'machine-health.mjs')], {
    encoding: 'utf8', windowsHide: true, cwd: REPO, timeout: 180_000,
  });

  test('เครื่องนี้ไม่ควรถูกแจ้งว่า container ล่ม', (t) => {
    let up = '';
    try {
      up = execFileSync('docker', ['ps', '--format', '{{.Names}}'], {
        encoding: 'utf8', windowsHide: true, timeout: 20_000,
      });
    } catch {
      t.skip('docker ไม่ตอบ');
      return;
    }
    const json = JSON.parse(runHealth().trim());
    const downClaims = (json.problems || []).filter((p) => p.area === 'docker');
    assert.deepEqual(downClaims, [], `docker ตอบว่าขึ้น ${up.split('\n').length - 1} ตัว แต่ health บอกล่ม`);
  });

  test('backup ต้องไม่ถูกแจ้งว่าเก่า (รอบ 03:00 เขียนที่ backups/postgres จริง)', (t) => {
    const json = JSON.parse(runHealth().trim());
    const backup = (json.problems || []).find((p) => p.area === 'backup');
    if (!backup) return; // ไม่มีปัญหา = ผ่าน
    t.diagnostic(`dbBackupAgeH = ${json.info?.dbBackupAgeH}`);
    assert.fail(`backup ถูกแจ้งวิกฤต แต่ dbBackupAgeH = ${json.info?.dbBackupAgeH}: ${backup.message}`);
  });

  test('offsite ต้องไม่ถูกแจ้งว่าไม่เคยสำรอง (มี log อยู่จริง)', (t) => {
    const json = JSON.parse(runHealth().trim());
    const offsite = (json.problems || []).find((p) => p.area === 'offsite');
    if (!offsite) return;
    t.diagnostic(`offsiteAgeH = ${json.info?.offsiteAgeH}`);
    assert.fail(`offsite ถูกแจ้งวิกฤต แต่ offsiteAgeH = ${json.info?.offsiteAgeH}: ${offsite.message}`);
  });
});
