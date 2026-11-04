"use client";
// components/users/InviteCodesPanel.tsx
// จัดการรหัสเชิญสมัครสมาชิก (SUPERADMIN) — แทนการพิมพ์ CLI สำหรับคนที่ใช้ UI
// กติกา: plaintext ของรหัสเห็นครั้งเดียวตอนสร้าง (DB เก็บแค่ sha256) จึงต้องให้คัดลอกทันที
import { useEffect, useState } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { asObject } from '../../lib/fetchJson';

interface Invite {
  id: string;
  label: string | null;
  role: string;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const ROLES = ['OPERATOR', 'NODE_ADMIN', 'SITE_ADMIN', 'SYSTEM_AI', 'SUPERADMIN'];

function inviteState(inv: Invite): { text: string; cls: string } {
  if (inv.revoked_at) return { text: 'เพิกถอนแล้ว', cls: 'text-rose-400' };
  if (inv.expires_at && new Date(inv.expires_at).getTime() <= Date.now()) return { text: 'หมดอายุ', cls: 'text-amber-400' };
  if (inv.use_count >= inv.max_uses) return { text: 'ใช้ครบแล้ว', cls: 'text-gray-500' };
  return { text: 'ใช้ได้', cls: 'text-emerald-400' };
}

export default function InviteCodesPanel() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [role, setRole] = useState('OPERATOR');
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState(1);
  const [days, setDays] = useState(7);
  const [created, setCreated] = useState<{ code: string; role: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      const res = await authFetch('/api/users/invites');
      if (!res.ok) return;
      const data = await asObject(res);
      if (Array.isArray(data)) setInvites(data as unknown as Invite[]);
    } catch { /* เงียบ — ปุ่มรีเฟรชมีให้กด */ }
  }

  useEffect(() => { void load(); }, []);

  async function create() {
    setError('');
    setBusy(true);
    try {
      const res = await authFetch('/api/users/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, label: label || null, maxUses, expiresInHours: days > 0 ? days * 24 : 0 }),
      });
      const data = await asObject(res);
      if (!res.ok) {
        setError(String(data.error || 'สร้างรหัสเชิญไม่สำเร็จ'));
        return;
      }
      setCreated({ code: String(data.code), role: String(data.role) });
      setCopied(false);
      setLabel('');
      await load();
    } catch {
      setError('ติดต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm('เพิกถอนรหัสนี้? ผู้ที่ยังไม่สมัครจะใช้ไม่ได้อีก')) return;
    const res = await authFetch('/api/users/invites/' + id, { method: 'DELETE' });
    if (res.ok) await load();
  }

  const link = created ? (typeof window !== 'undefined' ? window.location.origin : '') + '/register?code=' + created.code : '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch { setCopied(false); }
  }

  return (
    <div className="panel panel-glow p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-bold text-gray-200">รหัสเชิญสมัครสมาชิก</h2>
          <p className="text-[11px] text-gray-500">สร้างลิงก์ให้ทีมสมัครเองได้ โดยไม่ต้องเปิดรับสมัครเสรี</p>
        </div>
        <button onClick={() => void load()} className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-300 hover:border-emerald-500/50">
          รีเฟรช
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
        <label className="space-y-1">
          <span className="text-[11px] text-gray-400">บทบาท</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="input w-full">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="space-y-1 md:col-span-2">
          <span className="text-[11px] text-gray-400">ชื่อเรียก (ไว้จำว่าให้ใคร)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="เช่น ทีมขาย / น้องเอ" className="input w-full" />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-gray-400">ใช้ได้กี่ครั้ง</span>
          <input type="number" min={1} max={100} value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} className="input w-full" />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-gray-400">หมดอายุใน (วัน)</span>
          <input type="number" min={0} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} className="input w-full" />
        </label>
      </div>

      <button onClick={() => void create()} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
        {busy ? 'กำลังสร้าง...' : 'สร้างรหัสเชิญ'}
      </button>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {created && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.07] p-3 space-y-2">
          <p className="text-[11px] text-emerald-300">รหัสนี้แสดงครั้งเดียว — คัดลอกเก็บไว้ก่อนปิดหน้านี้</p>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="font-mono text-lg tracking-wider text-emerald-200">{created.code}</code>
            <span className="text-[11px] text-gray-400">บทบาท {created.role}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input readOnly value={link} className="input flex-1 text-xs font-mono" onFocus={(e) => e.currentTarget.select()} />
            <button onClick={() => void copy()} className="text-xs px-2 py-1 rounded border border-emerald-500/40 text-emerald-300">
              {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}
            </button>
            <a href={link} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-300">เปิดหน้าสมัคร</a>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead className="text-gray-400">
            <tr>
              <th className="px-2 py-1">ชื่อเรียก</th>
              <th className="px-2 py-1">บทบาท</th>
              <th className="px-2 py-1">ใช้ไป</th>
              <th className="px-2 py-1">หมดอายุ</th>
              <th className="px-2 py-1">สถานะ</th>
              <th className="px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => {
              const st = inviteState(inv);
              return (
                <tr key={inv.id} className="border-t border-gray-800">
                  <td className="px-2 py-1 text-gray-300">{inv.label || '—'}</td>
                  <td className="px-2 py-1 text-gray-400">{inv.role}</td>
                  <td className="px-2 py-1 text-gray-400">{inv.use_count}/{inv.max_uses}</td>
                  <td className="px-2 py-1 text-gray-500">
                    {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString('th-TH') : 'ไม่หมดอายุ'}
                  </td>
                  <td className={'px-2 py-1 ' + st.cls}>{st.text}</td>
                  <td className="px-2 py-1 text-right">
                    {!inv.revoked_at && (
                      <button onClick={() => void revoke(inv.id)} className="text-rose-400 hover:underline">เพิกถอน</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {invites.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-center text-gray-500">ยังไม่มีรหัสเชิญ</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
