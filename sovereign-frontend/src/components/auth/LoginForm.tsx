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

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // โดน rate limit → แสดง countdown ตาม Retry-After
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('Retry-After') || 0);
          if (retryAfter > 0) setCooldown(retryAfter);
          throw new Error(
            retryAfter > 0
              ? t('login.rateLimited', 'ลองพยายามบ่อยเกินไป — รอ {time} แล้วลองใหม่', { time: formatCountdown(retryAfter) })
              : t('login.rateLimitedNoHeader', 'ลองพยายามบ่อยเกินไป — พักสักครู่แล้วลองใหม่')
          );
        }
        if (res.status === 401 || res.status === 403) {
          // backend ตอบชัดเจนว่าไม่ผ่าน = user/pass ผิด (หรือบัญชีถูกปิด) — แยกจากเคสเครือข่าย
          throw new Error(data.error || t('login.badCredentials', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'));
        }
        if (res.status >= 500) {
          throw new Error(t('login.serverError', 'เซิร์ฟเวอร์ขัดข้องชั่วคราว — ลองใหม่อีกครั้งในอีกสักครู่'));
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
      // fetch ล้มเอง (TypeError: Failed to fetch) = ติดต่อ backend ไม่ได้ — แยกจาก error ที่เรา throw เอง
      if (err instanceof TypeError) {
        setError(t('login.cannotReachServer', 'ติดต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจว่า Core API (:3001) เปิดอยู่'));
        return;
      }
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
      {/* พื้นหลัง: grid เฟดขอบ + แสง 2 ชั้น (บนเขียว ล่างฟ้า) — command center แบบมีมิติ */}
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(#22c55e 1px, transparent 1px), linear-gradient(90deg, #22c55e 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse 75% 65% at 50% 45%, black 35%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 75% 65% at 50% 45%, black 35%, transparent 100%)',
        }}
      />
      <div className="absolute top-[-160px] left-1/2 -translate-x-1/2 w-[560px] h-[320px] rounded-full bg-green-500/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-180px] right-[-120px] w-[420px] h-[280px] rounded-full bg-teal-500/[0.07] blur-3xl pointer-events-none" />
      {/* เส้นขอบแสงบางๆ ด้านบนจอ — ให้ความรู้สึก "ประตู" */}
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent pointer-events-none" />

      <div className="relative w-full max-w-md px-6">
        <form
          onSubmit={handleSubmit}
          className="card panel-glow relative p-10 space-y-5"
        >
          {/* เส้น accent บนการ์ด */}
          <div className="absolute top-0 inset-x-8 h-px bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent pointer-events-none" />

          <div className="text-center">
            {/* emblem มงกุฎในกรอบ — จุดจ้องสายตา */}
            <div className="mx-auto w-14 h-14 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] flex items-center justify-center shadow-[0_0_24px_rgba(16,185,129,0.15)]">
              <span className="text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]">
                <Icon name="crown" size={26} />
              </span>
            </div>
            <h1 className="mt-4 text-sm font-semibold text-gray-100 tracking-[0.32em] glow-text">SOVEREIGN OS</h1>
            <div className="mt-3 flex items-center justify-center gap-3" aria-hidden="true">
              <span className="h-px w-14 bg-gradient-to-r from-transparent to-emerald-500/40" />
              <span className="w-1 h-1 rotate-45 bg-emerald-500/70" />
              <span className="h-px w-14 bg-gradient-to-l from-transparent to-emerald-500/40" />
            </div>
            <p className="text-gray-400 text-xs mt-3">{t('login.subtitle')}</p>
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

          <div className="space-y-1">
            <label className="label">{t('login.username')}</label>
            <input
              type="text"
              autoComplete="username"
              className="input w-full text-white transition-colors focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <label className="label">{t('login.password')}</label>
            <input
              type="password"
              autoComplete="current-password"
              className="input w-full text-white transition-colors focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <button
            type="submit"
            disabled={cooldown > 0}
            className="btn-primary w-full mt-1 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-[0_0_20px_rgba(16,185,129,0.25)] active:scale-[0.99] transition-all disabled:opacity-50 disabled:shadow-none"
          >
            {cooldown > 0 ? t('login.wait', 'รอ {time}', { time: formatCountdown(cooldown) }) : t('login.signIn')}
          </button>

          {/* footer แบบ status line — จุดสถานะ + ตัวคั่น */}
          <div className="pt-2 flex items-center justify-center gap-2 text-[10px] tracking-wider text-gray-500 font-mono">
            <span className="flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-emerald-500/80" />
              AUTH GATE
            </span>
            <span className="text-gray-700">·</span>
            <span>JWT 24h</span>
            <span className="text-gray-700">·</span>
            <span>2FA</span>
            <span className="text-gray-700">·</span>
            <span className="flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-teal-500/80" />
              LOCAL-FIRST
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}