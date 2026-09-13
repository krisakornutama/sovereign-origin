// ─────────────────────────────────────────────────────────────
//  bahtText — จำนวนเงินตัวหนังสือ (ข้อบังคับบนใบกำกับภาษี)
//  กฎหมายกำหนดให้ต้องมี "จำนวนเงินตัวหนังสือ" บนใบกำกับภาษี
//  อ่านตามจารีตไทย: เอ็ด (1 ท้าย), ยี่สิบ (2 ในหลักสิบ),
//  ทศนิยมอ่านเป็น "จุด..." แล้วปิดท้าย "บาท" — "บาทถ้วน" เมื่อไม่มีสตางค์
// ─────────────────────────────────────────────────────────────

const DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const UNITS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** อ่านเลขจำนวนเต็มเป็นคำไทย (กลุ่มละ 6 หลัก เลื่อน "ล้าน" ต่อกลุ่ม) */
export function numberToThaiWords(input: number): string {
  if (!Number.isFinite(input)) return '';
  let n = Math.floor(Math.abs(input));
  if (n === 0) return 'ศูนย์';

  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1_000_000);
    n = Math.floor(n / 1_000_000);
  }

  const parts: string[] = [];
  let hasEmitted = false; // เคยอ่านหลักที่สูงกว่าแล้วหรือยัง (ใช้กับกฎ "เอ็ด")
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g === 0) continue;
    let words = '';
    for (let pos = UNITS.length - 1; pos >= 0; pos--) {
      const digit = Math.floor(g / 10 ** pos) % 10;
      if (digit === 0) continue;
      if (pos === 1 && digit === 1) words += 'สิบ';
      else if (pos === 1 && digit === 2) words += 'ยี่สิบ';
      // เอ็ด: เลข 1 ตัวท้ายที่มีหลักสูงกว่าอ่านไปแล้ว (11 → สิบเอ็ด, 1,000,001 → หนึ่งล้านเอ็ด)
      else if (pos === 0 && digit === 1 && hasEmitted) words += 'เอ็ด';
      else words += DIGITS[digit] + UNITS[pos];
      hasEmitted = true;
    }
    parts.push(words + 'ล้าน'.repeat(i));
  }
  return parts.join('');
}

/** จำนวนเงิน → ตัวหนังสือ ("สามพันสองร้อยบาทถ้วน", "ห้าสิบบาทจุดห้าสิบสตางค์") */
export function bahtText(amount: number): string {
  if (!Number.isFinite(amount)) return '';
  const satang = Math.round((Math.abs(amount) % 1) * 100);
  const baht = Math.floor(Math.abs(amount));
  if (baht === 0 && satang === 0) return 'ศูนย์บาทถ้วน';

  let text = baht > 0 ? `${numberToThaiWords(baht)}บาท` : '';
  if (satang > 0) {
    text += `จุด${numberToThaiWords(satang)}สตางค์`;
  } else {
    text += 'ถ้วน';
  }
  return text || 'ศูนย์บาทถ้วน';
}
