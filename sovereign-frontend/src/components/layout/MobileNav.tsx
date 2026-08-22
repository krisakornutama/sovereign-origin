"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { openCommandPalette } from '../CommandPalette';
import { useFeatureStore } from '../../stores/useFeatureStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLanguageStore } from '../../stores/useLanguageStore';
import Icon from '../ui/Icon';
import { NAV_GROUPS } from '../../lib/navigation';

// เมนูหลักบนมือถือ/แท็บเล็ต — Sidebar จะหายไปบนจอเล็ก เลยต้องมีทางนำทางนี้
// (flex-wrap แสดงครบทุกเมนู ไม่ต้องไปหาเมนู)
// รายการมาจาก NAV_GROUPS ใน lib/navigation.ts โดยตรง — หน้าใหม่ที่เพิ่มที่นั่น
// จะไปโผล่บนมือถืออัตโนมัติ (เดิม hardcode ซ้ำแล้วตกขบวนหน้าใหม่ เช่น /restaurant)
const ITEMS: Array<{ href: string; label: string; labelKey: string; icon: string }> = [
  ...NAV_GROUPS.flatMap((g) => g.items),
  { href: 'palette', label: 'ค้นหา', labelKey: 'common.search', icon: 'search' },
];

export default function MobileNav() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const hasFeature = useFeatureStore((s) => s.has);
  const loadFeatures = useFeatureStore((s) => s.load);
  const t = useLanguageStore((s) => s.t);
  const isSuperadmin = user?.role === 'SUPERADMIN';

  useEffect(() => {
    if (user && !isSuperadmin) loadFeatures();
  }, [user, isSuperadmin, loadFeatures]);

  // ซ่อนหน้าที่ไม่มีสิทธิ์ — SUPERADMIN เห็นหมด (has() คืน true เมื่อยังไม่รู้สิทธิ์)
  const visibleItems = ITEMS.filter(
    (item) => item.href === 'palette' || isSuperadmin || hasFeature(item.href)
  );
  const active = (href: string) =>
    pathname === href || (href !== '/dashboard' && pathname.startsWith(href + '/'));

  return (
    <nav
      aria-label={t('common.mobileMenu', 'เมนูหลัก (มือถือ)')}
      className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-gray-900/95 border-t border-gray-800 backdrop-blur-md"
    >
      {/* flex-wrap: แสดงครบทุกเมนู (เดิมเลื่อนแนวนอนแล้วคนไม่รู้ว่ามีเมนูต่อ) */}
      <div className="flex flex-wrap justify-center">
        {visibleItems.map((item) =>
          item.href === 'palette' ? (
            <button
              key="palette"
              onClick={openCommandPalette}
              className="flex flex-col items-center justify-center gap-1 px-3 py-2 border-t-2 border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/60"
            >
              <Icon name={item.icon} size={17} />
              <span className="text-[10px] font-medium">{t(item.labelKey, item.label)}</span>
            </button>
          ) : (
          <Link
            key={item.href}
            href={item.href} scroll={false}
            className={`flex flex-col items-center justify-center gap-1 px-3 py-2 border-t-2 transition ${
              active(item.href)
                ? 'border-emerald-400 text-emerald-300 bg-emerald-500/10 shadow-[0_-2px_12px_rgba(52,211,153,0.2)]'
                : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
            }`}
          >
            <Icon name={item.icon} size={17} />
            <span className="text-[10px] font-medium">{t(item.labelKey, item.label)}</span>
          </Link>
          )
        )}
      </div>
      {/* พื้นที่กันเนื้อหาถูกบังโดยแถบนำทาง */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
