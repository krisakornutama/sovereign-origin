// components/business/soverien/csv-row-total.ts
// ค่าของคอลัมน์ "ยอดรวม" ในไฟล์ CSV ออเดอร์ (1 แถวต่อ 1 S/N)
//
// ⚠ แยกออกจาก csv.ts เพราะ csv.ts import `thaiDate`/`orderTotal` จาก store ซึ่งเป็น value import
//   → เทสต์ Node เรียก csv.ts ตรง ๆ ไม่ได้ (ERR_MODULE_NOT_FOUND ที่ './store' ไม่มีนามสกุล)
//   ไฟล์นี้จึง import แค่ type เท่านั้น ตามธรรมเนียมเดียวกับ store.ts/telegram-notify.ts
//
// ── บั๊กเดิมที่ไฟล์นี้ป้องกัน (17/10/69) ──
// เดิมทุกแถวของออเดอร์ใส่ `orderTotal(o)` เหมือนกันหมด
//   ออเดอร์ 3 ชิ้น ราคา 990 → CSV มี 3 แถว ๆ ละ 2,970
//   เจ้าของเปิด Excel แล้วรวมคอลัมน์ "ยอดรวม" ได้ 8,910 บาท ทั้งที่ขายจริง 2,970
//   = รายได้ถูกนับซ้ำเท่าจำนวนชิ้น และ nobody จับได้เพราะตัวเลขดู "มากกว่าปกติ" เฉย ๆ
import type { Order } from './types';

/**
 * คืนยอดรวมของ "แต่ละแถว" ให้รวมกันแล้วเท่ากับยอดที่คิดเงินจริงของออเดอร์พอดี
 *
 * แถวแรกแบกรับส่วนต่างที่เหลือไว้ (กรณีมีส่วนลด ยอดรวม ≠ จำนวน × ราคาต่อหน่วย)
 * ส่วนแถวที่เหลือเป็นราคาต่อหน่วย 1 ชิ้น ซึ่งเป็นค่าที่คนเปิด CSV คาดหวังอยู่แล้ว
 */
export function orderRowTotals(o: Order): number[] {
  const n = o.serials.length;
  const per = o.unitPrice;
  const orderSum = o.total || n * per;
  return o.serials.map((_, i) => (i === 0 ? orderSum - per * (n - 1) : per));
}
