"use client";
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { openCommandPalette } from '../CommandPalette';
import { useFeatureStore } from '../../stores/useFeatureStore';
import { useAuthStore } from '../../stores/useAuthStore';

// เมนูหลักบนมือถือ/แท็บเล็ต — Sidebar จะหายไปบนจอเล็ก เลยต้องมีทางนำทางนี้
// (เลื่อนแนวนอนได้ — มีครบทุกหน้า ไม่ต้องไปหาเมนู)
const ITEMS: Array<{ href: string; label: string; icon: string }> = [
  { href: '/dashboard', label: 'หน้าหลัก', icon: '🏰' },
  { href: '/change-password', label: 'รหัสผ่าน', icon: '🔑' },
  { href: '/sensors', label: 'อุปกรณ์และเซ็นเซอร์', icon: '📡' },
  { href: '/energy', label: 'พลังงาน', icon: '⚡' },
  { href: '/predictive', label: 'พยากรณ์', icon: '🔮' },
  { href: '/ai', label: 'AI Command', icon: '🧠' },
  { href: '/ai-agent', label: 'AI Agent', icon: '🤖' },
  { href: '/security', label: 'ความปลอดภัย', icon: '🛡️' },
  { href: '/property', label: 'แผนที่บ้าน', icon: '🗺️' },
  { href: '/risk-monitor', label: 'ความเสี่ยง', icon: '📰' },
  { href: '/knowledge', label: 'คลังความรู้', icon: '📚' },
  { href: '/inventory', label: 'เสบียง', icon: '📦' },
  { href: '/farm', label: 'ฟาร์ม', icon: '🌱' },
  { href: '/portfolio', label: 'การเงิน', icon: '💰' },
  { href: '/health', label: 'สุขภาพ', icon: '🩺' },
  { href: '/healing', label: 'ธรรมะบำบัด', icon: '🧘' },
  { href: '/system', label: 'ระบบ', icon: '🔧' },
  { href: '/settings', label: 'ตั้งค่า', icon: '🛠️' },
  { href: 'palette', label: 'ค้นหา', icon: '🔍' },
];

export default function MobileNav() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const hasFeature = useFeatureStore((s) => s.has);
  const loadFeatures = useFeatureStore((s) => s.load);
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
      aria-label="เมนูหลัก (มือถือ)"
      className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-gray-900/95 border-t border-gray-800 backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.35)]"
    >
      {/* flex-wrap: แสดงครบทุกเมนู (เดิมเลื่อนแนวนอนแล้วคนไม่รู้ว่ามีเมนูต่อ) */}
      <div className="flex flex-wrap justify-center">
        {visibleItems.map((item) =>
          item.href === 'palette' ? (
            <button
              key="palette"
              onClick={openCommandPalette}
              className="flex flex-col items-center justify-center gap-0.5 px-3 py-2 border-b-2 border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/60"
            >
              <span className="text-lg leading-none">{item.icon}</span>
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          ) : (
          <a
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center gap-0.5 px-3 py-2 border-b-2 transition ${
              active(item.href)
                ? 'border-emerald-400 text-emerald-300 bg-emerald-500/10'
                : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
            }`}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            <span className="text-[10px] font-medium">{item.label}</span>
          </a>
          )
        )}
      </div>
      {/* พื้นที่กันเนื้อหาถูกบังโดยแถบนำทาง */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
