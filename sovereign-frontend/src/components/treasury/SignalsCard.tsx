"use client";
// ─────────────────────────────────────────────────────────────
//  SignalsCard — AI Portfolio Manager (Small-Cap signal engine)
//  แสดงกฎ 6 ตัว + ราคาล่าสุด + สถานะ trailing/L1/L2 + ปุ่มตรวจสัญญาณทันที
//  API: GET/POST /api/treasury/signals
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../../lib/apiFetch';
import Icon from '../ui/Icon';

interface SellLevel { min: number; max: number; sellPct: number }
interface Trigger {
  symbol: string;
  role: 'CORE' | 'SATELLITE' | 'MOONSHOT';
  weightTargetMin: number;
  weightTargetMax: number;
  buyDipMin: number | null;
  buyDipMax: number | null;
  sellLevels: SellLevel[];
  noNewMoney: boolean;
  trailingStopPct: number;
  enabled: boolean;
  priceUsd: number | null;
  source: string | null;
  state: { peakPrice: number | null; trailingArmed: boolean; l1Done: boolean; l2Done: boolean };
}
interface AlertItem { symbol: string; action: string; message: string; priceTHB: number }

const ROLE_STYLE: Record<string, string> = {
  CORE: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  SATELLITE: 'bg-amber-900/40 text-amber-300 border-amber-700',
  MOONSHOT: 'bg-purple-900/40 text-purple-300 border-purple-700',
};
const ROLE_LABEL: Record<string, string> = { CORE: 'แกนหลัก', SATELLITE: 'หมุนเงิน', MOONSHOT: 'ถือยาว' };

function zone(t: Trigger): string {
  if (t.noNewMoney) return 'ห้ามเติมเงิน — รอเก็บกำไร';
  if (t.buyDipMin == null || t.buyDipMax == null) return 'ไม่รับซื้อเพิ่ม';
  return `ซื้อ $${t.buyDipMin.toFixed(2)}–${t.buyDipMax.toFixed(2)}`;
}
function sells(t: Trigger): string {
  if (t.sellLevels.length === 0) return 'ถือยาว ไม่ขาย';
  return t.sellLevels.map((l, i) => `L${i + 1} $${l.min}–${l.max} (ขาย ${l.sellPct}%)${t.state.l1Done && i === 0 ? ' ✓' : ''}${t.state.l2Done && i === 1 ? ' ✓' : ''}`).join(' · ');
}

export default function SignalsCard() {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/treasury/signals`);
      if (!res.ok) return;
      const d = await res.json();
      setTriggers(d.triggers ?? []);
    } catch { /* offline — เงียบ */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const checkNow = async () => {
    setChecking(true); setMsg(''); setErr('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/treasury/signals/check`, { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'ตรวจไม่สำเร็จ');
      setAlerts(d.alerts ?? []);
      setMsg(d.alerts?.length ? `พบ ${d.alerts.length} สัญญาณ — ส่ง Telegram แล้ว` : `ตรวจ ${d.checked} ตัว — ไม่มีราคาชนเงื่อนไข`);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
          <Icon name="trending-up" size={15} className="text-amber-400" />
          AI Portfolio Manager — Small-Cap Signals
        </h2>
        <button onClick={checkNow} disabled={checking} className="text-xs px-3 py-1.5 bg-amber-800/50 hover:bg-amber-700/50 border border-amber-700/50 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50">
          <Icon name="play" size={12} /> {checking ? 'กำลังดึงราคา…' : 'ตรวจสัญญาณตอนนี้'}
        </button>
      </div>

      {msg && <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 rounded-lg px-3 py-2">{msg}</div>}
      {err && <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/50 rounded-lg px-3 py-2">{err}</div>}
      {alerts.length > 0 && (
        <div className="space-y-1">
          {alerts.map((a, i) => (
            <div key={i} className="text-xs bg-amber-950/30 border border-amber-800/50 rounded-lg px-3 py-2 text-amber-200">
              <b>{a.symbol}</b> · {a.action} · ฿{a.priceTHB.toLocaleString()} — {a.message.replace(/^\S+\s/, '')}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {triggers.map((tr) => (
          <div key={tr.symbol} className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-sm text-gray-100">{tr.symbol}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${ROLE_STYLE[tr.role]}`}>{ROLE_LABEL[tr.role]} {tr.weightTargetMin ? `${tr.weightTargetMin}-${tr.weightTargetMax}%` : ''}</span>
            </div>
            <div className="text-lg font-bold text-emerald-400">
              {tr.priceUsd != null ? `$${tr.priceUsd.toFixed(2)}` : '—'}
              {tr.priceUsd != null && <span className="text-xs text-gray-500 ml-1">≈ ฿{Math.round(tr.priceUsd * 35).toLocaleString()}</span>}
            </div>
            <div className="text-[11px] text-gray-400 space-y-0.5">
              <div>🎯 {zone(tr)}</div>
              <div>💰 {sells(tr)}</div>
              <div>
                🛡️ {tr.trailingStopPct > 0 ? (tr.state.trailingArmed ? `ARMED (peak $${tr.state.peakPrice?.toFixed(2)}) −${tr.trailingStopPct}%` : `รอ +50% (−${tr.trailingStopPct}%)`) : 'ปิด trailing'}
              </div>
            </div>
          </div>
        ))}
        {triggers.length === 0 && <div className="text-xs text-gray-500 col-span-full text-center py-4">ยังไม่มีกฎ — กด reset ผ่าน API หรือรอ seed อัตโนมัติ</div>}
      </div>
      <p className="text-[10px] text-gray-600">⚠️ ระบบแจ้งเตือนตามกฎที่คุณกำหนดเอง (cron 15 นาที + Telegram) — ไม่ใช่คำแนะนำการลงทุน</p>
    </section>
  );
}
