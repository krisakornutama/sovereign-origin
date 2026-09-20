"use client";

// ─────────────────────────────────────────────────────────────
//  Command Palette (⌘K / Ctrl+K) — ค้นหาหน้า/คำสั่งทั่วทั้งแอป
//  เปิด: Ctrl+K (Windows) / Cmd+K (Mac) หรือกดปุ่มค้นหาใน Sidebar
//  ใช้: ↑↓ เลือก · Enter เปิด · Esc ปิด
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsSuperadmin } from '../lib/roles';
import { useRouter } from 'next/router';
import { ALL_PAGES } from '../lib/navigation';
import { useFeatureStore } from '../stores/useFeatureStore';
import { useAuthStore } from '../stores/useAuthStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { themeClassForPath } from './ui/PageHeader';
import { useCircadianAtmo, atmoNavStyle } from '../lib/useCircadian';
import Icon from './ui/Icon';

const PALETTE_EVENT = 'sovereign:palette';

/** เปิด palette จากปุ่มอื่น (Sidebar/MobileNav) — ส่ง event ไปให้ host ฟัง */
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT));
}

export function useCommandPaletteOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onEvent = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(PALETTE_EVENT, onEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(PALETTE_EVENT, onEvent);
    };
  }, []);
  return { open, setOpen };
}

type Result = { href: string; label: string; labelKey: string; icon: string; group: string; groupKey: string; score: number };

function scoreItem(q: string, item: { label: string; href: string; keywords?: string }): number {
  const s = q.toLowerCase();
  const label = item.label.toLowerCase();
  const keywords = (item.keywords || '').toLowerCase();
  if (label.startsWith(s)) return 100 - (label.length - s.length) * 0.5;
  if (label.includes(s)) return 60;
  if (keywords.includes(s)) return 40;
  if (item.href.includes(s)) return 20;
  return 0;
}

export default function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const router = useRouter();
  // สีเน้นของ palette ตามธีมหน้าปัจจุบัน (atmo-*) — ไม่มีธีม = ตามเวลาของวัน (circadian)
  // (เรียก hook ตรง ๆ เสมอ — hook ห้ามเรียกแบบมีเงื่อนไข; pathname ไม่เอา hash)
  const routeAtmo = themeClassForPath(router.pathname || '/');
  const circadianAtmo = useCircadianAtmo();
  const atmo = routeAtmo || circadianAtmo;
  const user = useAuthStore((s) => s.user);
  const hasFeature = useFeatureStore((s) => s.has);
  const loadFeatures = useFeatureStore((s) => s.load);
  const t = useLanguageStore((s) => s.t);
  const isSuperadmin = useIsSuperadmin();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // หน้า admin (system/backup/users/audit/settings) — SUPERADMIN เท่านั้น
  const ADMIN_PAGES = new Set(['/system', '/backup', '/users', '/audit', '/settings']);
  const visiblePages = useMemo(() => {
    if (isSuperadmin) return ALL_PAGES;
    // sub-view (href มี #hash) ใช้สิทธิ์เดียวกันกับหน้าแม่ — เช็คจาก href ฐาน
    return ALL_PAGES.filter((p) => !ADMIN_PAGES.has(p.href) && hasFeature(p.href.split('#')[0]));
  }, [isSuperadmin, hasFeature]);

  // โหลดสิทธิ์เมื่อเปิด palette (เผื่อ store ยังไม่โหลด)
  useEffect(() => {
    if (open && user && !isSuperadmin) loadFeatures();
  }, [open, user, isSuperadmin, loadFeatures]);

  const results: Result[] = useMemo(() => {
    const q = query.trim();
    if (!q) return visiblePages.map((p) => ({ ...p, score: 50 }));
    return visiblePages.map((p) => ({ ...p, score: scoreItem(q, p) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 14);
  }, [query, visiblePages]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  useEffect(() => setActive(0), [query]);

  // เลื่อนรายการให้ตัวเลือกที่ active อยู่ใน view
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href, undefined, { scroll: false });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { if (results[active]) go(results[active].href); }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4"
      style={atmoNavStyle(atmo)}
      onMouseDown={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label={t('common.searchPage', 'ค้นหาหน้า...')}
    >
      <div
        className="w-full max-w-lg bg-gray-900 border border-gray-800 rounded-xl shadow-2xl shadow-black/50 overflow-hidden"
        style={{ borderColor: 'color-mix(in srgb, var(--atmo-nav) 22%, #1f2937)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* ช่องค้นหา */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
          <Icon name="search" size={15} className="text-gray-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('common.searchPage')}
            className="flex-1 bg-transparent outline-none text-gray-100 placeholder-gray-500 text-sm"
          />
          <kbd className="text-[10px] text-gray-500 border border-gray-700 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        {/* ผลลัพธ์ */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              {t('common.noResults', 'ไม่พบหน้าที่ค้นหา')} "{query}"
            </div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.href}
                onClick={() => go(r.href)}
                onMouseEnter={() => setActive(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  i === active ? '' : 'text-gray-300'
                }`}
                style={i === active ? {
                  color: 'var(--atmo-nav-text)',
                  backgroundColor: 'color-mix(in srgb, var(--atmo-nav) 10%, transparent)',
                } : undefined}
              >
                <Icon name={r.icon} size={15} className={i === active ? '' : 'text-gray-500'} style={i === active ? { color: 'var(--atmo-nav-text)' } : undefined} />
              <span className="flex-1 min-w-0">
                <span className="block truncate">{t(r.labelKey, r.label)}</span>
                <span className="block text-[10px] text-gray-500">{t(r.groupKey, r.group)}</span>
              </span>
              {i === active && <span className="text-[10px]" style={{ color: 'var(--atmo-nav)' }}>↵ {t('common.open', 'เปิด')}</span>}
              </button>
            ))
          )}
        </div>

        <div className="px-4 py-2 border-t border-gray-800 text-[10px] text-gray-500 flex gap-3">
          <span>↑↓ {t('common.select', 'เลือก')}</span>
          <span>↵ {t('common.open', 'เปิด')}</span>
          <span>Esc {t('common.close', 'ปิด')}</span>
          <span className="ml-auto">{results.length} {t('common.pages', 'หน้า')}</span>
        </div>
      </div>
    </div>
  );
}
