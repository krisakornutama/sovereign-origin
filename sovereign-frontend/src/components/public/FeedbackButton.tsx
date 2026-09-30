"use client";
// src/components/public/FeedbackButton.tsx
// ปุ่มฟีดแบ็กลอยสำหรับหน้าสาธารณะ (P: Publishing → ย้ายจาก pages/demo.tsx ตามกฎ import-layers)
//  หน้าที่ใช้: /demo · /shop · /community · /trace — ส่งเข้า POST /api/feedback (honeypot กันสแปม)
//  P10: กดเปิด = ยิง beacon feedback_open เข้า /api/track (พฤติกรรมผู้เยี่ยมชม)
import { useState, useCallback } from 'react';
import { getApiUrl } from '../../lib/config';
import { trackFeedbackOpen } from '../../lib/visitorTrack';

export function FeedbackButton({ page = '/demo' }: { page?: string }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState('general');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState(''); // honeypot — ซ่อนจากมนุษย์
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  const submit = useCallback(async () => {
    if (message.trim().length < 3) return;
    setState('sending');
    try {
      const res = await fetch(`${getApiUrl()}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, topic, message, senderEmail: email || undefined, website }),
      });
      if (!res.ok && res.status !== 202) throw new Error('send failed');
      setState('done');
      setMessage('');
      setEmail('');
      setTimeout(() => { setOpen(false); setState('idle'); }, 2200);
    } catch {
      setState('error');
    }
  }, [message, topic, email, website, page]);

  return (
    <>
      {!open && (
        <button type="button" onClick={() => { setOpen(true); trackFeedbackOpen(page); }}
          className="fixed bottom-5 right-5 z-40 px-4 py-2 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white text-sm shadow-lg shadow-cyan-950/50">
          💬 ส่งความคิดเห็น
        </button>
      )}
      {open && (
        <div className="fixed bottom-5 right-5 z-40 w-[min(92vw,22rem)] card p-4 space-y-2 border-cyan-500/40" role="dialog" aria-label="ส่งความคิดเห็น">
          <div className="flex items-center justify-between">
            <span className="font-ledger text-sm text-cyan-300">ความคิดเห็นของคุณ</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="ปิด" className="text-gray-500 hover:text-gray-300">✕</button>
          </div>
          {state === 'done' ? (
            <p className="text-sm text-emerald-400 py-2">ส่งแล้ว — ขอบคุณครับ 🙏</p>
          ) : (
            <>
              <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="หัวข้อ"
                className="w-full bg-gray-800/70 border border-gray-700 rounded-lg px-2 py-1.5 text-sm">
                <option value="general">ความเห็นทั่วไป</option>
                <option value="bug">พบปัญหา</option>
                <option value="feature">อยากได้ฟีเจอร์</option>
                <option value="question">สอบถาม</option>
              </select>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={2000}
                placeholder="เล่าให้ฟังหน่อยว่าอะไรดี อะไรควรแก้…" aria-label="ข้อความ"
                className="w-full bg-gray-800/70 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120}
                placeholder="อีเมล (ถ้าอยากให้ติดต่อกลับ — ไม่บังคับ)" aria-label="อีเมลผู้ส่ง"
                className="w-full bg-gray-800/70 border border-gray-700 rounded-lg px-2 py-1.5 text-xs" />
              {/* honeypot — ซ่อนจากมนุษย์ (bot ที่กรอกอัตโนมัติจะโดนทิ้งเงียบ ๆ) */}
              <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1}
                autoComplete="off" aria-hidden="true"
                className="absolute -left-[9999px] h-0 w-0 opacity-0" />
              <div className="flex items-center justify-between">
                {state === 'error' ? <span className="text-[11px] text-rose-400">ส่งไม่สำเร็จ — ลองใหม่</span> : <span />}
                <button type="button" onClick={submit} disabled={state === 'sending' || message.trim().length < 3}
                  className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm">
                  {state === 'sending' ? 'กำลังส่ง…' : 'ส่ง'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

export default FeedbackButton;
