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

// ═════════════════════════════════════════════════════════════
//  detached:true + windowsHide ทั้งโปรเจ็กต์ (เคสจริง 20/10/69)
// ═════════════════════════════════════════════════════════════
//
// เจ้าของส่งภาพหน้าต่างนี้มาเองระหว่างเริ่มระบบ:
//   `powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri http://localhost:3001/api/health …`
//
// ต้นตอ: sovereign-frontend/electron/main.js เปิด start-sovereign.bat ด้วย
//   spawn(cmd, ['/d','/c','call', bat], { detached: true, windowsHide: true, stdio: 'ignore' })
//   · detached = ลูก "ไม่มี console" เลย
//   · windowsHide ซ่อนได้แค่ console ของลูกโดยตรง (ไม่มีผลกับหลาน)
//   ⇒ ทุกโปรเซส console ที่ .bat เรียกต่อ (powershell ในลูป health check ทุก 3 วิ ·
//     docker info · npm run build) ต้องขอ console ใหม่ของตัวเอง = หน้าต่างจริงเด้งขึ้นมา
//
// พิสูจน์บนเครื่องนี้ (tools/window-flash-probe.ps1 นับเฉพาะหน้าต่างที่มองเห็นได้จริง):
//   · detached + windowsHide        → จับได้ `powershell …` และ `docker info`
//   · wscript + run-hidden.vbs      → 0 หน้าต่าง และ .bat ทำงานจนจบแม้ตัวเปิดจบไปก่อน
//   (สคริปต์ทดลองเต็มชุด: .freebuff/flashlab · เทสต์ของตัวช่วย: tools/test/hidden-launch.test.mjs)
//
// กติกา: จุดที่ยังใช้ detached+windowsHide ต้องมีเหตุผลในรายการ ALLOWED_DETACHED_HIDE
//   และ "ห้าม" เป็นการเปิด shell (cmd/.bat/powershell) เด็ดขาด → ใช้ tools/hidden-launch.cjs

const SCAN_LANGS = ['*.mjs', '*.js', '*.cjs'];
const isCommentLine = (l) => /^\s*(\/\/|\*|\/\*)/.test(l);

/** ทุกบรรทัดที่เป็นโค้ด `detached: true` และมี windowsHide อยู่ในบริเวณเดียวกัน (±4 บรรทัด) */
function scanDetachedHide() {
  const files = SCAN_LANGS
    .flatMap((g) => execFileSync('git', ['ls-files', g], { cwd: REPO, encoding: 'utf8' }).split('\n'))
    .map((s) => s.trim())
    .filter(Boolean)
    // tools/test/** ไม่สแกน: ข้างในมีสตริง/ชื่อเทสต์ที่พูดถึงรูปแบบนี้เอง
    // (ตัวเทสต์จริงที่พิสูจน์หน้าต่างอยู่ที่ tools/test/hidden-launch.test.mjs — เข้มกว่ากฎนี้)
    .filter((f) => !f.startsWith('tools/test/'));
  const hits = [];
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(REPO, rel), 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (isCommentLine(l) || !/detached:\s*true/.test(l)) return;
      const around = lines.slice(Math.max(0, i - 4), i + 5).join('\n');
      if (!/windowsHide/.test(around)) return;
      const callLine = lines.slice(Math.max(0, i - 6), i + 1).reverse().find((x) => /(spawn|spawnSync|exec|execFile)\w*\s*\(/.test(x)) || '';
      hits.push({ file: rel, line: i + 1, code: l.trim(), call: callLine.trim() });
    });
  }
  return hits;
}

/**
 * จุดที่ยกเว้นได้ — ต้องเขียนเหตุผลทุกครั้ง (ห้ามเพิ่มโดยไม่มีหลักฐาน)
 * match = ข้อความในบรรทัดนั้น (ต้องตรงจริงในไฟล์ ไม่งั้นเทสต์จะฟ้องว่าเป็นรายการค้าง)
 */
const ALLOWED_DETACHED_HIDE = [
  {
    file: 'sovereign-frontend/electron/main.js',
    match: 'spawn(exe, [], { detached: true, windowsHide: true',
    why: 'Docker Desktop เป็นโปรแกรม GUI — ไม่มี console ให้เด้งตั้งแต่แรก และต้อง detached เพื่อให้รอดหลังปิดแอป',
  },
  {
    file: 'sovereign-frontend/electron/main.js',
    match: 'spawn(plan.file, plan.args',
    why: 'wscript.exe เป็น GUI host (ไม่มี console) — ตัว .bat ถูกซ่อนโดย tools/hidden-launch.cjs แล้ว '
      + '· พิสูจน์ด้วยเทสต์จริงใน tools/test/hidden-launch.test.mjs (0 หน้าต่าง) และต้อง detached เพื่อให้ .bat ทำงานต่อแม้ปิดแอป',
  },
  {
    file: 'autostart.mjs',
    match: 'spawn(plan.file, plan.args',
    why: 'เหมือน electron: เปิดผ่าน wscript + hidden-launch.cjs · detached จำเป็นเพราะ autostart จบแล้วลูกต้องอยู่ต่อ',
  },
  {
    file: 'autostart.mjs',
    match: 'spawn(file, args, {',
    why: 'ทางถอยของ detachSpawn — ใช้เฉพาะเมื่อ planHiddenLaunch คืน null (คำสั่งมีอักขระนอก ASCII) '
      + '· ยังต้อง detached เพราะลูกต้องอยู่รอดหลัง autostart จบ (ยอมรับความเสี่ยงหน้าต่างเด้งเฉพาะกรณีนั้น)',
  },
  {
    file: 'sovereign-os/agent-runner/src/selfUpdate.mjs',
    match: 'detached: true',
    why: 'spawn node.exe ตรง ๆ (ลูกโดยตรง ไม่ใช่ shell) + stdio ignore — พิสูจน์แบบ lab C: ไม่มีหน้าต่าง '
      + '· ยังไม่ย้ายมาใช้ hidden-launch.cjs เพราะเส้น self-update ทดสอบยาก (ถ้าเห็นเด้งให้ย้าย)',
  },
  {
    file: 'sovereign-os/edge-ai/lib/process.mjs',
    match: 'detached: true',
    why: 'spawn exe ของ Ollama ตรง ๆ (ลูกโดยตรง ไม่ใช่ shell) + stdio เป็นไฟล์ log · ยังไม่ได้พิสูจน์กับหน้าต่างจริง '
      + '(สแตก edge-AI ปิดอยู่ตอนตรวจ) — ถ้าเห็นหน้าต่างเด้งให้ย้ายมาใช้ hidden-launch.cjs',
  },
  {
    file: 'sovereign-os/edge-ai/scripts/install.mjs',
    match: 'detached: true',
    why: 'เหมือน lib/process.mjs — เปิด exe ตรง ๆ ไม่ผ่าน shell · ยังไม่ได้พิสูจน์ (สแตกปิดอยู่)',
  },
];

const SHELL_HINT = /ComSpec|['"]cmd(\.exe)?['"]|cmd\.exe|powershell|pwsh|\bbash\b|\.bat\b|\.cmd\b|\bnpm\b/i;

describe('detached:true + windowsHide ทั้งโปรเจ็กต์ (เคสจริง 20/10/69)', () => {
  test('มีไฟล์ให้สแกนจริง (กันเทสต์ผ่านมั่วตอน clone สด)', () => {
    const files = SCAN_LANGS.flatMap((g) => execFileSync('git', ['ls-files', g], { cwd: REPO, encoding: 'utf8' }).split('\n')).filter(Boolean);
    assert.ok(files.length > 20, `สแกนได้แค่ ${files.length} ไฟล์ — น่าจะเรียก git ผิด`);
  });

  test('ทุกจุดต้องมีเหตุผลในรายการยกเว้น (เพิ่มใหม่ = เทสต์แดง จนกว่าจะเขียนเหตุผล)', () => {
    const hits = scanDetachedHide();
    const bad = hits.filter(
      (h) => !ALLOWED_DETACHED_HIDE.some((a) => a.file === h.file && (h.code.includes(a.match) || h.call.includes(a.match))),
    );
    assert.deepEqual(
      bad.map((h) => `${h.file}:${h.line}: ${h.code.slice(0, 110)}`),
      [],
      'เจอ detached:true + windowsHide ที่ไม่มีเหตุผลกำกับ — หน้าต่าง console จะเด้งขึ้นมาเอง:\n  ',
    );
  });

  test('ห้ามใช้ detached+windowsHide กับการเปิด shell (cmd/.bat/powershell/npm) เด็ดขาด', () => {
    const bad = [];
    for (const h of scanDetachedHide()) {
      if (!SHELL_HINT.test(h.call)) continue;
      // ยกเว้นเฉพาะจุดที่พิสูจน์แล้วว่าเป็น GUI host หรือมีเทสต์จริงคุม
      const provenGuiHost = ALLOWED_DETACHED_HIDE.some(
        (a) =>
          a.file === h.file &&
          a.match.startsWith('spawn(plan.file') &&
          (h.code.includes(a.match) || h.call.includes(a.match)),
      );
      if (provenGuiHost) continue; // wscript = GUI host (พิสูจน์ด้วยเทสต์จริงใน hidden-launch.test.mjs)
      bad.push(`${h.file}:${h.line}: ${h.call.slice(0, 110)}`);
    }
    assert.deepEqual(
      bad,
      [],
      'shell ที่ถูกเปิดแบบ detached จะไม่มี console ⇒ ลูกของมัน (powershell/docker/npm) เด้งหน้าต่าง:\n  ',
    );
  });

  test('รายการยกเว้นต้องไม่ค้าง (ต้องยังมีบรรทัดนั้นจริงในไฟล์)', () => {
    for (const a of ALLOWED_DETACHED_HIDE) {
      const text = fs.readFileSync(path.join(REPO, a.file), 'utf8');
      assert.ok(text.includes(a.match), `${a.file}: รายการยกเว้น "${a.match}" หาไม่เจอแล้ว — ลบรายการที่ค้างออก`);
      assert.ok(a.why && a.why.length > 20, `${a.file}: ต้องเขียนเหตุผลให้คนอื่นอ่านรู้เรื่อง`);
    }
  });

  test('ตัวเปิด .bat ต้องผ่าน tools/hidden-launch.cjs (ไม่ spawn shell เอง)', () => {
    for (const f of ['sovereign-frontend/electron/main.js', 'autostart.mjs']) {
      const text = fs.readFileSync(path.join(REPO, f), 'utf8');
      assert.match(text, /hidden-launch\.cjs/, `${f}: ต้องใช้ tools/hidden-launch.cjs ในการเปิด .bat แบบไม่มีหน้าต่าง`);
    }
  });
});
