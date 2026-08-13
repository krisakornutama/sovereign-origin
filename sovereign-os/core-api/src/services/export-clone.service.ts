// src/services/export-clone.service.ts
//
// Export & Clone — ผู้ใช้ติ๊กเลือกฟังก์ชั่นที่อยากถอดแบบ (clone) ในหน้า Settings
// → ส่งออกเป็นแพ็กเกจ JSON (ข้อมูลทั้งหมดของโมดูลที่เลือก + รายการไฟล์ที่เกี่ยวข้อง)
// → นำแพ็กเกจไปติดตั้งที่เครื่องอื่น (import) ระบบจะสร้างข้อมูลให้เหมือนต้นฉบับ
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// ── รายการโมดูลที่ถอดแบบได้ — แต่ละตัว = กลุ่มตารางที่เกี่ยวข้อง ──
export interface ManifestModule {
  key: string;
  name: string;
  emoji: string;
  description: string;
  tables: string[];
}

export const MODULE_MANIFEST: ManifestModule[] = [
  {
    key: 'knowledge',
    name: 'คลังความรู้ + AI สอนลูก',
    emoji: '📚',
    description: 'ความรู้ทั้งหมด + embedding + บทเรียน/แบบทดสอบที่ AI สร้าง',
    tables: ['knowledge_items', 'knowledge_embeddings'],
  },
  {
    key: 'kids',
    name: 'หน้าที่ของลูก (งานบ้าน/คะแนน/ออม/คูปอง)',
    emoji: '🧒',
    description: 'โปรไฟล์เด็ก งานบ้าน ค่าขนม กระปุกออมสิน คูปอง เกียรติบัตร พอร์ตหุ้น',
    tables: [
      'kid_profiles',
      'kid_lesson_progress',
      'kid_chores',
      'kid_bills',
      'kid_wallet_txs',
      'kid_piggy_txs',
      'kid_investments',
      'kid_audit_logs',
      'kid_coupons',
      'kid_certificates',
      'kid_portfolio_deposits',
      'kid_portfolio_snapshots',
    ],
  },
  {
    key: 'vision',
    name: 'Vision AI (กล้อง + จดจำใบหน้า)',
    emoji: '📷',
    description: 'กล้อง ใบหน้าที่คุ้นเคย กฎเฝ้าระวัง ประวัติแจ้งเตือน',
    tables: ['cameras', 'known_faces', 'vision_rules', 'vision_alerts', 'detection_events'],
  },
  {
    key: 'agent',
    name: 'ทีม Agent AI (บทบาท + งานเบื้องหลัง)',
    emoji: '🤖',
    description: 'บทบาท agent ที่สร้างเอง งานที่สั่งรัน + กำหนดการสรุปรายวัน',
    tables: ['agent_roles', 'agent_jobs'],
  },
  {
    key: 'farm',
    name: 'แปลงฟาร์ม + วิเคราะห์ดิน',
    emoji: '🌱',
    description: 'แปลงผักทั้งหมด + ประวัติค่าดิน (NPK/ความชื้น)',
    tables: ['farm_plots', 'farm_soil_readings'],
  },
  {
    key: 'property',
    name: 'แผนที่ที่ดิน 3 มิติ + จุดยุทธศาสตร์',
    emoji: '🗺️',
    description: 'โซนที่ดิน + จุดวางกับดัก/ตรวจจับ',
    tables: ['property_zones', 'strategic_points'],
  },
  {
    key: 'firewall',
    name: 'Firewall Engine + กฎ',
    emoji: '🛡️',
    description: 'กฎกรองแพ็กเก็ต + นโยบายเริ่มต้น',
    tables: ['firewall_rules', 'firewall_config'],
  },
  {
    key: 'automation',
    name: 'ระบบอัตโนมัติ + แจ้งเตือน',
    emoji: '⚙️',
    description: 'กฎ automation ทั้งหมด + ประวัติแจ้งเตือน',
    tables: ['automation_rules', 'automation_alerts'],
  },
  {
    key: 'wealth',
    name: 'สินทรัพย์ + พอร์ตลงทุน',
    emoji: '💰',
    description: 'สินทรัพย์ ประวัติมูลค่า ราคา และการคาดการณ์',
    tables: ['assets', 'wealth_history', 'asset_prices', 'scenario_forecasts'],
  },
  {
    key: 'health',
    name: 'สุขภาพครอบครัว',
    emoji: '🩺',
    description: 'โปรไฟล์สุขภาพ ธงเตือน อาการที่บันทึก',
    tables: ['health_profiles', 'health_flags', 'health_readings', 'health_observations', 'health_consents'],
  },
  {
    key: 'inventory',
    name: 'คลังเสบียง',
    emoji: '📦',
    description: 'รายการเสบียงทั้งหมดในคลัง',
    tables: ['inventory_items'],
  },
  {
    key: 'water',
    name: 'คุณภาพน้ำ',
    emoji: '💧',
    description: 'ประวัติการตรวจวัดคุณภาพน้ำทั้งหมด',
    tables: ['water_quality_readings'],
  },
  {
    key: 'risk',
    name: 'ข่าวภัย + ดัชนีคุกคาม',
    emoji: '🚨',
    description: 'ข่าวที่บันทึก ดัชนีคุกคาม เหตุการณ์ DEFCON',
    tables: ['risk_headlines', 'threat_index', 'defcon_events'],
  },
];

/** แปลงคีย์ที่ติ๊กเลือก → รายการโมดูล */
export function resolveModules(keys: string[]): ManifestModule[] {
  const list = Array.isArray(keys) ? keys : [];
  return MODULE_MANIFEST.filter((m) => list.includes(m.key));
}

// ── Dump ข้อมูลจาก DB (ใช้ $queryRawUnsafe — ทำงานกับ PrismaClient หรือ mock) ──
interface DumpDb {
  $queryRawUnsafe: (sql: string) => Promise<any[]>;
}

/** เปลี่ยน BigInt/Date ให้ serialize เป็น JSON ได้ (BigInt → Number ถ้าพอดี, Date → ISO) */
function serializeRow(v: any): any {
  if (v === null || v === undefined) return v;
  if (typeof v === 'bigint') {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : String(v);
  }
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(serializeRow);
  if (typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v)) out[k] = serializeRow(v[k]);
    return out;
  }
  return v;
}

export async function dumpModuleData(keys: string[], db: DumpDb): Promise<Array<{ key: string; name: string; emoji: string; tables: Array<{ table: string; rows: any[] }> }>> {
  const modules = resolveModules(keys);
  const out = [];
  for (const mod of modules) {
    const tables = [];
    for (const table of mod.tables) {
      try {
        const rows = await db.$queryRawUnsafe(`SELECT * FROM "${table}"`);
        tables.push({ table, rows: (rows ?? []).map(serializeRow) });
      } catch (err) {
        // ตารางอาจยังไม่มีในเครื่องนี้ (ยังไม่ migrate) — ข้ามไป
        console.error(`export: ข้ามตาราง ${table}:`, err instanceof Error ? err.message : err);
      }
    }
    out.push({ key: mod.key, name: mod.name, emoji: mod.emoji, tables });
  }
  return out;
}

// ── สร้างแพ็กเกจ ──
export interface ExportPackage {
  version: number;
  generatedAt: string;
  appInfo: { appName: string };
  modules: Array<{ key: string; name: string; emoji: string; tables: Array<{ table: string; rows: any[] }> }>;
}

export async function buildExportPackage(keys: string[], appInfo?: { appName?: string }): Promise<ExportPackage> {
  const modules = await dumpModuleData(keys, prisma);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    appInfo: { appName: String(appInfo?.appName ?? process.env.APP_NAME ?? 'SOVEREIGN OS') },
    modules,
  };
}

// ── ตรวจสอบแพ็กเกจก่อนนำเข้า ──
export function validatePackage(pkg: any): string | null {
  if (!pkg || typeof pkg !== 'object') return 'แพ็กเกจไม่ถูกต้อง — ข้อมูลว่างเปล่า';
  if (pkg.version !== 1) return `เวอร์ชันของแพ็กเกจไม่รองรับ (${pkg.version}) — ต้องเป็นเวอร์ชัน 1`;
  if (!Array.isArray(pkg.modules)) return 'แพ็กเกจไม่มี modules';
  return null;
}

// ── นำเข้าแพ็กเกจ (TRUNCATE + INSERT — คืนค่าเหมือนต้นฉบับ) ──
interface ApplyDb {
  $executeRawUnsafe: (sql: string) => Promise<any>;
  $queryRawUnsafe: (sql: string) => Promise<Array<{ column_name: string }>>;
}

function sqlValue(v: any): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  return `'${JSON.stringify(v).replace(/'/g, "''")}'`; // jsonb / array
}

// ชื่อตาราง/คอลัมน์ต้องเป็น identifier ธรรมดาเท่านั้น — กัน SQL injection จากแพ็กเกจที่ผู้ใช้ส่ง
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const validIdent = (s: any): boolean => typeof s === 'string' && IDENT.test(s);

/** คอลัมน์ที่เป้าหมายมีจริง — เครื่องอื่นอาจ schema เก่ากว่า (ยังไม่ migrate) */
async function targetColumns(d: ApplyDb, table: string): Promise<Set<string>> {
  try {
    const rows = await d.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}'`
    );
    return new Set((rows ?? []).map((r) => String(r?.column_name ?? '').toLowerCase()));
  } catch {
    return new Set(); // ตารางยังไม่มี — ข้ามไป
  }
}

export async function applyPackage(pkg: any, db?: ApplyDb): Promise<{ ok: boolean; error?: string; restoredTables: number }> {
  try {
    const err = validatePackage(pkg);
    if (err) return { ok: false, error: err, restoredTables: 0 };
    const d = db ?? prisma;
    let restoredTables = 0;
    for (const mod of pkg.modules) {
      for (const t of mod?.tables ?? []) {
        if (!t?.table || !Array.isArray(t?.rows)) continue;
        if (!validIdent(t.table)) return { ok: false, error: `ชื่อตารางไม่ถูกต้องในแพ็กเกจ: ${String(t.table).slice(0, 60)}`, restoredTables: 0 };
        for (const row of t.rows) {
          for (const c of Object.keys(row ?? {})) {
            if (!validIdent(c)) return { ok: false, error: `ชื่อคอลัมน์ไม่ถูกต้องในแพ็กเกจ: ${String(c).slice(0, 60)}`, restoredTables: 0 };
          }
        }
        // เป้าหมาย schema เก่ากว่า — เติมเฉพาะคอลัมน์ที่มีจริง เพื่อไม่ให้ TRUNCATE แล้ว INSERT พัง (ข้อมูลเดิมหายไปเปล่า ๆ)
        const existing = await targetColumns(d, t.table);
        if (existing.size === 0) continue; // ตารางยังไม่มีในเครื่องนี้ — ข้าม
        const rows = t.rows
          .map((row: any) => {
            const out: Record<string, any> = {};
            for (const c of Object.keys(row)) if (existing.has(c.toLowerCase())) out[c] = row[c];
            return out;
          })
          .filter((row: Record<string, any>) => Object.keys(row).length > 0);
        await d.$executeRawUnsafe(`TRUNCATE TABLE "${t.table}" RESTART IDENTITY CASCADE`);
        for (const row of rows) {
          const cols = Object.keys(row);
          const colList = cols.map((c) => `"${c}"`).join(', ');
          const vals = cols.map((c) => sqlValue(row[c])).join(', ');
          await d.$executeRawUnsafe(`INSERT INTO "${t.table}" (${colList}) VALUES (${vals})`);
        }
        restoredTables += 1;
      }
    }
    return { ok: true, restoredTables };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 500), restoredTables: 0 };
  }
}
