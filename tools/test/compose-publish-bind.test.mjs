// ด่านกัน "compose เผยพอร์ตผู้ดูแล/ฐานข้อมูลออกทุก interface"
//
// เหตุผล: `- "18083:18083"` หรือ `- "${CORE_API_PORT:-3001}:3001"` ที่ไม่ระบุ host IP
// จะผูกกับ 0.0.0.0 (= ทุกการ์ดเครือข่าย/LAN) โดยปริยาย — ไม่ error ไม่เตือน
// container ที่เปิดพอร์ตพวกนี้จึงเข้าถึงได้จากเครื่องอื่นทั้งเครือข่าย
// ทั้งที่สถาปัตยกรรมของโปรเจ็กคือ domain → cloudflared → :3000 → rewrite /api → :3001
// (backend ไม่มีเหตุผลต้องรับ connexion ตรงจาก LAN) และ EMQX dashboard เป็นหน้า admin
//
// กติกา: container port ที่อยู่ใน SENSITIVE ต้องผูก host IP เป็น loopback เท่านั้น
// ยกเว้น MQTT 1883 ที่อุปกรณ์ภาคสนาม (ESP32 ฯลฯ) ต้องต่อตรงจากวง LAN
// ⇒ ต้องเป็น 0.0.0.0 ได้ แต่ต้องมีคอมเมนต์กำกับในไฟล์ว่าเป็นเจตนา (ไฟล์นี้ไม่บังคับคอมเมนต์)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/** พอร์ตที่ไม่ควรเปิดให้เครื่องอื่นในวงเข้าถึง */
const SENSITIVE = new Map([
  ['5432', 'PostgreSQL/TimescaleDB'],
  ['3001', 'core-api'],
  ['18083', 'EMQX dashboard (หน้า admin)'],
]);

/** พอร์ตที่อนุญาตให้ผูก 0.0.0.0 ได้ และเหตุผล */
const ALLOW_ALL_INTERFACES = new Map([
  ['1883', 'MQTT — อุปกรณ์ภาคสนามต่อตรงจากวง LAN'],
]);

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

function composeFiles() {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (/^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(ROOT, 0);
  return out.sort();
}

/**
 * ดึง port spec ที่ประกาศใต้คีย์ `ports:` (ทั้งรูปแบบ list และ mapping แบบสั้น)
 * @returns {string[]} ข้อความดิบของแต่ละรายการ
 */
export function publishedPorts(text) {
  const lines = text.split(/\r?\n/);
  const specs = [];
  let blockIndent = -1;
  for (const line of lines) {
    const bare = line.replace(/\s+#.*$/, '');
    if (!bare.trim()) continue;
    const indent = bare.length - bare.trimStart().length;
    if (blockIndent >= 0 && indent <= blockIndent) blockIndent = -1;
    if (blockIndent < 0) {
      if (/^\s*ports:\s*$/.test(bare)) blockIndent = indent;
      continue;
    }
    const m = /^\s*-\s*(.+?)\s*$/.exec(bare);
    if (!m) continue;
    const raw = m[1].replace(/^['"]|['"]$/g, '').trim();
    if (raw && !raw.startsWith('#')) specs.push(raw);
  }
  return specs;
}

/**
 * แทน ':' ที่อยู่ภายใน `${...}` ด้วย '\u0000' (ความยาวเท่าเดิม ⇒ index ตรงกับต้นฉบับ)
 * เพื่อนับเฉพาะ ':' ชั้นนอกที่กั้น host-ip : host-port : container-port
 */
function maskBracedColons(spec) {
  let out = '';
  for (let i = 0; i < spec.length; i += 1) {
    if (spec.startsWith('${', i)) {
      const end = spec.indexOf('}', i);
      const stop = end === -1 ? spec.length : end + 1;
      out += spec.slice(i, stop).replace(/:/g, '\u0000');
      i = stop - 1;
      continue;
    }
    out += spec[i];
  }
  return out;
}

/** ค่า default ของ `${VAR:-default}` → default ; `${VAR}` → null (ไม่รู้ค่าจริง) */
function envDefaultValue(token) {
  const m = /^\$\{[A-Za-z_][A-Za-z0-9_]*:-([^}]*)\}$/.exec(token.trim());
  return m ? m[1].trim() : null;
}

/**
 * แยก host IP / host port / container port จาก spec หนึ่งรายการ
 * รองรับ `${VAR:-default}` ที่มี ':' อยู่ข้างใน (เช่น `${CORE_API_PORT:-3001}:3001`)
 */
export function parsePortSpec(spec) {
  const withoutProto = spec.replace(/\/(tcp|udp)$/i, '');
  const masked = maskBracedColons(withoutProto);

  const cuts = [];
  for (let i = 0; i < masked.length; i += 1) if (masked[i] === ':') cuts.push(i);

  const parts = [];
  let start = 0;
  for (const cut of cuts) {
    parts.push(withoutProto.slice(start, cut));
    start = cut + 1;
  }
  parts.push(withoutProto.slice(start));

  let hostIp = null;
  if (parts.length >= 3) {
    // host-ip : host-port : container-port — ค่า host IP อาจเป็น ${VAR:-default}
    const rawIp = parts[parts.length - 3].trim();
    hostIp = rawIp.startsWith('${') ? envDefaultValue(rawIp) : rawIp;
    if (hostIp === null) hostIp = 'ไม่ทราบค่า (env var ไม่มี default)';
  }

  const containerPort = parts[parts.length - 1].trim();
  return { spec, hostIp, containerPort };
}

test('พอร์ตผู้ดูแล/ฐานข้อมูลใน compose ต้องผูก loopback ไม่ใช่ 0.0.0.0', () => {
  const files = composeFiles();
  assert.ok(files.length > 0, 'ต้องพบไฟล์ compose อย่างน้อย 1 ไฟล์');

  const violations = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const spec of publishedPorts(text)) {
      const { hostIp, containerPort } = parsePortSpec(spec);
      if (!SENSITIVE.has(containerPort)) continue;
      if (hostIp && LOOPBACK.has(hostIp.toLowerCase())) continue;
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      violations.push(
        `${rel}: "${spec}" → container port ${containerPort} (${SENSITIVE.get(containerPort)}) ` +
          `ผูกกับ ${hostIp ?? 'ทุก interface (ไม่ได้ระบุ host IP)'}`
      );
    }
  }

  assert.deepEqual(violations, [], `พอร์ตเหล่านี้ไม่ควรเปิดให้เครื่องอื่นในวงเข้าถึง:\n${violations.join('\n')}`);
});

test('พอร์ตที่อนุญาตให้เปิดทุก interface ต้องเป็นรายการที่ประกาศเจตนาไว้', () => {
  const allowed = [...ALLOW_ALL_INTERFACES.keys()].sort();
  assert.deepEqual(allowed, ['1883'], 'ถ้าจะอนุญาตพอร์ตเพิ่ม ต้องแก้เทสต์นี้และเอกสารกำกับ');
});
