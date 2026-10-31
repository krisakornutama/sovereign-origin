"use client";

import { useState } from 'react';
import Icon from '../ui/Icon';
import type { AccountFormValues, EcosystemPlatform } from './types';

interface Props {
  mode: 'create' | 'edit';
  initial: AccountFormValues;
  platforms: EcosystemPlatform[];
  saving: boolean;
  error: string;
  onSubmit: (values: AccountFormValues, removePassword: boolean) => void;
  onClose: () => void;
}

export default function AccountForm({ mode, initial, platforms, saving, error, onSubmit, onClose }: Props) {
  const [values, setValues] = useState<AccountFormValues>(initial);
  const [showPassword, setShowPassword] = useState(false);
  const [removePassword, setRemovePassword] = useState(false);
  const [localError, setLocalError] = useState('');

  const set = <K extends keyof AccountFormValues>(key: K, value: AccountFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setLocalError('');
  };

  const platform = platforms.find((p) => p.id === values.platform);
  const editing = mode === 'edit';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const label = values.label.trim();
    if (!label) {
      setLocalError('ต้องใส่ชื่อบัญชี');
      return;
    }
    const url = values.url.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      setLocalError('URL ต้องขึ้นต้นด้วย http:// หรือ https://');
      return;
    }
    onSubmit(
      {
        ...values,
        label,
        url,
        loginId: values.loginId.trim(),
        notes: values.notes.trim(),
      },
      removePassword,
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? 'แก้ไขบัญชี' : 'เพิ่มบัญชีใหม่'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form onSubmit={submit} className="panel w-full max-w-2xl space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Ecosystem</p>
            <h2 className="mt-1 text-lg font-semibold text-gray-100">
              {editing ? 'แก้ไขบัญชี' : 'เพิ่มบัญชีใหม่'}
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              รหัสผ่านถูกเข้ารหัส AES-256-GCM ก่อนเก็บ — ระบบจะไม่แสดงรหัสในรายการ
            </p>
          </div>
          <button type="button" className="btn-ghost p-2" onClick={onClose} aria-label="ปิด">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="eco-platform">Platform</label>
            <select
              id="eco-platform"
              className="input w-full"
              value={values.platform}
              onChange={(e) => {
                const next = platforms.find((p) => p.id === e.target.value);
                setValues((v) => ({
                  ...v,
                  platform: e.target.value,
                  url: v.url || next?.url || '',
                }));
              }}
            >
              {platforms.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {platform?.hint ? <p className="mt-1 text-[11px] text-gray-500">ปกติใช้: {platform.hint}</p> : null}
          </div>

          <div>
            <label className="label" htmlFor="eco-label">ชื่อบัญชี (ตั้งเอง)</label>
            <input
              id="eco-label"
              className="input w-full"
              value={values.label}
              maxLength={80}
              placeholder="เช่น Fiverr รับงานเขียน"
              onChange={(e) => set('label', e.target.value)}
              autoFocus
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="eco-url">URL หน้าเข้าใช้งาน</label>
            <input
              id="eco-url"
              className="input w-full"
              value={values.url}
              maxLength={500}
              placeholder="https://..."
              onChange={(e) => set('url', e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="eco-login">ชื่อผู้ใช้ / อีเมล</label>
            <input
              id="eco-login"
              className="input w-full"
              value={values.loginId}
              maxLength={200}
              placeholder="อีเมลที่ใช้สมัคร"
              autoComplete="off"
              onChange={(e) => set('loginId', e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="eco-password">รหัสผ่าน</label>
            <div className="flex gap-2">
              <input
                id="eco-password"
                className="input w-full font-mono"
                type={showPassword ? 'text' : 'password'}
                value={values.password}
                maxLength={500}
                placeholder={editing ? 'เว้นว่าง = ใช้รหัสเดิม' : 'ใส่รหัสผ่าน'}
                autoComplete="new-password"
                onChange={(e) => set('password', e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary px-3"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'ซ่อนรหัส' : 'แสดงรหัส'}
              >
                <Icon name={showPassword ? 'lock' : 'eye'} size={14} />
              </button>
            </div>
            {editing ? (
              <label className="mt-2 flex items-center gap-2 text-[11px] text-gray-400">
                <input
                  type="checkbox"
                  checked={removePassword}
                  onChange={(e) => setRemovePassword(e.target.checked)}
                />
                ลบรหัสผ่านที่บันทึกไว้
              </label>
            ) : null}
          </div>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="eco-notes">บันทึกเพิ่มเติม</label>
            <textarea
              id="eco-notes"
              className="input min-h-[72px] w-full"
              value={values.notes}
              maxLength={2000}
              placeholder="เช่น ใช้สมัครงาน / อีเมลสำรอง / ข้อตกลงกับลูกค้า"
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="eco-status">สถานะ</label>
            <select
              id="eco-status"
              className="input w-full"
              value={values.status}
              onChange={(e) => set('status', e.target.value)}
            >
              <option value="active">ใช้งาน</option>
              <option value="paused">พักไว้</option>
              <option value="archived">เก็บถาวร</option>
            </select>
          </div>
        </div>

        {localError || error ? (
          <p className="rounded-lg border border-red-800/70 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {localError || error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            <Icon name="save" size={14} />
            {saving ? 'กำลังบันทึก...' : editing ? 'บันทึกการแก้ไข' : 'เพิ่มบัญชี'}
          </button>
        </div>
      </form>
    </div>
  );
}
