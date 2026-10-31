"use client";

import Icon from '../ui/Icon';
import type { EcosystemAccount, EcosystemPlatform } from './types';

interface Props {
  account: EcosystemAccount;
  platform?: EcosystemPlatform;
  revealed: string | null;
  busy: boolean;
  onOpen: () => void;
  onReveal: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  active: 'ใช้งาน',
  paused: 'พักไว้',
  archived: 'เก็บถาวร',
};

export default function AccountCard({
  account,
  platform,
  revealed,
  busy,
  onOpen,
  onReveal,
  onCopy,
  onEdit,
  onDelete,
}: Props) {
  const color = platform?.color || '#38bdf8';
  const initial = (platform?.name || account.platformName || '?').slice(0, 1).toUpperCase();
  const stale = account.hasPassword && account.passwordAgeDays !== null && account.passwordAgeDays > 180;

  return (
    <article className="card card-hover relative overflow-hidden p-4">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: `linear-gradient(180deg, ${color}, transparent)` }}
      />

      <div className="flex items-start gap-3 pl-2">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
          style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}
        >
          {initial}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-gray-100">{account.label}</h3>
              <p className="mt-0.5 text-[11px] text-gray-500">{account.platformName}</p>
            </div>
            <span
              className={
                'shrink-0 rounded-full border px-2 py-0.5 text-[10px] ' +
                (account.status === 'active'
                  ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300'
                  : account.status === 'paused'
                    ? 'border-amber-700/60 bg-amber-950/40 text-amber-300'
                    : 'border-gray-700 bg-gray-800/60 text-gray-400')
              }
            >
              {STATUS_LABEL[account.status] || account.status}
            </span>
          </div>

          <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
            <Icon name="users" size={12} />
            <span className="truncate" title={account.loginId || undefined}>
              {account.loginId || 'ยังไม่ได้ใส่ชื่อผู้ใช้/อีเมล'}
            </span>
          </div>

          <div className="mt-1.5 flex items-center gap-1.5 text-xs">
            <Icon name="key" size={12} />
            {revealed ? (
              <code className="max-w-[220px] truncate rounded bg-gray-800/80 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300">
                {revealed}
              </code>
            ) : (
              <span className={account.hasPassword ? 'text-gray-400' : 'text-amber-400'}>
                {account.hasPassword ? '•••••••• (ซ่อนอยู่)' : 'ยังไม่มีรหัสผ่าน — กด “เพิ่มรหัส”'}
              </span>
            )}
          </div>

          {stale ? (
            <p className="mt-1.5 text-[11px] text-amber-400">
              รหัสนี้ไม่ได้เปลี่ยน {account.passwordAgeDays} วัน — ควรเปลี่ยน
            </p>
          ) : null}

          {account.notes ? (
            <p className="mt-1.5 line-clamp-2 text-[11px] text-gray-500">{account.notes}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 pl-2">
        <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={onOpen}>
          <Icon name="external" size={13} />
          เปิดเว็บ
        </button>
        <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={busy} onClick={onReveal}>
          <Icon name={account.hasPassword ? 'eye' : 'key'} size={13} />
          {!account.hasPassword ? 'เพิ่มรหัส' : revealed ? 'ซ่อน' : 'แสดงรหัส'}
        </button>
        <button
          type="button"
          className="btn-secondary px-3 py-1.5 text-xs"
          disabled={busy || !account.hasPassword}
          onClick={onCopy}
          title={account.hasPassword ? 'คัดลอกรหัสผ่าน' : 'ยังไม่มีรหัสผ่านให้คัดลอก'}
        >
          <Icon name="save" size={13} />
          คัดลอก
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="btn-ghost px-2 py-1.5 text-xs"
            disabled={busy}
            onClick={onEdit}
            title="แก้ไข"
          >
            <Icon name="edit" size={13} />
          </button>
          <button
            type="button"
            className="btn-ghost px-2 py-1.5 text-xs text-red-300 hover:text-red-200"
            disabled={busy}
            onClick={onDelete}
            title="ลบ"
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
    </article>
  );
}
