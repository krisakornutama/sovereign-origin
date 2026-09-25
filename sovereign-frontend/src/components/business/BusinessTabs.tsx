import { useState } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { getApiUrl } from '../../lib/config';
import Icon from '../ui/Icon';
import EmptyState from '../ui/EmptyState';
import { STATUS_TH, STATUS_CLS, StatusBadge, baht, POSITION_LABELS } from './shared';
import type { Product, Customer, Installation } from './shared';

// ── แท็บย่อยของ BusinessWorkspace (แยกจาก BusinessWorkspace — phase 3) ──
export function LedgerRow({ entry, canManage, base, reload, setNotice }: { entry: any; canManage: boolean; base: string; reload: () => Promise<void>; setNotice: (n: { ok: boolean; text: string } | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const editable = canManage && !entry.refOrderId;

  async function saveEdit() {
    const n = Number(amount);
    if (!n || n <= 0) { setNotice({ ok: false, text: 'ยอดเงินต้องมากกว่า 0' }); return; }
    setBusy(true);
    try {
      const r = await authFetch(`${base}/ledger/${entry.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: n }) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error ?? 'แก้ไขไม่สำเร็จ');
      setEditing(false);
      setNotice({ ok: true, text: 'แก้ไขรายการแล้ว' });
      await reload();
    } catch (e: any) { setNotice({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try {
      const r = await authFetch(`${base}/ledger/${entry.id}`, { method: 'DELETE' });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error ?? 'ลบไม่สำเร็จ');
      setNotice({ ok: true, text: 'ลบรายการแล้ว' });
      await reload();
    } catch (e: any) { setNotice({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-2 text-sm border-b border-slate-800 pb-1">
      <span className={`px-1.5 rounded text-[10px] ${entry.type === 'INCOME' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>{entry.type === 'INCOME' ? 'รับ' : 'จ่าย'}</span>
      <span className="text-slate-400 text-xs">{entry.category}</span>
      <span className="text-slate-300 flex-1 truncate">{editing ? (
        <input type="number" min={0.01} step="0.01" value={amount} autoFocus disabled={busy} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
          className="w-32 bg-slate-800 border border-cyan-600 rounded px-2 py-0.5 text-sm" aria-label="ยอดเงินใหม่" />
      ) : (entry.note ?? '')}</span>
      {entry.whtAmount > 0 && <span className="text-[10px] text-slate-500">WHT {baht(entry.whtAmount)}</span>}
      <span className={entry.type === 'INCOME' ? 'text-emerald-300' : 'text-rose-300'}>{entry.type === 'INCOME' ? '+' : '−'}{baht(entry.amount)}</span>
      {editable && !editing && (
        <>
          <button onClick={() => { setEditing(true); setAmount(String(entry.amount)); }} className="text-cyan-400 text-xs hover:underline" aria-label="แก้ไขรายการ">แก้</button>
          <button onClick={remove} disabled={busy} className="text-rose-400 text-xs hover:underline disabled:opacity-40" aria-label="ลบรายการ">ลบ</button>
        </>
      )}
      {editing && (
        <>
          <button onClick={saveEdit} disabled={busy} className="px-2 py-0.5 rounded bg-cyan-600/80 hover:bg-cyan-500 text-xs disabled:opacity-40">บันทึก</button>
          <button onClick={() => setEditing(false)} className="text-slate-400 text-xs hover:underline">ยกเลิก</button>
        </>
      )}
    </div>
  );
}

// ── Sub-components ──
export function ProductsTab({ products, canWrite, onAdded, onError, base, post }: any) {
  const [form, setForm] = useState({ sku: '', name: '', category: 'SENSOR', costPrice: '', salePrice: '', stockQty: '', reorderPoint: '3', warrantyMonths: '12', specs: '' });
  if (!canWrite) {
    return <div className="space-y-2">{products.map((p: Product) => (
      <div key={p.id} className="card p-3 flex flex-wrap items-center gap-2 text-sm"><span className="font-mono text-xs text-slate-400">{p.sku}</span><span>{p.name}</span><span className="ml-auto">{baht(p.salePrice)} · สต็อก {p.stockQty}</span></div>
    ))}</div>;
  }
  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="text-sm font-semibold">📦 เพิ่มสินค้า IoT</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <input placeholder="SKU เช่น ESP32-01" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="SKU" />
          <input placeholder="ชื่อสินค้า" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm sm:col-span-2" aria-label="ชื่อสินค้า" />
          <input placeholder="หมวด" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="หมวด" />
          <input type="number" placeholder="ราคาทุน" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ราคาทุน" />
          <input type="number" placeholder="ราคาขาย" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ราคาขาย" />
          <input type="number" placeholder="สต็อกเริ่ม" value={form.stockQty} onChange={(e) => setForm({ ...form, stockQty: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="สต็อก" />
          <input type="number" placeholder="จุดสั่งเติม" value={form.reorderPoint} onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="จุดสั่งเติม" />
          <input type="number" placeholder="รับประกัน (เดือน)" value={form.warrantyMonths} onChange={(e) => setForm({ ...form, warrantyMonths: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="รับประกัน" />
          <input placeholder="สเปคย่อ" value={form.specs} onChange={(e) => setForm({ ...form, specs: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="สเปค" />
        </div>
        <button onClick={async () => {
          if (!form.sku.trim()) { onError('กรอก SKU ก่อน'); return; }
          if (!form.name.trim()) { onError('กรอกชื่อสินค้าก่อน'); return; }
          if (Number(form.costPrice) < 0 || Number(form.salePrice) < 0) { onError('ราคาติดลบไม่ได้'); return; }
          try {
            const payload = { ...form, costPrice: Number(form.costPrice) || 0, salePrice: Number(form.salePrice) || 0, stockQty: Number(form.stockQty) || 0, reorderPoint: Number(form.reorderPoint) || 0, warrantyMonths: Number(form.warrantyMonths) || 0 };
            await post(`${base}/products`, payload);
            setForm({ sku: '', name: '', category: 'SENSOR', costPrice: '', salePrice: '', stockQty: '', reorderPoint: '3', warrantyMonths: '12', specs: '' });
            onAdded();
          } catch (e: any) { onError(/Unique constraint/i.test(e.message) ? 'SKU นี้มีอยู่แล้ว' : e.message); }
        }} className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium">เพิ่มสินค้า</button>
      </div>
      <div className="space-y-2">
        {products.map((p: Product) => (
          <div key={p.id} className="card p-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-xs text-slate-400">{p.sku}</span>
            <span className="font-medium">{p.name}</span>
            {p.stockQty <= p.reorderPoint && <span className="text-[10px] px-1.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">ใกล้หมด</span>}
            <span className="ml-auto text-slate-300">ทุน {baht(p.costPrice)} → ขาย {baht(p.salePrice)}</span>
            <span className="text-slate-400">สต็อก {p.stockQty}</span>
            <span className="text-slate-500 text-xs">รับประกัน {p.warrantyMonths} เดือน</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CustomersTab({ customers, canWrite, onAdded, onError, post, base }: any) {
  const [form, setForm] = useState({ name: '', phone: '', lineId: '', channel: 'ONLINE' });
  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="card p-4 space-y-3">
          <div className="text-sm font-semibold">👤 เพิ่มลูกค้า</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <input placeholder="ชื่อ" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ชื่อลูกค้า" />
            <input placeholder="เบอร์โทร" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="เบอร์โทร" />
            <input placeholder="LINE ID" value={form.lineId} onChange={(e) => setForm({ ...form, lineId: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="LINE ID" />
            <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ช่องทาง">
              <option value="ONLINE">ออนไลน์</option><option value="SHOP">หน้าร้าน</option><option value="B2B">B2B</option>
            </select>
          </div>
          <button onClick={async () => {
            if (!form.name.trim()) { onError('กรอกชื่อลูกค้า'); return; }
            try { await post(`${base}/customers`, form); setForm({ name: '', phone: '', lineId: '', channel: 'ONLINE' }); onAdded(); }
            catch (e: any) { onError(e.message); }
          }} className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium">เพิ่มลูกค้า</button>
        </div>
      )}
      <div className="space-y-2">
        {customers.length === 0 && <EmptyState title="ยังไม่มีลูกค้า" description="เพิ่มลูกค้าเพื่อผูกออเดอร์และประวัติการซื้อ" />}
        {customers.map((c: Customer) => (
          <div key={c.id} className="card p-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{c.name}</span>
            <span className="text-slate-400">{c.phone ?? ''}</span>
            <span className="ml-auto text-[10px] px-1.5 rounded bg-slate-700/50 text-slate-300">{c.channel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function InstallationsTab({ installations, canCreate, canWork, post, base, reload, setNotice }: any) {
  const [form, setForm] = useState({ title: '', scheduledAt: '' });
  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="card p-4 space-y-3">
          <div className="text-sm font-semibold">🔧 เปิดงานติดตั้ง</div>
          <div className="grid sm:grid-cols-2 gap-2">
            <input placeholder="ชื่องาน เช่น ติดตั้งเซ็นเซอร์โรงงาน A" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ชื่องานติดตั้ง" />
            <input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="วันนัดหมาย" />
          </div>
          <button onClick={async () => {
            if (!form.title.trim()) { setNotice({ ok: false, text: 'กรอกชื่องาน' }); return; }
            try { await post(`${base}/installations`, { title: form.title, scheduledAt: form.scheduledAt || undefined }); setForm({ title: '', scheduledAt: '' }); setNotice({ ok: true, text: 'เปิดงานติดตั้งแล้ว' }); await reload(); }
            catch (e: any) { setNotice({ ok: false, text: e.message }); }
          }} className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium">เปิดงาน</button>
        </div>
      )}
      <div className="space-y-2">
        {installations.length === 0 && <EmptyState title="ยังไม่มีงานติดตั้ง" description="งานติดตั้งหน้างานจะช่วยติดตามช่างและวันนัด" />}
        {installations.map((inst: Installation) => (
          <div key={inst.id} className="card p-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{inst.title}</span>
            <StatusBadge status={inst.status} />
            {inst.scheduledAt && <span className="text-xs text-slate-400">📅 {new Date(inst.scheduledAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
            <div className="ml-auto flex gap-1">
              {canWork && inst.status === 'TODO' && <button onClick={async () => { try { await post(`${base}/installations/${inst.id}/transition`, { action: 'start' }); await reload(); } catch (e: any) { setNotice({ ok: false, text: e.message }); } }} className="px-3 py-1 rounded bg-amber-600/80 hover:bg-amber-500 text-xs">เริ่มงาน</button>}
              {canWork && inst.status === 'IN_PROGRESS' && <button onClick={async () => { try { await post(`${base}/installations/${inst.id}/transition`, { action: 'complete' }); await reload(); } catch (e: any) { setNotice({ ok: false, text: e.message }); } }} className="px-3 py-1 rounded bg-emerald-600/80 hover:bg-emerald-500 text-xs">ปิดงาน</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LedgerForm({ post, base, reload, setNotice }: any) {
  const [form, setForm] = useState({ type: 'EXPENSE', category: 'RESTOCK', amount: '', note: '' });
  // ภาษีจากใบกำกับ — เว้นว่าง = ให้ระบบจัดการ (รายรับ: แยก VAT ให้เองตามอัตราร้าน)
  const [vat, setVat] = useState('');
  const [wht, setWht] = useState('');
  return (
    <div className="card p-4 space-y-3">
      <div className="text-sm font-semibold">✍️ บันทึกรายรับ-รายจ่าย</div>
      <div className="grid sm:grid-cols-4 gap-2">
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, category: e.target.value === 'INCOME' ? 'SALES' : 'RESTOCK' })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ประเภท">
          <option value="EXPENSE">รายจ่าย</option><option value="INCOME">รายรับ</option>
        </select>
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="หมวด">
          {form.type === 'EXPENSE'
            ? [['RESTOCK', 'ของเข้า'], ['TRANSPORT', 'ขนส่ง'], ['ADS', 'โฆษณา'], ['OTHER', 'อื่น ๆ']].map(([v, l]) => <option key={v} value={v}>{l}</option>)
            : [['SALES', 'ขาย'], ['OTHER', 'อื่น ๆ']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="number" placeholder="จำนวนเงิน (บาท)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="จำนวนเงิน" />
        <input placeholder="หมายเหตุ" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="หมายเหตุ" />
      </div>
      <div className="grid sm:grid-cols-3 gap-2">
        <input type="number" min={0} placeholder={form.type === 'EXPENSE' ? 'ภาษีซื้อ VAT (จากใบกำกับ)' : 'ภาษีขาย VAT (ว่าง = แยกให้เอง)'} value={vat} onChange={(e) => setVat(e.target.value)} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ยอด VAT" />
        <input type="number" min={0} placeholder="หัก ณ ที่จ่าย WHT (ถ้ามี)" value={wht} onChange={(e) => setWht(e.target.value)} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ภาษีหัก ณ ที่จ่าย" />
        <div className="text-[11px] text-slate-500 self-center">รายจ่าย: VAT จากใบกำกับซัพพลายเออร์ + WHT ที่เราหัก (ท.ป.4 · อัตราร่วม: ค่าจ้าง 3% · เช่า 5% · ขนส่ง 1%) · รายรับ: ว่าง = ระบบแยก VAT ตามอัตราร้าน</div>
      </div>
      <button onClick={async () => {
        const amount = Number(form.amount);
        if (!amount || amount <= 0) { setNotice({ ok: false, text: 'กรอกจำนวนเงิน' }); return; }
        const vatN = vat.trim() === '' ? undefined : Number(vat);
        const whtN = wht.trim() === '' ? undefined : Number(wht);
        if (vatN !== undefined && (Number.isNaN(vatN) || vatN < 0 || vatN > amount)) { setNotice({ ok: false, text: 'VAT ต้องเป็นตัวเลข 0 ถึงยอดเงิน' }); return; }
        if (whtN !== undefined && (Number.isNaN(whtN) || whtN < 0 || whtN > amount)) { setNotice({ ok: false, text: 'WHT ต้องเป็นตัวเลข 0 ถึงยอดเงิน' }); return; }
        try { await post(`${base}/ledger`, { ...form, amount, ...(vatN !== undefined ? { vatAmount: vatN } : {}), ...(whtN !== undefined && whtN > 0 ? { whtAmount: whtN } : {}) }); setForm({ ...form, amount: '', note: '' }); setVat(''); setWht(''); setNotice({ ok: true, text: 'บันทึกบัญชีแล้ว' }); await reload(); }
        catch (e: any) { setNotice({ ok: false, text: e.message }); }
      }} className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium">บันทึก</button>
    </div>
  );
}

export function AddMemberCard({ base, reload, setNotice }: any) {
  const [username, setUsername] = useState('');
  const [position, setPosition] = useState('SALES');
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!username.trim()) { setNotice({ ok: false, text: 'กรอกชื่อผู้ใช้' }); return; }
    setBusy(true);
    try {
      // หา userId จาก username ผ่าน user-lookup (SUPERADMIN) — ถ้าไม่ใช่ SUPERADMIN ให้ใส่ userId ตรง
      const r = await authFetch(`${getApiUrl()}/api/business/user-lookup`);
      let userId = username.trim();
      if (r.ok) {
        const users = await r.json();
        const hit = users.find((u: any) => u.username === username.trim());
        if (!hit) { setNotice({ ok: false, text: `ไม่พบผู้ใช้ "${username}"` }); setBusy(false); return; }
        userId = hit.id;
      }
      const res = await authFetch(`${base}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, position }) });
      const data = res.ok ? null : await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'เพิ่มไม่สำเร็จ');
      setNotice({ ok: true, text: `เพิ่มสมาชิก (${POSITION_LABELS[position] ?? position}) แล้ว` });
      setUsername('');
      await reload();
    } catch (e: any) { setNotice({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }
  return (
    <div className="card p-4 space-y-3">
      <div className="text-sm font-semibold">➕ เพิ่มสมาชิก</div>
      <div className="grid sm:grid-cols-3 gap-2">
        <input placeholder="ชื่อผู้ใช้ในระบบ" value={username} onChange={(e) => setUsername(e.target.value)} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ชื่อผู้ใช้" />
        <select value={position} onChange={(e) => setPosition(e.target.value)} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ตำแหน่ง">
          {Object.entries(POSITION_LABELS).filter(([k]) => k !== 'OWNER').map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <button onClick={add} disabled={busy} className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium disabled:opacity-40">เพิ่มเข้าธุรกิจ</button>
      </div>
    </div>
  );
}

