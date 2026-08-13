"use client";
import { usePathname } from 'next/navigation';
import { openCommandPalette } from '../CommandPalette';

// เมนูหลักบนมือถือ/แท็บเล็ต — Sidebar จะหายไปบนจอเล็ก เลยต้องมีทางนำทางนี้
// (เลื่อนแนวนอนได้ — มีครบทุกหน้า ไม่ต้องไปหาเมนู)
const ITEMS: Array<{ href: string; label: string; icon: string }> = [
  { href: '/dashboard', label: 'หน้าหลัก', icon: '🏰' },
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
  const active = (href: string) =>
    pathname === href || (href !== '/dashboard' && pathname.startsWith(href + '/'));

  return (
    <nav
      aria-label="เมนูหลัก (มือถือ)"
      className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-gray-900/95 border-t border-gray-800 backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.35)]"
    >
      <div className="flex overflow-x-auto scrollbar-none">
        {ITEMS.map((item) =>
          item.href === 'palette' ? (
            <button
              key="palette"
              onClick={openCommandPalette}
              className="flex flex-col items-center justify-center gap-0.5 px-4 py-2.5 min-w-max border-b-2 border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/60"
            >
              <span className="text-lg leading-none">{item.icon}</span>
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          ) : (
          <a
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center gap-0.5 px-4 py-2.5 min-w-max border-b-2 transition ${
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
