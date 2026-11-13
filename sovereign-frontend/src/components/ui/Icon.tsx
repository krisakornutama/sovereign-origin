"use client";

// ─────────────────────────────────────────────────────────────
//  Icon — ชุดไอคอนเส้นบาง (stroke) 24x24 สำหรับทั้งแอป
//  ใช้แทน emoji ในส่วน UI เพื่อให้ดูเป็นระบบเดียวกัน
//  ใช้งาน: <Icon name="dashboard" size={16} className="text-gray-400" />
//  ตารางรูปทรง (ICONS) อยู่ที่ lib/iconPaths.tsx (FE-001)
// ─────────────────────────────────────────────────────────────
import React from 'react';
import { ICONS } from '../../lib/iconPaths';

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 16,
  className = '',
  strokeWidth = 1.8,
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name] ?? <circle cx="12" cy="12" r="9" />}
    </svg>
  );
}

export default Icon;