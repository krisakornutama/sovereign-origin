import { useState, useEffect } from 'react';
import Head from 'next/head';
import { getApiUrl } from '../../lib/config';
import { FeedbackButton } from '../../components/public/FeedbackButton';
import { FounderCredit } from '../../components/public/FounderCredit';
import { trackPageView } from '../../lib/visitorTrack';

// P17 — ลิงก์ส่วนตัวของคู่ค้า: /partners/me?p=<partnerId>&t=<publicToken ของบิลใดบิลหนึ่ง>
//  เห็นครบในหน้าเดียว: บิลทั้งหมด · สถานะชำระ (ค้าง/ครบ) · งานติดตั้ง/ซ่อม · ปุ่มชำระ PromptPay ต่อบิล
//  token ไม่ถูก = ข้อความกลาง ไม่เปิดเผยว่ามี partner นี้อยู่

interface Bill {
  orderNo: string; title: string; total: number; paid: number; remaining: number;
  status: string; publicToken: string | null; createdAt: string;
  installs: Array<{ title: string; status: string; scheduledAt: string | null; note: string | null }>;
}
interface Portal {
  partner: { name: string; category: string; status: string; since: string };
  summary: { billCount: number; totalBilled: number; totalPaid: number; remaining: number; installCount: number; installDone: number };
  bills: Bill[];
}

const baht = (n: number) => `${Number(n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`;
const STATUS_TH: Record<string, string> = { QUOTE: 'รอชำระ', ORDERED: 'รอชำระ', PAID: 'ชำระแล้ว', DELIVERED: 'เสร็จสิ้น', CANCELLED: 'ยกเลิก' };
const INSTALL_TH: Record<string, string> = { TODO: 'รอดำเนินการ', IN_PROGRESS: 'กำลังดำเนินการ', DONE: 'เสร็จแล้ว' };

export default function PartnerPortalPage() {
  const [data, setData] = useState<Portal | null>(null);
  const [bad, setBad] = useState(false);
  const [query, setQuery] = useState<{ p: string; t: string } | null>(null);
  const [qr, setQr] = useState<{ name: string; target: string; qrDataUrl: string } | null>(null);

  useEffect(() => {
    trackPageView('/partners/me');
    const sp = new URLSearchParams(window.location.search);
    const p = sp.get('p') ?? '';
    const t = sp.get('t') ?? '';
    setQuery({ p, t });
    if (p && t) {
      fetch(`${getApiUrl()}/api/partners/${p}/portal?t=${encodeURIComponent(t)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then(setData)
        .catch(() => setBad(true));
    } else {
      setBad(true);
    }
  }, []);

  // P19 — QR ป้ายหน้าร้านของคู่ค้าเอง (สแกน → หมุดร้านบนแผนที่คู่ค้า) — โหลดเมื่อรู้ id แล้วดาวน์โหลดเป็น PNG ได้
  useEffect(() => {
    const pid = query?.p;
    if (!pid) return;
    let alive = true;
    fetch(`${getApiUrl()}/api/partners/${pid}/qr`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setQr(d && d.qrDataUrl ? d : null); })
      .catch(() => { if (alive) setQr(null); });
    return () => { alive = false; };
  }, [query]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Head>
        <title>พื้นที่ของคู่ค้า — Sovereign Origin</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="max-w-3xl mx-auto px-4 py-10">
        {!query?.p || !query?.t || bad ? (
          <div className="text-center py-16 space-y-2">
            <div className="text-4xl" aria-hidden>🔒</div>
            <h1 className="text-lg font-semibold">ลิงก์ไม่ถูกต้อง</h1>
            <p className="text-sm text-gray-400">ลิงก์นี้ใช้ได้เฉพาะที่ได้รับจากทีมงาน — ติดต่อเราเพื่อรับลิงก์ใหม่</p>
          </div>
        ) : !data ? (
          <div className="text-center py-16 text-sm text-gray-500 animate-pulse">กำลังเปิดพื้นที่ของคุณ…</div>
        ) : (
          <div className="space-y-6">
            <header className="space-y-1">
              <div className="mono text-[10px] tracking-[0.25em] uppercase text-cyan-400/80">ลิงก์ส่วนตัว · พื้นที่คู่ค้า</div>
              <h1 className="text-2xl font-bold">{data.partner.name}</h1>
              <p className="text-xs text-gray-500">
                คู่ค้า{data.partner.status === 'ACTIVE' ? 'เปิดใช้งานแล้ว' : 'รอตรวจสอบ'} · ร่วมเครือข่ายเมื่อ {new Date(data.partner.since).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </header>

            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'บิลทั้งหมด', value: String(data.summary.billCount), icon: '🧾' },
                { label: 'ยอดรวม', value: baht(data.summary.totalBilled), icon: '📊' },
                { label: 'ชำระแล้ว', value: baht(data.summary.totalPaid), icon: '✅' },
                { label: 'ค้างชำระ', value: baht(data.summary.remaining), icon: data.summary.remaining > 0 ? '⏳' : '🎉' },
              ].map((c) => (
                <div key={c.label} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-center">
                  <div className="text-lg" aria-hidden>{c.icon}</div>
                  <div className="mono text-sm text-emerald-300 font-semibold mt-1">{c.value}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{c.label}</div>
                </div>
              ))}
            </section>

            {qr && (
              <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 flex flex-col sm:flex-row items-center gap-4">
                <img src={qr.qrDataUrl} alt={`QR ป้ายร้าน ${qr.name}`} width={132} height={132} className="rounded-lg bg-white p-1.5 shrink-0" />
                <div className="space-y-1 text-center sm:text-left">
                  <h2 className="text-sm font-semibold text-gray-300">🏷️ QR ป้ายหน้าร้านของคุณ</h2>
                  <p className="text-xs text-gray-500">ลูกค้าสแกน → เปิดหมุดร้านคุณบนแผนที่คู่ค้าทันที · พิมพ์ติดหน้าร้าน/ใส่นามบัตรได้</p>
                  <div className="flex flex-wrap gap-2 justify-center sm:justify-start pt-1">
                    <a href={qr.qrDataUrl} download={`sovereign-qr-${qr.name.replace(/[^0-9a-zA-Zก-๙]+/g, '-') || 'partner'}.png`} className="inline-block text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 font-medium">
                      ⬇️ ดาวน์โหลด PNG
                    </a>
                    <a href={qr.target} target="_blank" rel="noreferrer" className="inline-block text-xs rounded-lg border border-white/15 hover:bg-white/5 text-gray-300 px-4 py-2">
                      เปิดลิงก์ป้าย
                    </a>
                  </div>
                </div>
              </section>
            )}

            {data.summary.installCount > 0 && (
              <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-2">
                <h2 className="text-sm font-semibold text-gray-300">🛠️ งานติดตั้ง/ซ่อม ({data.summary.installDone}/{data.summary.installCount} เสร็จแล้ว)</h2>
                <div className="space-y-2">
                  {data.bills.flatMap((b) => b.installs.map((i, idx) => (
                    <div key={`${b.orderNo}-${idx}`} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-gray-300">{i.title}</span>
                      <span className="mono text-[10px] text-gray-600">{b.orderNo}</span>
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] ${i.status === 'DONE' ? 'bg-emerald-500/10 text-emerald-400' : i.status === 'IN_PROGRESS' ? 'bg-cyan-500/10 text-cyan-300' : 'bg-amber-500/10 text-amber-300'}`}>
                        {INSTALL_TH[i.status] ?? i.status}
                      </span>
                    </div>
                  )))}
                </div>
              </section>
            )}

            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-300">🧾 บิลค่าบริการ</h2>
              {data.bills.length === 0 && <div className="card p-5 text-sm text-gray-500">ยังไม่มีบิล — บิลจะแสดงที่นี่เมื่อทีมงานออกบิลให้</div>}
              {data.bills.map((b) => (
                <div key={b.orderNo} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-gray-200">{b.title || 'ค่าบริการ IoT'}</span>
                    <span className="mono text-[10px] text-gray-600">{b.orderNo}</span>
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] ${b.remaining <= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-300'}`}>
                      {STATUS_TH[b.status] ?? b.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-3 text-xs text-gray-400">
                    <span>รวม <span className="mono text-gray-200">{baht(b.total)}</span></span>
                    {b.paid > 0 && <span>ชำระแล้ว <span className="mono text-emerald-400">{baht(b.paid)}</span></span>}
                    {b.remaining > 0 && <span>ค้าง <span className="mono text-amber-300">{baht(b.remaining)}</span></span>}
                  </div>
                  {b.remaining > 0 && b.publicToken && (
                    <a href={`/shop/?order=${b.publicToken}`} className="inline-block text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 font-medium">
                      💳 ชำระด้วย PromptPay
                    </a>
                  )}
                </div>
              ))}
            </section>

            <footer className="text-center text-[10px] text-gray-600 pt-2 space-y-1">
              <div>ลิงก์นี้เป็นของร้านคุณเท่านั้น — อย่าส่งต่อให้ผู้อื่น (มีข้อมูลการเงิน)</div>
              <div>เครือข่ายคู่ค้า Sovereign Origin · <a href="/partners/" className="hover:text-gray-400 underline underline-offset-2">แผนที่คู่ค้า</a> · <a href="/partners/guide/" className="hover:text-gray-400 underline underline-offset-2">คู่มือ</a></div>
              <FounderCredit />
            </footer>
          </div>
        )}
      </main>
      <FeedbackButton page="/partners/me" />
    </div>
  );
}
