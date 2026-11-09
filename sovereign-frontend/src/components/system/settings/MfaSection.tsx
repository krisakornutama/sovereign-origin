"use client";
// ── MFA (2FA) — ตั้งค่า/ปิดชั่วคราว · flow: enroll → สแกน QR → confirm ด้วยรหัสจากแอป (กัน lockout) ──
import { useState, useEffect } from 'react';
import { authFetch } from '../../../lib/apiFetch';
import { getApiUrl } from '../../../lib/config';
import { useLanguageStore } from '../../../stores/useLanguageStore';
import Icon from '../../ui/Icon';

// ── MFA (2FA) — ตั้งค่า/ปิดชั่วคราว ──
// flow: enroll → สแกน QR → confirm ด้วยรหัสจากแอป (กัน lockout)
export default function MfaSection() {
  const t = useLanguageStore((s) => s.t);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const refresh = async () => {
    try {
      const res = await authFetch(`${getApiUrl()}/api/auth/mfa/status`);
      const data = await res.json();
      setEnabled(data.enabled === true);
      setPending(data.pending === true);
    } catch (e) {
      setErr(t('settings.mfa.loadFailed', 'โหลดสถานะ MFA ไม่สำเร็จ'));
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enroll = async () => {
    setBusy(true); setMsg(''); setErr(''); setCode('');
    try {
      const res = await authFetch(`${getApiUrl()}/api/auth/mfa/enroll`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('settings.mfa.enrollFailed', 'สร้างคีย์ไม่สำเร็จ'));
      setQr(data.qrCode);
      setSecret(data.secret);
      setPending(true);
      setMsg(t('settings.mfa.scanHint', 'สแกน QR ด้านล่างในแอป Authenticator แล้วกรอกรหัส 6 หลักเพื่อยืนยัน'));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setErr(t('settings.mfa.codeRequired', 'กรอกรหัส 6 หลักจากแอป'));
      return;
    }
    setBusy(true); setMsg(''); setErr('');
    try {
      const res = await authFetch(`${getApiUrl()}/api/auth/mfa/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('settings.mfa.confirmFailed', 'ยืนยันไม่สำเร็จ'));
      setQr(''); setSecret(''); setCode('');
      // รหัสสำรองชุดแรก — แสดงครั้งเดียว ให้เก็บไว้กัน lockout ตอนโทรศัพท์หาย
      if (Array.isArray(data.backupCodes) && data.backupCodes.length) setBackupCodes(data.backupCodes);
      setMsg(t('settings.mfa.enabled', 'เปิดใช้งาน 2FA แล้ว — ครั้งหน้า login จะต้องกรอกรหัสจากแอป'));
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!window.confirm(t('settings.mfa.disableConfirm', 'ปิด 2FA ชั่วคราว? (เข้าระบบด้วยรหัสผ่านอย่างเดียว — เปิดใหม่ได้เสมอ)'))) return;
    setBusy(true); setMsg(''); setErr('');
    try {
      const res = await authFetch(`${getApiUrl()}/api/auth/mfa/disable`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('settings.mfa.disableFailed', 'ปิดไม่สำเร็จ'));
      setQr(''); setSecret(''); setCode('');
      setBackupCodes(null);
      setMsg(t('settings.mfa.disabled', 'ปิด 2FA ชั่วคราวแล้ว — เปิดใหม่ได้จากหน้านี้'));
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  // รหัสสำรองชุดใหม่ (ทับชุดเก่า — ชุดเก่าใช้ไม่ได้อีก)
  const regenerateCodes = async () => {
    if (!window.confirm(t('settings.mfa.backupRegenConfirm', 'สร้างรหัสสำรองชุดใหม่? (รหัสชุดเก่าจะใช้ไม่ได้ทั้งหมด)'))) return;
    setBusy(true); setMsg(''); setErr('');
    try {
      const res = await authFetch(`${getApiUrl()}/api/auth/mfa/backup-codes`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('settings.mfa.backupFailed', 'สร้างรหัสสำรองไม่สำเร็จ'));
      setBackupCodes(data.backupCodes);
      setMsg(t('settings.mfa.backupNew', 'รหัสสำรองชุดใหม่ — เก็บไว้ให้ดี จะแสดงครั้งนี้ครั้งเดียว'));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel panel-glow p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200 glow-text">2FA / MFA</h2>
        {enabled === true && <span className="text-xs bg-emerald-900/40 text-emerald-300 border border-emerald-700 rounded px-2 py-1">{t('settings.mfa.on', 'เปิดอยู่')}</span>}
        {enabled === false && <span className="text-xs bg-amber-900/40 text-amber-300 border border-amber-700 rounded px-2 py-1">{t('settings.mfa.off', 'ปิดชั่วคราว')}</span>}
      </div>

      {msg && <div className="card p-3 text-sm text-emerald-400">{msg}</div>}
      {err && <div className="card p-3 text-sm text-rose-400">{err}</div>}

      {enabled === true ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            {t('settings.mfa.enabledDesc', '2FA เปิดอยู่ — ทุกครั้งที่ login ต้องกรอกรหัส 6 หลักจากแอป Authenticator')}
          </p>
          {backupCodes && (
            <div className="card p-3 space-y-2">
              <div className="text-xs font-semibold text-amber-300">
                {t('settings.mfa.backupTitle', 'รหัสสำรอง 8 ตัว (ใช้ได้ครั้งเดียวต่อรหัส) — เก็บไว้ที่ปลอดภัย จะแสดงครั้งนี้ครั้งเดียว:')}
              </div>
              <div className="grid grid-cols-4 gap-1 font-mono text-sm text-green-300 select-all">
                {backupCodes.map((c) => (
                  <code key={c} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-center">{c}</code>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            <button onClick={regenerateCodes} disabled={busy} className="btn-primary">
              <Icon name="refresh" size={14} />
              {t('settings.mfa.backupRegen', 'สร้างรหัสสำรองใหม่')}
            </button>
            <button onClick={disable} disabled={busy} className="btn-danger disabled:opacity-50">
              <Icon name="x-circle" size={14} />
              {t('settings.mfa.disable', 'ปิด 2FA ชั่วคราว')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            {t('settings.mfa.disabledDesc', 'เข้าระบบด้วยรหัสผ่านอย่างเดียวตอนนี้ — เปิด 2FA เพื่อเพิ่มความปลอดภัย (คีย์ใหม่ถูกสร้างให้สแกน)')}
          </p>
          {!pending ? (
            <button onClick={enroll} disabled={busy} className="btn-primary">
              {busy ? t('settings.mfa.creating', 'กำลังสร้าง…') : (
                <>
                  <Icon name="lock" size={14} />
                  {t('settings.mfa.setup', 'ตั้งค่า 2FA ใหม่')}
                </>
              )}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-4 items-start flex-wrap">
                {qr && (
                  <img
                    src={qr}
                    alt={t('settings.mfa.qrAlt', 'QR Code สำหรับแอป Authenticator')}
                    className="w-40 h-40 bg-white rounded-lg p-2"
                  />
                )}
                <div className="space-y-2 flex-1 min-w-[220px]">
                  <div className="text-xs text-gray-500">
                    {t('settings.mfa.manualEntry', 'หรือกรอกคีย์นี้ในแอป (manual entry):')}
                  </div>
                  <code className="block bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-green-300 break-all select-all glow-text">
                    {secret}
                  </code>
                  <div className="flex gap-2">
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder={t('settings.mfa.codePh', 'รหัส 6 หลักจากแอป')}
                      inputMode="numeric"
                      className="input text-sm flex-1"
                    />
                    <button onClick={confirm} disabled={busy || code.length !== 6} className="btn-primary">
                      {t('common.confirm', 'ยืนยัน')}
                    </button>
                  </div>
                </div>
              </div>
              <div className="text-xs text-gray-600">
                {t('settings.mfa.howTo', 'เปิดแอป Google Authenticator / Microsoft Authenticator → สแกน QR (หรือ + → ป้อนคีย์ด้วยตนเอง) → ระบบจะเปิด 2FA ต่อเมื่อรหัสจากแอปตรงกัน')}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
