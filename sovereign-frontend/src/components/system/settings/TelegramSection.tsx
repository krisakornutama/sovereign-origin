"use client";
// ── Telegram Alerts — ตั้งค่า bot token / chat ID ผ่าน UI (บันทึกลง DB, ไม่ต้องแตะ .env) ──
import { useState, useEffect } from 'react';
import { authFetch } from '../../../lib/apiFetch';
import { getApiUrl } from '../../../lib/config';
import { useLanguageStore } from '../../../stores/useLanguageStore';
import Icon from '../../ui/Icon';

// ── Telegram Alerts — ตั้งค่า bot token / chat ID ผ่าน UI (บันทึกลง DB, ไม่ต้องแตะ .env) ──
export default function TelegramSection() {
  const t = useLanguageStore((s) => s.t);
  const [configured, setConfigured] = useState(false);
  const [source, setSource] = useState<'env' | 'db' | 'none'>('none');
  const [masked, setMasked] = useState('');
  const [chatId, setChatId] = useState('');
  const [botToken, setBotToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [testOutcome, setTestOutcome] = useState<'idle' | 'ok' | 'fail'>('idle');

  const loadConfig = async () => {
    try {
      const res = await authFetch(`${getApiUrl()}/api/telegram/config`);
      if (!res.ok) return;
      const data = await res.json();
      setConfigured(data.configured === true);
      setSource(data.source);
      setMasked(data.botTokenMasked || '');
      setChatId(data.chatId || '');
      setTestOutcome('idle');
    } catch {
      // เงียบ — แสดงสถานะไม่พร้อม
    }
  };

  useEffect(() => {
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const body: Record<string, string> = {};
      if (botToken.trim()) body.botToken = botToken.trim();
      if (chatId.trim()) body.chatId = chatId.trim();
      if (Object.keys(body).length === 0) {
        setErr(t('settings.telegram.saveFailed', 'บันทึกไม่สำเร็จ: {error}', { error: t('common.invalid', 'ข้อมูลไม่ถูกต้อง') }));
        return;
      }
      const res = await authFetch(`${getApiUrl()}/api/telegram/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setBotToken('');
      setMsg(t('settings.telegram.saved', 'บันทึก Telegram credentials แล้ว — ระบบจะใช้ค่านี้ทันที'));
      await loadConfig();
    } catch (e: any) {
      setErr(t('settings.telegram.saveFailed', 'บันทึกไม่สำเร็จ: {error}', { error: e.message }));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true); setErr(''); setMsg(''); setTestOutcome('idle');
    try {
      const res = await authFetch(`${getApiUrl()}/api/telegram/test`, { method: 'POST' });
      const data = await res.json();
      setTestOutcome(data.success === true ? 'ok' : 'fail');
      if (data.success === true) setMsg(t('settings.telegram.testOk', 'ส่งข้อความทดสอบแล้ว — ตรวจสอบ Telegram ของคุณ'));
    } catch {
      setTestOutcome('fail');
    } finally {
      setBusy(false);
    }
  };

  const useEnv = async () => {
    if (!window.confirm(t('settings.telegram.useEnv', 'ใช้ค่าจาก .env'))) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const res = await authFetch(`${getApiUrl()}/api/telegram/config`, { method: 'DELETE' });
      const data = await res.json();
      setMsg(t('settings.telegram.reverted', 'ลบ override แล้ว — กลับไปใช้ค่าใน .env'));
      setConfigured(data.configured === true);
      setSource(data.source);
      setMasked(data.botTokenMasked || '');
      setChatId(data.chatId || '');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const [chats, setChats] = useState<Array<{chatId:string,title:string,type:string,text:string}>>([]);
  const fetchChats = async () => {
    setBusy(true); setErr(''); try {
      const res = await authFetch(`${getApiUrl()}/api/telegram/updates`);
      const data = await res.json();
      // 429 = โดนจำกัดความถี่ (ของเราหรือของ Telegram) — บอกให้ลองใหม่พร้อมเวลารอ ไม่ใช่ error ดิบ
      if (res.status === 429) {
        const wait = Number(data?.retryAfter) || 0;
        setErr(wait > 0
          ? t('settings.telegram.rateLimited', 'เรียก Telegram บ่อยเกินไป — ลองใหม่ภายหลังใน {s} วินาที', { s: wait })
          : t('settings.telegram.rateLimitedNoWait', 'เรียก Telegram บ่อยเกินไป — ลองใหม่ภายหลัง'));
        return;
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setChats(data.chats || []);
      if ((data.chats||[]).length===0) setErr('ยังไม่พบข้อความ — ส่งข้อความหา bot หรือเชิญบอทเข้ากลุ่มแล้วพิมพ์อะไรสักอย่างก่อน');
      else setMsg(`พบ ${data.chats.length} แชท — กดเลือกเพื่อใส่ Chat ID อัตโนมัติ`);
    } catch(e:any){ setErr(e.message); } finally { setBusy(false); }
  };
  const statusBadge = !configured
    ? t('settings.telegram.notConfigured', 'ยังไม่ได้ตั้งค่า')
    : source === 'db'
      ? t('settings.telegram.fromDb', 'ตั้งค่าแล้ว (DB)')
      : t('settings.telegram.fromEnv', 'จาก .env');

  return (
    <section className="panel panel-glow p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('settings.telegram.title', 'Telegram Alerts')}</h2>
        <span className={`text-xs border rounded px-2 py-1 ${configured ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700' : 'bg-amber-900/40 text-amber-300 border-amber-700'}`}>
          {t('settings.telegram.statusLabel', 'สถานะ: ')}{statusBadge}
        </span>
      </div>
      <p className="text-xs text-gray-500">
        {t('settings.telegram.desc', 'ตั้งค่า bot token และ chat ID เพื่อรับข้อความแจ้งเตือนจากระบบ (บันทึกลง DB — ไม่ต้องแก้ไฟล์ .env บนเครื่อง)')}
      </p>

      {msg && <div className="card p-3 text-sm text-emerald-400">{msg}</div>}
      {err && <div className="card p-3 text-sm text-rose-400">{err}</div>}

      <div className="space-y-3">
        <div>
          <label htmlFor="settings-telegram-bot-token" className="block text-xs text-gray-400 mb-1">{t('settings.telegram.botToken', 'Bot Token')}</label>
          <input id="settings-telegram-bot-token"
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder={masked ? t('settings.telegram.botTokenMasked', 'ตั้งค่าแล้ว: {masked} — ปล่อยว่างเพื่อใช้ค่าเดิม', { masked }) : t('settings.telegram.botTokenPh', 'กรอก bot token จาก @BotFather (เช่น 123456789:AAF…)')}
            autoComplete="new-password"
            className="input w-full text-sm"
          />
        </div>
        <div>
          <label htmlFor="settings-telegram-chat-id" className="block text-xs text-gray-400 mb-1">{t('settings.telegram.chatId', 'Chat ID')}</label>
          <input id="settings-telegram-chat-id"
            type="text"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder={t('settings.telegram.chatIdPh', 'เช่น 123456789 หรือ @username')}
            className="input w-full text-sm"
          />
        </div>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <button onClick={save} disabled={busy || (!botToken.trim() && !chatId.trim())} className="btn-primary">
          <Icon name="save" size={14} />
          {t('settings.telegram.save', 'บันทึก')}
        </button>
        <button onClick={fetchChats} disabled={busy || !botToken.trim()} className="btn-secondary">
          <Icon name="search" size={14} /> ดึง Chat ID อัตโนมัติ
        </button>
        <button onClick={test} disabled={busy || !configured} className="btn-secondary">
          {busy ? t('common.loading', 'กำลังโหลด...') : t('settings.telegram.test', 'ส่งข้อความทดสอบ')}
        </button>
        {source === 'db' && (
          <button onClick={useEnv} disabled={busy} className="btn-secondary">
            {t('settings.telegram.useEnv', 'ใช้ค่าจาก .env')}
          </button>
        )}
      </div>
      {chats.length>0 && (
        <div className="grid gap-1.5">
          {chats.map(c=>(
            <button key={c.chatId} onClick={()=>setChatId(c.chatId)} className="text-left px-3 py-2 rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-xs flex justify-between">
              <span><b className="text-gray-200">{c.chatId}</b> <span className="text-gray-500">{c.title} · {c.type}</span></span>
              <span className="text-gray-500 truncate ml-2">{c.text}</span>
            </button>
          ))}
        </div>
      )}
      {testOutcome === 'fail' && (
        <div className="card p-3 text-sm text-rose-400">
          {t('settings.telegram.testFail', 'ส่งไม่สำเร็จ — ตรวจ token / chat ID หรือการเชื่อมต่ออินเทอร์เน็ต')}
        </div>
      )}
      {!configured && (
        <div className="text-[11px] text-gray-600">
          {t('settings.telegram.notAdmin', 'เฉพาะ SUPERADMIN ตั้งค่า Telegram ได้')}
        </div>
      )}
    </section>
  );
}
