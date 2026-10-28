#!/usr/bin/env node
// a11y — หน้าล็อกอิน / OTP / เปลี่ยนรหัสผ่าน
// เหตุผลที่ต้องมีไฟล์นี้: ทั้งสามหน้าคือ "ประตู" ที่คนในบ้านต้องผ่านทุกวัน
// แต่เดิม <label> ไม่ผูกกับช่องกรอก (ไม่มี htmlFor/id) → screen reader อ่านว่า
// "edit text" เปล่า ๆ ไม่บอกว่าต้องกรอกอะไร และข้อความ error ของ login/OTP
// ไม่มี role="alert" → คนที่ใช้ screen reader ไม่รู้ว่าล็อกอินไม่ผ่าน
//
// เทสต์นี้เป็นแบบ static (อ่าน JSX) เพราะ:
//   - ตรวจได้โดยไม่ต้องมี server/DB/บัญชีจริง (e2e ต้อง login ซึ่ง credential ไม่มีในเครื่อง)
//   - จับ regression ได้ทันทีที่มีคนแก้ฟอร์มพวกนี้
// ทุกเคสผูกกับ "สิ่งที่ผู้ใช้ได้" ไม่ใช่รายละเอียด implementation:
//   label ต้องชี้ถึง control จริง · control ต้องมีชื่อ · error ต้องถูกประกาศ
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readRaw = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ตัด comment ทิ้งก่อนตรวจ — ไม่งั้นคำอธิบายในคอมเมนต์ (เช่น `// role="alert": ...`)
// จะทำให้เทสต์ผ่านทั้งที่ attribute จริงถูกลบไปแล้ว
// ⚠️ ห้ามใช้ `/\*...\*/` แบบกว้าง: ไฟล์จริงมีสตริง `accept="image/*"` → จะกินโค้ดทั้งบล็อกทิ้ง
// (เจอจริง 28/10: เทสต์หา <input> ไม่เจอเลยเพราะกฎนี้) → ตัดเฉพาะ JSX comment และ // ที่ขึ้นบรรทัดใหม่
function stripComments(src) {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');
}
const read = (p) => stripComments(readRaw(p));

const AUTH_FILES = {
  login: 'sovereign-frontend/src/components/auth/LoginForm.tsx',
  otp: 'sovereign-frontend/src/components/auth/MfaInput.tsx',
  changePassword: 'sovereign-frontend/src/components/auth/ChangePasswordForm.tsx',
};

// หน้าที่คนในบ้านใช้จริง (C2) — ตรวจเฉพาะ "label ผูกกับช่องกรอก" ก่อน
// (กฎ "ทุกช่องต้องมีชื่อ" ยังคุมเฉพาะ auth เพราะหน้าอื่นมี input ที่มี aria-label อยู่แล้วบางส่วน)
const FORM_FILES = {
  settings: 'sovereign-frontend/src/pages/settings.tsx',
  sensorsHub: 'sovereign-frontend/src/components/sensors/SensorsHub.tsx',
  predictive: 'sovereign-frontend/src/pages/predictive.tsx',
  restaurantAdmin: 'sovereign-frontend/src/pages/restaurant/admin.tsx',
  restaurant: 'sovereign-frontend/src/pages/restaurant/index.tsx',
  vision: 'sovereign-frontend/src/pages/vision.tsx',
};

// ── ตัวอ่านแท็กแบบไม่หลง `=>` หรือ template string ──────────────────────────
// regex ธรรมดา (`<input[^>]*>`) ใช้ไม่ได้ เพราะ arrow function ใน attribute
// มี `>` อยู่ (`onChange={(e) => setX(e.target.value)}`) → จะตัดแท็กขาดกลางคัน
function readTag(src, start) {
  let i = start + 1;
  let depth = 0;
  let quote = null;
  while (i < src.length) {
    const ch = src[i];
    if (quote) {
      if (ch === quote && src[i - 1] !== '\\') quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
    } else if (ch === '>' && depth === 0 && src[i - 1] !== '=') {
      return { text: src.slice(start, i + 1), end: i + 1 };
    }
    i += 1;
  }
  return null;
}

function tags(src, name) {
  const out = [];
  const re = new RegExp('<' + name + '\\b', 'g');
  let m;
  while ((m = re.exec(src))) {
    const t = readTag(src, m.index);
    if (!t) break;
    out.push({ start: m.index, end: t.end, text: t.text, attrs: t.text.slice(name.length + 1, -1) });
    re.lastIndex = t.end;
  }
  return out;
}

const attr = (tag, key) => {
  const m = new RegExp('(?:^|\\s)' + key + '\\s*=\\s*"([^"]*)"').exec(' ' + tag.attrs);
  return m ? m[1] : null;
};
const hasAttr = (tag, key) => new RegExp('(?:^|\\s)' + key + '\\s*=').test(' ' + tag.attrs);

// aria-describedby อาจเป็น string ตรง ๆ หรือ JSX expression (`{error ? 'login-error' : undefined}`)
// → ดึง "ชื่อ id" ออกมาให้ได้ทั้งสองแบบ เพื่อยืนยันว่าชี้ไปยัง element ที่มีอยู่จริง
const idRef = (tag, key) => {
  const m = new RegExp('(?:^|\\s)' + key + '\\s*=\\s*(?:"([^"]*)"|\\{[^}]*?[\'"]([^\'"]+)[\'"])').exec(' ' + tag.attrs);
  return m ? (m[1] || m[2] || null) : null;
};

function labelsWithNoAssociation(src) {
  const bad = [];
  for (const label of tags(src, 'label')) {
    if (hasAttr(label, 'htmlFor')) continue;
    // label ที่ "ห่อ" control ไว้ = สมาคมแบบ implicit ใช้ได้ตาม HTML spec
    const close = src.indexOf('</label>', label.end);
    const inner = close === -1 ? '' : src.slice(label.end, close);
    if (/<(input|select|textarea)\b/.test(inner)) continue;
    bad.push(label.text.replace(/\s+/g, ' ').slice(0, 80));
  }
  return bad;
}

function controlsWithNoName(src) {
  const ids = new Set(tags(src, 'label').map((l) => attr(l, 'htmlFor')).filter(Boolean));
  const bad = [];
  for (const tagName of ['input', 'select', 'textarea']) {
    for (const c of tags(src, tagName)) {
      if (hasAttr(c, 'aria-label') || hasAttr(c, 'aria-labelledby')) continue;
      const id = attr(c, 'id');
      if (id && ids.has(id)) continue;
      bad.push(c.text.replace(/\s+/g, ' ').slice(0, 80));
    }
  }
  return bad;
}

function danglingHtmlFor(src) {
  const ids = new Set(tags(src, 'input').concat(tags(src, 'select'), tags(src, 'textarea')).map((c) => attr(c, 'id')).filter(Boolean));
  return tags(src, 'label')
    .map((l) => attr(l, 'htmlFor'))
    .filter((v) => v && !ids.has(v));
}

/** ข้อความ error ต้องอยู่ใน element ที่มี role="alert" (หรือ aria-live assertive) */
function errorIsAnnounced(src) {
  const idx = src.indexOf('{error}');
  if (idx === -1) return { ok: false, why: 'ไม่พบจุดที่แสดง {error}' };
  const window = src.slice(Math.max(0, idx - 400), idx + 120);
  // ต้องเป็น attribute จริง — ไม่ใช่ substring ของ data-role="alert"
  const ok = /(?:^|[\s{])role="alert"/m.test(window) || /(?:^|[\s{])aria-live="assertive"/m.test(window);
  return { ok, why: ok ? '' : 'error ไม่ได้อยู่ใน role="alert"/aria-live' };
}

describe('a11y — auth screens: label ผูกกับช่องกรอกจริง', () => {
  for (const [name, file] of Object.entries(AUTH_FILES)) {
    test(`${name}: ไม่มี <label> ที่ลอยอยู่เดี่ยว ๆ`, () => {
      const bad = labelsWithNoAssociation(read(file));
      assert.deepEqual(bad, [], `${file} มี label ที่ไม่ได้ผูกกับช่องกรอก: ${bad.join(' | ')}`);
    });

    test(`${name}: ไม่มี htmlFor ที่ชี้ไปยัง id ที่ไม่มีอยู่`, () => {
      const bad = danglingHtmlFor(read(file));
      assert.deepEqual(bad, [], `${file} มี htmlFor ชี้เป้าผิด: ${bad.join(', ')}`);
    });

    test(`${name}: ทุกช่องกรอกมีชื่อให้ screen reader อ่าน`, () => {
      const bad = controlsWithNoName(read(file));
      assert.deepEqual(bad, [], `${file} มีช่องกรอกไม่มีชื่อ: ${bad.join(' | ')}`);
    });
  }
});

describe('a11y — หน้าที่คนในบ้านใช้ (C2): label ผูกกับช่องกรอกจริง', () => {
  for (const [name, file] of Object.entries(FORM_FILES)) {
    test(`${name}: ไม่มี <label> ที่ลอยอยู่เดี่ยว ๆ`, () => {
      const bad = labelsWithNoAssociation(read(file));
      assert.deepEqual(bad, [], `${file} มี label ที่ไม่ได้ผูกกับช่องกรอก: ${bad.join(' | ')}`);
    });

    test(`${name}: ไม่มี htmlFor ที่ชี้ไปยัง id ที่ไม่มีอยู่`, () => {
      const bad = danglingHtmlFor(read(file));
      assert.deepEqual(bad, [], `${file} มี htmlFor ชี้เป้าผิด: ${bad.join(', ')}`);
    });
  }
});

describe('a11y — auth screens: ข้อความ error ถูกประกาศ', () => {
  for (const [name, file] of Object.entries(AUTH_FILES)) {
    test(`${name}: error อยู่ในกล่องที่ประกาศตัวเอง`, () => {
      const r = errorIsAnnounced(read(file));
      assert.ok(r.ok, `${file}: ${r.why}`);
    });
  }

  test('login: ช่องกรอกชี้ไปยัง error (aria-describedby + aria-invalid)', () => {
    const src = read(AUTH_FILES.login);
    const inputs = tags(src, 'input');
    assert.ok(inputs.length >= 2, 'ต้องมีช่อง username/password');
    for (const i of inputs) {
      assert.match(i.text, /aria-invalid=/, 'ช่องกรอกต้องบอกสถานะผิดพลาดด้วย aria-invalid');
      assert.match(i.text, /aria-describedby=/, 'ช่องกรอกต้องชี้ไปยังข้อความ error ด้วย aria-describedby');
    }
    const target = idRef(inputs[0], 'aria-describedby');
    assert.ok(target && src.includes(`id="${target}"`), `aria-describedby="${target}" ต้องมี element id ตรงกัน`);
  });
});
