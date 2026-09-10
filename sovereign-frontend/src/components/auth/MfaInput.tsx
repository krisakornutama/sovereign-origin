import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { useRouter } from 'next/navigation';
import Icon from '../ui/Icon';
import LanguageToggle from '../ui/LanguageToggle';

const DIGIT_COUNT = 6;

function formatCountdown(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function MfaInput() {
  const [digits, setDigits] = useState<string[]>(Array(DIGIT_COUNT).fill(''));
  const [useBackup, setUseBackup] = useState(false);
  const [backupCode, setBackupCode] = useState('');
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const { token, login } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const router = useRouter();

  // นับถอยหลัง Retry-After; ปิดการกรอกระหว่างรอ
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown > 0]);

  const code = digits.join('');
  const locked = cooldown > 0;

  const handleChange = (idx: number, value: string) => {
    if (locked) return;
    const clean = value.replace(/\D/g, '');
    if (!clean) {
      setDigits((d) => d.map((x, i) => (i === idx ? '' : x)));
      return;
    }
    // วาง/พิมพ์ทั้งชุด (paste)
    if (clean.length > 1) {
      const filled = clean.split('').slice(0, DIGIT_COUNT);
      setDigits(Array(DIGIT_COUNT).fill('').map((_, i) => filled[i] ?? ''));
      refs.current[Math.min(clean.length, DIGIT_COUNT) - 1]?.focus();
      return;
    }
    setDigits((d) => d.map((x, i) => (i === idx ? clean : x)));
    if (idx < DIGIT_COUNT - 1) refs.current[idx + 1]?.focus();
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      refs.current[idx - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!text) return;
    const filled = text.split('').slice(0, DIGIT_COUNT);
    setDigits(Array(DIGIT_COUNT).fill('').map((_, i) => filled[i] ?? ''));
    refs.current[Math.min(text.length, DIGIT_COUNT) - 1]?.focus();
  };

  const submit = async () => {
    if (submitting || code.length !== DIGIT_COUNT || locked) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/verify-mfa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code }),
      });

      const data = await res.json();
      if (!res.ok) {
        // โดน rate limit → แสดง countdown ตาม Retry-After
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('Retry-After') || 0);
          if (retryAfter > 0) setCooldown(retryAfter);
        }
        throw new Error(data.error || t('login.otpInvalid', 'รหัส OTP ไม่ถูกต้อง'));
      }

      // token เต็ม (mfa_verified=true)
      login(data.token);
      // ยังไม่ได้เปลี่ยนรหัสผ่านครั้งแรก → บังคับไปเปลี่ยนก่อนเข้า dashboard
      router.push(useAuthStore.getState().mustChangePassword ? '/change-password' : '/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // โหมดรหัสสำรอง (10 hex ตัวอักษร-ตัวเลข) — ใช้ endpoint เดียวกับ TOTP; backend แยก format เอง
  const submitBackup = async () => {
    const normalized = backupCode.trim().toLowerCase();
    if (submitting || locked || !/^[0-9a-f]{10}$/.test(normalized)) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/verify-mfa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: normalized }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('Retry-After') || 0);
          if (retryAfter > 0) setCooldown(retryAfter);
        }
        throw new Error(data.error || t('login.otpInvalid', 'รหัส OTP ไม่ถูกต้อง'));
      }
      login(data.token);
      setBackupCode('');
      router.push(useAuthStore.getState().mustChangePassword ? '/change-password' : '/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // auto-submit เมื่อครบ 6 หลัก (ดีเลย์นิดหน่อยให้ user เห็นตัวสุดท้าย)
  useEffect(() => {
    if (code.length !== DIGIT_COUNT) return;
    const t = setTimeout(submit, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center relative overflow-hidden">
      {/* สลับภาษาไทย/อังกฤษ */}
      <div className="absolute top-4 right-4 z-10">
        <LanguageToggle compact />
      </div>
      {/* พื้นหลัง: grid + glow เล็ก ๆ แบบ command center */}
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(#22c55e 1px, transparent 1px), linear-gradient(90deg, #22c55e 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      <div className="absolute top-[-140px] left-1/2 -translate-x-1/2 w-[520px] h-[300px] rounded-full bg-green-500/10 blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md px-6">
        <div className="card panel-glow p-8">
          <div className="text-center">
            <div className="flex justify-center text-emerald-400">
              <Icon name="crown" size={28} />
            </div>
            <h1 className="mt-2 text-sm font-semibold text-gray-200 tracking-wide glow-text">SOVEREIGN OS</h1>
            <p className="text-gray-400 text-sm mt-1 flex items-center justify-center gap-1.5">
              <Icon name="lock" size={13} />{t('login.mfaTitle')}
            </p>
            <p className="text-gray-500 text-xs mt-1">
              {t('login.mfaHint')}
            </p>
          </div>

          {locked ? (
            <div
              className="mt-6 p-3 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-300 text-sm text-center font-mono"
              role="status"
            >
              {t('login.rateLimited', 'ระบบจำกัดจำนวนครั้ง — ลองอีกครั้งใน {time}', { time: formatCountdown(cooldown) })}
            </div>
          ) : (
            error && (
              <div className="mt-6 p-3 rounded-lg bg-red-900/30 border border-red-800/60 text-red-300 text-sm text-center">
                {error}
              </div>
            )
          )}

          {useBackup ? (
            <div className="mt-6 space-y-3">
              <p className="text-xs text-gray-500">{t('login.mfaBackupHint', 'กรอกรหัสสำรอง 10 ตัวที่เก็บไว้ (ใช้ได้ครั้งเดียว)')}</p>
              <input
                type="text"
                value={backupCode}
                onChange={(e) => setBackupCode(e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 10))}
                onKeyDown={(e) => { if (e.key === 'Enter') submitBackup(); }}
                placeholder="xxxxxxxxxx"
                autoComplete="off"
                autoFocus
                disabled={locked}
                className="w-full h-12 rounded-lg border border-gray-600 bg-gray-800 px-4 text-center font-mono text-lg tracking-widest text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={submitBackup}
                disabled={locked || submitting || backupCode.trim().length !== 10}
                className="w-full btn-primary disabled:opacity-50"
              >
                {locked ? t('login.wait', 'รอ {time}', { time: formatCountdown(cooldown) }) : submitting ? t('login.verifying') : t('login.confirm')}
              </button>
            </div>
          ) : (
            <>
          {/* ช่องกรอกรหัส 6 ช่อง */}
          <div className="mt-6 flex justify-between gap-2">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { refs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                autoComplete={i === 0 ? 'one-time-code' : 'off'}
                maxLength={i === 0 ? DIGIT_COUNT : 1}
                value={d}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onPaste={handlePaste}
                disabled={locked}
                autoFocus={i === 0}
                aria-label={t('login.mfaDigitLabel', 'หลักที่ {n}', { n: i + 1 })}
                className={`w-11 h-14 sm:w-12 rounded-lg border bg-gray-800 text-center text-2xl font-mono text-white
                  focus:outline-none focus:ring-2 transition
                  ${error ? 'border-red-700' : 'border-gray-600 focus:ring-emerald-500'}
                  ${d ? 'border-green-600/70' : ''}
                  disabled:opacity-50 disabled:cursor-not-allowed`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={locked || submitting || code.length !== DIGIT_COUNT}
            className="mt-6 w-full btn-primary"
          >
            {locked ? t('login.wait', 'รอ {time}', { time: formatCountdown(cooldown) }) : submitting ? t('login.verifying') : t('login.confirm')}
          </button>
            </>
          )}

          <button
            type="button"
            onClick={() => { setUseBackup((v) => !v); setError(''); }}
            className="mt-3 mx-auto block text-xs text-gray-400 hover:text-emerald-300 underline underline-offset-2"
          >
            {useBackup
              ? t('login.mfaUseTotp', 'กลับไปกรอกรหัสจากแอป Authenticator')
              : t('login.mfaUseBackup', 'โทรศัพท์หาย? ใช้รหัสสำรองแทน')}
          </button>

          <p className="mt-4 text-center text-[11px] text-gray-500 font-mono">
            {t('login.mfaGate', 'SESSION GATE · TOTP (SHA-1) · 30 วินาทีต่อรหัส · พยายามจำกัด 10 ครั้ง/15 นาที')}
          </p>
        </div>
      </div>
    </div>
  );
}