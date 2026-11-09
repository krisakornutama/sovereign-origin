// src/components/nav/NetworkIndicator.tsx — Transparent Offline UX Badge
//
// กติกา (คำสั่งเจ้าของ Sprint 2 ระยะ 3 · Transparent Offline UX):
//   - presentational เพียว — รับ state, queuedCount, label/pendingLabel จาก container (i18n)
//   - syncing ชนะทุกสถานะ · offline ชนะ online · ไม่มี onSync = span · มี onSync = button
//   - role="status" + aria-live="polite" สำหรับ a11y (สถานะเปลี่ยนฟ้องเงียบได้)
//   - จุดสี: online=emerald, offline=orange, syncing=sky + animate-pulse
import React, { useMemo } from 'react';

export type NetworkState = 'online' | 'offline' | 'syncing';

export interface NetworkIndicatorProps {
  state: NetworkState;
  queuedCount: number;
  /** label override สำหรับ i18n container — fallback ไทย literal (presentational ไม่ bind สมองสโตร์) */
  label?: string;
  /** pendingLabel override — fallback ไทย literal · '{n}' = placeholder จำนวนคิว */
  pendingLabel?: string;
  /** ถ้ามี = เรนเดอร์เป็น <button> และคลิกได้เพื่อ syncNow · ไม่มี = <span> */
  onSync?: () => void;
}

export function networkState(isOnline: boolean, queuedCount: number, syncing: boolean): NetworkState {
  if (syncing) return 'syncing';
  if (!isOnline) return 'offline';
  return 'online';
}

export function NetworkIndicatorBadge({
  state,
  queuedCount,
  label,
  pendingLabel,
  onSync,
}: NetworkIndicatorProps): React.ReactElement {
  const isSyncing = state === 'syncing';
  const isOffline = state === 'offline';

  const baseClass = useMemo(() => {
    if (isSyncing) return 'bg-sky-400 animate-pulse';
    if (isOffline) return 'bg-orange-400';
    return 'bg-emerald-400';
  }, [isSyncing, isOffline]);

  const statusLabel = useMemo(() => {
    if (label) return label;
    if (isSyncing) return 'กำลังซิงก์';
    if (isOffline) return 'ออฟไลน์';
    return 'ออนไลน์';
  }, [label, isSyncing, isOffline]);

  const pendingText = useMemo(() => {
    if (queuedCount <= 0) return '';
    if (pendingLabel) return pendingLabel.replace('{n}', String(queuedCount));
    return `${queuedCount} รายการรอส่ง`;
  }, [pendingLabel, queuedCount]);

  const Component = onSync ? 'button' : 'span';
  const clickHandler = onSync
    ? { onClick: onSync, type: 'button' as const }
    : {};

  return (
    <Component
      {...clickHandler}
      className={`
        inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
        text-gray-950 ${baseClass}
        ${onSync ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}
        focus:outline-none focus:ring-2 focus:ring-sky-400/50
      `}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      title={pendingText || statusLabel}
    >
      <span
        className="w-2 h-2 rounded-full bg-current"
        aria-hidden="true"
      />
      <span className="hidden sm:inline">{statusLabel}</span>
      {pendingText && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/20 text-[10px] font-semibold whitespace-nowrap">
          {pendingText}
        </span>
      )}
    </Component>
  );
}