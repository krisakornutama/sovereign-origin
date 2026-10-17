// components/business/soverien/csv.ts
// สร้าง/อ่าน CSV — ป้องกัน Excel ตีความผิดด้วย BOM + escape เครื่องหมายพิเศษ
// ⚠ `import type` เท่านั้น — เทสต์ Node เรียกไฟล์นี้ตรง ๆ (tools/test/soverien-tools.test.mjs)
//   ถ้าเขียนเป็น value import ธรรมดา Node จะพยายาม resolve './types' แล้วล้มทันที
import type { Order, Db } from './types';
import { thaiDate } from './store';
import { orderRowTotals } from './csv-row-total';

function cell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  // ขึ้นต้นด้วย = + - @ แล้ว Excel จะพยายามรันเป็นสูตร → escape ด้วย ' นำหน้า
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function ordersToCsv(db: Db): string {
  const rows: string[][] = [
    ['เลขออเดอร์', 'S/N', 'รุ่น', 'ชื่อลูกค้า', 'เบอร์โทร', 'LINE', 'ที่อยู่', 'วันที่ออกใบ',
      'เริ่มประกัน', 'สิ้นสุดประกัน', 'จำนวน', 'ราคาต่อหน่วย', 'ยอดรวม', 'สถานะ', 'หมายเหตุ'],
  ];
  for (const o of [...db.orders].sort((a, b) => a.issueDate.localeCompare(b.issueDate))) {
    // ⚠ "ยอดรวม" ต้องรวมคอลัมน์แล้วได้ยอดออเดอร์จริง (17/10/69)
    //   เดิมใส่ orderTotal(o) ทุกแถว → ออเดอร์ 3 ชิ้น ถูก Excel บวกรวมเป็น 3 เท่า
    //   ตรรกะนี้อยู่ที่ csv-row-total.ts (มีเทสต์คุม · แยกเพราะ csv.ts import store ซึ่ง Node เรียกตรง ๆ ไม่ได้)
    const totals = orderRowTotals(o);
    o.serials.forEach((sn, i) => {
      const model = db.models.find((m) => sn.startsWith(m.prefix + '-'));
      rows.push([
        o.no, sn, model?.name ?? '', o.customerName, o.phone, o.line ?? '', o.address ?? '',
        thaiDate(o.issueDate), thaiDate(o.warrantyStart), thaiDate(o.warrantyEnd),
        '1', String(o.unitPrice), String(totals[i]),
        o.status === 'VOID' ? 'ยกเลิก' : 'ใช้งาน', o.note ?? '',
      ]);
    });
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export function serialsToCsv(db: Db): string {
  const rows: string[][] = [['S/N', 'รุ่น', 'วันที่ออก serial', 'สถานะ', 'เลขออเดอร์']];
  for (const s of db.serials) {
    const model = db.models.find((m) => m.id === s.modelId);
    const label = s.status === 'STOCK' ? 'ในคลัง' : s.status === 'VOID' ? 'ยกเลิก' : 'ขายแล้ว';
    rows.push([s.sn, model?.name ?? '', thaiDate(s.issuedAt), label, s.orderId ?? '']);
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

/** พิมพ์รายการผ่านหน้าต่างพิมพ์ของเบราว์เซอร์ (ไม่ต้องเพิ่ม lib) */
export function printHtml(title: string, innerHtml: string): void {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font-family:'Sarabun','Noto Sans Thai',sans-serif;padding:24px;color:#111}
  h1{font-size:18px;margin:0 0 4px}
  table{border-collapse:collapse;width:100%;font-size:11px;margin-top:12px}
  th,td{border:1px solid #999;padding:4px 6px;text-align:left}
  th{background:#eee}
  @media print{ .no-print{display:none} }
</style></head><body>${innerHtml}<script>window.onload=()=>{window.print()}</script></body></html>`);
  w.document.close();
}

export function ordersPrintTable(orders: Order[], nameOf: (o: Order) => string): string {
  const head = '<h1>รายการออเดอร์ — Soverien</h1><div style="font-size:11px;color:#555">พิมพ์เมื่อ ' +
    new Date().toLocaleString('th-TH') + '</div>';
  const body = orders.map((o) => `<tr>
    <td>${cell(o.no)}</td><td>${cell(o.serials.join(', '))}</td><td>${cell(nameOf(o))}</td>
    <td>${cell(o.customerName)}</td><td>${cell(o.phone)}</td>
    <td>${cell(thaiDate(o.issueDate))}</td><td>${cell(thaiDate(o.warrantyEnd))}</td>
    <td>${cell(o.status === 'VOID' ? 'ยกเลิก' : 'ใช้งาน')}</td></tr>`).join('');
  return `${head}<table><thead><tr><th>เลขออเดอร์</th><th>S/N</th><th>รุ่น</th><th>ลูกค้า</th><th>โทร</th><th>วันที่</th><th>ประกันถึง</th><th>สถานะ</th></tr></thead><tbody>${body}</tbody></table>`;
}