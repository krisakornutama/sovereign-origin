// ─────────────────────────────────────────────────────────────
//  TaxInvoice — ใบกำกับภาษี/ใบเสร็จรับเงิน (เอกสารกฎหมายจากข้อมูลออเดอร์จริง)
//  ใช้เมื่อออเดอร์ PAID ขึ้นไป — แสดงเป็นโมดัลสำหรับพิมพ์/บันทึก PDF
//
//  ดีไซน์: "กระดาษฟอร์มจริง" — เอกสารหลุดออกจากหน้าจอนีออน
//  ปาเกตต์กระดาษ (ไม่ใช่สีระบบ): chalk #FDFCF8 · หมึก #1A1A1A · เทาสำเนา #5B5B5B
//  · แดงตราประทับ #8C1D18 · เส้นบรรทัด #E2DED2
//  เสียงตัวอักษร: .font-ledger (Noto Serif Thai) = ชื่อเอกสาร/คำกฎหมาย,
//  .font-script (Sarabun) = รายการข้อความ, .mono = ตัวเลข/จำนวนเงิน
//  ลายเซ็น: ขอบสำเนาปรุ (counterfoil) — เส้นประ + ✂ แบ่งต้นฉบับ/สำเนาบันทึกบัญชี
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo } from 'react';
import { bahtText } from '../../lib/bahtText';

const PAPER = '#FDFCF8';
const INK = '#1A1A1A';
const COPYGRAY = '#5B5B5B';
const STAMPRED = '#8C1D18';
const RULE = '#E2DED2';

const baht = (n: number) => `${Number(n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`;

/** แถวช่องกรอกว่าง — เส้นประจุดสำหรับกรอกมือเหมือนฟอร์มพิมพ์ (ธุรกิจยังไม่มีข้อมูลนี้ในระบบ) */
const Dotted = () => (
  <span style={{ color: COPYGRAY, letterSpacing: 2, fontSize: 10 }}>…………</span>
);

export default function TaxInvoice({ order, business, onClose }: {
  order: any;
  business: any;
  onClose: () => void;
}) {
  const paid = order?.status === 'PAID' || order?.status === 'DELIVERED';
  const payments = Array.isArray(order?.payments) ? order.payments : [];
  const lastPayment = payments.length ? payments[payments.length - 1] : null;
  const wht = Number(lastPayment?.whtAmount ?? 0);
  const vatRate = Number(business?.vatRate ?? 0.07);
  const isVat = vatRate > 0;

  const thb = (d: Date) =>
    `${d.getDate()} ${d.toLocaleDateString('th-TH', { month: 'long' })} ${d.getFullYear() + 543}`;
  const issueDate = useMemo(() => thb(new Date(order?.createdAt ?? Date.now())), [order?.createdAt]);
  const payDate = lastPayment?.paidAt ? thb(new Date(lastPayment.paidAt)) : null;
  const docNo = String(order?.orderNo ?? '').replace(/^B/, 'TIV') || '—';

  const lines = Array.isArray(order?.lines) ? order.lines : [];

  // ── print ──
  useEffect(() => {
    const id = 'tax-invoice-print-css';
    if (document.getElementById(id)) return;
    const css = document.createElement('style');
    css.id = id;
    css.textContent = `
@media print {
  body * { visibility: hidden !important; }
  .taxinvoice-sheet, .taxinvoice-sheet * { visibility: visible !important; }
  .taxinvoice-sheet {
    position: absolute; left: 0; top: 0; width: 190mm;
    box-shadow: none !important; margin: 0 !important;
  }
  .taxinvoice-noprint { display: none !important; }
}`;
    document.head.appendChild(css);
    return () => {
      document.getElementById(id)?.remove();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: 'rgba(6,10,8,.75)' }}>
      <div className="taxinvoice-noprint sticky top-0 z-10 flex justify-center gap-3 py-3" style={{ background: 'rgba(6,10,8,.85)' }}>
        <button onClick={() => window.print()} className="btn btn-primary px-4 py-1.5 text-xs">พิมพ์ / บันทึก PDF</button>
        <button onClick={onClose} className="btn px-4 py-1.5 text-xs">ปิด</button>
      </div>

      <div
        className="taxinvoice-sheet relative mx-auto my-4"
        style={{
          width: 720, maxWidth: '94vw', background: PAPER, color: INK,
          boxShadow: '0 24px 80px rgba(0,0,0,.55)', borderRadius: 2,
          display: 'grid', gridTemplateColumns: '44px 1fr',
        }}
      >
        {/* ── ลายเซ็น: ขอบสำเนาปรุ ── */}
        <div style={{ borderRight: `2px dashed ${RULE}`, position: 'relative' }}>
          <span style={{
            position: 'absolute', top: 6, left: -7, fontSize: 11, color: COPYGRAY,
            transform: 'rotate(-90deg)', transformOrigin: 'center', whiteSpace: 'nowrap',
            letterSpacing: 3,
          }}>ต้นฉบับ — ผู้ซื้อ</span>
          <span style={{ position: 'absolute', top: 4, left: 13, fontSize: 12, color: COPYGRAY }}>✂</span>
          <span style={{
            position: 'absolute', bottom: 6, left: 8, fontSize: 9, color: COPYGRAY,
            writingMode: 'vertical-rl', letterSpacing: 3,
          }}>สำเนาบันทึกบัญชี</span>
        </div>

        <div style={{ padding: '22px 26px 26px 18px' }}>
          {/* ── หัวเอกสาร ── */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div className="font-ledger" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.15 }}>
                {business?.shopName || business?.name || '—'}
              </div>
              <div className="font-script" style={{ fontSize: 11, color: COPYGRAY, marginTop: 4 }}>
                ผู้เสียภาษีอากรเลขที่ {business?.taxId ? <b className="mono" style={{ color: INK }}>{business.taxId}</b> : <Dotted />}
                &nbsp; ที่อยู่ {business?.address || <Dotted />} &nbsp; โทร. <Dotted />
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="font-ledger" style={{ fontSize: 15, fontWeight: 700 }}>
                {isVat ? 'ใบกำกับภาษี/ใบเสร็จรับเงิน' : 'ใบเสร็จรับเงิน'}
              </div>
              <div style={{ fontSize: 10, color: COPYGRAY, marginTop: 2 }}>ต้นฉบับ / ออกเป็นชุด</div>
            </div>
          </div>

          <div style={{ height: 1, background: INK, margin: '14px 0 10px', opacity: 0.75 }} />

          {/* ── รหัสเอกสาร ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, fontSize: 11 }} className="font-script">
            <div>เลขที่เอกสาร <b className="mono">{docNo}</b></div>
            <div>วันที่ออกเอกสาร <b className="mono">{issueDate}</b></div>
            <div>วันที่รับชำระ <b className="mono">{payDate ?? <Dotted />}</b></div>
          </div>

          {/* ── ลูกค้า/ผู้ซื้อ ── */}
          <div className="font-script" style={{ marginTop: 12, fontSize: 11 }}>
            ผู้ซื้อ / ลูกค้า: <b>{order?.customer?.name ?? 'ลูกค้าหน้าร้าน'}</b>
            {order?.customer?.taxId ? <> · เลขผู้เสียภาษี <b className="mono">{order.customer.taxId}</b></> : null}
            {order?.customer?.address ? <><br />ที่อยู่: {order.customer.address}</> : null}
          </div>

          {/* ── ตารางรายการ ── */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14, fontSize: 11.5 }}>
            <thead>
              <tr style={{ borderBottom: `1.5px solid ${INK}` }}>
                <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>รายการ</th>
                <th style={{ width: 44, textAlign: 'right', padding: '4px 6px', fontWeight: 600 }}>จำนวน</th>
                <th style={{ width: 92, textAlign: 'right', padding: '4px 6px', fontWeight: 600 }}>ราคาต่อหน่วย</th>
                <th style={{ width: 104, textAlign: 'right', padding: '4px 6px', fontWeight: 600 }}>จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l: any, i: number) => (
                <tr key={l.id ?? i} style={{ borderBottom: `1px solid ${RULE}` }}>
                  <td style={{ padding: '6px' }}>
                    <div className="font-script">{l.product?.name ?? l.description ?? '—'}</div>
                    {l.product?.sku && <div className="mono" style={{ fontSize: 9.5, color: COPYGRAY }}>{l.product.sku}</div>}
                  </td>
                  <td className="mono" style={{ textAlign: 'right', padding: 6 }}>{l.qty}</td>
                  <td className="mono" style={{ textAlign: 'right', padding: 6 }}>{baht(l.unitPrice)}</td>
                  <td className="mono" style={{ textAlign: 'right', padding: 6 }}>{baht(l.qty * l.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* ── สรุปยอด ── */}
          <div style={{ marginTop: 10, marginLeft: 'auto', width: 260, fontSize: 11.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 6px' }}>
              <span className="font-script">รวมเงิน</span><b className="mono">{baht(order?.subtotal ?? 0)}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 6px' }}>
              <span className="font-script">ภาษีมูลค่าเพิ่ม {Math.round(vatRate * 100)}%</span>
              <b className="mono">{isVat ? baht(order?.vat ?? 0) : 'ยกเว้น'}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 6px', borderTop: `1.5px solid ${INK}`, borderBottom: `1.5px solid ${INK}` }}>
              <b className="font-ledger">จำนวนเงินรวมทั้งสิ้น</b><b className="mono">{baht(order?.total ?? 0)}</b>
            </div>
            <div className="font-script" style={{ marginTop: 6, fontSize: 11 }}>
              จำนวนเงินตัวหนังสือ <b className="font-ledger">{bahtText(Number(order?.total ?? 0))}</b>
            </div>
            {wht > 0 && (
              <div className="font-script" style={{ marginTop: 4, fontSize: 10.5, color: COPYGRAY }}>
                หัก ภ.ง.ด. (WHT) {baht(wht)} — รับโอนสุทธิ {baht(Number(order?.total ?? 0) - wht)}
              </div>
            )}
          </div>

          {/* ── ช่องลงชื่อรับ ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, marginTop: 34, fontSize: 10.5, color: COPYGRAY }} className="font-script">
            <div style={{ borderTop: `1px solid ${INK}`, paddingTop: 4, textAlign: 'center' }}>ลงชื่อผู้รับเงิน</div>
            <div style={{ borderTop: `1px solid ${INK}`, paddingTop: 4, textAlign: 'center' }}>ลงชื่อผู้มอบของ/ฝ่ายขาย</div>
          </div>
        </div>

        {/* ── ตราประทับชำระแล้ว ── */}
        {paid && (
          <div style={{
            position: 'absolute', right: 26, bottom: 74,
            border: `3px double ${STAMPRED}`, color: STAMPRED, borderRadius: 6,
            padding: '6px 14px', transform: 'rotate(-7deg)', opacity: 0.85,
            textAlign: 'center', pointerEvents: 'none',
          }}>
            <div className="font-ledger" style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>ชำระแล้ว</div>
            <div className="mono" style={{ fontSize: 9.5, marginTop: 1 }}>{payDate ?? ''}</div>
          </div>
        )}
      </div>
    </div>
  );
}
