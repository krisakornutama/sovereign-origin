"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { openCommandPalette } from '../CommandPalette';
import { useFeatureStore } from '../../stores/useFeatureStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLanguageStore } from '../../stores/useLanguageStore';
import Icon from '../ui/Icon';

// เมนูหลักบนมือถือ/แท็บเล็ต — Sidebar จะหายไปบนจอเล็ก เลยต้องมีทางนำทางนี้
// (เลื่อนแนวนอนได้ — มีครบทุกหน้า ไม่ต้องไปหาเมนู)
const ITEMS: Array<{ href: string; label: string; labelKey: string; icon: string }> = [
  { href: '/dashboard', label: 'หน้าหลัก', labelKey: 'common.nav.dashboard', icon: 'dashboard' },
  { href: '/change-password', label: 'รหัสผ่าน', labelKey: 'common.nav.changePassword', icon: 'key' },
  { href: '/sensors', label: 'อุปกรณ์และเซ็นเซอร์', labelKey: 'common.nav.sensors', icon: 'sensors' },
  { href: '/energy', label: 'พลังงาน', labelKey: 'common.nav.energy', icon: 'energy' },
  { href: '/predictive', label: 'พยากรณ์', labelKey: 'common.nav.predictive', icon: 'predictive' },
  { href: '/ai', label: 'AI Command', labelKey: 'common.nav.ai', icon: 'ai' },
  { href: '/ai-agent', label: 'AI Agent', labelKey: 'common.nav.aiAgent', icon: 'ai-agent' },
  { href: '/security', label: 'ความปลอดภัย', labelKey: 'common.nav.security', icon: 'security' },
  { href: '/property', label: 'แผนที่บ้าน', labelKey: 'common.nav.property', icon: 'property' },
  { href: '/risk-monitor', label: 'ความเสี่ยง', labelKey: 'common.nav.riskMonitor', icon: 'risk' },
  { href: '/knowledge', label: 'คลังความรู้', labelKey: 'common.nav.knowledge', icon: 'knowledge' },
  { href: '/inventory', label: 'เสบียง', labelKey: 'common.nav.inventory', icon: 'inventory' },
  { href: '/farm', label: 'ฟาร์ม', labelKey: 'common.nav.farm', icon: 'farm' },
  { href: '/livestock', label: 'ปศุสัตว์', labelKey: 'common.nav.livestock', icon: 'farm' },
  { href: '/treasury', label: 'การเงิน', labelKey: 'common.nav.treasury', icon: 'portfolio' },
  { href: '/health', label: 'สุขภาพ', labelKey: 'common.nav.health', icon: 'health' },
  { href: '/healing', label: 'ธรรมะบำบัด', labelKey: 'common.nav.healing', icon: 'healing' },
  { href: '/system', label: 'ระบบ', labelKey: 'common.nav.system', icon: 'system' },
  { href: '/settings', label: 'ตั้งค่า', labelKey: 'common.nav.settings', icon: 'settings' },
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
