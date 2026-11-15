"use client";
// ── Tab 6: บัญชีงวด ──
// ย้ายจาก pages/livestock.tsx ตามเดิมทุกบรรทัด (FE-003)
import { useState, useEffect } from 'react';
import Icon from '../ui/Icon';
import { Group, fmtNum } from '../../lib/livestock-helpers';

export default function FinanceTab({ groups, canWrite, api, loadAll, setMsg, setErr, t }: any) {
  const [form, setForm] = useState({ batchCode: '', livestockGroupId: '', initialAnimalCost: '', totalFeedCost: '', totalMedCost: '', totalUtilityCost: '', totalRevenue: '' });
  const [batches, setBatches] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const r = await api('/batches');
      const d = await r.json();
      if (r.ok) setBatches(d.batches ?? []);
    } catch { /* ignore */ }
  };

  const save = async () => {
    if (!form.batchCode.trim()) return;
    setSaving(true); setErr(''); setMsg('');
    try {
      const num = (v: string) => (v === '' ? undefined : Number(v));
      const body: Record<string, unknown> = { batchCode: form.batchCode.trim() };
      if (form.livestockGroupId) body.livestockGroupId = form.livestockGroupId;
      for (const k of ['initialAnimalCost', 'totalFeedCost', 'totalMedCost', 'totalUtilityCost', 'totalRevenue'] as const) {
        const v = num(form[k]);
        if (v !== undefined) body[k] = v;
      }
      const r = await api('/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'save failed');
      setMsg(t('livestock.page.updated', 'อัปเดตสำเร็จ'));
      setForm({ batchCode: '', livestockGroupId: '', initialAnimalCost: '', totalFeedCost: '', totalMedCost: '', totalUtilityCost: '', totalRevenue: '' });
      load(); loadAll();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const closeBatch = async (id: string) => {
    try {
      const r = await api(`/batches/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ closedAt: new Date().toISOString() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'update failed');
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const totalRevenue = batches.reduce((s, b) => s + b.totalRevenue, 0);
  const totalCost = batches.reduce((s, b) => s + b.initialAnimalCost + b.totalFeedCost + b.totalMedCost + b.totalUtilityCost, 0);

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="card panel-glow p-4 space-y-3">
          <div className="text-sm font-semibold text-gray-200 flex items-center gap-1.5"><Icon name="note" size={14} className="text-gray-400" />{t('livestock.finance.title', 'บัญชีงวด (Batch Financial Engine)')}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input value={form.batchCode} onChange={(e) => setForm({ ...form, batchCode: e.target.value })} placeholder={t('livestock.finance.batchCodePlaceholder', 'รหัสงวด *')} className="input" />
            <select value={form.livestockGroupId} onChange={(e) => setForm({ ...form, livestockGroupId: e.target.value })} className="input">
              <option value="">{t('livestock.finance.noGroup', 'ไม่ผูกกลุ่ม')}</option>
              {groups.map((g: Group) => <option key={g.id} value={g.id}>{g.code}</option>)}
            </select>
            <input value={form.initialAnimalCost} onChange={(e) => setForm({ ...form, initialAnimalCost: e.target.value })} type="number" min="0" placeholder={t('livestock.finance.costAnimal', 'ต้นทุนสัตว์')} className="input" />
            <input value={form.totalFeedCost} onChange={(e) => setForm({ ...form, totalFeedCost: e.target.value })} type="number" min="0" placeholder={t('livestock.finance.costFeed', 'ค่าอาหาร')} className="input" />
            <input value={form.totalMedCost} onChange={(e) => setForm({ ...form, totalMedCost: e.target.value })} type="number" min="0" placeholder={t('livestock.finance.costMed', 'ค่ายา')} className="input" />
            <input value={form.totalUtilityCost} onChange={(e) => setForm({ ...form, totalUtilityCost: e.target.value })} type="number" min="0" placeholder={t('livestock.finance.costUtility', 'ค่าไฟ/น้ำ')} className="input" />
            <input value={form.totalRevenue} onChange={(e) => setForm({ ...form, totalRevenue: e.target.value })} type="number" min="0" placeholder={t('livestock.finance.revenue', 'รายได้')} className="input" />
          </div>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? '…' : t('livestock.finance.save', 'สร้างงวด')}</button>
        </div>
      )}

      <div className="card p-4 space-y-2">
        <div className="text-sm font-semibold text-gray-200">{t('livestock.finance.summary', 'สรุปบัญชี (ทุกงวด)')}</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-gray-900 rounded p-3"><div className="text-lg font-bold text-emerald-300">{fmtNum(totalRevenue, 0)}</div><div className="text-[11px] text-gray-400">{t('livestock.finance.totalRevenue', 'รายได้รวม {n} บาท', { n: '' })}</div></div>
          <div className="bg-gray-900 rounded p-3"><div className="text-lg font-bold text-amber-300">{fmtNum(totalCost, 0)}</div><div className="text-[11px] text-gray-400">{t('livestock.finance.totalCost', 'ต้นทุนรวม {n} บาท', { n: '' })}</div></div>
          <div className="bg-gray-900 rounded p-3"><div className={`text-lg font-bold ${totalRevenue - totalCost < 0 ? 'text-red-400' : 'text-emerald-300'}`}>{fmtNum(totalRevenue - totalCost, 0)}</div><div className="text-[11px] text-gray-400">{t('livestock.finance.netProfit', 'กำไรสุทธิ')}</div></div>
        </div>
      </div>

      {batches.length === 0 && <div className="card"><div className="flex flex-col items-center justify-center text-center py-12 px-6 gap-3"><div className="w-12 h-12 rounded-xl border border-gray-700 bg-gray-800/40 flex items-center justify-center text-gray-400"><Icon name="farm" size={20} /></div><div className="text-sm font-bold text-gray-100">{t('livestock.finance.noBatches', 'ยังไม่มีงวดบัญชี')}</div></div></div>}
      {batches.map((b) => (
        <div key={b.id} className="card card-hover p-4 space-y-2">
          <div className="flex justify-between items-center">
            <div className="font-bold text-white">{b.batchCode}</div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full border ${b.closedAt ? 'bg-gray-800 text-gray-400 border-gray-600' : 'bg-emerald-900/40 text-emerald-300 border-emerald-600/40'}`}>
                {b.closedAt ? t('livestock.finance.closed', 'ปิดงวด') : t('livestock.finance.open', 'ยังไม่ปิด')}
              </span>
              {!b.closedAt && canWrite && (
                <button onClick={() => closeBatch(b.id)} className="text-xs bg-sky-600/20 hover:bg-sky-600/40 text-sky-300 border border-sky-600/40 rounded px-2 py-0.5">{t('livestock.finance.closeBtn', 'ปิดงวด')}</button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs text-gray-400">
            <div>{t('livestock.finance.costAnimal', 'ต้นทุนสัตว์')}: <span className="text-gray-200">{fmtNum(b.initialAnimalCost, 0)}</span></div>
            <div>{t('livestock.finance.costFeed', 'ค่าอาหาร')}: <span className="text-gray-200">{fmtNum(b.totalFeedCost, 0)}</span></div>
            <div>{t('livestock.finance.costMed', 'ค่ายา')}: <span className="text-gray-200">{fmtNum(b.totalMedCost, 0)}</span></div>
            <div>{t('livestock.finance.costUtility', 'ค่าไฟ/น้ำ')}: <span className="text-gray-200">{fmtNum(b.totalUtilityCost, 0)}</span></div>
            <div>{t('livestock.finance.revenue', 'รายได้')}: <span className="text-gray-200">{fmtNum(b.totalRevenue, 0)}</span></div>
          </div>
          <div className={`text-sm font-bold ${b.netProfit < 0 ? 'text-red-400' : 'text-emerald-300'}`}>
            {b.netProfit >= 0 ? t('livestock.finance.profit', 'กำไร {n} บาท', { n: fmtNum(b.netProfit, 0) }) : t('livestock.finance.loss', 'ขาดทุน {n} บาท', { n: fmtNum(-b.netProfit, 0) })}
          </div>
        </div>
      ))}
    </div>
  );
}
