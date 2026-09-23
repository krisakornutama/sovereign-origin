// src/components/knowledge/kid-print.ts
// ตัวช่วยพิมพ์ PDF ของโมดูล knowledge (แยกจาก KidHomePanel — phase 4 ลดหนี้ไฟล์ยักษ์)
// printCertificate + printWeeklyReport เป็นฟังก์ชันล้วน (เปิดหน้าต่างพิมพ์) ไม่ผูกกับ JSX

import { fmtLocale } from '../../lib/formatDate';
import { authFetch } from '../../lib/apiFetch';
import { buildWeeklyReportHtml } from './weekly-report';
import type { WeeklyReportKid } from './knowledge-types';

type TFn = (key: string, fallback?: string, params?: Record<string, unknown>) => string;

/** พิมพ์เกียรติบัตร PDF (หน้าต่างพิมพ์ → บันทึกเป็น PDF) */
export function printCertificate(
  t: TFn,
  setTeachError: (msg: string) => void,
  cert: { level: number; title: string; detail: string | null; created_at: string },
  kid: { name: string; age: number | null; emoji: string | null }
): void {
  const name = `${kid.emoji || ''} ${kid.name}`.trim();
  const date = new Date(cert.created_at).toLocaleDateString(fmtLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
  const win = window.open('', '_blank', 'width=800,height=600');
  if (!win) {
    setTeachError(t('knowledge.errors.popupBlocked', 'เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต popup แล้วลองใหม่'));
    return;
  }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${t('knowledge.cert.title', 'เกียรติบัตร')} ${cert.level}</title><style>
      body { font-family: 'Sarabun', 'Tahoma', sans-serif; background: #fff8e7; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
      .cert { width: 720px; padding: 40px; border: 4px double #c9a227; border-radius: 12px; text-align: center; background: #fffdf5; }
      .star { font-size: 42px; }
      h1 { color: #b8860b; font-size: 34px; margin: 8px 0 4px; }
      .name { font-size: 40px; color: #1f2937; font-weight: bold; margin: 12px 0; }
      .line { font-size: 15px; color: #4b5563; line-height: 1.8; }
      .detail { font-size: 13px; color: #6b7280; margin-top: 10px; }
      .date { margin-top: 24px; font-size: 12px; color: #9ca3af; }
      @media print { body { background: #fff; } }
    </style></head><body><div class="cert">
      <div class="star">🎓</div>
      <h1>${t('knowledge.cert.title', 'เกียรติบัตร')}</h1>
      <div class="name">${name}</div>
      <div class="line">${t('knowledge.cert.body', 'ได้รับเกียตินี้เพื่อยืนยันว่า สะสมคะแนนถึงระดับ {level}', { level: cert.level })}</div>
      <div class="line" style="font-weight:bold; color:#b8860b; font-size:20px;">${t('knowledge.cert.levelLine', '⭐ ระดับ {level} ⭐', { level: cert.level })}</div>
      <div class="detail">${cert.detail || ''}</div>
      <div class="date">${t('knowledge.cert.date', 'ออกให้ ณ วันที่ {date} · ครอบครัว Sovereign OS', { date })}</div>
    </div></body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

/** รายงานรายสัปดาห์ (PDF) — ดึงข้อมูล 7 วัน + เปิดหน้าต่างพิมพ์ */
export async function printWeeklyReport(
  t: TFn,
  opts: { setReportLoading: (b: boolean) => void; setTeachError: (msg: string) => void }
): Promise<void> {
  const { setReportLoading, setTeachError } = opts;
  setReportLoading(true);
  setTeachError('');
  try {
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/report/weekly`);
    if (!res.ok) throw new Error(t('knowledge.errors.reportFailed', 'สร้างรายงานไม่สำเร็จ'));
    const data = await res.json();
    const kids = (data.kids || []) as WeeklyReportKid[];
    if (kids.length === 0) {
      setTeachError(t('knowledge.errors.reportNoKids', 'ยังไม่มีโปรไฟล์เด็ก — เพิ่มโปรไฟล์ก่อนสร้างรายงาน'));
      return;
    }
    const html = buildWeeklyReportHtml(kids, data.generatedAt, t);
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      setTeachError(t('knowledge.errors.popupBlocked', 'เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต popup แล้วลองใหม่'));
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  } catch (e) {
    setTeachError(e instanceof Error ? e.message : t('knowledge.errors.reportFailed', 'สร้างรายงานไม่สำเร็จ'));
  } finally {
    setReportLoading(false);
  }
}
