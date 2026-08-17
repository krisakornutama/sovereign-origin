"use client";
import { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { useRouter } from 'next/navigation';
import Icon from '../ui/Icon';

const MIN_LENGTH = 8;
const WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'abc12345', 'admin123', 'letmein1', 'welcome1', 'monkey123',
]);

function strengthOf(pw: string): { score: number; color: string } {
  let score = 0;
  if (pw.length >= MIN_LENGTH) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500', 'bg-emerald-400'];
  return { score, color: colors[score] };
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
  const t = useLanguageStore((s) => s.t);
  const router = useRouter();

  const strength = strengthOf(newPassword);
  const strengthLabels = [
    t('changePassword.strength.0', 'อ่อนเกินไป'),
    t('changePassword.strength.1', 'ง่าย'),
    t('changePassword.strength.2', 'พอใช้'),
    t('changePassword.strength.3', 'ดี'),
    t('changePassword.strength.4', 'แข็งแรง'),
  ];

  const validate = (): string => {
    if (!forced && !currentPassword) return t('changePassword.errCurrent', 'กรอกรหัสผ่านปัจจุบันก่อน');
    if (!newPassword) return t('changePassword.errNew', 'ตั้งรหัสผ่านใหม่ก่อน');
    if (newPassword.length < MIN_LENGTH) return t('changePassword.errMinLen', 'รหัสผ่านใหม่ต้องยาวอย่างน้อย {n} ตัวอักษร', { n: MIN_LENGTH });
    if (newPassword.length > 128) return t('changePassword.errTooLong', 'รหัสผ่านยาวเกินไป (สูงสุด 128 ตัวอักษร)');
    if (WEAK_PASSWORDS.has(newPassword.toLowerCase())) return t('changePassword.errWeak', 'รหัสผ่านนี้อ่อนเกินไป — เลือกรหัสที่เดายากกว่านี้');
    if (newPassword === currentPassword) return t('changePassword.errSame', 'รหัสผ่านใหม่ต้องต่างจากรหัสผ่านเดิม');
    if (newPassword !== confirmPassword) return t('changePassword.errMismatch', 'ยืนยันรหัสผ่านใหม่ไม่ตรงกัน');
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
      if (!res.ok) throw new Error(data.error || t('changePassword.errGeneric', 'เปลี่ยนรหัสผ่านไม่สำเร็จ'));

      // token ใหม่ (ไม่มี flag บังคับเปลี่ยน) — session ต่อเนื่องเลย
      login(data.token);
      setSuccess(forced ? t('changePassword.successForced', 'เปลี่ยนรหัสผ่านสำเร็จ — เข้าสู่ระบบเรียบร้อย') : t('changePassword.success', 'เปลี่ยนรหัสผ่านสำเร็จ'));
      setTimeout(() => router.push('/dashboard'), forced ? 600 : 400);
    } catch (err: any) {
      setError(err.message || t('changePassword.errUnexpected', 'เกิดข้อผิดพลาด — ลองใหม่อีกครั้ง'));
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'input w-full text-white';

  return (
    <div className="card panel-glow p-8 space-y-4 w-full">
      <div className="text-center">
        <div className="flex justify-center text-emerald-400">
          <Icon name="key" size={28} />
        </div>
        <h1 className="mt-2 text-sm font-semibold text-gray-200 tracking-wide glow-text">{t('changePassword.title', 'เปลี่ยนรหัสผ่าน')}</h1>
        {forced ? (
          <p className="text-amber-300 text-sm mt-1 font-semibold flex items-center justify-center gap-1.5">
            <Icon name="alert-triangle" size={13} />
            {t('changePassword.forcedFirstLogin', 'นี่คือ login ครั้งแรก — ต้องเปลี่ยนรหัสผ่านชั่วคราวก่อนเข้าใช้งาน')}
          </p>
        ) : (
          <p className="text-gray-400 text-sm mt-1">{t('changePassword.voluntaryHint', 'ตั้งรหัสผ่านใหม่ (ต้องกรอกรหัสปัจจุบันก่อน)')}</p>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-900/30 border border-red-800/60 text-red-300 text-sm text-center" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-700/40 text-emerald-400 text-sm text-center" role="status">
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {!forced && (
          <div>
            <label className="label">{t('changePassword.currentLabel', 'รหัสผ่านปัจจุบัน')}</label>
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
          <label className="label">{t('changePassword.newLabel', 'รหัสผ่านใหม่')}</label>
          <input
            type="password"
            autoComplete="new-password"
            className={inputCls}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t('changePassword.placeholderMin', 'อย่างน้อย {n} ตัว (มีตัวพิมพ์เล็ก/ใหญ่ ตัวเลข สัญลักษณ์)', { n: MIN_LENGTH })}
            required
            autoFocus={forced}
          />
          {newPassword && (
            <div className="mt-2">
              <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                <div className={`h-full ${strength.color} transition-all`} style={{ width: `${((strength.score + 1) / 5) * 100}%` }} />
              </div>
              <div className="text-[11px] text-gray-400 mt-1">{t('changePassword.strengthLabel', 'ความแข็งแรง: {label}', { label: strengthLabels[strength.score] })}</div>
            </div>
          )}
        </div>

        <div>
          <label className="label">{t('changePassword.confirmLabel', 'ยืนยันรหัสผ่านใหม่')}</label>
          <input
            type="password"
            autoComplete="new-password"
            className={inputCls}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t('changePassword.placeholderRepeat', 'พิมพ์ซ้ำอีกครั้ง')}
            required
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="btn-primary w-full"
        >
          {submitting ? t('changePassword.submitting', 'กำลังบันทึก…') : forced ? t('changePassword.submitForced', 'เปลี่ยนรหัสผ่านและเข้าใช้งาน') : t('changePassword.submit', 'เปลี่ยนรหัสผ่าน')}
        </button>

        {forced && (
          <p className="text-[11px] text-gray-500 text-center font-mono">
            {t('changePassword.gateNote', 'PASSWORD GATE · เปลี่ยนไม่ได้ = ออกจากระบบ (ระบบจะไม่ให้เข้าหน้าอื่นจนกว่าจะเปลี่ยน)')}
          </p>
        )}
      </form>
    </div>
  );
}
