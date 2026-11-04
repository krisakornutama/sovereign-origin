"use client";
// pages/register.tsx — สมัครสมาชิกด้วยรหัสเชิญ (Community Edition)
// ทำไมต้องมีรหัสเชิญ: CE ไม่มี SMTP และมักถูกเปิดพอร์ตออกอินเทอร์เน็ต
// → เปิดรับสมัครเสรีเมื่อไรก็โดน bot สมัครทิ้ง admin จึงเป็นผู้ออกสิทธิ์
import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getApiUrl } from '../lib/config';
import { useAuthStore } from '../stores/useAuthStore';

export default function RegisterPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [code, setCode] = useState('');
  const [checked, setChecked] = useState<null | { role: string; usesLeft: number }>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [telemetry, setTelemetry] = useState(true);
  const [analytics, setAnalytics] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // ลิงก์ที่ admin ส่งมาจะพา ?code=... มาด้วย — ตรวจให้เลยว่ายังใช้ได้
  useEffect(() => {
    if (!router.isReady) return;
    const fromQuery = typeof router.query.code === 'string' ? router.query.code : '';
    if (fromQuery) {
      setCode(fromQuery);
      void checkCode(fromQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  async function checkCode(raw: string) {
    setError('');
    setChecked(null);
    try {
      const res = await fetch(getApiUrl() + '/api/auth/register/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: raw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.valid) {
        setError('รหัสเชิญไม่ถูกต้อง ถูกใช้ไปแล้ว หรือหมดอายุ');
        return;
      }
      setChecked({ role: data.role, usesLeft: data.usesLeft });
    } catch {
      setError('ติดต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจว่า Core API เปิดอยู่');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(getApiUrl() + '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, username, password, consents: { telemetry, analytics } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'สมัครสมาชิกไม่สำเร็จ');
        return;
      }
      login(data.token);
      router.push('/');
    } catch {
      setError('ติดต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจว่า Core API เปิดอยู่');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head>
        <title>สมัครสมาชิก · Sovereign OS</title>
      </Head>
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-6 py-10">
        <form onSubmit={handleSubmit} className="card panel-glow relative w-full max-w-md p-8 space-y-4">
          <div className="text-center space-y-1">
            <h1 className="text-xl font-semibold text-gray-100">สมัครสมาชิกด้วยรหัสเชิญ</h1>
            <p className="text-sm text-gray-400">รหัสนี้ได้จากผู้ดูแลระบบของคุณ (ใช้ได้ตามจำนวนครั้งที่กำหนด)</p>
          </div>

          <label className="block space-y-1">
            <span className="text-sm text-gray-300">รหัสเชิญ</span>
            <div className="flex gap-2">
              <input
                className="input flex-1 font-mono tracking-wider"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onBlur={() => code.trim() && checkCode(code.trim())}
                placeholder="SG-XXXX-XXXX-XXXX"
                autoComplete="off"
                required
              />
              <button
                type="button"
                onClick={() => checkCode(code.trim())}
                className="px-3 rounded-lg border border-gray-700 text-sm text-gray-300 hover:border-emerald-500/50"
              >
                ตรวจสอบ
              </button>
            </div>
          </label>

          {checked && (
            <p className="text-xs text-emerald-400">
              รหัสใช้ได้ · บทบาทที่จะได้รับ: {checked.role} · เหลือ {checked.usesLeft} สิทธิ์
            </p>
          )}

          <label className="block space-y-1">
            <span className="text-sm text-gray-300">ชื่อผู้ใช้</span>
            <input
              className="input w-full"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="a-z A-Z 0-9 . _ - (3–32 ตัว)"
              autoComplete="username"
              required
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-gray-300">รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)</span>
            <input
              type="password"
              className="input w-full"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-gray-300">ยืนยันรหัสผ่าน</span>
            <input
              type="password"
              className="input w-full"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          <div className="space-y-2 rounded-lg border border-gray-800 p-3">
            <p className="text-xs text-gray-400">
              จำเป็นต่อการให้บริการ: บัญชีและการเข้าสู่ระบบ (บันทึกอัตโนมัติ) ·{' '}
              <Link href="/privacy" className="text-emerald-400 underline">
                อ่านนโยบายความเป็นส่วนตัว
              </Link>
            </p>
            <label className="flex items-start gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={telemetry} onChange={(e) => setTelemetry(e.target.checked)} className="mt-1" />
              <span>ข้อมูลการใช้งานและสุขภาพระบบ (telemetry)</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} className="mt-1" />
              <span>การวิเคราะห์การใช้งาน (analytics)</span>
            </label>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button type="submit" disabled={busy || !checked} className="btn-primary w-full disabled:opacity-50">
            {busy ? 'กำลังสร้างบัญชี...' : 'สร้างบัญชี'}
          </button>

          <p className="text-center text-sm text-gray-400">
            มีบัญชีแล้ว?{' '}
            <Link href="/" className="text-emerald-400 underline">
              เข้าสู่ระบบ
            </Link>
          </p>
        </form>
      </div>
    </>
  );
}
