// ─────────────────────────────────────────────────────────────
// gen-changelog-data.mjs — แปลง CHANGELOG.md → ข้อมูลสำหรับหน้า /changelog ในแอป
//
// ทำไมต้องมี: หน้า "ประวัติการพัฒนา" ต้องเห็นได้ในแอปเดสก์ท็อป/เว็บโดยไม่ต้องอ่าน
// ไฟล์ markdown เอง — แต่ CHANGELOG.md อยู่นอก build context ของ frontend
// (Docker build ใช้ context sovereign-frontend) จึง generate เป็น JSON ที่ commit ไว้
// แล้วให้เทสต์ `--check` กันข้อมูลในแอปตกหล่นเมื่อ CHANGELOG ถูกแก้
//
// ใช้: node tools/gen-changelog-data.mjs            (เขียนทับ JSON)
//      node tools/gen-changelog-data.mjs --check    (อ่านอย่างเดียว · ไม่ตรง = exit 1)
// ─────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const OUT = path.join(ROOT, 'sovereign-frontend', 'src', 'data', 'changelog.json');
const PKG = path.join(ROOT, 'sovereign-frontend', 'package.json');

// วันที่ปล่อยของ tag ที่หัวข้อ CHANGELOG ไม่ได้ระบุ (เอามาจาก GitHub Releases)
// v1.2.0 มีวันที่อยู่ในหัวข้อแล้ว — ตารางนี้ใช้เฉพาะ tag เก่า
const RELEASE_DATES = {
  'v1.0': '2026-09-17',
  'v1.1.0': '2026-09-18',
  'v1.1.1': '2026-09-18',
};

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function thaiDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  const day = Number(m[3]);
  const month = TH_MONTHS[Number(m[2]) - 1];
  return month ? `${day} ${month} ${m[1]}` : '';
}

/** ล้าง markdown inline ให้เหลือข้อความอ่านง่าย (bold/italic/code/link) */
export function cleanInline(text) {
  return String(text ?? '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ตัวเก็บ block ของ section — flush เมื่อชนิดเปลี่ยน/เจอบรรทัดว่าง
 * ชนิดที่รองรับ: paragraph · list · table · note · subheading
 */
function createCollector() {
  const blocks = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    if (current.type === 'list') {
      const items = current.items.map(cleanInline).filter(Boolean);
      if (items.length) blocks.push({ type: 'list', items });
    } else if (current.type === 'table') {
      const rows = current.rows;
      if (rows.length) {
        const headers = rows[0].map(cleanInline);
        const body = rows
          .slice(1)
          .filter((r) => !r.every((c) => /^:?-{3,}:?$/.test(String(c).trim())))
          .map((r) => r.map(cleanInline));
        if (headers.some(Boolean)) blocks.push({ type: 'table', headers, rows: body });
      }
    } else if (current.type === 'note') {
      const text = cleanInline(current.lines.join(' '));
      if (text) blocks.push({ type: 'note', text });
    } else if (current.type === 'paragraph') {
      const text = cleanInline(current.lines.join(' '));
      if (text) blocks.push({ type: 'paragraph', text });
    }
    current = null;
  };

  return {
    blocks,
    flush,
    add(line) {
      const trimmed = line.trim();
      if (!trimmed) return flush();
      if (/^-{3,}$/.test(trimmed)) return flush(); // เส้นคั่นเวอร์ชัน

      if (/^\|/.test(trimmed)) {
        if (!current || current.type !== 'table') {
          flush();
          current = { type: 'table', rows: [] };
        }
        const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        current.rows.push(cells);
        return;
      }

      if (/^>\s?/.test(trimmed)) {
        if (!current || current.type !== 'note') {
          flush();
          current = { type: 'note', lines: [] };
        }
        current.lines.push(trimmed.replace(/^>\s?/, ''));
        return;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        if (!current || current.type !== 'list') {
          flush();
          current = { type: 'list', items: [] };
        }
        current.items.push(trimmed.replace(/^[-*]\s+/, ''));
        return;
      }

      const boldOnly = trimmed.match(/^\*\*(.+)\*\*$/);
      if (boldOnly) {
        flush();
        blocks.push({ type: 'subheading', text: cleanInline(boldOnly[1]) });
        return;
      }

      if (!current || current.type !== 'paragraph') {
        flush();
        current = { type: 'paragraph', lines: [] };
      }
      current.lines.push(trimmed);
    },
  };
}

/**
 * อ่าน CHANGELOG.md → versions + notes
 * @returns {{ versions: any[], notes: any[] }}
 */
export function parseChangelog(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/);
  const versions = [];
  const notes = [];
  let currentVersion = null;
  let summary = null;
  let section = null;
  let collector = null;
  let globalNotes = null;

  /** ปิด collector ของ section ปัจจุบัน แล้วเก็บ block ไว้ใน section นั้น */
  const closeSection = () => {
    if (collector) {
      collector.flush();
      if (section) section.blocks = collector.blocks;
    }
    collector = null;
    section = null;
  };

  /** ปิดทุกอย่างของเวอร์ชันปัจจุบัน แล้วเก็บ summary ที่ flush แล้ว */
  const closeVersion = () => {
    closeSection();
    if (summary) summary.flush();
    if (currentVersion && summary) currentVersion.summary = summary.blocks;
    if (currentVersion) versions.push(currentVersion);
    summary = null;
    currentVersion = null;
  };

  for (const line of lines) {
    const versionHeading = line.match(/^##\s+\[([^\]]+)\](?:\s*—\s*(.+))?$/);
    if (versionHeading) {
      closeVersion();
      if (globalNotes) globalNotes.flush();

      const version = versionHeading[1].trim();
      const rest = (versionHeading[2] || '').trim();
      const dateInHeading = /(\d{4}-\d{2}-\d{2})/.exec(rest)?.[1] || '';
      const ref = /^[a-f0-9]{7,40}$/i.test(rest) ? rest : '';
      const dateISO = dateInHeading || RELEASE_DATES[version] || '';
      currentVersion = {
        version,
        dateISO,
        dateLabel: thaiDate(dateISO),
        released: /released/i.test(rest) || (!/unreleased/i.test(version) && /^v\d/.test(version)),
        ref,
        summary: [],
        sections: [],
      };
      summary = createCollector();
      globalNotes = null;
      continue;
    }

    const sectionHeading = line.match(/^###\s+(.+)$/);
    if (sectionHeading) {
      const title = cleanInline(sectionHeading[1]);
      if (currentVersion) summary.flush();
      if (title === 'หมายเหตุ') {
        // บล็อกหมายเหตุท้ายไฟล์ (หลังเวอร์ชันสุดท้าย) — ไม่ใช่ของเวอร์ชันใดเวอร์ชันหนึ่ง
        closeSection();
        globalNotes = createCollector();
        collector = globalNotes;
      } else if (currentVersion) {
        closeSection();
        section = { title, blocks: [] };
        currentVersion.sections.push(section);
        collector = createCollector();
      }
      continue;
    }

    if (!currentVersion) continue;
    if (globalNotes) {
      globalNotes.add(line);
    } else if (section) {
      collector.add(line);
    } else {
      summary.add(line);
    }
  }

  closeVersion();
  if (globalNotes) {
    globalNotes.flush();
    notes.push(...globalNotes.blocks);
  }
  return { versions, notes };
}

/** ประกอบข้อมูลสุดท้ายที่หน้าเว็บใช้ */
export function buildChangelogData(markdown, currentVersion) {
  const parsed = parseChangelog(markdown);
  return {
    generatedFrom: 'CHANGELOG.md',
    generatedBy: 'tools/gen-changelog-data.mjs',
    currentVersion: String(currentVersion || ''),
    versions: parsed.versions,
    notes: parsed.notes,
  };
}

export function serializeChangelogData(data) {
  return JSON.stringify(data, null, 2) + '\n';
}

function main() {
  const md = readFileSync(CHANGELOG, 'utf8');
  const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
  const data = buildChangelogData(md, pkg.version);
  const text = serializeChangelogData(data);
  const check = process.argv.includes('--check');

  if (check) {
    const old = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (old !== text) {
      console.error('[changelog] ข้อมูลในแอปไม่ตรงกับ CHANGELOG.md — รัน: node tools/gen-changelog-data.mjs');
      process.exit(1);
    }
    console.log('[changelog] ข้อมูลในแอปตรงกับ CHANGELOG.md');
    return;
  }

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, text, 'utf8');
  console.log('[changelog] เขียน', path.relative(ROOT, OUT), `(${data.versions.length} เวอร์ชัน)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
