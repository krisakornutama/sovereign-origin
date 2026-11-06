// tools/agent-pack/modules.mjs
//
// ── "จะติดตั้งฟังก์ชั่นอะไรที่เครื่องนี้" ────────────────────────────────────────
// เจ้าของสั่ง 25/10/69: "ก็อปปี้เป็นไฟล์ใหญ่เลย ทั้งระบบ เป็นตัวติดตั้ง ให้เลือก
// ฟังก์ชั่นที่จะติดตั้ง เช่น IOT ระบบเลี้ยงดูลูก"
//
// ไฟล์นี้เป็น **ที่เดียว** ที่บอกว่ามีฟังก์ชั่นอะไรให้เลือก และแต่ละฟังก์ชั่น
// ไปเขียนอะไรลงเครื่องลูกจริง:
//   · enabledModules → ชื่อใน ENABLED_MODULES ของ core-api (ประตูจริง ไม่ใช่แค่ซ่อนเมนู)
//   · services       → container ที่ต้องเปิดใน docker-compose (ค่าเริ่มต้นเปิดหมดอยู่แล้ว)
//   · pages          → หน้าเว็บที่ฟังก์ชั่นนี้เป็นเจ้าของ (ใช้สรุปให้ผู้ใช้เห็น)
//
// กติกา: ชื่อ `enabledModules` ต้องเป็นชื่อที่ backend รู้จัก (AVAILABLE_MODULES ใน
// sovereign-os/core-api/src/config/index.ts) — เทสต์ตรวจให้ทั้งสองทาง
// ชื่ออื่น (iot/kids/…) เก็บใน install-plan.json เพื่อให้หน้าเว็บ/ตัวติดตั้งรุ่นต่อไปใช้
// แต่ **ไม่** เขียนลง ENABLED_MODULES เพราะ backend จะเตือนแล้วทิ้งค่านั้น

/** ชื่อโมดูลที่ backend ใช้เปิด/ปิดจริง — ต้องตรงกับ AVAILABLE_MODULES */
export const BACKEND_MODULES = Object.freeze(['inventory', 'farm', 'vision', 'documents', 'restaurant']);

/**
 * แคตตาล็อกฟังก์ชั่น — ลำดับในอาร์เรย์นี้คือลำดับเลขที่ผู้ใช้เห็น (1,2,3,…)
 * @type {ReadonlyArray<{id:string,label:string,desc:string,required?:boolean,recommended?:boolean,pages:string[],enabledModules?:string[],services?:string[]}>}
 */
export const MODULE_CATALOG = Object.freeze([
  {
    id: 'core',
    label: 'ระบบหลัก (บังคับ)',
    desc: 'หน้าแรก · เครื่องลูก/คิวงาน · สถานะระบบ · ตั้งค่า',
    required: true,
    recommended: true,
    pages: ['/dashboard', '/machine-console', '/agent-queue', '/system', '/settings'],
    services: ['timescaledb', 'core-api'],
  },
  {
    id: 'iot',
    label: 'IoT / เซนเซอร์ / รีเลย์',
    desc: 'อ่านเซนเซอร์ ESP32 · สั่งรีเลย์ · บ้าน 3D · อุปกรณ์ในโรงงาน/ร้าน',
    recommended: true,
    pages: ['/sensors', '/automation', '/relay', '/infrastructure', '/property'],
    services: ['emqx'],
  },
  {
    id: 'kids',
    label: 'เลี้ยงดูลูก',
    desc: 'ตารางเรียน/บทเรียน · งานบ้าน · ค่าขนม/กระเป๋าเด็ก · ทักษะ · นิสัยการนอน',
    recommended: true,
    pages: ['/skills', '/lifestyle', '/mbti'],
  },
  {
    id: 'farm',
    label: 'ฟาร์ม / ปศุสัตว์',
    desc: 'แปลง/ผลผลิต · ปศุสัตว์ · traceability (QR) · พึ่งพาตนเอง',
    recommended: true,
    pages: ['/farm', '/livestock', '/trace', '/selfreliance'],
    enabledModules: ['farm'],
  },
  {
    id: 'inventory',
    label: 'คลังสินค้า / วัตถุดิบ',
    desc: 'สต็อก · รับเข้า/เบิกออก · แจ้งเตือนของใกล้หมด',
    pages: ['/inventory'],
    enabledModules: ['inventory'],
  },
  {
    id: 'energy',
    label: 'พลังงาน / ไฟฟ้า',
    desc: 'มิเตอร์ · ต้นทุนไฟ · วางแผนลดการใช้',
    pages: ['/energy'],
  },
  {
    id: 'health',
    label: 'สุขภาพ / ดูแลตัวเอง',
    desc: 'บันทึกสุขภาพ · self-check · ฟื้นตัว · เตือนความเสี่ยง',
    pages: ['/health', '/health/self-check', '/healing', '/crisis', '/risk-monitor', '/alerts', '/alert-history'],
  },
  {
    id: 'vision',
    label: 'Vision AI (กล้อง)',
    desc: 'ตรวจภาพจากกล้อง · นับของ · ตรวจนก/ศัตรูพืช',
    pages: ['/vision'],
    enabledModules: ['vision'],
  },
  {
    id: 'documents',
    label: 'เอกสาร / องค์ความรู้',
    desc: 'คลังเอกสาร · ค้นหาเชิงความหมาย · องค์ความรู้ในบ้าน',
    pages: ['/knowledge'],
    enabledModules: ['documents'],
  },
  {
    id: 'ai',
    label: 'AI / เขียนโค้ด',
    desc: 'ผู้ช่วย AI · agent เขียนโค้ด · เรียนรู้จากข้อมูลจริง · พยากรณ์',
    recommended: true,
    pages: ['/ai', '/ai-agent', '/learning', '/predictive'],
  },
  {
    id: 'security',
    label: 'ความปลอดภัย / ผู้ใช้',
    desc: '防火墙 · ผู้ใช้/สิทธิ์ · audit log',
    pages: ['/security', '/users', '/audit'],
  },
]);

/** id ทั้งหมดตามลำดับที่โชว์ */
export function allModuleIds(catalog = MODULE_CATALOG) {
  return catalog.map((m) => m.id);
}

/** id ของฟังก์ชั่นที่ติดมาให้อยู่แล้ว (บังคับ) */
export function requiredModuleIds(catalog = MODULE_CATALOG) {
  return catalog.filter((m) => m.required).map((m) => m.id);
}

/** ชุดที่แนะนำ = Enter เฉย ๆ (บังคับ + ที่ทำเครื่องหมาย recommended) */
export function recommendedIds(catalog = MODULE_CATALOG) {
  return catalog.filter((m) => m.required || m.recommended).map((m) => m.id);
}

/** เรียง id ตามลำดับแคตตาล็อก + ตัดซ้ำ + ทิ้ง id ที่ไม่มีจริง */
export function orderModuleIds(ids, catalog = MODULE_CATALOG) {
  const want = new Set((ids ?? []).map((s) => String(s ?? '').trim().toLowerCase()).filter(Boolean));
  return catalog.filter((m) => want.has(m.id)).map((m) => m.id);
}

/** หา pack จาก id (ไม่สนตัวพิมพ์) */
export function findModule(id, catalog = MODULE_CATALOG) {
  const key = String(id ?? '').trim().toLowerCase();
  return catalog.find((m) => m.id === key) ?? null;
}

/**
 * อ่านคำตอบของผู้ใช้ ("1,3" · "iot,kids" · "a" · "")
 *
 * คืน `{ ok:true, ids }` หรือ `{ ok:false, error, token }` — ไม่คืนรายการครึ่ง ๆ กลาง ๆ
 * เพราะถ้าเลือกไม่ครบแล้วติดตั้งไป ผู้ใช้จะเห็นฟังก์ชั่นที่ไม่ได้สั่งหรือขาดของที่สั่ง
 * โดยไม่รู้ตัว (แย่กว่าให้ถามใหม่)
 */
export function parseModuleSelection(input, catalog = MODULE_CATALOG) {
  const required = requiredModuleIds(catalog);
  const fallback = recommendedIds(catalog);
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: true, ids: fallback };

  const tokens = raw.split(/[\s,;|]+/).map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return { ok: true, ids: fallback };

  if (tokens.length === 1 && /^(\*|a|all|ทุก|ทั้งหมด)$/i.test(tokens[0])) {
    return { ok: true, ids: allModuleIds(catalog) };
  }

  const picked = new Set(required);
  for (const token of tokens) {
    if (/^-?\d+$/.test(token)) {
      const n = Number(token);
      if (!Number.isInteger(n) || n < 1 || n > catalog.length) {
        return { ok: false, error: 'out_of_range', token };
      }
      picked.add(catalog[n - 1].id);
      continue;
    }
    // ชื่อรหัสตรงตัวก่อน แล้วค่อยยอมให้พิมพ์เฉพาะคำไทยในชื่อ (เช่น "เลี้ยงดูลูก")
    const hit =
      findModule(token, catalog) ??
      catalog.find((m) => String(m.label).toLowerCase().includes(token.toLowerCase()));
    if (!hit) return { ok: false, error: 'unknown', token };
    picked.add(hit.id);
  }
  return { ok: true, ids: orderModuleIds([...picked], catalog) };
}

/** ชื่อโมดูลที่ต้องเขียนลง ENABLED_MODULES (เรียงตามแคตตาล็อก · ไม่ซ้ำ · เฉพาะที่ backend รู้จัก) */
export function enabledModulesFor(ids, catalog = MODULE_CATALOG) {
  const out = [];
  for (const id of orderModuleIds(ids, catalog)) {
    for (const name of findModule(id, catalog)?.enabledModules ?? []) {
      if (BACKEND_MODULES.includes(name) && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/** container ที่ต้องเปิดสำหรับฟังก์ชั่นที่เลือก (คืนเฉพาะที่มีระบุ — compose เปิดที่เหลือตามปกติ) */
export function servicesFor(ids, catalog = MODULE_CATALOG) {
  const out = [];
  for (const id of orderModuleIds(ids, catalog)) {
    for (const svc of findModule(id, catalog)?.services ?? []) {
      if (!out.includes(svc)) out.push(svc);
    }
  }
  return out;
}

/** หน้าเว็บที่ฟังก์ชั่นที่เลือกเป็นเจ้าของ (ใช้สรุป/ตรวจว่าติดตั้งอะไรไป) */
export function pagesFor(ids, catalog = MODULE_CATALOG) {
  const out = [];
  for (const id of orderModuleIds(ids, catalog)) {
    for (const page of findModule(id, catalog)?.pages ?? []) {
      if (!out.includes(page)) out.push(page);
    }
  }
  return out;
}

/**
 * เมนูให้ผู้ใช้เลือก (ข้อความล้วน — เทสต์ตรวจได้ ไม่ต้องมี terminal)
 * @param {ReadonlyArray} catalog
 * @param {ReadonlyArray<string>} selected id ที่เลือกอยู่แล้ว
 */
export function renderModuleMenu(catalog = MODULE_CATALOG, selected = []) {
  const on = new Set(selected ?? []);
  const lines = [];
  catalog.forEach((m, i) => {
    const mark = on.has(m.id) ? '✔' : ' ';
    lines.push(`  ${String(i + 1).padStart(2, ' ')}) [${mark}] ${m.label}${m.required ? ' *' : ''} — ${m.desc}`);
  });
  lines.push('');
  lines.push('  พิมพ์เลขคั่นด้วย , (เช่น 1,2,5) หรือชื่อรหัส (iot,kids)');
  lines.push('  Enter = ชุดที่แนะนำ · a = ทั้งหมด · * = บังคับติดมาทุกครั้ง');
  return lines.join('\n');
}

/** สรุปสั้น ๆ ว่าเลือกอะไร (ใช้บรรทัด confirm + machine-profile.json) */
export function summarizeModules(ids, catalog = MODULE_CATALOG) {
  const picked = orderModuleIds(ids, catalog).map((id) => findModule(id, catalog)?.label ?? id);
  return picked.length ? picked.join(' · ') : '(ไม่มี)';
}
