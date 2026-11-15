// components/dashboard/HeaderBar.tsx — แถบหัวหน้า Dashboard (ย้ายจาก pages/dashboard.tsx)
// (IDEA-011: ตัด badge "NEON {neonPct}%" ค่าแข็ง 56% ออก — ระบบไม่มี metric ชื่อ NEON ที่ไหนเลย
//  การโชว์ตัวเลขเป็น % ทั้งที่ไม่มีที่มา = ข้อมูลปลอมบนหน้าแรก)
import { useAuthStore } from '../../stores/useAuthStore';
import { useLanguageStore } from '../../stores/useLanguageStore';
import Icon from '../ui/Icon';

export function Header({ queuedCount, isOnline, syncNow }: { queuedCount: number; isOnline: boolean; syncNow: () => Promise<number> }) {
  const { user, logout } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  return (
    <header className="bg-gray-900/80 border-b border-gray-800 px-4 lg:px-6 py-2.5 flex justify-between items-center backdrop-blur-md sticky top-0 z-20">
      <h1 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
        <Icon name="shield" size={15} className="text-emerald-400 glow-text" />
        SOVEREIGN OS <span className="text-[11px] text-gray-500 font-normal tracking-widest">Command Center</span>
      </h1>
      <div className="flex items-center gap-2 text-sm">
        {!isOnline && <span className="px-2 py-1 rounded bg-amber-950/50 border border-amber-800/60 text-amber-300 text-xs">{t('common.onlineBadge')}</span>}
        {queuedCount > 0 && (
          <button onClick={() => syncNow()} title={t('common.pendingSync', 'กดเพื่อ sync ทันที', { n: queuedCount })} className="flex items-center gap-1 px-2 py-1 rounded bg-sky-950/50 border border-sky-800/60 text-sky-300 text-xs hover:bg-sky-900/60 transition-colors">
            <Icon name="refresh" size={11} />
            {t('common.pendingSync', '{n} รายการรอ sync', { n: queuedCount })}
          </button>
        )}
        <span className="mono text-[11px] text-gray-500 hidden sm:inline">{user?.role} | {(user?.id || user?.username || '').toString().slice(0, 8) || '—'}</span>
        <button
          onClick={() => { logout(); window.location.href = '/'; }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-950/40 hover:bg-red-900/50 border border-red-800/60 text-red-300 transition-colors text-xs"
        >
          <Icon name="logout" size={12} />
          {t('common.logout')}
        </button>
      </div>
    </header>
  );
}
