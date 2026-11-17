// src/components/knowledge/kid-print.ts
// ตัวช่วยพิมพ์ PDF ของโมดูล knowledge (แยกจาก KidHomePanel — phase 4 ลดหนี้ไฟล์ยักษ์)
// printCertificate + printWeeklyReport เป็นฟังก์ชันล้วน (เปิดหน้าต่างพิมพ์) ไม่ผูกกับ JSX

import { fmtLocale } from '../../lib/formatDate';
import { authFetch } from '../../lib/apiFetch';
import { buildWeeklyReportHtml } from './weekly-report';
import { buildCertificateHtml } from './certificate-html';
import type { WeeklyReportKid } from './knowledge-types';

type TFn = (key: string, fallback?: string, params?: Record<string, unknown>) => string;

/** พิมพ์เกียรติบัตร PDF (หน้าต่างพิมพ์ → บันทึกเป็น PDF) */
export function printCertificate(
  t: TFn,
  setTeachError: (msg: string) => void,
  cert: { level: number; title: string; detail: string | null; created_at: string },
  kid: { name: string; age: number | null; emoji: string | null }
): void {
  const date = new Date(cert.created_at).toLocaleDateString(fmtLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
  const win = window.open('', '_blank', 'width=800,height=600');
  if (!win) {
    setTeachError(t('knowledge.errors.popupBlocked', 'เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต popup แล้วลองใหม่'));
    return;
  }
  win.document.write(
    buildCertificateHtml({
      t,
      name: kid.name,
      emoji: kid.emoji,
      level: cert.level,
      detail: cert.detail,
      dateLabel: date,
    })
  );
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
