"use client";
// components/business/soverien/TelegramNotifyCard.tsx
// ตั้งค่า "แจ้งเตือนเข้าห้อง Telegram" สำหรับข้อมูลธุรกิจ (16/10/69)
//
// เจ้าของ: "ในส่วนของติดตาม เพิ่มในส่วนของการแจ้งเตือนจาก telegram …ให้ผมใส่รหัสห้องก็ได้"
//   → ใช้บอทตัวเดียวกับที่ระบบใช้อยู่แล้ว แต่ส่งไปห้องนี้เท่านั้น (ไม่ปนกับเรื่องเทคนิค)
//   → token อยู่ฝั่งเซิร์ฟเวอร์ หน้านี้ไม่ต้องกรอกและไม่เห็น token
import { useCallback, useEffect, useState } from 'react';
import type { Db } from './types';
import { Card, Notice, inputCls } from './ui';
import { warrantyState, thaiDate } from './store';
import { authFetch } from '../../../lib/apiFetch';
import { getApiUrl } from '../../../lib/config';
import {
  createBizNotifier, buildTrackingDigest, validateChatId, type BizStatus,
} from './telegram-notify';

// สูตรจริงจาก store — ส่งเข้าไปให้ logic ที่อยู่ใน telegram-notify.ts ทดสอบได้ (ดูคอมเมนต์ที่นั่น)
const DEPS = { warrantyState, thaiDate };
const notifier = createBizNotifier({ authFetch, apiUrl: getApiUrl() });

export default function TelegramNotifyCard({ db }: { db: Db }) {
  const [status, setStatus] = useState<BizStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [chatId, setChatId] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const s = await notifier.fetchBizStatus();
    setStatus(s);
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    const bad = validateChatId(chatId);
    if (bad) { setMsg({ ok: false, text: bad }); return; }
    setBusy(true); setMsg(null);
    const r = await notifier.saveBizChatId(chatId);
    if (!r.ok) {
      setMsg({ ok: false, text: r.error || 'บันทึกไม่สำเร็จ (ถ้ายังไม่ล็อกอิน ให้ล็อกอินในแอปก่อน)' });
    } else {
      setMsg({ ok: true, text: `บันทึกห้องแล้ว (••••${chatId.replace('-', '').slice(-3)})` });
      await load();
    }
    setBusy(false);
  };

  const test = async () => {
    setBusy(true); setMsg(null);
    const target = validateChatId(chatId) ? undefined : chatId;   // ยังไม่ได้พิมพ์ = ใช้ห้องที่บันทึกไว้
    const r = await notifier.testBizNotify(target);
    setMsg(r.ok
      ? { ok: true, text: 'ส่งข้อความทดสอบแล้ว — ลองเช็คห้อง Telegram ดูครับ' }
      : { ok: false, text: `ส่งไม่สำเร็จ: ${r.error || 'ไม่ทราบสาเหตุ'}` });
    setBusy(false);
  };

  const sendDigest = async () => {
    setBusy(true); setMsg(null);
    const d = buildTrackingDigest(db, DEPS);
    const ok = await notifier.notifyBiz(d.isEmpty ? 'info' : 'warranty', d.title, d.detail);
    setMsg(ok
      ? { ok: true, text: d.isEmpty ? 'ส่งสรุปแล้ว (ไม่มีรายการค้าง)' : 'ส่งรายการที่ต้องติดตามเข้าห้องแล้ว' }
      : { ok: false, text: 'ส่งไม่สำเร็จ — ยังไม่ได้ตั้งห้อง หรือยังไม่ได้ล็อกอิน' });
    setBusy(false);
  };

  return (
    <Card
      title="🔔 แจ้งเตือนเข้าห้อง Telegram"
      sub="ใช้บอทเดียวกับที่ระบบใช้อยู่ แต่ส่งไปห้องนี้เฉพาะข้อมูลธุรกิจ"
    >
      {!loaded ? (
        <p className="text-xs text-gray-500">กำลังตรวจสถานะ…</p>
      ) : !status?.hasBotToken ? (
        <Notice kind="err">
          ยังไม่ได้ตั้งบอท Telegram ของระบบ — ให้ตั้งที่หน้า ⚙️ Telegram ก่อน แล้วกลับมาตั้งห้องนี้
        </Notice>
      ) : (
        <>
          <div className="space-y-2">
            <label className="block text-xs text-gray-400">
              หมายเลขห้อง (Chat ID)
              <input
                className={`${inputCls} mt-1 w-full`}
                inputMode="numeric"
                placeholder="-1001234567890"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
              />
            </label>
            <p className="text-[11px] text-gray-500">
              ห้องที่ตั้งไว้: <span className="text-gray-300">{status.bizChatIdMasked || 'ยังไม่ได้ตั้ง'}</span>
              {status.tokenMask && <> · บอท {status.tokenMask}</>}
            </p>
            <p className="text-[11px] text-gray-500">
              วิธีหาหมายเลขห้อง: เพิ่มบอท <b>@SovereignOS_Alert_bot</b> เข้าห้องก่อน
              แล้วส่งข้อความอะไรก็ได้ 1 ข้อความ — บอทจะได้รับหมายเลขห้องนั้น
            </p>
          </div>

          {msg && <div className="pt-2"><Notice kind={msg.ok ? 'ok' : 'err'}>{msg.text}</Notice></div>}

          <div className="flex flex-wrap gap-2 pt-3">
            <button
              type="button"
              onClick={save} disabled={busy}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-gray-950 hover:bg-emerald-500 disabled:opacity-50"
            >
              บันทึกห้อง
            </button>
            <button
              type="button"
              onClick={test} disabled={busy || !status.ready}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-slate-800 disabled:opacity-40"
            >
              ส่งข้อความทดสอบ
            </button>
            <button
              type="button"
              onClick={sendDigest} disabled={busy || !status.ready}
              className="rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40"
            >
              ส่งรายการที่ต้องติดตาม
            </button>
          </div>
          {!status.ready && (
            <p className="pt-2 text-[11px] text-amber-400">
              ยังส่งไม่ได้ — ต้องบันทึกหมายเลขห้องให้เรียบร้อยก่อน
            </p>
          )}
        </>
      )}
    </Card>
  );
}
