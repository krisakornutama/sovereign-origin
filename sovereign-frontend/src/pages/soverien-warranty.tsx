import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import { useSoverienStore } from '../stores/useSoverienStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { format } from 'date-fns';
import { th, enUS } from 'date-fns/locale';

export default function SoverienWarrantyPage() {
  const router = useRouter();
  const { t, locale } = useLanguageStore();
  const {
    orders,
    serials,
    settings,
  } = useSoverienStore();

  const [filter, setFilter] = useState<'all' | 'valid' | 'expiring' | 'expired'>('all');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const localeDateFns = locale === 'th' ? th : enUS;

  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const enrichedOrders = orders.map(order => {
    const warrantyEnd = order.warrantyEnd ? new Date(order.warrantyEnd) : null;
    let status: 'valid' | 'expiring' | 'expired' = 'valid';
    if (warrantyEnd) {
      if (warrantyEnd <= now) status = 'expired';
      else if (warrantyEnd <= thirtyDaysFromNow) status = 'expiring';
    }
    return { ...order, warrantyStatus: status, warrantyEndDate: warrantyEnd };
  });

  const filteredOrders = enrichedOrders
    .filter(o => {
      if (filter !== 'all' && o.warrantyStatus !== filter) return false;
      if (search) {
        const s = search.toLowerCase();
        return o.serialNumbers?.some(sn => sn.toLowerCase().includes(s)) ||
          o.customer?.name?.toLowerCase().includes(s) ||
          o.customer?.phone?.includes(s) ||
          o.id.toLowerCase().includes(s);
      }
      return true;
    })
    .sort((a, b) => {
      if (a.warrantyEndDate && b.warrantyEndDate) {
        return a.warrantyEndDate.getTime() - b.warrantyEndDate.getTime();
      }
      return 0;
    });

  const stats = {
    valid: enrichedOrders.filter(o => o.warrantyStatus === 'valid').length,
    expiring: enrichedOrders.filter(o => o.warrantyStatus === 'expiring').length,
    expired: enrichedOrders.filter(o => o.warrantyStatus === 'expired').length,
    total: enrichedOrders.length,
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try { return format(new Date(dateStr), 'dd/MM/yyyy', { locale: locale === 'th' ? th : enUS }); } catch { return dateStr; }
  };

  const daysUntil = (dateStr?: string) => {
    if (!dateStr) return 0;
    const diff = new Date(dateStr).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try { return format(new Date(dateStr), 'dd/MM/yyyy', { locale: locale === 'th' ? th : enUS }); } catch { return dateStr; }
  };

  return (
    <div className="atmo-system min-h-screen bg-gray-950 text-gray-100">
      <Sidebar />
      <div className="lg:pl-64">
        <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
          <PageHeader
            title="ระบบรับประกัน"
            subtitle="ติดตามสถานะประกันอุปกรณ์ IoT — แจ้งเตือนอัตโนมัติเมื่อใกล้หมดอายุ"
            theme="system"
            icon={<Icon name="shield" size={26} />}
          />

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="card p-4 border-l-4 border-green-500">
              <div className="text-3xl font-bold text-green-400">{stats.valid}</div>
              <div className="text-sm text-slate-400">ในประกัน</div>
            </div>
            <div className="card p-4 border-l-4 border-yellow-500">
              <div className="text-3xl font-bold text-yellow-400">{stats.expiring}</div>
              <div className="text-sm text-slate-400">ใกล้หมด (30 วัน)</div>
            </div>
            <div className="card p-4 border-l-4 border-red-500">
              <div className="text-3xl font-bold text-red-400">{stats.expired}</div>
              <div className="text-sm text-slate-400">หมดประกันแล้ว</div>
            </div>
            <div className="card p-4 border-l-4 border-blue-500">
              <div className="text-3xl font-bold text-blue-400">{stats.total}</div>
              <div className="text-sm text-slate-400">ทั้งหมด</div>
            </div>
          </div>

          {/* Filters */}
          <div className="card p-4 mb-6">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-400">กรอง:</label>
                <select value={filter} onChange={(e) => setFilter(e.target.value as any)}
                  className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm">
                  <option value="all">ทั้งหมด</option>
                  <option value="valid">ในประกัน</option>
                  <option value="expiring">ใกล้หมด (30 วัน)</option>
                  <option value="expired">หมดประกัน</option>
                </select>
              </div>
              <div className="flex-1 max-w-md">
                <div className="search-box">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input type="text" placeholder="ค้นหา S/N, ลูกค้า, เบอร์..." value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-10 py-2 text-sm" />
                </div>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="card p-4">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>S/N</th>
                    <th>ลูกค้า</th>
                    <th>รุ่น</th>
                    <th>วันที่ออกใบ</th>
                    <th>เริ่มประกัน</th>
                    <th>สิ้นสุดประกัน</th>
                    <th>สถานะ</th>
                    <th>เหลือ (วัน)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-slate-500">ไม่พบข้อมูล</td></tr>
                  ) : (
                    filteredOrders.map((order) => (
                      <tr key={order.id} className={`hover:bg-slate-800/50 ${order.warrantyStatus === 'expired' ? 'bg-red-500/5' : order.warrantyStatus === 'expiring' ? 'bg-yellow-500/5' : ''}`}>
                        <td className="font-mono text-sm">{order.serialNumbers?.[0]?.slice(-8) || '-'}</td>
                        <td>{order.customer?.name || '-'}</td>
                        <td className="text-slate-400 text-sm">{order.modelName || '-'}</td>
                        <td className="text-slate-400 text-sm">{order.createdAt ? format(new Date(order.createdAt), 'dd/MM/yyyy', { locale: localeDateFns }) : '-'}</td>
                        <td className="text-slate-400 text-sm">{order.warrantyStart ? format(new Date(order.warrantyStart), 'dd/MM/yyyy', { locale: localeDateFns }) : '-'}</td>
                        <td className={`font-medium ${order.warrantyStatus === 'expired' ? 'text-red-400' : order.warrantyStatus === 'expiring' ? 'text-yellow-400' : 'text-green-400'}`}>
                          {order.warrantyEnd ? format(new Date(order.warrantyEnd), 'dd/MM/yyyy', { locale: localeDateFns }) : '-'}
                        </td>
                        <td>
                          <span className={`badge ${order.warrantyStatus === 'valid' ? 'badge-green' : order.warrantyStatus === 'expiring' ? 'badge-yellow' : 'badge-red'}`}>
                            {order.warrantyStatus === 'valid' ? 'ในประกัน' : order.warrantyStatus === 'expiring' ? 'ใกล้หมด' : 'หมดอายุ'}
                          </span>
                        </td>
                        <td className={`font-mono ${order.warrantyStatus === 'expired' ? 'text-red-400' : order.warrantyStatus === 'expiring' ? 'text-yellow-400' : 'text-green-400'}`}>
                          {order.warrantyEnd ? daysUntil(order.warrantyEnd) : '-'}
                        </td>
                      </tr>
                    )))
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SoverienWarrantyPage;