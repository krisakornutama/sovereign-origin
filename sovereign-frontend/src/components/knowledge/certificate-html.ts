// ─────────────────────────────────────────────────────────────────────────────
// เกียรติบัตร (หน้าต่างพิมพ์) — ตัวสร้าง HTML แบบ "ฟังก์ชันล้วน" ไม่มี import
//
// ทำไมต้องแยกออกมา: `printCertificate` เดิมประกอบ HTML ด้วย template literal
// ที่ฝังค่าจาก DB ลงไปตรง ๆ (`${name}`, `${cert.detail}`) แล้ว `document.write`
// ลงหน้าต่างที่ `window.open('', '_blank')` เปิด ⇒ หน้าต่างนั้น "สืบทอด origin"
// ของแอป ⇒ ค่าที่มี `<img onerror=...>` จะรันสคริปต์ใน origin เดียวกับที่เก็บ JWT
// ใน localStorage (`sovereign-auth`) = ขโมย session ได้
//
// แยกออกมาเป็นไฟล์ที่ไม่มี import เพื่อให้ `node --test` import ตรงได้ (type
// stripping ของ Node 24) ⇒ ทดสอบพฤติกรรมจริงได้ ไม่ใช่แค่อ่านซอร์ส
// ─────────────────────────────────────────────────────────────────────────────

type TFn = (key: string, fallback?: string, params?: Record<string, unknown>) => string;

/**
 * Escape ข้อความก่อนฝังลง HTML
 * ใช้กับ **ทุกค่า** ที่ผู้ใช้/DB เป็นเจ้าของ (ชื่อเด็ก อีโมจิ detail) เพราะผลลัพธ์
 * ถูก `document.write` ลงหน้าต่างที่สืบทอด origin ของแอป ⇒ `<img onerror=...>`
 * จะรันสคริปต์ใน origin เดียวกับ JWT ใน localStorage
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface CertificateHtmlInput {
  /** ฟังก์ชันแปลภาษา — ส่งเข้ามาเพื่อให้ไฟล์นี้ไม่ต้อง import store */
  t: TFn;
  /** ชื่อเด็ก (ผู้ใช้ตั้งเอง — ต้องถูก escape) */
  name: string;
  /** อีโมจิหน้าชื่อ (ผู้ใช้ตั้งเอง) */
  emoji?: string | null;
  /** ระดับเกียรติบัตร (ตัวเลขจาก DB) */
  level: number;
  /** รายละเอียดเกียรติบัตร (ข้อความจาก DB) */
  detail?: string | null;
  /** วันที่ออก — ผู้เรียกจัดรูปแบบมาแล้ว */
  dateLabel: string;
}

export function buildCertificateHtml(input: CertificateHtmlInput): string {
  const { t, level, dateLabel } = input;
  // ค่าที่ผู้ใช้/DB เป็นเจ้าของ → escape ทุกตัวก่อนฝัง (ดูเหตุผลใน escapeHtml)
  const name = escapeHtml(`${input.emoji || ''} ${input.name}`.trim());
  const detail = escapeHtml(input.detail || '');
  const levelText = escapeHtml(level);
  const dateText = escapeHtml(dateLabel);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${t('knowledge.cert.title', 'เกียรติบัตร')} ${levelText}</title><style>
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
      <div class="line">${t('knowledge.cert.body', 'ได้รับเกียตินี้เพื่อยืนยันว่า สะสมคะแนนถึงระดับ {level}', { level })}</div>
      <div class="line" style="font-weight:bold; color:#b8860b; font-size:20px;">${t('knowledge.cert.levelLine', '⭐ ระดับ {level} ⭐', { level })}</div>
      <div class="detail">${detail}</div>
      <div class="date">${t('knowledge.cert.date', 'ออกให้ ณ วันที่ {date} · ครอบครัว Sovereign OS', { date: dateText })}</div>
    </div></body></html>`;
}
