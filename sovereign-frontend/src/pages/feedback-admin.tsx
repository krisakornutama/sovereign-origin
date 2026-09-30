"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { roleIsSuperadmin } from '../lib/roles';
import { useLanguageStore } from '../stores/useLanguageStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';

// ────────────────────────────────────────────────────────────────────────────
// /feedback-admin — คัดกรองฟีดแบ็กจากหน้าสาธารณะ (SUPERADMIN)
//  ตัดสิน "มีประโยชน์/สแปม" ต่อรายการ → เฉพาะที่ "มีประโยชน์" เข้า digest ไปหาเจ้าของ
//  ปุ่ม "ยื่นถึงผม" = ส่ง digest ทันทีผ่าน Telegram (ของที่ยังไม่ sent เท่านั้น)
//  P10: มีแผง "พฤติกรรมผู้เยี่ยมชม" — สรุปหน้ายอดนิยม/แท็บเดโม่/แบบสอบถาม (GET /api/analytics/summary)
// ────────────────────────────────────────────────────────────────────────────

interface VisitorSummaryData {
  days: number; totalEvents: number; uniqueVisitors: number;
  pageViews: { page: string; count: number }[];
  demoTabs: { detail: string; count: number }[];
  ctaClicks: { cta: string; variant: string; count: number }[];
  avgTimeOnPageSec: number | null;
  surveys: { value: string; count: number }[];
  questions: { detail: string; value: string; count: number }[];
  feedbackOpens: number;
}

function VisitorInsights() {
  const [sum, setSum] = useState<VisitorSummaryData | null>(null);
  useEffect(() => {
    authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/analytics/summary?days=7`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSum(d))
      .catch(() => {});
  }, []);
  if (!sum) return null;
  const top = (arr: { count: number }[]) => Math.max(1, ...arr.map((a) => a.count));
  return (
    <section className="card p-4 space-y-3" aria-label="พฤติกรรมผู้เยี่ยมชม">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="font-ledger text-sm text-gray-300">📊 พฤติกรรมผู้เยี่ยมชม 7 วันล่าสุด</h2>
        <span className="mono text-[11px] text-gray-500">{sum.totalEvents} เหตุการณ์ · ~{sum.uniqueVisitors} ผู้มาเยือน (ประมาณ) · เปิดฟีดแบ็ก {sum.feedbackOpens} ครั้ง</span>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <div className="text-[11px] text-gray-500">หน้ายอดนิยม</div>
          {sum.pageViews.length === 0 && <div className="text-xs text-gray-600">ยังไม่มีข้อมูล</div>}
          {sum.pageViews.slice(0, 5).map((p) => (
            <div key={p.page} className="flex items-center gap-2 text-xs">
              <span className="w-24 truncate text-gray-300">{p.page}</span>
              <div className="flex-1 h-1.5 bg-gray-800 rounded overflow-hidden"><div className="h-full bg-cyan-500/60" style={{ width: `${(p.count / top(sum.pageViews)) * 100}%` }} /></div>
              <span className="mono text-[10px] text-gray-500 w-8 text-right">{p.count}</span>
            </div>
          ))}
        </div>
        <div className="space-y-1">
          <div className="text-[11px] text-gray-500">แท็บเดโม่ที่คนเปิด ({sum.avgTimeOnPageSec != null ? `อยู่หน้าเฉลี่ย ${sum.avgTimeOnPageSec}s` : 'ยังไม่มีข้อมูลเวลา'})</div>
          {sum.demoTabs.length === 0 && <div className="text-xs text-gray-600">ยังไม่มีข้อมูล</div>}
          {sum.demoTabs.slice(0, 5).map((p) => (
            <div key={p.detail} className="flex items-center gap-2 text-xs">
              <span className="w-24 truncate text-gray-300">{p.detail}</span>
              <div className="flex-1 h-1.5 bg-gray-800 rounded overflow-hidden"><div className="h-full bg-emerald-500/60" style={{ width: `${(p.count / top(sum.demoTabs)) * 100}%` }} /></div>
              <span className="mono text-[10px] text-gray-500 w-8 text-right">{p.count}</span>
            </div>
          ))}
        </div>
      </div>
      {sum.ctaClicks.length > 0 && (
        <div className="space-y-1 pt-2 border-t border-dashed border-gray-800">
          <div className="text-[11px] text-gray-500">A/B การ์ดหน้าแรก (กดปุ่มไหนมากกว่า — A=เดโม่ก่อน · B=ร้านก่อน)</div>
          {(['A', 'B'] as const).map((v) => {
            const rows = sum.ctaClicks.filter((c) => c.variant === v);
            if (rows.length === 0) return null;
            const total = rows.reduce((s, c) => s + c.count, 0);
            return (
              <div key={v} className="flex items-center gap-2 text-xs flex-wrap">
                <span className="mono w-6 text-cyan-300">{v}</span>
                {rows.map((c) => (
                  <span key={c.cta} className="text-gray-300">{c.cta} <span className="mono text-[10px] text-gray-500">×{c.count}</span></span>
                ))}
                <span className="ml-auto mono text-[10px] text-gray-500">รวม {total} คลิก</span>
              </div>
            );
          })}
          <div className="text-[10px] text-gray-600">ยังเก็บต่อได้ 1–2 สัปดาห์ก่อนตัดสิน — ผู้ใช้แต่ละคนเห็นแบบเดิมเสมอ (จำไว้ในเครื่อง)</div>
        </div>
      )}
      {(sum.surveys.length > 0 || sum.questions.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4 pt-2 border-t border-dashed border-gray-800">
          <div className="space-y-1">
            <div className="text-[11px] text-gray-500">แบบสอบถาม: ส่วนที่อยากใช้จริงก่อน</div>
            {sum.surveys.map((s) => (
              <div key={s.value} className="text-xs text-gray-300">• {s.value} <span className="mono text-[10px] text-gray-500">×{s.count}</span></div>
            ))}
          </div>
          <div className="space-y-1">
            <div className="text-[11px] text-gray-500">ความต้องการที่ผู้ใช้เขียนเอง</div>
            {sum.questions.slice(0, 5).map((q, i) => (
              <div key={i} className="text-xs text-gray-300">• <span className="text-cyan-300/80">{q.detail}</span> — {q.value}</div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// P16 — แผงอนุมัติคู่ค้า: สมัครจาก /partners → อนุมัติ = ขึ้นแผนที่สาธารณะทันที
interface PartnerRow { id: string; name: string; category: string; detail: string | null; address: string | null; phone: string | null; lat: number; lng: number; contactName: string; contactPhone: string; status: string; created_at: string; }
interface BillResult { orderNo: string; total: number; payUrl: string; publicToken: string; }

// P17 — ฟอร์มบิลค่าบริการ IoT ต่อร้าน ACTIVE: สร้างบิล+ลิงก์ PromptPay ส่งคู่ค้า
function PartnerBillForm({ id, name }: { id: string; name: string }) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [install, setInstall] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ payUrl: string; orderNo: string; total: number; publicToken: string } | null>(null);
  const [err, setErr] = useState('');
  async function make() {
    setBusy(true); setErr('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/partners/${id}/bills`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, amount: Number(amount), installTitle: install || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setResult(data);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (result) {
    const portalUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/partners/me/?p=${id}&t=${result.publicToken}`;
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/20 p-3 space-y-1.5 text-xs" style={{ width: 300 }}>
        <div className="text-emerald-300 font-medium">บิล {result.orderNo} สร้างแล้ว (รวม {result.total.toLocaleString('th-TH')}฿)</div>
        <div className="break-all text-cyan-300">{result.payUrl}</div>
        <div className="text-[10px] text-gray-500">ลิงก์พื้นที่คู่ค้า (ดูบิล+งานติดตั้งครบ):</div>
        <div className="break-all text-cyan-300/80">{portalUrl}</div>
        <button type="button" onClick={() => navigator.clipboard?.writeText(`${name}
ลิงก์ชำระค่าบริการ: ${result.payUrl}
พื้นที่ของร้าน (บิล+สถานะงาน): ${portalUrl}`)}
          className="w-full text-xs px-3 py-1.5 rounded-lg bg-cyan-600/30 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-600/50">📋 คัดลอกข้อความส่งคู่ค้า</button>
        <button type="button" onClick={() => { setResult(null); setTitle(''); setAmount(''); setInstall(''); }} className="text-[11px] text-gray-500 hover:text-gray-300">สร้างบิลใหม่</button>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-white/10 p-3 space-y-2" style={{ width: 300 }}>
      <div className="text-[11px] text-gray-400">บิลค่าบริการ — {name}</div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="รายการ เช่น ค่าติดตั้งเซ็นเซอร์ 2 จุด"
        className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs" maxLength={160} />
      <div className="flex gap-2">
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="จำนวนเงิน (บาท)"
          inputMode="decimal" className="w-32 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs mono" />
        <input value={install} onChange={(e) => setInstall(e.target.value)} placeholder="งานติดตั้ง/ซ่อม (ไม่บังคับ)"
          className="flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs" maxLength={160} />
      </div>
      {err && <div className="text-[11px] text-rose-400">{err}</div>}
      <button type="button" onClick={make} disabled={busy || !title || !Number(amount)}
        className="w-full text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40">{busy ? 'กำลังสร้าง…' : '🧾 สร้างบิล + ลิงก์ PromptPay'}</button>
    </div>
  );
}

// QR ป้ายร้าน (P16): สร้าง QR ต่อร้าน ACTIVE — สแกนแล้วเปิดหมุดร้านตัวเองบนแผนที่
function PartnerQrButton({ id, name }: { id: string; name: string }) {
  const [qr, setQr] = useState<{ qrDataUrl: string; target: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function make() {
    setBusy(true);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/partners/${id}/qr`);
      if (res.ok) setQr(await res.json());
    } finally {
      setBusy(false);
    }
  }
  if (qr) {
    return (
      <div className="rounded-lg border border-gray-700 p-3 text-center space-y-2" style={{ width: 240 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr.qrDataUrl} alt={`QR ป้ายร้าน ${name}`} width={200} height={200} className="mx-auto rounded bg-white p-1" />
        <div className="text-[11px] text-gray-400 break-all">{qr.target}</div>
        <button type="button" onClick={() => window.print()} className="w-full text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white">🖨️ พิมพ์ป้าย</button>
        <button type="button" onClick={() => setQr(null)} className="text-[11px] text-gray-500 hover:text-gray-300">ปิด</button>
      </div>
    );
  }
  return <button type="button" onClick={make} disabled={busy} className="text-[11px] text-cyan-300 hover:underline underline-offset-2 disabled:opacity-40">{busy ? 'กำลังสร้าง…' : '🏷️ QR ป้ายร้าน'}</button>;
}

function PartnerApprovals() {
  const [rows, setRows] = useState<PartnerRow[]>([]);
  const [msg, setMsg] = useState('');
  const [billFor, setBillFor] = useState<string | null>(null); // P17: ฟอร์มบิลของร้านที่กำลังออกบิล
  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/partners/admin/list`);
      if (!res.ok) return;
      const data = await res.json();
      setRows(data.partners ?? []);
    } catch { /* เงียบ — โหลดไม่ได้ = แผงหายไปชั่วคราว */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function decide(id: string, status: 'ACTIVE' | 'REJECTED') {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/partners/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows((s) => s.filter((r) => r.id !== id)); // ลบแถวออกจากจอเมื่อ server ยืนยันเท่านั้น (บทเรียน: ผู้ใช้กดแล้วไม่ติ — แถวหายแบบ optimistic)
      setMsg(status === 'ACTIVE' ? 'อนุมัติแล้ว — ขึ้นแผนที่แล้ว' : 'ปฏิเสธแล้ว');
    } catch {
      setMsg('ทำรายการไม่สำเร็จ — ลองใหม่ (รายการยังอยู่)');
    }
    setTimeout(() => setMsg(''), 3500);
  }
  if (rows.length === 0) return null;
  const CAT: Record<string, string> = { SHOP: '🏪 ร้านค้า', TECHNICIAN: '🔧 ช่าง', OTHER: '🤝 อื่น ๆ' };
  const pending = rows.filter((r) => r.status === 'PENDING');
  const active = rows.filter((r) => r.status === 'ACTIVE');
  if (pending.length === 0 && active.length === 0) return null;
  return (
    <section className="card p-4 space-y-3" aria-label="จัดการคู่ค้า">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="font-ledger text-sm text-gray-300">🗺️ คู่ค้า — รออนุมัติ {pending.length} · เปิดใช้งาน {active.length}</h2>
        <div className="flex items-center gap-3">
          {msg && <span className="text-xs text-emerald-400">{msg}</span>}
          <button onClick={load} className="text-[11px] text-gray-500 hover:text-gray-300">รีเฟรช</button>
        </div>
      </div>
      <div className="space-y-2">
        {pending.map((p) => (
          <div key={p.id} className="card p-3 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-gray-200">{p.name}</span>
              <span className="border rounded px-1.5 py-0.5 border-gray-700 text-[10px]">{CAT[p.category] ?? p.category}</span>
              <span className="mono text-[10px] text-gray-500">📍 {p.lat}, {p.lng}</span>
              <span className="ml-auto text-[11px] text-gray-500">ติดต่อ: {p.contactName} · {p.contactPhone}</span>
            </div>
            {p.detail && <p className="text-xs text-gray-400">{p.detail}</p>}
            {p.address && <p className="text-[11px] text-gray-500">📍 {p.address}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={() => decide(p.id, 'ACTIVE')} className="px-3 py-1 rounded-lg text-xs border border-emerald-600/50 text-emerald-400 hover:bg-emerald-950/40">✓ อนุมัติ (ขึ้นแผนที่)</button>
              <button onClick={() => decide(p.id, 'REJECTED')} className="px-3 py-1 rounded-lg text-xs border border-rose-600/50 text-rose-400 hover:bg-rose-950/40">✕ ปฏิเสธ</button>
            </div>
          </div>
        ))}
        {active.length > 0 && (
          <div className="pt-2 border-t border-dashed border-gray-800 space-y-2">
            <div className="text-[11px] text-gray-500">คู่ค้าที่เปิดใช้งานแล้ว — สร้าง QR ป้ายติดหน้าร้าน (สแกน = เปิดหมุดร้านบนแผนที่)</div>
            {active.map((p) => (
              <div key={p.id} className="space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium text-gray-200">{p.name}</span>
                  <span className="text-[10px] text-gray-500">{CAT[p.category] ?? p.category}</span>
                  <span className="ml-auto flex items-center gap-3">
                    <PartnerQrButton id={p.id} name={p.name} />
                    <button type="button" onClick={() => setBillFor(billFor === p.id ? null : p.id)} className="text-[11px] text-emerald-400 hover:underline underline-offset-2">🧾 ออกบิลค่าบริการ</button>
                  </span>
                </div>
                {billFor === p.id && <PartnerBillForm id={p.id} name={p.name} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

interface Note {
  id: string;
  created_at: string;
  page: string;
  topic: string;
  message: string;
  sender_email: string | null;
  useful: boolean | null;
  sent_at: string | null;
  ip_hash: string | null;
}

const TOPIC_TH: Record<string, string> = { general: 'ทั่วไป', bug: 'พบปัญหา', feature: 'ขอฟีเจอร์', question: 'สอบถาม' };

export default function FeedbackAdminPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [notes, setNotes] = useState<Note[]>([]);
  const [filter, setFilter] = useState<'pending' | 'useful' | 'spam' | 'all'>('pending');
  const [loading, setLoading] = useState(false);
  const [digestMsg, setDigestMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/feedback?take=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNotes(data.notes ?? []);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isHydrated && isAuthenticated) load();
  }, [isHydrated, isAuthenticated, load]);

  async function judge(id: string, useful: boolean | null) {
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ useful }),
    });
    setNotes((s) => s.map((n) => (n.id === id ? { ...n, useful } : n)));
  }

  async function sendDigest() {
    setDigestMsg('…');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/feedback/digest`, { method: 'POST' });
      const data = await res.json();
      setDigestMsg(data.sent > 0 ? `ส่งแล้ว ${data.sent} รายการ (Telegram)` : 'ไม่มีของรอส่ง');
      if (data.sent > 0) load();
    } catch {
      setDigestMsg('ส่งไม่สำเร็จ');
    }
    setTimeout(() => setDigestMsg(''), 4000);
  }

  if (!isHydrated) return <div className="text-white p-8">{t('common.loading', 'กำลังโหลด...')}</div>;
  if (!isAuthenticated || !user) return <div className="text-white p-8">Unauthorized</div>;
  if (!roleIsSuperadmin(user.role)) {
    return <div className="min-h-screen bg-gray-950 text-gray-100 p-8">หน้านี้ใช้ได้เฉพาะ SUPERADMIN</div>;
  }

  const filtered = notes.filter((n) =>
    filter === 'all' ? true : filter === 'pending' ? n.useful === null : filter === 'useful' ? n.useful === true : n.useful === false,
  );

  return (
    <div className="atmo-system min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader
          eyebrow="ระบบ"
          title="ฟีดแบ็กจากผู้เยี่ยมชม"
          icon={<Icon name="message" size={18} />}
          subtitle="คัดกรอง 'มีประโยชน์' ก่อนยื่นถึงคุณ — ส่วนที่เลือกจะถูกรวมส่งเป็นข้อความเดียว"
          actions={
            <div className="flex gap-3 items-center">
              {digestMsg && <span className="text-xs text-cyan-300">{digestMsg}</span>}
              <button onClick={sendDigest} className="text-sm px-3 py-1.5 rounded-lg border border-cyan-500/50 text-cyan-300 hover:bg-cyan-950/40">
                📮 ยื่นถึงผม
              </button>
            </div>
          }
        />
        <main className="flex-1 p-4 lg:p-6 max-w-5xl mx-auto w-full space-y-4">
          <PartnerApprovals />
          <VisitorInsights />
          <div className="flex gap-2" role="tablist" aria-label="กรองสถานะฟีดแบ็ก">
            {([['pending', `รอตัดสิน (${notes.filter((n) => n.useful === null).length})`], ['useful', `มีประโยชน์ (${notes.filter((n) => n.useful === true).length})`], ['spam', `สแปม (${notes.filter((n) => n.useful === false).length})`], ['all', 'ทั้งหมด']] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                className={`px-3 py-1.5 rounded-lg text-xs border ${filter === k ? 'border-cyan-500/60 text-cyan-300 bg-cyan-950/30' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>
                {label}
              </button>
            ))}
            <button onClick={load} className="ml-auto text-xs text-gray-500 hover:text-gray-300">รีเฟรช</button>
          </div>

          {loading && <div className="text-sm text-gray-500">กำลังโหลด…</div>}
          {!loading && filtered.length === 0 && <div className="card p-6 text-sm text-gray-500">ไม่มีรายการในหมวดนี้</div>}

          <div className="space-y-2">
            {filtered.map((n) => (
              <div key={n.id} className="card p-3 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                  <span className="border rounded px-1.5 py-0.5 border-gray-700">{TOPIC_TH[n.topic] ?? n.topic}</span>
                  <span className="mono">{new Date(n.created_at).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <span>{n.page}</span>
                  {n.sender_email && <span className="text-cyan-400/80">✉ {n.sender_email}</span>}
                  {n.sent_at && <span className="text-emerald-500/80">ส่งแล้ว</span>}
                  <span className="ml-auto">
                    {n.useful === true && <span className="text-emerald-400">มีประโยชน์ ✓</span>}
                    {n.useful === false && <span className="text-rose-400">สแปม ✕</span>}
                  </span>
                </div>
                <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">{n.message}</p>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => judge(n.id, true)} disabled={n.useful === true}
                    className="px-3 py-1 rounded-lg text-xs border border-emerald-600/50 text-emerald-400 hover:bg-emerald-950/40 disabled:opacity-30">
                    👍 มีประโยชน์
                  </button>
                  <button onClick={() => judge(n.id, false)} disabled={n.useful === false}
                    className="px-3 py-1 rounded-lg text-xs border border-rose-600/50 text-rose-400 hover:bg-rose-950/40 disabled:opacity-30">
                    👎 สแปม
                  </button>
                  {n.useful !== null && (
                    <button onClick={() => judge(n.id, null)} className="px-3 py-1 rounded-lg text-xs text-gray-500 hover:text-gray-300">
                      ยกเลิกตัดสิน
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
