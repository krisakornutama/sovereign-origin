import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLanguageStore } from '../../stores/useLanguageStore';
import MfaInput from './MfaInput';
import { useRouter } from 'next/navigation';
import Icon from '../ui/Icon';
import LanguageToggle from '../ui/LanguageToggle';

function formatCountdown(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const { login, setMfaRequired, mfaRequired } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const router = useRouter();

  // นับถอยหลัง Retry-After; ปิดปุ่ม submit ระหว่างรอ
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown > 0]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        // โดน rate limit → แสดง countdown ตาม Retry-After
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('Retry-After') || 0);
          if (retryAfter > 0) setCooldown(retryAfter);
        }
        throw new Error(data.error || t('login.loginFailed', 'เข้าสู่ระบบล้มเหลว'));
      }

      if (data.mfa_required) {
        // เก็บ token ชั่วคราว (mfa_verified=false) แล้วแสดงหน้า MFA
        login(data.token); // token นี้จะทำให้ store มี token แต่ isAuthenticated=false
        setMfaRequired(true);
      } else {
        // token สมบูรณ์ → เข้าระบบ (redirect ไปเปลี่ยนรหัสก่อนถ้ายังไม่ได้เปลี่ยนครั้งแรก)
        login(data.token);
        router.push(useAuthStore.getState().mustChangePassword ? '/change-password' : '/dashboard');
      }
    } catch (err: any) {
      setError(err.message || t('login.genericError', 'เกิดข้อผิดพลาด'));
    }
  };

  if (mfaRequired) {
    return <MfaInput />;
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center relative overflow-hidden">
      {/* สลับภาษาไทย/อังกฤษ */}
      <div className="absolute top-4 right-4 z-10">
        <LanguageToggle compact />
      </div>
      {/* พื้นหลัง: grid + glow แบบ command center (ตรงกับหน้า MFA) */}
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
        <form
          onSubmit={handleSubmit}
          className="card panel-glow p-8 space-y-4"
        >
          <div className="text-center">
            <div className="flex justify-center text-emerald-400">
              <Icon name="crown" size={28} />
            </div>
            <h1 className="mt-2 text-sm font-semibold text-gray-200 tracking-wide glow-text">SOVEREIGN OS</h1>
            <p className="text-gray-500 text-xs mt-1">{t('login.subtitle')}</p>
          </div>

          {cooldown > 0 ? (
            <div
              className="p-3 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-300 text-sm text-center font-mono"
              role="status"
            >
              {t('login.rateLimited', 'ระบบจำกัดจำนวนครั้ง — ลองอีกครั้งใน {time}', { time: formatCountdown(cooldown) })}
            </div>
          ) : (
            error && (
              <div className="p-3 rounded-lg bg-red-900/30 border border-red-800/60 text-red-300 text-sm text-center">
                {error}
              </div>
            )
          )}

          <div>
            <label className="label">{t('login.username')}</label>
            <input
              type="text"
              autoComplete="username"
              className="input w-full text-white"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="label">{t('login.password')}</label>
            <input
              type="password"
              autoComplete="current-password"
              className="input w-full text-white"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <button
            type="submit"
            disabled={cooldown > 0}
            className="btn-primary w-full"
          >
            {cooldown > 0 ? t('login.wait', 'รอ {time}', { time: formatCountdown(cooldown) }) : t('login.signIn')}
          </button>

          <p className="pt-1 text-center text-[11px] text-gray-500 font-mono">
            AUTH GATE · JWT 24h · 2FA REQUIRED · LOCAL-FIRST
          </p>
        </form>
      </div>
    </div>
  );
}