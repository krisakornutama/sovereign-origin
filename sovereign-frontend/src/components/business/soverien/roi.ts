// components/business/soverien/roi.ts
// เครื่องคำนวณ ROI ของ "คู่มือขาย" — แยกจาก store.ts ซึ่งชิดเพดาน 400 บรรทัด
//
// ⚠ เหตุผลที่ต้องอยู่ใน .ts ธรรมดา (ไม่ใช่ใน SalesGuide.tsx):
//   เทสต์ Node (tools/test/soverien-tools.test.mjs) import ไฟล์ logic ตรง ๆ แล้วเรียกฟังก์ชันจริง
//   ถ้าฝังไว้ใน .tsx จะอ่านได้ด้วยการ grep อย่างเดียว ซึ่งพิสูจน์ไม่ได้ว่าคำนวณถูก

/**
 * จำนวนวันที่ "คุ้มทุน" ของแพ็กเกจราคา `price`
 * เมื่อลูกค้าเสียของมูลค่า `lossPerYear` ต่อปี · null = ยังไม่มีข้อมูลพอให้คำนวณ
 *
 * ⚠ 17/10/69 — เดิมหน้าจอเอาค่าหน่วย "เดือน" ไปใส่ในช่องที่เขียนว่า "วัน"
 *   price / (loss/12) ได้ออกมาเป็น "เดือน" อยู่แล้ว แต่ถูก Math.ceil แล้วขึ้นคำว่า "วัน"
 *   → คุ้มทุน ~30 วัน ถูกบอกลูกค้าว่า "ประมาณ 1 วัน" ขาด ~30 เท่า
 *   เครื่องคิดตัวนี้ลูกค้าเห็นก่อนตัดสินใจซื้อ จึงผิดตรงนี้ไม่ได้
 */
export function breakEvenDays(price: number, lossPerYear: number): number | null {
  if (price <= 0 || lossPerYear <= 0) return null;
  return Math.ceil((price / (lossPerYear / 12)) * 30.44);
}
