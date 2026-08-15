"use client";
import { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useRouter } from 'next/navigation';

const MIN_LENGTH = 8;
const WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'abc12345', 'admin123', 'letmein1', 'welcome1', 'monkey123',
]);

function strengthOf(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= MIN_LENGTH) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  const labels = ['อ่อนเกินไป', 'ง่าย', 'พอใช้', 'ดี', 'แข็งแรง'];
  const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500', 'bg-emerald-400'];
  return { score, label: labels[score], color: colors[score] };
}

interface Props {
  // true = โหมดบังคับเปลี่ยนหลัง login ครั้งแรก (เต็มจอ ไม่มีเมนู ข้ามไม่ได้)
  forced?: boolean;
}

export default function ChangePasswordForm({ forced = false }: Props) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { token, login } = useAuthStore();
  const router = useRouter();

  const strength = strengthOf(newPassword);

  const validate = (): string => {
    if (!forced && !currentPassword) return 'กรอกรหัสผ่านปัจจุบันก่อน';
    if (!newPassword) return 'ตั้งรหัสผ่านใหม่ก่อน';
    if (newPassword.length < MIN_LENGTH) return `รหัสผ่านใหม่ต้องยาวอย่างน้อย ${MIN_LENGTH} ตัวอักษร`;
    if (newPassword.length > 128) return 'รหัสผ่านยาวเกินไป (สูงสุด 128 ตัวอักษร)';
    if (WEAK_PASSWORDS.has(newPassword.toLowerCase())) return 'รหัสผ่านนี้อ่อนเกินไป — เลือกรหัสที่เดายากกว่านี้';
    if (newPassword === currentPassword) return 'รหัสผ่านใหม่ต้องต่างจากรหัสผ่านเดิม';
    if (newPassword !== confirmPassword) return 'ยืนยันรหัสผ่านใหม่ไม่ตรงกัน';
    return '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เปลี่ยนรหัสผ่านไม่สำเร็จ');

      // token ใหม่ (ไม่มี flag บังคับเปลี่ยน) — session ต่อเนื่องเลย
      login(data.token);
      setSuccess(forced ? '✅ เปลี่ยนรหัสผ่านสำเร็จ — เข้าสู่ระบบเรียบร้อย' : '✅ เปลี่ยนรหัสผ่านสำเร็จ');
      setTimeout(() => router.push('/dashboard'), forced ? 600 : 400);
    } catch (err: any) {
      setError(err.message || 'เกิดข้อผิดพลาด — ลองใหม่อีกครั้ง');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 mt-1 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500';

  return (
    <div className="bg-gray-900/90 border border-gray-700 rounded-2xl p-8 shadow-2xl shadow-black/60 backdrop-blur space-y-4 w-full">
      <div className="text-center">
        <div className="text-3xl">🔑</div>
        <h1 className="mt-2 text-xl font-bold text-green-400 tracking-wide">เปลี่ยนรหัสผ่าน</h1>
        {forced ? (
          <p className="text-amber-300 text-sm mt-1 font-semibold">
            ⚠️ นี่คือ login ครั้งแรก — ต้องเปลี่ยนรหัสผ่านชั่วคราวก่อนเข้าใช้งาน
          </p>
        ) : (
          <p className="text-gray-400 text-sm mt-1">ตั้งรหัสผ่านใหม่ (ต้องกรอกรหัสปัจจุบันก่อน)</p>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-900/30 border border-red-800/60 text-red-300 text-sm text-center" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-green-900/30 border border-green-800/60 text-green-300 text-sm text-center" role="status">
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {!forced && (
          <div>
            <label className="text-sm text-gray-400">รหัสผ่านปัจจุบัน</label>
            <input
              type="password"
              autoComplete="current-password"
              className={inputCls}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoFocus={!forced}
            />
          </div>
        )}

        <div>
          <label className="text-sm text-gray-400">รหัสผ่านใหม่</label>
          <input
            type="password"
            autoComplete="new-password"
            className={inputCls}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={`อย่างน้อย ${MIN_LENGTH} ตัว (มีตัวพิมพ์เล็ก/ใหญ่ ตัวเลข สัญลักษณ์)`}
            required
            autoFocus={forced}
          />
          {newPassword && (
            <div className="mt-2">
              <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                <div className={`h-full ${strength.color} transition-all`} style={{ width: `${((strength.score + 1) / 5) * 100}%` }} />
              </div>
              <div className="text-[11px] text-gray-400 mt-1">ความแข็งแรง: {strength.label}</div>
            </div>
          )}
        </div>

        <div>
          <label className="text-sm text-gray-400">ยืนยันรหัสผ่านใหม่</label>
          <input
            type="password"
            autoComplete="new-password"
            className={inputCls}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="พิมพ์ซ้ำอีกครั้ง"
            required
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-green-600 hover:bg-green-500 py-3 rounded-lg text-white font-semibold tracking-wide transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'กำลังบันทึก…' : forced ? 'เปลี่ยนรหัสผ่านและเข้าใช้งาน' : 'เปลี่ยนรหัสผ่าน'}
        </button>

        {forced && (
          <p className="text-[11px] text-gray-500 text-center font-mono">
            PASSWORD GATE · เปลี่ยนไม่ได้ = ออกจากระบบ (ระบบจะไม่ให้เข้าหน้าอื่นจนกว่าจะเปลี่ยน)
          </p>
        )}
      </form>
    </div>
  );
}
