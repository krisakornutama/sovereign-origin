import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import MfaInput from './MfaInput';
import { useRouter } from 'next/navigation';

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
        throw new Error(data.error || 'เข้าสู่ระบบล้มเหลว');
      }

      if (data.mfa_required) {
        // เก็บ token ชั่วคราว (mfa_verified=false) แล้วแสดงหน้า MFA
        login(data.token); // token นี้จะทำให้ store มี token แต่ isAuthenticated=false
        setMfaRequired(true);
      } else {
        // token สมบูรณ์ → เข้าระบบและ redirect ไป dashboard
        login(data.token);
        router.push('/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'เกิดข้อผิดพลาด');
    }
  };

  if (mfaRequired) {
    return <MfaInput />;
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center relative overflow-hidden">
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
          className="bg-gray-900/90 border border-gray-700 rounded-2xl p-8 shadow-2xl shadow-black/60 backdrop-blur space-y-4"
        >
          <div className="text-center">
            <div className="text-3xl">🏰</div>
            <h1 className="mt-2 text-xl font-bold text-green-400 tracking-wide">SOVEREIGN OS</h1>
            <p className="text-gray-500 text-xs mt-1">Off-Grid Command Center · เข้าสู่ระบบ</p>
          </div>

          {cooldown > 0 ? (
            <div
              className="p-3 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-300 text-sm text-center font-mono"
              role="status"
            >
              ⏳ ระบบจำกัดจำนวนครั้ง — ลองอีกครั้งใน {formatCountdown(cooldown)}
            </div>
          ) : (
            error && (
              <div className="p-3 rounded-lg bg-red-900/30 border border-red-800/60 text-red-300 text-sm text-center">
                {error}
              </div>
            )
          )}

          <div>
            <label className="text-sm text-gray-400">Username</label>
            <input
              type="text"
              autoComplete="username"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 mt-1 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="text-sm text-gray-400">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 mt-1 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <button
            type="submit"
            disabled={cooldown > 0}
            className="w-full bg-green-600 hover:bg-green-500 py-3 rounded-lg text-white font-semibold tracking-wide transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cooldown > 0 ? `รอ ${formatCountdown(cooldown)}` : 'เข้าสู่ระบบ'}
          </button>

          <p className="pt-1 text-center text-[11px] text-gray-500 font-mono">
            AUTH GATE · JWT 24h · 2FA REQUIRED · LOCAL-FIRST
          </p>
        </form>
      </div>
    </div>
  );
}