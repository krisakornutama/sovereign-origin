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
// ────────────────────────────────────────────────────────────────────────────

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
