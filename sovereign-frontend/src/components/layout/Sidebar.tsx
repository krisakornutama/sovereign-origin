"use client";
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { authFetch } from '../../lib/apiFetch';
import { NAV_GROUPS } from '../../lib/navigation';
import { openCommandPalette } from '../CommandPalette';

const GROUP_COLORS = [
  'text-emerald-400',
  'text-cyan-400',
  'text-rose-400',
  'text-violet-400',
  'text-amber-400',
  'text-blue-400',
];

export default function Sidebar() {
  const pathname = usePathname();
  // โมดูลที่เปิดใช้งาน (จาก GET /api/modules) — fetch ไม่สำเร็จ = แสดงทุกเมนู
  const [enabledModules, setEnabledModules] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/modules`);
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setEnabledModules(body.enabled ?? []);
      } catch {
        // offline — แสดงทุกเมนูตามค่าเริ่มต้น
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hidden = new Set<string>();
  if (enabledModules) {
    if (!enabledModules.includes('inventory')) hidden.add('/inventory');
    if (!enabledModules.includes('farm')) hidden.add('/farm');
  }
  const navGroups = NAV_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => !hidden.has(item.href)) }))
    .filter((group) => group.items.length > 0);

  return (
    <aside className="w-64 shrink-0 bg-gray-900/70 border-r border-gray-800 p-4 space-y-5 hidden md:flex flex-col backdrop-blur-md overflow-y-auto h-screen sticky top-0">
      {/* โลโก้ */}
      <div className="px-2 pt-1">
        <div className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-300 tracking-tight">
          ⬢ SOVEREIGN
        </div>
        <div className="text-[10px] text-gray-500 tracking-[0.25em] uppercase mt-0.5">Command Center</div>
      </div>

      {/* ค้นหาหน้า — เปิด Command Palette (Ctrl/Cmd+K ด้วยก็ได้) */}
      <button
        onClick={openCommandPalette}
        className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-gray-800 bg-gray-800/40 text-[13px] text-gray-400 hover:text-gray-200 hover:border-gray-700 transition-colors cursor-pointer w-full"
      >
        <span className="text-sm">🔍</span>
        <span className="flex-1 text-left">ค้นหาหน้า...</span>
        <kbd className="text-[10px] text-gray-500 border border-gray-700 rounded px-1 py-0.5">⌘K</kbd>
      </button>

      {navGroups.map((group, gi) => (
        <nav key={group.title} className="space-y-1">
          <div className={`text-[10px] uppercase tracking-[0.2em] px-2 mb-1 font-semibold ${GROUP_COLORS[gi % GROUP_COLORS.length]}`}>
            {group.title}
          </div>
          {group.items.map((item) => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));
            return (
              <a
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] transition-all duration-150 ${
                  active
                    ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                    : 'text-gray-400 hover:bg-gray-800/70 hover:text-gray-200 border border-transparent'
                }`}
              >
                <span className={active ? '' : 'opacity-80'}>{item.icon}</span>
                {item.label}
                {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.9)]" />}
              </a>
            );
          })}
        </nav>
      ))}
    </aside>
  );
}
