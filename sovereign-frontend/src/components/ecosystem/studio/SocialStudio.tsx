"use client";
// components/ecosystem/studio/SocialStudio.tsx
// ────────────────────────────────────────────────────────────────────────────
// Social Studio — ศูนย์โพสต์ของเจ้าของ อยู่ใน Ecosystem (ไม่ใช่หน้าธุรกิจอีกต่อไป)
//
// แยก 2 งานให้ชัดเจนตามที่เจ้าของสั่ง:
//   1) โพสต์ข้อความ / เรื่องทั่วไป  → Facebook เท่านั้น
//   2) ลงคลิปวิดีโอ                  → YouTube · Instagram · TikTok · Facebook
//
// ⚠ บัญชีทั้งหมดดึงจาก Ecosystem (อีเมลที่ผูกไว้บนเครื่อง) — ไม่มีการล็อกอินซ้ำในหน้านี้
// ────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';

import Icon from '../../ui/Icon';
import type { EcosystemAccount } from '../types';
import ClipStudio from './ClipStudio';
import PostHistory from './PostHistory';
import TextStudio from './TextStudio';
import { accountsForPlatform } from './studio-model';

type StudioMode = 'text' | 'clip' | 'history';

const CLIP_PLATFORMS = ['youtube', 'facebook', 'instagram', 'tiktok'] as const;

export interface SocialStudioProps {
  accounts: EcosystemAccount[];
  onAddAccount: (platform: string) => void;
}

export default function SocialStudio({ accounts, onAddAccount }: SocialStudioProps) {
  const [mode, setMode] = useState<StudioMode>('text');

  const fbCount = useMemo(() => accountsForPlatform(accounts, 'facebook').length, [accounts]);
  const clipCount = useMemo(() => {
    const ids = new Set<string>();
    for (const platform of CLIP_PLATFORMS) {
      for (const option of accountsForPlatform(accounts, platform)) ids.add(option.id);
    }
    return ids.size;
  }, [accounts]);

  const modes: Array<{
    key: StudioMode;
    icon: 'note' | 'play' | 'history';
    title: string;
    sub: string;
    badge: string;
    accent: string;
    ring: string;
  }> = [
    {
      key: 'text',
      icon: 'note',
      title: 'โพสต์ข้อความ',
      sub: 'เรื่องทั่วไป · โปรโมชัน · อัปเดตงาน → Facebook',
      badge: fbCount > 0 ? `${fbCount} บัญชี Facebook` : 'ยังไม่มีบัญชี Facebook',
      accent: 'text-[#7ab5ff]',
      ring: 'border-[#1877f2]/60 bg-[#1877f2]/10',
    },
    {
      key: 'clip',
      icon: 'play',
      title: 'ลงคลิปวิดีโอ',
      sub: 'YouTube · Instagram · TikTok · Facebook',
      badge: clipCount > 0 ? `${clipCount} บัญชีพร้อมใช้` : 'ยังไม่มีบัญชีโซเชียล',
      accent: 'text-rose-300',
      ring: 'border-rose-500/60 bg-rose-500/10',
    },
    {
      key: 'history',
      icon: 'history',
      title: 'ประวัติการโพสต์',
      sub: 'ติดตามว่าทำแพลตฟอร์มไหนแล้ว — กันโพสต์ซ้ำ',
      badge: 'บันทึกในฐานข้อมูล',
      accent: 'text-emerald-300',
      ring: 'border-emerald-500/60 bg-emerald-500/10',
    },
  ];

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-3" aria-label="เลือกงานที่ต้องการ">
        {modes.map((m) => {
          const active = mode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              aria-pressed={active}
              onClick={() => setMode(m.key)}
              className={`group flex items-start gap-3 rounded-2xl border p-4 text-left transition-all ${
                active
                  ? `${m.ring} shadow-lg shadow-black/20`
                  : 'border-slate-700 bg-slate-800/40 hover:border-slate-500 hover:bg-slate-800/70'
              }`}
            >
              <span
                className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                  active ? 'border-white/20 bg-white/10' : 'border-slate-600 bg-slate-900/60'
                } ${m.accent}`}
              >
                <Icon name={m.icon} size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-100">{m.title}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${
                      active
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                        : 'border-slate-600 text-gray-400'
                    }`}
                  >
                    {m.badge}
                  </span>
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed text-gray-500">{m.sub}</span>
              </span>
              <span className={`mt-1 text-xs ${active ? 'text-emerald-300' : 'text-gray-600'}`}>
                {active ? '● กำลังใช้งาน' : '○'}
              </span>
            </button>
          );
        })}
      </section>

      {mode === 'text' && <TextStudio accounts={accounts} onAddAccount={onAddAccount} />}
      {mode === 'clip' && <ClipStudio accounts={accounts} onAddAccount={onAddAccount} />}
      {mode === 'history' && <PostHistory />}
    </div>
  );
}
