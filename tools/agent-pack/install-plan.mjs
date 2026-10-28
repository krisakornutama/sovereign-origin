// tools/agent-pack/install-plan.mjs
//
// ── "แผนติดตั้ง" ที่ตัวแพ็กเขียนลงชุดติดตั้ง และเครื่องลูกอ่านตอนติดตั้ง ─────────────
// เจ้าของสั่ง 25/10/69: "พอติดตั้งเสร็จ ระบบจะขึ้นข้อมูลในเครื่องเลยว่า
// เครื่องนี้เป็นลูกของเครื่องไหน"
//
// ไฟล์ install-plan.json = คำตอบของสองคำถามนั้น (ชื่อเครื่องแม่ + ฟังก์ชั่นที่เลือก)
// **ไม่มี token** — token อยู่ใน join.json ที่เดียว (แยกกันเพื่อให้ส่งไฟล์แผนให้ใครดูก็ได้)
//
// ฝั่งเครื่องลูกใช้สองทาง:
//   1) โชว์ให้เห็นทันทีหลังติดตั้ง (MACHINE-PROFILE.txt + หน้าจอ)
//   2) เขียน ENABLED_MODULES/PARENT_NAME ลง sovereign-os/infra/.env ของ stack ตัวเอง
//      (แก้เฉพาะบรรทัดที่เกี่ยวข้อง · รันซ้ำได้ผลเท่าเดิม)
import fs from 'node:fs';
import path from 'node:path';
import {
  MODULE_CATALOG,
  enabledModulesFor,
  findModule,
  orderModuleIds,
  pagesFor,
  recommendedIds,
  summarizeModules,
} from './modules.mjs';

export const INSTALL_PLAN_FILE = 'install-plan.json';
export const MACHINE_PROFILE_FILE = 'machine-profile.json';
export const MACHINE_PROFILE_TEXT = 'MACHINE-PROFILE.txt';
/** ใช้เมื่อชุดติดตั้งไม่ได้ระบุเจ้าของ (ชุดเก่า/แพ็กแบบไม่ผูกเครื่อง) */
export const FALLBACK_OWNER_LABEL = 'ยังไม่ระบุเครื่องแม่';

/** ที่อยู่ของ .env ฝั่ง stack (คนละไฟล์กับ .env ของ runner ที่อยู่รากชุดติดตั้ง) */
export function stackEnvRel() {
  return path.join('sovereign-os', 'infra', '.env');
}

export function planPath(dir) {
  return path.join(dir, INSTALL_PLAN_FILE);
}

export function profileJsonPath(dir) {
  return path.join(dir, MACHINE_PROFILE_FILE);
}

export function profileTextPath(dir) {
  return path.join(dir, MACHINE_PROFILE_TEXT);
}

/**
 * สร้างแผนติดตั้ง (ค่าที่ไม่รู้จักถูกตัดทิ้ง — กัน token หลุดลงไฟล์ที่แชร์ได้)
 * @param {{machineName?: string, hubUrl?: string, parent?: {id?: string, username?: string}|null, modules?: string[], createdAt?: string}} input
 */
export function buildInstallPlan({
  machineName = '',
  hubUrl = '',
  parent = null,
  executors = '',
  modules = [],
  createdAt = new Date().toISOString(),
} = {}) {
  const picked = modules && modules.length ? orderModuleIds(modules, MODULE_CATALOG) : recommendedIds(MODULE_CATALOG);
  const owner = parent && String(parent.username ?? '').trim()
    ? { username: String(parent.username).trim(), ...(parent.id ? { id: String(parent.id) } : {}) }
    : null;
  return {
    schema: 1,
    machineName: String(machineName ?? '').trim(),
    hubUrl: String(hubUrl ?? '').trim().replace(/\/$/, ''),
    parent: owner,
    // executors ที่เครื่องลูกควรเปิด (เช่น "echo,opencode") — setup-machine อ่านค่านี้เขียน .env
    // ให้เครื่องลูกโดยไม่ต้องพิมพ์อะไร (ค่าว่าง = ไม่ระบุ → เครื่องลูกใช้ค่าเริ่มต้น echo)
    ...(String(executors ?? '').trim() ? { executors: String(executors).trim() } : {}),
    modules: picked,
    moduleLabels: picked.map((id) => findModule(id, MODULE_CATALOG)?.label ?? id),
    enabledModules: enabledModulesFor(picked, MODULE_CATALOG),
    pages: pagesFor(picked, MODULE_CATALOG),
    createdAt: String(createdAt),
    note: 'แผนติดตั้งของเครื่องนี้ (ไม่มีความลับ) — สร้างโดย tools/agent-pack',
  };
}

/**
 * อ่าน JSON จากไฟล์โดยทน BOM
 *
 * ของจริงบน Windows: Notepad/Notepad++ บางรุ่น และ `Set-Content -Encoding UTF8` ของ
 * PowerShell 5.1 เติม BOM (`\uFEFF`) หน้าไฟล์ ⇒ `JSON.parse` ล้มด้วย "Unexpected token ''"
 * ทั้งที่คนเปิดดูเห็นว่าไฟล์ถูกต้อง — เครื่องลูกจะไม่เปิดโมดูลและผู้ใช้หาสาเหตุไม่ได้
 */
function readJsonLoose(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

/**
 * อ่านแผนจากโฟลเดอร์ชุดติดตั้ง
 * @returns {{ok:true, plan:object} | {ok:false, code:'no_plan'|'bad_plan', error:string}}
 */
export function readInstallPlan(dir) {
  const file = planPath(dir);
  if (!fs.existsSync(file)) {
    return {
      ok: false,
      code: 'no_plan',
      error: `ไม่พบ ${INSTALL_PLAN_FILE} — เป็นชุดติดตั้งรุ่นเก่าที่ยังไม่มีการเลือกฟังก์ชั่น`,
    };
  }
  let parsed;
  try {
    parsed = readJsonLoose(file);
  } catch (err) {
    return { ok: false, code: 'bad_plan', error: `${INSTALL_PLAN_FILE} อ่านไม่ได้: ${String(err?.message ?? err)}` };
  }
  if (!parsed || typeof parsed !== 'object' || !String(parsed.machineName ?? '').trim()) {
    return { ok: false, code: 'bad_plan', error: `${INSTALL_PLAN_FILE} ไม่มี machineName ที่ถูกต้อง` };
  }
  const modules = Array.isArray(parsed.modules) ? parsed.modules : [];
  const parent = parsed.parent && String(parsed.parent.username ?? '').trim()
    ? { username: String(parsed.parent.username).trim(), ...(parsed.parent.id ? { id: String(parsed.parent.id) } : {}) }
    : null;
  return {
    ok: true,
    plan: {
      ...parsed,
      machineName: String(parsed.machineName).trim(),
      hubUrl: String(parsed.hubUrl ?? '').trim().replace(/\/$/, ''),
      modules: orderModuleIds(modules, MODULE_CATALOG),
      parent,
      enabledModules: Array.isArray(parsed.enabledModules) && parsed.enabledModules.length
        ? parsed.enabledModules.map(String)
        : enabledModulesFor(modules, MODULE_CATALOG),
    },
  };
}

/** เขียนแผนลงชุดติดตั้ง (atomic พอสมควร: เขียนทับทั้งไฟล์) */
export function writeInstallPlan(dir, plan) {
  const file = planPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(plan, null, 2) + '\n', 'utf8');
  return file;
}

/** บรรทัด KEY=VALUE ที่ต้องไปอยู่ใน .env ของ stack (ไม่มีคีย์ไหน = ไม่มีบรรทัดนั้น) */
export function envLinesForPlan(plan) {
  const out = [];
  const enabled = Array.isArray(plan?.enabledModules) ? plan.enabledModules.filter(Boolean) : [];
  if (enabled.length) out.push(`ENABLED_MODULES=${enabled.join(',')}`);
  if (plan?.parent?.username) out.push(`PARENT_NAME=${plan.parent.username}`);
  if (plan?.hubUrl) out.push(`PARENT_HUB_URL=${plan.hubUrl}`);
  return out;
}

/**
 * แทนที่/เพิ่มบรรทัดในข้อความ .env โดยไม่แตะคีย์อื่น
 * @param {string} text เนื้อหา .env เดิม
 * @param {string[]} lines บรรทัด KEY=VALUE ที่ต้องการ
 */
export function applyPlanToEnvText(text, lines) {
  const src = String(text ?? '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const incoming = (lines ?? []).map((l) => String(l ?? '').trim()).filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l));
  if (!incoming.length) return src;
  const wanted = new Map(incoming.map((l) => [l.slice(0, l.indexOf('=')), l]));
  const out = [];
  const used = new Set();
  for (const raw of src.split(/\r?\n/)) {
    const trimmed = raw.trim();
    const isComment = trimmed.startsWith('#');
    const key = !isComment && trimmed.includes('=') ? trimmed.split('=')[0].trim() : '';
    if (key && wanted.has(key)) {
      if (!used.has(key)) {
        out.push(wanted.get(key));
        used.add(key);
      }
      continue; // บรรทัดซ้ำของคีย์เดียวกัน — เก็บอันแรกที่แทนแล้วเท่านั้น
    }
    out.push(raw);
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  for (const line of incoming) {
    const key = line.slice(0, line.indexOf('='));
    if (!used.has(key)) {
      out.push(line);
      used.add(key);
    }
  }
  return out.join(eol) + eol;
}

/** เนื้อหา MACHINE-PROFILE.txt — สิ่งที่คนเจอหลังติดตั้งเสร็จ */
export function renderMachineProfile(plan) {
  const parent = plan?.parent?.username || FALLBACK_OWNER_LABEL;
  const hub = plan?.hubUrl || '(ไม่ระบุ)';
  const modules = summarizeModules(plan?.modules ?? [], MODULE_CATALOG);
  const lines = [
    '══════════════════════════════════════════════════',
    '  Sovereign OS — เครื่องนี้ติดตั้งเสร็จแล้ว',
    '══════════════════════════════════════════════════',
    `  ชื่อเครื่อง   : ${plan?.machineName || '(ไม่ระบุ)'}`,
    `  เครื่องแม่    : ${parent}`,
    `  HUB           : ${hub}`,
    `  ฟังก์ชั่นที่ติดตั้ง : ${modules}`,
    '',
  ];
  if (plan?.parent?.username) {
    lines.push(`  เจ้าของเครื่องนี้ถูกผูกไว้ตั้งแต่แพ็กชุดติดตั้ง ⇒ เข้าหน้า HUB ด้วยบัญชี`);
    lines.push(`  "${plan.parent.username}" แล้วควบคุมเครื่องนี้ได้ทันทีที่เครื่องออนไลน์`);
  } else {
    lines.push('  ชุดติดตั้งนี้ไม่ได้ระบุเครื่องแม่ — ผูกเองได้ที่หน้า HUB → เครื่องลูก');
  }
  lines.push('');
  return lines.join('\r\n');
}

/** เขียนโปรไฟล์เครื่อง (JSON สำหรับโปรแกรมอ่าน + TXT สำหรับคนอ่าน) */
export function writeMachineProfile(dir, plan) {
  const json = profileJsonPath(dir);
  fs.mkdirSync(path.dirname(json), { recursive: true });
  fs.writeFileSync(
    json,
    JSON.stringify({ ...plan, generatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );
  const text = profileTextPath(dir);
  fs.writeFileSync(text, renderMachineProfile(plan), 'utf8');
  return { json, text };
}
