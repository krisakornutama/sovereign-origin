// src/services/ops-summary.service.ts — สรุปสุขภาพ ops สำหรับ /api/health/truth (P0 ใช้งานง่าย 27/9)
//
// ทำไมต้องแยกไฟล์: หน้า /system-health ต้องการเห็น "ทุกสาย" แต่บางสายอยู่ฝั่ง Windows
// (Task Scheduler) ที่ container มองไม่เห็น — จึงรวม 2 แหล่งที่นี่:
//   1) อายุ backup คำนวณสดจากไฟล์ที่ mount เข้ามา (backups/, backups/offsite-log.jsonl)
//      → ตัวเลขตรงจากไฟล์จริงเสมอ ไม่ต้องรอใครมาเขียน
//   2) ผล task/nightly อ่านจาก data/ops-status.json ที่ tools/ops-status.mjs --snapshot
//      เขียนจากฝั่ง host (เครื่องมือบ้านเดียวกับที่แจ้ง Telegram)
// หลักการ soft-fail: ส่วนไหนอ่านไม่ได้ = null พร้อม note — ไม่เด้ง route ทั้งเส้น
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BACKUP_DIR = join(process.cwd(), 'backups');
const OFFSITE_LOG = join(BACKUP_DIR, 'offsite-log.jsonl');
const SNAPSHOT = join(process.cwd(), 'data', 'ops-status.json');

const ageHours = (ms: number) => Math.round(((Date.now() - ms) / 3_600_000) * 10) / 10;

interface OpsSummary {
  checkedAt: string;
  backup: {
    dbLastAgeH: number | null;
    dbLastFile: string | null;
    offsiteLastAgeH: number | null;
    offsiteLastStatus: string | null;
    offsiteNote: string | null;
  };
  host: {
    snapshotAt: string | null;
    watch: string[];
    tasks: Array<{ name: string; label?: string; lastRun?: string; result: { ok: boolean; text: string } }> | null;
    nightly: { ok: boolean | null; finishedAt?: string; gateOk: boolean | null; codeMatch: boolean | null; failed: string[] } | null;
    note: string | null;
  };
}

export async function buildOpsSummary(): Promise<OpsSummary> {
  const out: OpsSummary = {
    checkedAt: new Date().toISOString(),
    backup: { dbLastAgeH: null, dbLastFile: null, offsiteLastAgeH: null, offsiteLastStatus: null, offsiteNote: null },
    host: { snapshotAt: null, watch: [], tasks: null, nightly: null, note: null },
  };

  // ── 1) อายุ DB backup (ไฟล์จริงใน mount) ──
  try {
    const files = readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('sovereign_backup_') && f.endsWith('.sql.gz'))
      .sort();
    const last = files.at(-1);
    if (last) {
      out.backup.dbLastAgeH = ageHours(statSync(join(BACKUP_DIR, last)).mtimeMs);
      out.backup.dbLastFile = last;
    }
  } catch {
    out.backup.offsiteNote = 'อ่านโฟลเดอร์ backups/ ไม่ได้';
  }

  // ── 2) สาย offsite (บรรทัดล่าสุดของ log — จดทั้ง sent และ failed) ──
  try {
    if (existsSync(OFFSITE_LOG)) {
      const lines = readFileSync(OFFSITE_LOG, 'utf8').split('\n').filter((l) => l.trim());
      const parsed = lines
        .map((l) => { try { return JSON.parse(l) as { ts?: string; status?: string; tg_message_id?: number; reason?: string }; } catch { return null; } })
        .filter(Boolean)
        .sort((a, b) => new Date(a!.ts ?? 0).getTime() - new Date(b!.ts ?? 0).getTime());
      const last = parsed.at(-1);
      if (last?.ts) {
        out.backup.offsiteLastAgeH = ageHours(new Date(last.ts).getTime());
        out.backup.offsiteLastStatus = last.status ?? (last.tg_message_id ? 'sent' : 'unknown');
        if (last.status === 'failed') out.backup.offsiteNote = String(last.reason ?? 'ส่งไม่สำเร็จ').slice(0, 160);
      }
    } else {
      out.backup.offsiteNote = 'ไม่มี offsite-log.jsonl — ไม่เคย push';
    }
  } catch (e) {
    out.backup.offsiteNote = `อ่าน offsite-log ไม่ได้ (${String(e).slice(0, 80)})`;
  }

  // ── 3) snapshot ฝั่ง host (task scheduler + nightly — เขียนโดย tools/ops-status.mjs --snapshot) ──
  try {
    if (existsSync(SNAPSHOT)) {
      const s = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as {
        checkedAt?: string;
        watch?: string[];
        tasks?: Array<{ name: string; label?: string; lastRun?: string; result: { ok: boolean; text: string } }>;
        nightly?: OpsSummary['host']['nightly'];
      };
      out.host.snapshotAt = s.checkedAt ?? null;
      out.host.watch = Array.isArray(s.watch) ? s.watch : [];
      out.host.tasks = Array.isArray(s.tasks) ? s.tasks : null;
      out.host.nightly = s.nightly ?? null;
      const ageMin = s.checkedAt ? Math.round((Date.now() - new Date(s.checkedAt).getTime()) / 60_000) : null;
      if (ageMin != null && ageMin > 26 * 60) out.host.note = `snapshot เก่า ${Math.round(ageMin / 60)} ชม. — ฝั่ง host อาจไม่ได้รัน snapshot`;
    } else {
      out.host.note = 'ยังไม่มี data/ops-status.json — รัน node tools/ops-status.mjs --snapshot (หรือผูกเข้า task) ครั้งแรก';
    }
  } catch (e) {
    out.host.note = `อ่าน snapshot ไม่ได้ (${String(e).slice(0, 80)})`;
  }

  return out;
}
