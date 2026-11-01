"use client";
// components/ecosystem/studio/TextStudio.tsx
// ────────────────────────────────────────────────────────────────────────────
// งานที่ 1 ของ Social Studio: "โพสต์ข้อความ" → Facebook เท่านั้น
//
// ทำไมแยกจากลงคลิป:
//   ข้อความกับวิดีโอเป็นคนละงาน คนละหน้าเว็บ คนละข้อจำกัด — ยัดรวมกันแล้วเจ้าของกดผิดตลอด
//
// ⚠ ความจริงที่ต้องบอกตรง ๆ: Facebook ไม่เปิดให้แอปบุคคลทั่วไปโพสต์แทนผ่าน API
//   (ต้องมี App Review + สิทธิ์ pages_manage_posts) ⇒ แอปเตรียมข้อความให้พร้อม
//   คัดลอกให้ แล้วเปิดหน้า Facebook — เหลือแค่ Ctrl+V กับกดโพสต์
//   ห้ามทำให้ผู้ใช้เข้าใจว่าแอปโพสต์ให้แล้ว (จะไม่มีอะไรขึ้นบน Facebook เลย)
// ────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { EcosystemAccount } from '../types';
import { postBridge } from './bridge';
import { copyVia } from './post-clipboard';
import {
  TEXT_DRAFT_KEY,
  TEXT_LIMITS,
  accountsForPlatform,
  buildTextPost,
  normalizeTextDraft,
  textPostStatus,
} from './studio-model';
import { Alert, BTN_GHOST, BTN_PRIMARY, Card, Counter, Hint, INPUT_CLS } from './ui';

const FB_HOME = 'https://www.facebook.com/';

export interface TextStudioProps {
  accounts: EcosystemAccount[];
  onAddAccount: (platform: string) => void;
}

export default function TextStudio({ accounts, onAddAccount }: TextStudioProps) {
  const options = useMemo(() => accountsForPlatform(accounts, 'facebook'), [accounts]);

  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [accountId, setAccountId] = useState('');
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'error' | 'warn' } | null>(null);

  // โหลดร่างใน effect เท่านั้น — prerender ฝั่งเซิร์ฟเวอร์ไม่มี localStorage
  useEffect(() => {
    let draft = { text: '', link: '', accountId: '' };
    try {
      const raw = window.localStorage.getItem(TEXT_DRAFT_KEY);
      if (raw) draft = normalizeTextDraft(JSON.parse(raw));
    } catch {
      /* ร่างเสียหาย/โหมดส่วนตัว — เริ่มจากว่างดีกว่าให้ทั้งหน้าพัง */
    }
    setText(draft.text);
    setLink(draft.link);
    setAccountId(draft.accountId);
    setReady(true);
  }, []);

  // บันทึกอัตโนมัติหลังโหลดเสร็จ (กันร่างเดิมถูกทับด้วยค่าว่าง)
  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(TEXT_DRAFT_KEY, JSON.stringify({ text, link, accountId }));
    } catch {
      /* พื้นที่เต็ม — ไม่ทำให้หน้าพัง */
    }
  }, [text, link, accountId, ready]);

  // บัญชีที่เลือกอาจถูกลบ/เก็บถาวรระหว่างเปิดหน้า — ถอยไปใช้ตัวแรกที่ยังใช้ได้
  const selected = options.find((o) => o.id === accountId) || options[0] || null;

  const body = buildTextPost(text, link);
  const status = textPostStatus(text, link, TEXT_LIMITS.facebook);

  const copy = useCallback(async () => {
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    const ok = await copyVia(nav, body);
    setMsg(
      ok
        ? { text: 'คัดลอกข้อความแล้ว — เปิด Facebook แล้ววางได้เลย (Ctrl+V)', kind: 'ok' }
        : { text: 'คัดลอกอัตโนมัติไม่ได้ — เลือกข้อความในตัวอย่างแล้วกด Ctrl+C', kind: 'warn' },
    );
  }, [body]);

  const openFacebook = useCallback(async () => {
    const account = accounts.find((a) => a.id === selected?.id);
    const own = String(account?.url || '').trim();
    const url = /^https:\/\/(www\.|web\.|m\.)?facebook\.com\//i.test(own) ? own : FB_HOME;

    const bridge = postBridge(typeof window === 'undefined' ? undefined : window);
    if (bridge) {
      const r = await bridge.openExternal(url);
      if (!r.ok) setMsg({ text: r.message || 'เปิด Facebook ไม่สำเร็จ', kind: 'error' });
      return;
    }
    const w = typeof window === 'undefined' ? null : window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) setMsg({ text: 'เบราว์เซอร์บล็อกป๊อปอัป — กรุณาอนุญาตแล้วกดอีกครั้ง', kind: 'warn' });
  }, [accounts, selected]);

  const clear = useCallback(() => {
    if (!window.confirm('ล้างข้อความที่พิมพ์ไว้ทั้งหมด?')) return;
    setText('');
    setLink('');
    setMsg({ text: 'ล้างข้อความแล้ว', kind: 'ok' });
  }, []);

  return (
    <div className="space-y-4">
      <Card
        title="โพสต์ในนาม"
        sub="ดึงบัญชี Facebook ที่ผูกไว้ใน Ecosystem — ไม่ต้องล็อกอินซ้ำ"
        right={
          <span className="rounded-full border border-slate-600 px-2.5 py-1 text-[11px] text-gray-400">
            {options.length} บัญชี
          </span>
        }
      >
        {options.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
            <p className="min-w-[220px] flex-1 text-xs text-amber-200">
              ยังไม่ได้ผูกบัญชี Facebook — เพิ่มอีเมลที่ใช้ล็อกอินก่อน แล้วสตูดิโอจะแสดงให้อัตโนมัติ
            </p>
            <button type="button" className={BTN_PRIMARY} onClick={() => onAddAccount('facebook')}>
              + เพิ่มบัญชี Facebook
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {options.map((o) => {
              const active = selected?.id === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setAccountId(o.id)}
                  className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                    active
                      ? 'border-[#1877f2]/70 bg-[#1877f2]/15 text-gray-100'
                      : 'border-slate-700 bg-slate-800/40 text-gray-300 hover:bg-slate-700/40'
                  }`}
                >
                  <span className="block text-sm font-medium">📘 {o.display}</span>
                  <span className="block text-[11px] text-gray-500">
                    {o.label && o.label !== o.display ? o.label : 'Facebook'}
                  </span>
                </button>
              );
            })}
            <button type="button" className={BTN_GHOST} onClick={() => onAddAccount('facebook')}>
              + เพิ่มบัญชี
            </button>
          </div>
        )}
        <Hint>
          บัญชีที่แสดงคือ “อีเมลที่คุณผูกไว้บนเครื่องนี้” — ถ้าอยากเปลี่ยนชื่อที่แสดง ให้แก้ในแท็บ “บัญชีของฉัน”
        </Hint>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card
          title="ข้อความที่จะโพสต์"
          sub="พิมพ์ครั้งเดียว — ลิงก์ (ถ้ามี) จะถูกต่อท้ายให้เอง"
          right={<Counter len={status.len} max={TEXT_LIMITS.facebook} />}
        >
          <textarea
            className={`${INPUT_CLS} min-h-[220px] resize-y leading-relaxed`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="เล่าเรื่องที่อยากแชร์ เช่น ความคืบหน้าของโปรเจ็ก งานที่เพิ่งส่ง หรือโปรโมชันใหม่"
          />
          <label className="block space-y-1">
            <span className="text-xs text-gray-400">ลิงก์แนบ (ไม่บังคับ)</span>
            <input
              className={INPUT_CLS}
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://…"
              inputMode="url"
            />
          </label>

          {status.missing && link.trim() && <Alert kind="warn">ยังไม่ได้พิมพ์ข้อความ — ใส่ข้อความก่อน แล้วค่อยแนบลิงก์</Alert>}
          {status.over > 0 && (
            <Alert kind="error">
              ยาวเกินเพดาน Facebook {status.over.toLocaleString('th-TH')} ตัว — ตัดออกก่อนโพสต์
            </Alert>
          )}
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_PRIMARY} onClick={copy} disabled={!body}>
              1) คัดลอกข้อความ
            </button>
            <button type="button" className={BTN_GHOST} onClick={openFacebook} disabled={!selected}>
              2) เปิด Facebook
            </button>
            <button type="button" className={BTN_GHOST} onClick={clear} disabled={!text && !link}>
              ล้างข้อความ
            </button>
          </div>
        </Card>

        <Card title="ตัวอย่างก่อนโพสต์" sub="เห็นแบบนี้ = วางบน Facebook แล้วได้แบบนี้">
          <div className="rounded-xl border border-[#1877f2]/30 bg-[#1877f2]/5 p-3">
            <div className="mb-2 flex items-center gap-2 border-b border-slate-700/60 pb-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1877f2] text-sm font-bold text-white">
                f
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-100">{selected?.display || 'ยังไม่ได้เลือกบัญชี'}</p>
                <p className="text-[11px] text-gray-500">โพสต์สาธารณะ · เมื่อสักครู่</p>
              </div>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-200">
              {body || 'ข้อความของคุณจะแสดงตรงนี้'}
            </p>
          </div>

          <ol className="space-y-1.5 text-xs text-gray-400">
            <li>1. กด “คัดลอกข้อความ”</li>
            <li>2. กด “เปิด Facebook” (ล็อกอินค้างไว้ได้เลย)</li>
            <li>3. วางด้วย Ctrl+V แล้วกดโพสต์</li>
          </ol>
          <Hint>
            แอปเตรียมข้อความให้พร้อมและเปิดหน้าที่ถูกต้อง — ขั้นกดโพสต์เป็นสิทธิ์ของคุณเอง
            (Facebook ไม่ให้แอปบุคคลทั่วไปโพสต์แทน) ร่างถูกบันทึกในเครื่องนี้อัตโนมัติ
          </Hint>
        </Card>
      </div>
    </div>
  );
}
