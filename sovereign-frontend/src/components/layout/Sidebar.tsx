"use client";
import { useEffect, useRef, useState } from 'react';
import { useIsSuperadmin } from '../../lib/roles';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRouter } from 'next/router';
import { authFetch } from '../../lib/apiFetch';
import { NAV_GROUPS } from '../../lib/navigation';
import { useFeatureStore } from '../../stores/useFeatureStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { openCommandPalette } from '../CommandPalette';
import Icon from '../ui/Icon';
import { useLanguageStore } from '../../stores/useLanguageStore';

// sidebar เป็น scroll container ของตัวเอง และหน้า (Pages Router) remount ใหม่ทุกครั้งที่สลับ
// → scrollTop หายเป็น 0 ทุกครั้ง จำไว้ระดับ module (module อยู่ข้ามการสลับหน้า) แล้วคืนให้ตอน mount
let savedSidebarScrollTop: number | null = null;

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const asideRef = useRef<HTMLElement>(null);
  const user = useAuthStore((s) => s.user);
  const hasFeature = useFeatureStore((s) => s.has);
  const loadFeatures = useFeatureStore((s) => s.load);
  const t = useLanguageStore((s) => s.t);
  const isSuperadmin = useIsSuperadmin();
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

  // สิทธิ์ฟังก์ชั่นต่อคน: โหลด feature ที่เห็นได้ (ซ้ำได้ ไม่พัง)
  useEffect(() => {
    if (user && !isSuperadmin) loadFeatures();
  }, [user, isSuperadmin, loadFeatures]);

  // บันทึกตำแหน่ง scroll ของ sidebar ก่อนเปลี่ยนหน้า (คลิกเมนู / Command Palette / Back)
  useEffect(() => {
    const save = () => {
      if (asideRef.current) savedSidebarScrollTop = asideRef.current.scrollTop;
    };
    router.events?.on('routeChangeStart', save);
    return () => {
      router.events?.off('routeChangeStart', save);
    };
  }, [router]);

  // คืนตำแหน่ง scroll ให้ sidebar ใหม่ (mount ใหม่ทุกครั้งที่สลับหน้า — หลัง layout เสร็จ)
  useEffect(() => {
    const y = savedSidebarScrollTop;
    if (y === null || !asideRef.current) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (asideRef.current) {
          asideRef.current.scrollTop = y;
          savedSidebarScrollTop = null;
        }
      });
    });
  }, []);

  const hidden = new Set<string>();
  if (enabledModules) {
    if (!enabledModules.includes('inventory')) hidden.add('/inventory');
    if (!enabledModules.includes('farm')) hidden.add('/farm');
  }
  // ซ่อนหน้าที่ไม่มีสิทธิ์ — SUPERADMIN เห็นหมด (has() คืน true เมื่อยังไม่รู้สิทธิ์)
  // sub-view (href มี #hash) ใช้สิทธิ์เดียวกันกับหน้าแม่ — เช็คจาก href ฐาน
  if (!isSuperadmin) {
    for (const item of NAV_GROUPS.flatMap((g) => g.items)) {
      if (!hasFeature(item.href.split('#')[0])) hidden.add(item.href);
    }
  }
  const navGroups = NAV_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => !hidden.has(item.href)) }))
    .filter((group) => group.items.length > 0);

  // หน้าปัจจุบัน (มี hash ด้วย) — ใช้เป็น active state สำหรับ sub-view
  const asPath = router.asPath || pathname;

  return (
    <aside ref={asideRef} className="w-60 shrink-0 bg-gray-900/60 border-r border-gray-800 p-3 space-y-5 hidden md:flex flex-col overflow-y-auto h-screen sticky top-0">
      {/* โลโก้ */}
      <div className="px-2 pt-1">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center shadow-[0_0_12px_rgba(52,211,153,0.25)]">
            <Icon name="shield" size={13} className="text-emerald-400 glow-text" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-gray-100 glow-text">
            SOVEREIGN
          </span>
        </div>
        <div className="eyebrow mt-1.5 pl-0.5">Command Center</div>
      </div>

      {/* ค้นหาหน้า — เปิด Command Palette (Ctrl/Cmd+K ด้วยก็ได้) */}
      <button
        onClick={openCommandPalette}
        className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-gray-800 bg-gray-800/40 text-[13px] text-gray-400 hover:text-cyan-300 hover:border-cyan-800/60 transition-colors cursor-pointer w-full"
      >
        <Icon name="search" size={14} className="text-cyan-400/80" />
        <span className="flex-1 text-left">{t('common.searchPage')}</span>
        <kbd className="text-[10px] text-gray-500 border border-gray-700 rounded px-1 py-0.5">⌘K</kbd>
      </button>

      {navGroups.map((group) => (
        <nav key={group.title} className="space-y-0.5">
          <div className="eyebrow px-2 mb-1.5">{t(group.titleKey, group.title)}</div>
          {group.items.map((item) => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));
            const childActive = (href: string) => {
              const [base, hash] = href.split('#');
              return pathname === base && (hash ? asPath.includes('#' + hash) : true);
            };
            return (
              <div key={item.href} className="space-y-0.5">
                <Link
                  href={item.href} scroll={false}
                  className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] transition-all duration-150 ${
                    active
                      ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 shadow-[0_0_14px_rgba(52,211,153,0.15)]'
                      : 'text-gray-400 hover:bg-gray-800/70 hover:text-gray-200 border border-transparent'
                  }`}
                >
                  <Icon name={item.icon} size={15} className={active ? 'glow-text' : 'opacity-70'} />
                  <span className="truncate">{t(item.labelKey, item.label)}</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    {item.href === '/governance-sim' && (
                      <span
                        title={t('common.simNoCard', 'Governance SIM — ไม่พบซิมการ์ด')}
                        className="text-[9px] font-bold px-1 py-px rounded bg-red-950/60 border border-red-800/70 text-red-400 glow-text-red"
                      >
                        X
                      </span>
                    )}
                    <span className={`w-1.5 h-1.5 rounded-full pulse-soft ${active ? 'bg-emerald-400 glow-dot' : 'bg-emerald-400/40'}`} />
                    {active && <span className="w-1 h-3.5 rounded-full bg-emerald-400/80" />}
                  </span>
                </Link>
                {item.children && item.children.length > 0 && (
                  <div className="ml-4 pl-2.5 border-l border-gray-800/80 space-y-0.5">
                    {item.children.map((child) => {
                      const isChildActive = childActive(child.href);
                      return (
                        <Link
                          key={child.href}
                          href={child.href} scroll={false}
                          className={`flex items-center gap-2.5 px-3 py-1 rounded-lg text-[12px] transition-all duration-150 ${
                            isChildActive
                              ? 'text-emerald-300 bg-emerald-500/5 border border-emerald-500/20'
                              : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50 border border-transparent'
                          }`}
                        >
                          <Icon name={child.icon} size={13} className={isChildActive ? 'glow-text' : 'opacity-60'} />
                          <span className="truncate">{t(child.labelKey, child.label)}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      ))}
    </aside>
  );
}
