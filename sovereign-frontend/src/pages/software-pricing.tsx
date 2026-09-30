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
// /software-pricing — หน้าจัดการขายซอฟต์แวร์แยกชิ้น (SUPERADMIN)
//  ดึง "ข้อมูลฟังก์ชันจริง" ต่อโมดูล (endpoints/LOC/ชุดทดสอบ) จากการสแกนโค้ดจริง
//  → ใช้กำหนดราคาขาย (มีราคาแนะนำจากสูตรโปร่งใส) → กด publish = ขึ้นหน้าร้านทันที
// ────────────────────────────────────────────────────────────────────────────

interface Facts { key: string; endpoints: number; loc: number; routeFiles: number; serviceFiles: number; testRefs: number; suggestedPrice: number; }
interface Row {
  sku: string; moduleKey: string; productId: string | null; name: string; category: string; specs: string;
  costPrice: number; salePrice: number; suggestedPrice: number; isActive: boolean; published: boolean; facts: Facts;
}
interface Payload { rows: Row[]; businessId: string | null; scannedAt: string; }

const baht = (n: number) => `${Number(n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })} ฿`;

export default function SoftwarePricingPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [data, setData] = useState<Payload | null>(null);
  const [filter, setFilter] = useState('');
  const [onlyUnpublished, setOnlyUnpublished] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [edits, setEdits] = useState<Record<string, { name: string; salePrice: string; specs: string }>>({});

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/software/scan`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e: any) {
      setMsg(e.message);
    }
  }, []);

  useEffect(() => {
    if (isHydrated && isAuthenticated) load();
  }, [isHydrated, isAuthenticated, load]);

  async function publish(row: Row) {
    const e = edits[row.sku] ?? { name: row.name, salePrice: String(row.salePrice), specs: row.specs };
    setBusy(row.sku);
    setMsg('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/software/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moduleKey: row.moduleKey,
          name: e.name,
          specs: e.specs,
          salePrice: Number(e.salePrice) || row.facts.suggestedPrice,
          costPrice: row.costPrice || 0,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      setMsg(`✓ เปิดขาย ${row.sku} แล้ว — ขึ้นหน้าร้านทันที`);
      await load();
    } catch (e: any) {
      setMsg(`✗ ${e.message}`);
    } finally {
      setBusy('');
    }
  }

  async function unpublish(row: Row) {
    setBusy(row.sku);
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/software/unpublish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleKey: row.moduleKey }),
      });
      setMsg(`✓ ปิดขาย ${row.sku} (ข้อมูลคงอยู่)`);
      await load();
    } catch (e: any) {
      setMsg(`✗ ${e.message}`);
    } finally {
      setBusy('');
    }
  }

  if (!isHydrated) return <div className="text-white p-8">{t('common.loading', 'กำลังโหลด...')}</div>;
  if (!isAuthenticated || !user) return <div className="text-white p-8">Unauthorized</div>;
  if (!roleIsSuperadmin(user.role)) {
    return <div className="min-h-screen bg-gray-950 text-gray-100 p-8">หน้านี้ใช้ได้เฉพาะ SUPERADMIN</div>;
  }

  const rows = (data?.rows ?? []).filter((r) =>
    (onlyUnpublished ? !r.published : true) &&
    (filter.trim() ? `${r.moduleKey} ${r.name} ${r.sku}`.toLowerCase().includes(filter.trim().toLowerCase()) : true),
  );
  const publishedCount = (data?.rows ?? []).filter((r) => r.published).length;

  return (
    <div className="atmo-system min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader
          eyebrow="ธุรกิจ"
          title="ขายซอฟต์แวร์แยกชิ้น — ตั้งราคาจากข้อมูลจริง"
          icon={<Icon name="package" size={18} />}
          subtitle={`สแกนโค้ดจริง ${data?.rows.length ?? 0} โมดูล · เปิดขายแล้ว ${publishedCount} · ราคาแนะนำจาก endpoints+LOC+ชุดทดสอบ`}
          actions={
            <div className="flex gap-3 items-center">
              {msg && <span className="text-xs text-cyan-300 max-w-xs truncate">{msg}</span>}
              <button onClick={load} className="text-sm px-3 py-1.5 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800/40">สแกนใหม่</button>
            </div>
          }
        />
        <main className="flex-1 p-4 lg:p-6 max-w-7xl mx-auto w-full space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="ค้นโมดูล เช่น farm, livestock…"
              className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-1.5 text-sm w-64" aria-label="ค้นหาโมดูล" />
            <label className="text-xs text-gray-400 flex items-center gap-1.5">
              <input type="checkbox" checked={onlyUnpublished} onChange={(e) => setOnlyUnpublished(e.target.checked)} />
              เฉพาะที่ยังไม่เปิดขาย
            </label>
          </div>

          <div className="space-y-2">
            {rows.map((r) => {
              const e = edits[r.sku] ?? { name: r.name, salePrice: String(r.salePrice), specs: r.specs };
              const setE = (patch: Partial<typeof e>) => setEdits((s) => ({ ...s, [r.sku]: { ...e, ...patch } }));
              const gap = r.salePrice - r.facts.suggestedPrice;
              return (
                <div key={r.sku} className={`card p-3 space-y-2 ${r.published ? 'border-emerald-700/40' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono text-[11px] text-gray-500">{r.sku}</span>
                    <span className="text-sm text-gray-200 font-medium">{r.moduleKey}</span>
                    {r.published ? (
                      <span className="text-[10px] border border-emerald-500/40 text-emerald-400 rounded px-1.5 py-0.5">เปิดขายอยู่</span>
                    ) : (
                      <span className="text-[10px] border border-gray-700 text-gray-500 rounded px-1.5 py-0.5">ยังไม่เปิดขาย</span>
                    )}
                    <span className="ml-auto flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500 mono">
                      <span>{r.facts.endpoints} endpoints</span>
                      <span>{r.facts.loc.toLocaleString('th-TH')} บรรทัด</span>
                      <span>{r.facts.routeFiles} route files</span>
                      <span>{r.facts.testRefs > 0 ? <span className="text-emerald-500/80">{r.facts.testRefs} ชุดทดสอบ</span> : <span className="text-amber-500/80">ไม่มีเทสต์</span>}</span>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-0.5">ชื่อที่โชว์บนหน้าร้าน</label>
                      <input value={e.name} onChange={(ev) => setE({ name: ev.target.value })}
                        className="bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1 text-sm w-72" aria-label={`ชื่อสินค้า ${r.sku}`} />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-0.5">สเปค (โชว์บนหน้าร้าน)</label>
                      <input value={e.specs} onChange={(ev) => setE({ specs: ev.target.value })}
                        className="bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1 text-xs w-96 max-w-full" aria-label={`สเปค ${r.sku}`} />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-0.5">
                        ราคาขาย (แนะนำ {baht(r.facts.suggestedPrice)}
                        {r.published && gap !== 0 && <span className={gap > 0 ? ' text-emerald-500/80' : ' text-amber-500/80'}> · ต่าง {gap > 0 ? '+' : ''}{baht(gap)}</span>})
                      </label>
                      <input type="number" min="0" value={e.salePrice} onChange={(ev) => setE({ salePrice: ev.target.value })}
                        className="bg-gray-800/60 border border-gray-700 rounded-lg px-2 py-1 text-sm mono w-28" aria-label={`ราคา ${r.sku}`} />
                    </div>
                    <button onClick={() => (r.published ? unpublish(r) : publish(r))} disabled={busy === r.sku}
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 ${r.published
                        ? 'border border-rose-600/50 text-rose-400 hover:bg-rose-950/40'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}>
                      {busy === r.sku ? '…' : r.published ? 'ปิดขาย' : 'เปิดขาย'}
                    </button>
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && <div className="card p-6 text-sm text-gray-500">ไม่มีโมดูลตรงเงื่อนไข</div>}
          </div>
        </main>
      </div>
    </div>
  );
}
