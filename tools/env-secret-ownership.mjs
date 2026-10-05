// ────────────────────────────────────────────────────────────────────────────
// env-secret-ownership.mjs — อ่าน "ใครเป็นเจ้าของค่าลับตัวไหน" จากไฟล์จริง
//
// ทำไมต้องมี (วัดจริง 5/10/69 — เจอซ้ำกับ STRIPE_WEBHOOK_SECRET):
//   กับดักที่ทำเงินหายเงียบไม่ใช่แค่ "ใส่ค่าผิดไฟล์" แต่คือ **"ทั้งระบบไม่มีใคร
//   ตอบได้ว่าไฟล์ไหนถูก"** คนดูแลจึงเดาจากชื่อที่ใกล้สุด แล้วมันผิด
//   คราวนี้ค่านี้ไม่ได้หลุดแค่ในไฟล์จริง แต่หลุดใน **ไฟล์ตัวอย่างที่ track ไว้**
//   ด้วยซ้ำ คือ:
//     ✗ sovereign-os/core-api/.env.example   มีช่อง STRIPE_WEBHOOK_SECRET=  ← ชี้ผิด
//     ✗ sovereign-os/infra/.env.example      ไม่มีช่องนี้เลย            ← เจ้าของจริง
//   ⇒ clone ใหม่แล้วทำตามไฟล์ตัวอย่าง = หลุดทันที แบบไม่มีใครเตือน
//
// ไฟล์นี้เป็น "ข้อเท็จจริงเกี่ยวกับโครงสร้างไฟล์" ล้วน ๆ ไม่มี I/O ไม่อ่านค่าลับ
// (คืนได้แค่ "ชื่อคีย์" ไม่ใช่ค่า) ⇒ เทสต์ได้โดยไม่ต้องมีไฟล์จริงและไม่มีทางรั่ว
//
// กติกาที่บังคับ (ผู้ดูแลเปลี่ยนโครงสร้างไฟล์แล้วต้องเห็นผลทันที):
//   1) คีย์ที่ compose ส่งเข้า container ต้องมี "ที่อยู่จริง" ที่ระบุได้ว่าอยู่ไฟล์ไหน
//   2) คีย์ลับที่ประกาศว่าเจ้าของคือไฟล์ที่ A ต้อง **ไม่** ปรากฏในไฟล์ตัวอย่างของ B
//      (B = ไฟล์ที่ไม่มีผลกับ container) — นี่คือกับดักที่ทำเงินหาย
//   3) ไฟล์ตัวอย่างของเจ้าของ (A) ต้องมีช่องของคีย์นั้น ไม่ใช่แค่ไม่มีใน B
//      (ไม่มีช่อง = คนตั้งค่าไม่ได้ แม้จะรู้ว่าต้องแก้ A)
// ────────────────────────────────────────────────────────────────────────────

/**
 * อ่านชื่อคีย์จากไฟล์ .env (หรือ .env.example) — คืนชื่อเท่านั้น ไม่คืนค่า
 *
 * ข้ามบรรทัดว่าง/คอมเมนต์ และตัด comment ท้ายบรรทัดแบบเดียวกับ dotenv
 * คีย์ที่ปรากฏซ้ำคืนค่าเดียว (ชื่อเดียว) — เพราะคำถามคือ "มีคีย์นี้ไหม" ไม่ใช่ "ค่าอันไหนชนะ"
 */
export function parseEnvKeys(text) {
  const keys = new Set();
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * แยก `services:` ออกมาเป็นราย service พร้อมชื่อคีย์ใน `environment:`
 *
 * เขียนเองแทน YAML lib เพราะ: (1) ไม่ต้องเพิ่ม dependency
 * (2) โครงสร้างไฟล์นี้คงที่และเป็นตัวกำหนดว่าอะไรมีผลจริง — ถ้า YAML ซับซ้อนขึ้น
 *     parser ต้อง "พัง" ให้เห็น ไม่ใช่เดาใบ้ ๆ (docker compose config คือคำตอบจริง)
 *
 * รองรับทั้ง `KEY: value` และ `KEY:` (ย่อยเป็นรายการ) ซึ่งเป็นรูปแบบที่ใช้จริงในไฟล์นี้
 */
export function parseComposeServices(yamlText) {
  const services = {};
  const lines = String(yamlText ?? '').split(/\r?\n/);
  let current = null;
  let inEnvironment = false;

  for (const line of lines) {
    const serviceMatch = /^ {2}([A-Za-z0-9._-]+):\s*$/.exec(line);
    if (serviceMatch) {
      current = serviceMatch[1];
      services[current] = { envKeys: [], referencedVars: new Set() };
      inEnvironment = false;
      continue;
    }
    if (!current) continue;
    // เข้า/ออกบล็อก environment:
    if (/^ {4}environment:\s*$/.test(line)) { inEnvironment = true; continue; }
    if (/^ {4}\S/.test(line)) inEnvironment = false;
    if (inEnvironment) {
      const kv = /^ {6}([A-Za-z0-9_]+):/.exec(line);
      if (kv) services[current].envKeys.push(kv[1]);
    }
    // ${VAR} / ${VAR:-default} / ${VAR:?required} — ตัวแปรที่ compose ดึงจาก .env ตัวเลือก
    for (const m of line.matchAll(/\$\{([A-Za-z0-9_]+)[:?-]/g)) {
      services[current].referencedVars.add(m[1]);
    }
  }
  return services;
}

/** คีย์ลับ/ค่าลับที่ต้องระวังเรื่อง "เขียนผิดไฟล์แล้วไม่มีผล" */
const SECRET_NAME_PATTERN = /(SECRET|TOKEN|PASSWORD|PASS$|_KEY$|APIKEY|PRIVATE|CREDENTIAL)/;

/** ชื่อคีย์ที่ "หน้าตาเหมือนค่าลับ" (ไว้รายงานให้คนตัดสินใจ ไม่ได้ฟันธงเองว่าลับ) */
export function isSecretShapedKey(key) {
  return SECRET_NAME_PATTERN.test(String(key ?? ''));
}

/**
 * อ่านคีย์เดียวจากเนื้อไฟล์ .env โดย**แยก 3 สถานะ** ไม่ใช่ 2
 *
 * ทำไมต้องแยก (เจอจริงรอบนี้): การอ่านแบบคืนค่าเดียวทำให้ "อ่านไฟล์ไม่ได้" กับ
 * "อ่านได้ แต่ไม่มีคีย์นี้" กลายเป็นข้อความเดียวกัน — พอเราลบคีย์หลุดออกจาก
 * ไฟล์หลอกตามแผน เครื่องมือก็รายงานว่า "อ่านไม่ได้" ทั้งที่ไฟล์อ่านได้ปกติ
 * ในเครื่องมือที่หน้าที่คือบอกความจริงเรื่องค่าลับอย่างซื่อสัตย์ ข้อความผิดชนิด
 * แบบนี้ทำให้คนหยุดเชื่อทั้งตัว — ซึ่งแย่กว่าการไม่มีเครื่องมือเลย
 *
 * @returns {{ state: 'present', value: string } | { state: 'absent' } | { state: 'unreadable' }}
 */
export function readEnvKeyState(text, key) {
  if (text === null || text === undefined) return { state: 'unreadable' };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() !== key) continue;
    const value = line.slice(eq + 1).trim().replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
    return { state: 'present', value };
  }
  return { state: 'absent' };
}

/**
 * คีย์ลับที่อยู่ในไฟล์ host-run แต่ **ไม่ถึง container เลย**
 *
 * นี่คือรายการที่ต้องรายงานเสียงดัง ไม่ใช่ของที่ "ผิด" เสมอ — เพราะบางคีย์เป็น
 * ของ host-run จริง ๆ (พัฒนาบนเครื่อง) ผู้ดูแลต้องตัดสินใจเองว่าจะ "ย้าย" หรือ "ยอมให้เป็น host-only"
 * เครื่องมือนี้จึงรายงาน ไม่ลบ ไม่แก้ ไม่เดา
 */
export function findSecretsNotReachingContainer({ hostEnvKeys, composeYaml }) {
  const services = parseComposeServices(composeYaml);
  const allEnvKeys = new Set();
  for (const svc of Object.values(services)) for (const k of svc.envKeys) allEnvKeys.add(k);
  const hostKeys = hostEnvKeys instanceof Set ? hostEnvKeys : parseEnvKeys(hostEnvKeys);
  return [...hostKeys]
    .filter((k) => isSecretShapedKey(k) && !allEnvKeys.has(k))
    .sort();
}

/**
 * คีย์ที่อยู่ในไฟล์เจ้าของ แต่ไม่มี service ไหนอ้างถึงเลย
 *
 * อันนี้ไม่ทำให้เงินหาย แต่ทำให้ "ตั้งค่าแล้วไม่มีอะไรเกิดขึ้น" โดยไม่มีใครรู้
 * (คนเข้าใจว่าเปิดใช้งานแล้วเพราะใส่ค่าไว้ในไฟล์ที่ถูกตามกติกาของตัวเอง)
 */
export function findOwnerKeysReferencedByNothing({ ownerEnvKeys, composeYaml }) {
  const services = parseComposeServices(composeYaml);
  const referenced = new Set();
  for (const svc of Object.values(services)) for (const v of svc.referencedVars) referenced.add(v);
  const ownerKeys = ownerEnvKeys instanceof Set ? ownerEnvKeys : parseEnvKeys(ownerEnvKeys);
  return [...ownerKeys].filter((k) => !referenced.has(k)).sort();
}

/**
 * ตรวจ "กับดักช่องค่าลับผิดไฟล์" ที่ทำให้เงินหาย — บนไฟล์ตัวอย่างที่ track ไว้
 *
 * นี่คือเช็กที่ต้องผ่าน **ตลอดเวลา** ไม่ใช่แค่ตอนนี้ เพราะไฟล์ตัวอย่างคือสิ่งที่
 * clone ใหม่ใช้สร้างไฟล์จริง ถ้าช่องอยู่ผิดไฟล์ ทุกคนที่ตั้งค่าใหม่จะหลุด
 *
 * @param {object} input
 * @param {string} input.key              คีย์ที่ต้องการตรวจ (เช่น STRIPE_WEBHOOK_SECRET)
 * @param {string} input.ownerExample     เนื้อหาไฟล์ตัวอย่างของเจ้าของ (A)
 * @param {string} input.hostRunExample   เนื้อหาไฟล์ตัวอย่างของ host-run (B)
 * @param {string} input.composeYaml      เนื้อหา docker-compose.yml
 * @returns {{ ok: boolean, problems: string[], ownerHasSlot: boolean, hostRunHasSlot: boolean, reachesContainer: boolean }}
 */
export function auditSecretSlotOwnership({ key, ownerExample, hostRunExample, composeYaml }) {
  const problems = [];
  const ownerKeys = parseEnvKeys(ownerExample);
  const hostRunKeys = parseEnvKeys(hostRunExample);
  const services = parseComposeServices(composeYaml);

  const ownerHasSlot = ownerKeys.has(key);
  const hostRunHasSlot = hostRunKeys.has(key);
  const reachesContainer = Object.values(services).some((s) => s.envKeys.includes(key));

  // (1) ช่องต้องอยู่ที่เจ้าของ — ไม่มีช่อง = คนที่ทำตามเอกสารตั้งค่าไม่ได้เลย
  if (!ownerHasSlot) {
    problems.push(
      `ไฟล์ตัวอย่างของเจ้าของไม่มีช่อง ${key} — คนที่ตั้งค่าตามเอกสารจะหาไฟล์ที่ใส่ค่าไม่เจอ`,
    );
  }
  // (2) ห้ามมีช่องในไฟล์ที่ไม่มีผล — นี่คือตัวที่ทำเงินหายจริง
  if (hostRunHasSlot) {
    problems.push(
      `ไฟล์ตัวอย่าง host-run ยังมีช่อง ${key} ทั้งที่ไฟล์นั้นไม่มีผลกับ container — ` +
      `คนจะใส่ค่าตรงนี้แล้วคิดว่ารู้แล้ว แต่จริง ๆ ไม่มีผล`,
    );
  }
  // (3) compose ต้องส่งค่าเข้า container ได้จริง
  if (!reachesContainer) {
    problems.push(`docker-compose ไม่ได้ส่ง ${key} เข้า container เลย — ไม่มีทางที่ค่าจะมีผล`);
  }

  return { ok: problems.length === 0, problems, ownerHasSlot, hostRunHasSlot, reachesContainer };
}