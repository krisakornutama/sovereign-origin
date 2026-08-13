import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useRouter } from 'next/navigation';

const DIGIT_COUNT = 6;

function formatCountdown(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function MfaInput() {
  const [digits, setDigits] = useState<string[]>(Array(DIGIT_COUNT).fill(''));
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const { token, login } = useAuthStore();
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
        throw new Error(data.error || 'รหัส OTP ไม่ถูกต้อง');
      }

      // token เต็ม (mfa_verified=true)
      login(data.token);
      router.push('/dashboard');
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
        <div className="bg-gray-900/90 border border-gray-700 rounded-2xl p-8 shadow-2xl shadow-black/60 backdrop-blur">
          <div className="text-center">
            <div className="text-3xl">🏰</div>
            <h1 className="mt-2 text-xl font-bold text-green-400 tracking-wide">SOVEREIGN OS</h1>
            <p className="text-gray-400 text-sm mt-1">🔐 ยืนยันตัวตน 2FA — ขั้นตอนที่ 2</p>
            <p className="text-gray-500 text-xs mt-1">
              กรอกรหัส 6 หลักจากแอป Authenticator (Google / Microsoft)
            </p>
          </div>

          {locked ? (
            <div
              className="mt-6 p-3 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-300 text-sm text-center font-mono"
              role="status"
            >
              ⏳ ระบบจำกัดจำนวนครั้ง — ลองอีกครั้งใน {formatCountdown(cooldown)}
            </div>
          ) : (
            error && (
              <div className="mt-6 p-3 rounded-lg bg-red-900/30 border border-red-800/60 text-red-300 text-sm text-center">
                {error}
              </div>
            )
          )}

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
                aria-label={`หลักที่ ${i + 1}`}
                className={`w-11 h-14 sm:w-12 rounded-lg border bg-gray-800 text-center text-2xl font-mono text-white
                  focus:outline-none focus:ring-2 transition
                  ${error ? 'border-red-700' : 'border-gray-600 focus:ring-green-500'}
                  ${d ? 'border-green-600/70' : ''}
                  disabled:opacity-50 disabled:cursor-not-allowed`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={locked || submitting || code.length !== DIGIT_COUNT}
            className="mt-6 w-full bg-green-600 hover:bg-green-500 py-3 rounded-lg text-white font-semibold tracking-wide transition
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {locked ? `รอ ${formatCountdown(cooldown)}` : submitting ? 'กำลังยืนยัน…' : 'ยืนยัน'}
          </button>

          <p className="mt-4 text-center text-[11px] text-gray-500 font-mono">
            SESSION GATE · TOTP (SHA-1) · 30 วินาทีต่อรหัส · พยายามจำกัด 10 ครั้ง/15 นาที
          </p>
        </div>
      </div>
    </div>
  );
}