import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import EmptyState from '../components/ui/EmptyState';
import { useSoverienStore } from '../stores/useSoverienStore';
import { format } from 'date-fns';
import { th, enUS } from 'date-fns/locale';
import { useLanguageStore } from '../stores/useLanguageStore';

interface DashboardStat {
  label: string;
  labelKey: string;
  value: number;
  icon: string;
  color: string;
  trend?: { value: number; label: string };
  href?: string;
}

function SoverienDashboardPage() {
  const router = useRouter();
  const { t, locale } = useLanguageStore();
  const {
    models,
    serials,
    orders,
    customers,
    stickerTemplates,
    settings,
    alerts,
    getNextSerial,
  } = useSoverienStore();

  const localeDateFns = locale === 'th' ? th : enUS;

  const [stats, setStats] = useState<DashboardStat[]>([]);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [expiringWarranties, setExpiringWarranties] = useState<any[]>([]);

  const computeStats = useCallback(() => {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const totalSerials = serials.length;
    const availableSerials = serials.filter(s => s.status === 'available').length;
    const soldSerials = serials.filter(s => s.status === 'sold' || s.status === 'installed').length;
    const totalOrders = orders.length;
    const pendingOrders = orders.filter(o => o.status === 'pending' || o.status === 'confirmed' || o.status === 'installing').length;
    const totalCustomers = customers.length;
    const totalModels = models.length;

    const activeOrders = orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled');
    const expiringSoon = orders.filter(o => {
      if (!o.warrantyEnd) return false;
      const end = new Date(o.warrantyEnd);
      return end > now && end <= thirtyDaysFromNow;
    });
    const expiredWarranties = orders.filter(o => o.warrantyEnd && new Date(o.warrantyEnd) <= now);

    setStats([
      {
        label: 'รุ่นอุปกรณ์', labelKey: 'soverien.dashboard.models', value: models.length,
        icon: 'package', color: 'bg-blue-500', href: '/soverien-serial',
      },
      {
        label: 'Serial ทั้งหมด', labelKey: 'soverien.dashboard.totalSerials', value: totalSerials,
        icon: 'hash', color: 'bg-purple-500', href: '/soverien-serial',
        trend: { value: availableSerials, label: 'ว่าง' },
      },
      {
        label: 'Serial ขายแล้ว', labelKey: 'soverien.dashboard.soldSerials', value: soldSerials,
        icon: 'shopping-cart', color: 'bg-green-500', href: '/soverien-warehouse',
      },
      {
        label: 'ออเดอร์ทั้งหมด', labelKey: 'soverien.dashboard.totalOrders', value: orders.length,
        icon: 'clipboard', color: 'bg-purple-500', href: '/soverien-order',
        trend: { value: pendingOrders, label: 'รอดำเนินการ' },
      },
      {
        label: 'ลูกค้าทั้งหมด', labelKey: 'soverien.dashboard.totalCustomers', value: totalCustomers,
        icon: 'users', color: 'bg-orange-500', href: '/soverien-customers',
      },
      {
        label: 'ใกล้หมดประกัน (30 วัน)', labelKey: 'soverien.dashboard.expiringSoon', value: expiringSoon.length,
        icon: 'alert-triangle', color: 'bg-yellow-500', href: '/soverien-warranty',
      },
      {
        label: 'หมดประกันแล้ว', labelKey: 'soverien.dashboard.expired', value: expiredWarranties.length,
        icon: 'alert-circle', color: 'bg-red-500', href: '/soverien-warranty',
      },
      {
        label: 'ค้างชำระ/รอดำเนินการ', labelKey: 'soverien.dashboard.pending', value: pendingOrders,
        icon: 'alert-triangle', color: 'bg-yellow-500', href: '/soverien-warehouse',
      },
    ]);

    // Recent orders
    const recent = orders
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
    setRecentOrders(recent);

    // Expiring warranties
    const expiring = orders
      .filter(o => o.warrantyEnd && new Date(o.warrantyEnd) > new Date() && new Date(o.warrantyEnd) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
      .sort((a, b) => new Date(a.warrantyEnd!).getTime() - new Date(b.warrantyEnd!).getTime())
      .slice(0, 5);
    setExpiringWarranties(expiring);
  }, [serials, orders, customers, models]);

  useEffect(() => { computeStats(); }, [serials, orders, customers, models, computeStats]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
      return format(new Date(dateStr), 'dd/MM/yyyy', { locale: localeDateFns });
    } catch { return dateStr; }
  };

  const localeDateFns = locale === 'th' ? th : enUS;

  const nextSerial = models.length > 0 ? getNextSerial(models[0].id) : '-';

  return (
    <div className="atmo-system min-h-screen bg-gray-950 text-gray-100">
      <Sidebar />
      <div className="lg:pl-64">
        <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
          <PageHeader
            title={t('soverien.nav.dashboard') || 'แดชบอร์ด Soverien'}
            subtitle="ภาพรวมธุรกิจ IoT Soverien — Serial, ออเดอร์, รับประกัน, ลูกค้า"
            theme="system"
            icon={<Icon name="dashboard" size={26} />}
          />

          {/* Quick Actions */}
          <div className="flex flex-wrap gap-3 mb-4">
            <button onClick={() => router.push('/soverien-serial')} className="btn btn-primary btn-sm flex items-center gap-2">
              <Icon name="plus" size={14} /> {t('soverien.nav.serial') || 'ออก Serial ใหม่'}
            </button>
            <button onClick={() => router.push('/soverien-order')} className="btn btn-success btn-sm flex items-center gap-2">
              <Icon name="plus" size={14} /> {t('soverien.nav.order') || 'ออกออเดอร์ใหม่'}
            </button>
            <button onClick={() => router.push('/soverien-sticker')} className="btn btn-primary btn-sm flex items-center gap-2">
              <Icon name="tag" size={14} /> {t('soverien.nav.sticker') || 'สร้างสติกเกอร์'}
            </button>
            <button onClick={() => router.push('/soverien-warehouse')} className="btn btn-secondary btn-sm flex items-center gap-2">
              <Icon name="archive" size={14} /> {t('soverien.nav.warehouse') || 'คลังออเดอร์'}
            </button>
            <button onClick={() => router.push('/soverien-warranty')} className="btn btn-warning btn-sm flex items-center gap-2">
              <Icon name="shield" size={14} /> {t('soverien.nav.warranty') || 'รับประกัน'}
            </button>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
            {stats.map((stat, i) => (
              <a key={i} href={stat.href} className="card p-4 hover:border-primary/40 transition-colors space-y-2">
                <div className="flex items-center justify-between">
                  <div className={`p-3 rounded-xl ${stat.color}`}>
                    <Icon name={stat.icon} size={20} className="text-white" />
                  </div>
                  {stat.trend && (
                    <span className="text-xs text-green-400 flex items-center gap-1">
                      <Icon name="arrow-up" size={10} /> {stat.trend.value}
                    </span>
                  )}
                </div>
                <div className="text-2xl font-bold text-white">{stat.value}</div>
                <div className="text-xs text-slate-400">{t(stat.labelKey) || stat.label}</div>
              </a>
            ))}
          </div>

          {/* Charts Row */}
          <div className="grid lg:grid-cols-2 gap-6 mb-6">
            {/* Orders Trend */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">แนวโน้มออเดอร์ (7 วันล่าสุด)</h3>
                <button className="btn btn-sm btn-outline text-xs" onClick={() => router.push('/soverien-warehouse')}>
                  <Icon name="external-link" size={12} /> ดูทั้งหมด
                </button>
              </div>
              <div className="h-64">
                <canvas id="ordersChart"></canvas>
              </div>
            </div>

            {/* Warranty Status */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">สถานะรับประกัน</h3>
                <button className="btn btn-sm btn-outline text-xs" onClick={() => router.push('/soverien-warranty')}>
                  <Icon name="external-link" size={12} /> ดูทั้งหมด
                </button>
              </div>
              <div className="h-64">
                <canvas id="warrantyChart"></canvas>
              </div>
            </div>
          </div>

          {/* Recent Orders & Expiring Warranties */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Recent Orders */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">ออเดอร์ล่าสุด</h3>
                <button className="btn btn-sm btn-outline text-xs" onClick={() => router.push('/soverien-warehouse')}>
                  <Icon name="external-link" size={12} /> ดูทั้งหมด
                </button>
              </div>
              {recentOrders.length === 0 ? (
                <EmptyState icon={<Icon name="clipboard" size={26} />} title="ยังไม่มีออเดอร์" description="กดปุ่ม “ออกออเดอร์” เพื่อสร้างออเดอร์แรก" />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>S/N</th>
                        <th>ลูกค้า</th>
                        <th>วันที่</th>
                        <th>สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentOrders.map((order) => (
                        <tr key={order.id} className="cursor-pointer hover:bg-slate-800/50" onClick={() => router.push(`/soverien-warehouse?order=${order.id}`)}>
                          <td className="font-mono text-sm">{order.serialNumbers?.[0]?.slice(-8) || '-'}</td>
                          <td>{order.customer?.name || '-'}</td>
                          <td className="text-slate-400 text-sm">{(order.createdAt ? format(new Date(order.createdAt), 'dd/MM/yyyy', { locale: localeDateFns }) : '-')}</td>
                          <td>
                            <span className={`badge ${getStatusBadge(order.status)}`}>
                              {getStatusLabel(order.status)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Expiring Warranties */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">ใกล้หมดประกัน (30 วัน)</h3>
                <button className="btn btn-sm btn-outline text-xs" onClick={() => router.push('/soverien-warranty')}>
                  <Icon name="external-link" size={12} /> ดูทั้งหมด
                </button>
              </div>
              {expiringWarranties.length === 0 ? (
                <EmptyState icon={<Icon name="shield" size={26} />} title="ไม่มีใกล้หมดประกัน" description="ออเดอร์ทั้งหมดยังอยู่ในระยะเวลาประกัน" />
              ) : (
                <div className="space-y-3">
                  {expiringWarranties.map((order) => (
                    <div key={order.id} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-yellow-500/20 rounded-lg">
                          <Icon name="alert-triangle" size={18} className="text-yellow-400" />
                        </div>
                        <div>
                          <div className="font-medium">{order.serialNumbers?.[0] || '-'}</div>
                          <div className="text-sm text-slate-400">{order.customer?.name || '-'}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="badge badge-yellow">{formatDate(order.warrantyEnd)}</div>
                        <div className="text-xs text-slate-400 mt-1">อีก {daysUntil(order.warrantyEnd)} วัน</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Quick Info */}
          <div className="card p-4">
            <h3 className="font-semibold mb-4">ข้อมูลเร็ว</h3>
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="p-3 bg-slate-800/50 rounded-lg space-y-1">
                <div className="text-xs text-slate-400">รุ่นต่อไป</div>
                <div className="font-mono text-lg font-bold text-cyan-300">{nextSerial}</div>
              </div>
              <div className="p-3 bg-slate-800/50 rounded-lg space-y-1">
                <div className="text-xs text-slate-400">วันสิ้นสุดประกันล่าสุด</div>
                <div className="font-medium">{expiringWarranties[0] ? format(new Date(expiringWarranties[0].warrantyEnd!), 'dd/MM/yyyy', { locale: localeDateFns }) : '-'}</div>
              </div>
              <div className="p-3 bg-slate-800/50 rounded-lg space-y-1">
                <div className="text-xs text-slate-400">รุ่นที่มี Serial มากสุด</div>
                <div className="font-medium">{getTopModel()?.name || '-'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'pending': return 'badge-yellow';
    case 'confirmed': return 'badge-blue';
    case 'installing': return 'badge-blue';
    case 'installed': return 'badge-green';
    case 'completed': return 'badge-green';
    case 'cancelled': return 'badge-gray';
    default: return 'badge-gray';
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'pending': return 'รอดำเนินการ';
    case 'confirmed': return 'ยืนยันแล้ว';
    case 'installing': return 'กำลังติดตั้ง';
    case 'installed': return 'ติดตั้งแล้ว';
    case 'completed': return 'เสร็จสิ้น';
    case 'cancelled': return 'ยกเลิก';
    default: return status;
  }
}

function daysUntil(dateStr?: string) {
  if (!dateStr) return 0;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function getTopModel() {
  return null;
}

const localeDateFns = locale === 'th' ? th : enUS;
}

export default SoverienDashboardPage;