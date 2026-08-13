"use client";

// ─────────────────────────────────────────────────────────────
//  Command Palette (⌘K / Ctrl+K) — ค้นหาหน้า/คำสั่งทั่วทั้งแอป
//  เปิด: Ctrl+K (Windows) / Cmd+K (Mac) หรือกดปุ่มค้นหาใน Sidebar
//  ใช้: ↑↓ เลือก · Enter เปิด · Esc ปิด
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ALL_PAGES } from '../lib/navigation';

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

type Result = { href: string; label: string; icon: string; group: string; score: number };

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
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results: Result[] = useMemo(() => {
    const q = query.trim();
    if (!q) return ALL_PAGES.map((p) => ({ ...p, score: 50 }));
    return ALL_PAGES.map((p) => ({ ...p, score: scoreItem(q, p) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 14);
  }, [query]);

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
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { if (results[active]) go(results[active].href); }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4"
      onMouseDown={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="ค้นหาหน้า"
    >
      <div
        className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* ช่องค้นหา */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
          <span className="text-gray-500 text-lg">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="ค้นหาหน้า... (เช่น ความปลอดภัย, ฟาร์ม, wealth)"
            className="flex-1 bg-transparent outline-none text-gray-100 placeholder-gray-500 text-sm"
          />
          <kbd className="text-[10px] text-gray-500 border border-gray-700 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        {/* ผลลัพธ์ */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              ไม่พบหน้า "{query}" — ลองคำอื่น เช่น 'ai', 'ไฟ', 'เงิน'
            </div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.href}
                onClick={() => go(r.href)}
                onMouseEnter={() => setActive(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  i === active ? 'bg-emerald-500/10 text-emerald-300' : 'text-gray-300'
                }`}
              >
                <span className="text-base">{r.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{r.label}</span>
                  <span className="block text-[10px] text-gray-500">{r.group}</span>
                </span>
                {i === active && <span className="text-[10px] text-emerald-400">↵ เปิด</span>}
              </button>
            ))
          )}
        </div>

        <div className="px-4 py-2 border-t border-gray-800 text-[10px] text-gray-500 flex gap-3">
          <span>↑↓ เลือก</span>
          <span>↵ เปิด</span>
          <span>Esc ปิด</span>
          <span className="ml-auto">{results.length} หน้า</span>
        </div>
      </div>
    </div>
  );
}
