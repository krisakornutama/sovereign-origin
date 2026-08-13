"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import type { InventoryItem } from '../types';

const CATEGORIES = ['WATER', 'FOOD', 'FUEL', 'MATERIAL', 'PRECIOUS_METAL', 'OTHER'];

const CATEGORY_ICON: Record<string, string> = {
  WATER: '💧',
  FOOD: '🍚',
  FUEL: '⛽',
  MATERIAL: '🧱',
  PRECIOUS_METAL: '🥇',
  OTHER: '📦',
};

const STATUS_LABEL: Record<string, string> = {
  ok: 'ปกติ',
  expiring: 'ใกล้หมดอายุ',
  expired: 'หมดอายุแล้ว',
  na: 'ไม่มีวันหมดอายุ',
};

const STATUS_COLOR: Record<string, string> = {
  ok: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  expiring: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  expired: 'bg-red-500/15 text-red-300 border-red-500/30',
  na: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

const EMPTY_FORM = {
  name: '',
  category: 'OTHER',
  quantity: '',
  unit: 'ชิ้น',
  unit_price_usd: '',
  location: '',
  expiry_date: '',
  shelf_life_days: '',
  minimum_stock: '',
  notes: '',
};

interface ScanLabel {
  name: string;
  category: string;
  quantity: number | null;
  unit: string;
  unit_price_usd: number | null;
  expiry_date: string | null;
  shelf_life_days: number | null;
  notes: string | null;
  warnings: string[];
}

export default function InventoryPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [category, setCategory] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [lowOnly, setLowOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const [scanOpen, setScanOpen] = useState(false);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanLabel, setScanLabel] = useState<ScanLabel | null>(null);
  const [scanForm, setScanForm] = useState(EMPTY_FORM);

  const canWrite = user?.role === 'SUPERADMIN' || user?.role === 'NODE_ADMIN' || user?.role === 'OPERATOR';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (category !== 'ALL') params.set('category', category);
      if (status !== 'ALL') params.set('status', status);
      if (lowOnly) params.set('low', 'true');
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/inventory?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setItems(body.items ?? []);
    } catch (e: any) {
      setError(e.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [category, status, lowOnly]);

  useEffect(() => {
    if (isAuthenticated) load();
  }, [isAuthenticated, load]);

  // รอ hydration ก่อน (SSR กับ first client render ต้องตรงกัน ไม่งั้น React hydration
  // error → หน้าเข้าวง "Unauthorized" ค้าง) — แพทเทิร์นเดียวกับหน้าที่ทำกันทั่วแอป
  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">⏳ Loading...</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">Unauthorized</div>;
  }

  const create = async () => {
    if (!form.name.trim()) return setMessage('⚠️ ต้องระบุชื่อรายการ');
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        category: form.category,
        quantity: form.quantity === '' ? 0 : Number(form.quantity),
        unit: form.unit || 'ชิ้น',
        unit_price_usd: form.unit_price_usd === '' ? 0 : Number(form.unit_price_usd),
        notes: form.notes || null,
      };
      if (form.location) body.location = form.location;
      if (form.expiry_date) body.expiry_date = form.expiry_date;
      if (form.shelf_life_days) body.shelf_life_days = Number(form.shelf_life_days);
      if (form.minimum_stock) body.minimum_stock = Number(form.minimum_stock);

      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');
      setMessage(`✅ เพิ่ม "${form.name}" แล้ว`);
      setForm(EMPTY_FORM);
      load();
    } catch (e: any) {
      setError(e.message || 'เกิดข้อผิดพลาด');
    } finally {
      setSaving(false);
    }
  };

  const scanPickFile = (f: File | null) => {
    setScanFile(f);
    setScanError('');
    setScanLabel(null);
    if (scanPreview) URL.revokeObjectURL(scanPreview);
    setScanPreview(f ? URL.createObjectURL(f) : null);
  };

  const runScan = async () => {
    if (!scanFile || scanLoading) return;
    setScanLoading(true);
    setScanError('');
    try {
      const fd = new FormData();
      fd.append('image', scanFile as Blob);
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/documents/analyze`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      setScanLabel(data);
      setScanForm({
        name: data.name ?? '',
        category: data.category ?? 'OTHER',
        quantity: data.quantity != null ? String(data.quantity) : '',
        unit: data.unit || 'ชิ้น',
        unit_price_usd: data.unit_price_usd != null ? String(data.unit_price_usd) : '',
        location: '',
        expiry_date: data.expiry_date ?? '',
        shelf_life_days: data.shelf_life_days != null ? String(data.shelf_life_days) : '',
        minimum_stock: '',
        notes: data.notes ?? '',
      });
    } catch (e: any) {
      setScanError(e.message || 'วิเคราะห์ฉลากไม่สำเร็จ');
    } finally {
      setScanLoading(false);
    }
  };

  const saveScan = async () => {
    if (!scanForm.name.trim()) return setScanError('ต้องระบุชื่อรายการ');
    if (scanLoading) return;
    setScanLoading(true);
    setScanError('');
    try {
      const parsed: Record<string, unknown> = {
        name: scanForm.name.trim(),
        category: scanForm.category,
        quantity: scanForm.quantity === '' ? 0 : Number(scanForm.quantity),
        unit: scanForm.unit || 'ชิ้น',
        unit_price_usd: scanForm.unit_price_usd === '' ? 0 : Number(scanForm.unit_price_usd),
        expiry_date: scanForm.expiry_date || null,
        shelf_life_days: scanForm.shelf_life_days === '' ? null : Number(scanForm.shelf_life_days),
        notes: scanForm.notes || null,
      };
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/documents/scan-to-inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');
      setMessage(`📷 สแกนฉลาก → เพิ่ม "${scanForm.name}" แล้ว`);
      setScanOpen(false);
      setScanLabel(null);
      setScanFile(null);
      if (scanPreview) URL.revokeObjectURL(scanPreview);
      setScanPreview(null);
      load();
    } catch (e: any) {
      setScanError(e.message || 'เกิดข้อผิดพลาด');
    } finally {
      setScanLoading(false);
    }
  };

  const remove = async (item: InventoryItem) => {
    if (!window.confirm(`ลบ "${item.name}" ออกจากสต็อก?`)) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/inventory/${item.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('ลบไม่สำเร็จ');
      setMessage(`🗑️ ลบ "${item.name}" แล้ว`);
      load();
    } catch (e: any) {
      setError(e.message || 'เกิดข้อผิดพลาด');
    }
  };

  const totalValue = items.reduce((sum, i) => sum + (i.quantity ?? 0) * (i.unit_price_usd ?? 0), 0);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow="ชีวิต &amp; การเงิน"
          title="🏰 SOVEREIGN OS"
          subtitle="Inventory &amp; Supplies" actions={<div className="flex gap-3 items-center">
            <a href="/dashboard" className="text-sm text-blue-400 hover:underline">📊 Dashboard</a>
          </div>}
        />
      </header>

        <main className="max-w-7xl mx-auto p-6 space-y-4 w-full">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">📦 เสบียง & สต็อกสินค้า</h2>
            <div className="text-sm text-gray-400">
              รายการ {items.length} รายการ · มูลค่า <span className="text-emerald-300 font-bold">${totalValue.toFixed(2)}</span>
            </div>
          </div>

          {error && <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded px-4 py-2 text-sm">{error}</div>}
          {message && <div className="bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 rounded px-4 py-2 text-sm">{message}</div>}

          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm">
              <option value="ALL">ทุกหมวด</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_ICON[c]} {c}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm">
              <option value="ALL">ทุกสถานะ</option>
              <option value="ok">ปกติ</option>
              <option value="expiring">ใกล้หมดอายุ</option>
              <option value="expired">หมดอายุ</option>
              <option value="no-expiry">ไม่มีวันหมดอายุ</option>
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="accent-emerald-500" />
              สต็อกต่ำกว่าเกณฑ์
            </label>
            <button onClick={load} className="ml-auto bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200">
              🔄 รีโหลด
            </button>
          </div>

          {/* Add form */}
          {canWrite && (
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-cyan-300">➕ เพิ่มของเข้าสต็อก</div>
                <button onClick={() => { setScanOpen(true); setScanError(''); }} className="text-xs px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded font-bold">
                  📷 สแกนฉลาก (AI)
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ชื่อรายการ *" className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm col-span-2" />
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="จำนวน *" type="number" min="0" className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
                <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="หน่วย (ลิตร/กก./ชิ้น)" className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
                <input value={form.unit_price_usd} onChange={(e) => setForm({ ...form, unit_price_usd: e.target.value })} placeholder="ราคา/หน่วย ($)" type="number" min="0" className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
                <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="ที่เก็บ (ห้อง/ตู้)" className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
                <input value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} type="date" className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
                <input value={form.shelf_life_days} onChange={(e) => setForm({ ...form, shelf_life_days: e.target.value })} placeholder="อายุใช้งาน (วัน) → คำนวณวันหมดอายุ" type="number" min="1" className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
                <input value={form.minimum_stock} onChange={(e) => setForm({ ...form, minimum_stock: e.target.value })} placeholder="สต็อกขั้นต่ำ (แจ้งเตือน)" type="number" min="0" className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="หมายเหตุ" className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
              </div>
              <button onClick={create} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded px-4 py-2 text-sm font-bold">
                {saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
          )}

          {/* Table */}
          {loading ? (
            <div className="text-gray-500 text-center py-12">กำลังโหลด…</div>
          ) : items.length === 0 ? (
            <div className="text-gray-500 text-center py-12 border border-dashed border-gray-700 rounded-xl">ไม่มีรายการ</div>
          ) : (
            <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-700 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3">รายการ</th>
                    <th className="px-4 py-3">หมวด</th>
                    <th className="px-4 py-3 text-right">จำนวน</th>
                    <th className="px-4 py-3 text-right">มูลค่า ($)</th>
                    <th className="px-4 py-3">ที่เก็บ</th>
                    <th className="px-4 py-3">วันหมดอายุ</th>
                    <th className="px-4 py-3">สถานะ</th>
                    <th className="px-4 py-3">สต็อก</th>
                    {canWrite && <th className="px-4 py-3"></th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b border-gray-800 hover:bg-gray-800/40">
                      <td className="px-4 py-3 font-semibold">
                        {item.name}
                        {item.notes && <div className="text-xs text-gray-500 font-normal">{item.notes}</div>}
                      </td>
                      <td className="px-4 py-3">{CATEGORY_ICON[item.category] ?? '📦'} {item.category}</td>
                      <td className="px-4 py-3 text-right">{item.quantity.toLocaleString()} {item.unit}</td>
                      <td className="px-4 py-3 text-right text-emerald-300">${((item.quantity ?? 0) * (item.unit_price_usd ?? 0)).toFixed(2)}</td>
                      <td className="px-4 py-3 text-gray-400">{item.location ?? '—'}</td>
                      <td className="px-4 py-3">{item.expiry.date ? new Date(item.expiry.date).toLocaleDateString('th-TH') : '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs border ${STATUS_COLOR[item.expiry.status] ?? STATUS_COLOR.na}`}>
                          {STATUS_LABEL[item.expiry.status] ?? item.expiry.status}
                          {item.expiry.daysLeft != null && item.expiry.status !== 'expired' && item.expiry.status !== 'na' && ` (${item.expiry.daysLeft} วัน)`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {item.lowStock ? <span className="text-red-400">⚠️ ต่ำกว่าเกณฑ์</span> : <span className="text-gray-500">OK</span>}
                      </td>
                      {canWrite && (
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => remove(item)} className="text-red-400 hover:text-red-300 text-xs">🗑️</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── สแกนฉลาก Modal (P5) ── */}
          {scanOpen && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-blue-300">📷 สแกนฉลากด้วย AI (qwen3-vl)</h3>
                  <button onClick={() => { setScanOpen(false); setScanLabel(null); setScanFile(null); if (scanPreview) URL.revokeObjectURL(scanPreview); setScanPreview(null); }} className="text-gray-400 hover:text-white text-sm">✖ ปิด</button>
                </div>

                {!scanLabel ? (
                  <>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => scanPickFile(e.target.files?.[0] ?? null)}
                      className="block w-full text-sm text-gray-400 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600"
                    />
                    {scanPreview && <img src={scanPreview} alt="scan preview" className="max-h-60 rounded-lg border border-gray-700 object-contain bg-black mx-auto" />}
                    <div className="flex gap-2 items-center">
                      <button onClick={runScan} disabled={!scanFile || scanLoading} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded text-sm font-bold">
                        {scanLoading ? '👁️ AI กำลังอ่านฉลาก...' : '🔍 วิเคราะห์ฉลาก'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {scanLabel.warnings.length > 0 && (
                      <div className="bg-amber-900/30 border border-amber-800 text-amber-300 rounded p-3 text-xs space-y-1">
                        {scanLabel.warnings.map((w) => <div key={w}>⚠️ {w}</div>)}
                      </div>
                    )}
                    <div className="flex gap-4 items-start">
                      {scanPreview && <img src={scanPreview} alt="scan preview" className="w-32 h-32 rounded border border-gray-700 object-contain bg-black shrink-0" />}
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 flex-1">
                        <input value={scanForm.name} onChange={(e) => setScanForm({ ...scanForm, name: e.target.value })} placeholder="ชื่อรายการ *" className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm col-span-2" />
                        <select value={scanForm.category} onChange={(e) => setScanForm({ ...scanForm, category: e.target.value })} className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm">
                          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input value={scanForm.quantity} onChange={(e) => setScanForm({ ...scanForm, quantity: e.target.value })} placeholder="จำนวน" type="number" min="0" className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
                        <input value={scanForm.unit} onChange={(e) => setScanForm({ ...scanForm, unit: e.target.value })} placeholder="หน่วย" className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
                        <input value={scanForm.unit_price_usd} onChange={(e) => setScanForm({ ...scanForm, unit_price_usd: e.target.value })} placeholder="ราคา/หน่วย ($)" type="number" min="0" className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
                        <input value={scanForm.expiry_date} onChange={(e) => setScanForm({ ...scanForm, expiry_date: e.target.value })} type="date" className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
                        <input value={scanForm.shelf_life_days} onChange={(e) => setScanForm({ ...scanForm, shelf_life_days: e.target.value })} placeholder="อายุเก็บ (วัน)" type="number" min="1" className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
                        <input value={scanForm.notes} onChange={(e) => setScanForm({ ...scanForm, notes: e.target.value })} placeholder="หมายเหตุ" className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
                      </div>
                    </div>
                    {scanError && <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded px-4 py-2 text-sm">{scanError}</div>}
                    <div className="flex gap-2">
                      <button onClick={saveScan} disabled={scanLoading} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-sm font-bold">
                        {scanLoading ? 'กำลังบันทึก...' : '✅ ยืนยันบันทึกเข้ารายการ'}
                      </button>
                      <button onClick={() => { setScanLabel(null); setScanForm(EMPTY_FORM); }} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm">
                        🔄 สแกนใหม่
                      </button>
                    </div>
                  </>
                )}
                {scanError && !scanLabel && <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded px-4 py-2 text-sm">{scanError}</div>}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}