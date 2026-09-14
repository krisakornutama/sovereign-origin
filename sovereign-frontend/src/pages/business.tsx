import { useState, useEffect, useCallback } from 'react';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import EmptyState from '../components/ui/EmptyState';
import { authFetch } from '../lib/apiFetch';
import { getApiUrl } from '../lib/config';
import BusinessWorkspace from '../components/business/BusinessWorkspace';

// ────────────────────────────────────────────────────────────────────────────
// /business — หน้ารวมธุรกิจ (Hub) + ปุ่มสร้างธุรกิจ + workspace
// ────────────────────────────────────────────────────────────────────────────

interface Business {
  id: string;
  name: string;
  bizType: string;
  vatRate: number;
  members: Array<{ id: string; userId: string; position: string; user?: { username: string } }>;
}

const BIZ_TYPES: Array<{ value: string; label: string; emoji: string }> = [
  { value: 'IOT_RETAIL', label: 'ขายสินค้า IoT', emoji: '📡' },
  { value: 'GENERAL_TRADE', label: 'ค้าขายทั่วไป', emoji: '🛒' },
  { value: 'SERVICE', label: 'บริการ/ติดตั้ง', emoji: '🔧' },
];

export default function BusinessPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [form, setForm] = useState({ name: '', bizType: 'IOT_RETAIL', vatRate: '7' });
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${getApiUrl()}/api/business`);
      if (res.ok) {
        const data = await res.json();
        setBusinesses(Array.isArray(data) ? data : []);
      }
    } catch { /* ยัง login ไม่ผ่าน — ให้ layout จัดการ */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createBusiness() {
    if (!form.name.trim()) { setNotice({ ok: false, text: 'ตั้งชื่อธุรกิจก่อน' }); return; }
    const vat = Number(form.vatRate);
    if (!Number.isFinite(vat) || vat < 0 || vat > 30) { setNotice({ ok: false, text: 'VAT ต้องอยู่ระหว่าง 0-30%' }); return; }
    setBusy(true);
    try {
      const res = await authFetch(`${getApiUrl()}/api/business`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), bizType: form.bizType, vatRate: vat / 100 }),
      });
      const data = res.ok ? await res.json() : await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'สร้างไม่สำเร็จ');
      setNotice({ ok: true, text: `สร้างธุรกิจ "${data.name}" แล้ว — ผู้ช่วย AI 5 คนพร้อมทำงาน` });
      setForm({ name: '', bizType: 'IOT_RETAIL', vatRate: '7' });
      setShowWizard(false);
      await load();
      setSelected(data.id);
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const current = businesses.find((b) => b.id === selected) ?? null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Sidebar />
      <div className="lg:pl-64">
        <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4">
          <PageHeader title="ธุรกิจของฉัน" subtitle="จักรวรรดิธุรกิจ — สินค้า ลูกค้า ออเดอร์ ติดตั้ง การเงิน และผู้ช่วย AI ในที่เดียว" icon={<Icon name="package" size={26} />} />

          {notice && (
            <div className={`text-sm rounded-lg border px-3 py-2 ${notice.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>{notice.text}</div>
          )}

          {current ? (
            <BusinessWorkspace biz={current} onExit={() => { setSelected(null); void load(); }} refreshBiz={load} />
          ) : (
            <div className="space-y-4">
              {/* ปุ่มสร้างธุรกิจ */}
              <div className="flex justify-end">
                <button onClick={() => setShowWizard((s) => !s)}
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 font-medium text-sm flex items-center gap-2">
                  <Icon name="plus" size={16} /> สร้างธุรกิจ
                </button>
              </div>

              {/* Wizard */}
              {showWizard && (
                <div className="card p-4 space-y-3 border-cyan-500/30">
                  <div className="text-sm font-semibold">🚀 สร้างธุรกิจใหม่</div>
                  <div className="grid sm:grid-cols-3 gap-2">
                    <input autoFocus placeholder="ชื่อธุรกิจ เช่น Siam IoT Shop" value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && createBusiness()}
                      className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm sm:col-span-2" aria-label="ชื่อธุรกิจ" />
                    <input type="number" step="0.5" min="0" max="30" placeholder="VAT %" value={form.vatRate}
                      onChange={(e) => setForm({ ...form, vatRate: e.target.value })}
                      className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" aria-label="อัตรา VAT" />
                  </div>
                  <div className="grid sm:grid-cols-3 gap-2">
                    {BIZ_TYPES.map((t) => (
                      <button key={t.value} onClick={() => setForm({ ...form, bizType: t.value })}
                        className={`px-3 py-2 rounded-lg border text-sm ${form.bizType === t.value ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-200' : 'border-slate-700 hover:bg-slate-700/30'}`}>
                        {t.emoji} {t.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={createBusiness} disabled={busy}
                      className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-40">สร้างเลย</button>
                    <span className="text-xs text-slate-500">สร้างแล้วระบบจะตั้งทีม, ตำแหน่ง และผู้ช่วย AI 5 คนให้อัตโนมัติ</span>
                  </div>
                </div>
              )}

              {/* รายการธุรกิจ */}
              {businesses.length === 0 ? (
                <EmptyState icon={<Icon name="package" size={26} />} title="ยังไม่มีธุรกิจ" description="กดปุ่ม “สร้างธุรกิจ” เพื่อเริ่มธุรกิจแรกของคุณ — ระบบเตรียมทีม สินค้า ออเดอร์ การเงิน และผู้ช่วย AI ให้ครบ" />
              ) : (
                <div className="grid md:grid-cols-2 gap-3">
                  {businesses.map((b) => {
                    const mine = b.members?.find((m) => m.user?.username) ?? b.members?.[0];
                    return (
                      <button key={b.id} onClick={() => setSelected(b.id)}
                        className="card p-4 text-left hover:border-cyan-500/40 transition-colors space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{BIZ_TYPES.find((t) => t.value === b.bizType)?.emoji ?? '🏢'}</span>
                          <span className="font-bold">{b.name}</span>
                        </div>
                        <div className="text-xs text-slate-400">
                          {BIZ_TYPES.find((t) => t.value === b.bizType)?.label ?? b.bizType} · VAT {(b.vatRate * 100).toFixed(1).replace(/\.0$/, '')}%
                          {mine ? ` · สมาชิก ${b.members?.length ?? 0} คน` : ''}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
