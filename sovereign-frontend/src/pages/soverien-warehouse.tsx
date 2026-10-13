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

export default function SoverienWarehousePage() {
  const router = useRouter();
  const { t, locale } = useLanguageStore();
  const {
    orders,
    serials,
    updateOrder,
    getOrder,
  } = useSoverienStore();

  const [filter, setFilter] = useState<'all' | 'pending' | 'confirmed' | 'installing' | 'installed' | 'completed' | 'cancelled'>('all');
  const [search, setSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const localeDateFns = locale === 'th' ? th : enUS;

  const filteredOrders = orders
    .filter(o => {
      if (filter !== 'all' && o.status !== filter) return false;
      if (search) {
        const s = search.toLowerCase();
        return o.serialNumbers?.some(sn => sn.toLowerCase().includes(s)) ||
          o.customer?.name?.toLowerCase().includes(s) ||
          o.customer?.phone?.includes(s) ||
          o.id.toLowerCase().includes(s);
      }
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const statusOptions = [
    { value: 'pending', label: 'รอดำเนินการ', color: 'bg-yellow-500' },
    { value: 'confirmed', label: 'ยืนยันแล้ว', color: 'bg-blue-500' },
    { value: 'installing', label: 'กำลังติดตั้ง', color: 'bg-blue-500' },
    { value: 'installed', label: 'ติดตั้งแล้ว', color: 'bg-green-500' },
    { value: 'completed', label: 'เสร็จสิ้น', color: 'bg-green-500' },
    { value: 'cancelled', label: 'ยกเลิก', color: 'bg-gray-500' },
  ];

  const getStatusColor = (status: string) => {
    const s = statusOptions.find(s => s.value === status);
    return s?.color || 'bg-gray-500';
  };

  const getStatusLabel = (status: string) => {
    const s = statusOptions.find(s => s.value === status);
    return s?.label || status;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try { return format(new Date(dateStr), 'dd/MM/yyyy HH:mm', { locale: locale === 'th' ? th : enUS }); } catch { return dateStr; }
  };

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    const order = getOrder(orderId);
    if (!order) return;
    updateOrder(orderId, { status: newStatus as any });
    // If installing -> installed, set installedAt
    if (newStatus === 'installed' && !order.installedAt) {
      updateOrder(orderId, { installedAt: new Date().toISOString() });
    }
  };

  const formatDateFull = (dateStr?: string) => {
    if (!dateStr) return '-';
    try { return format(new Date(dateStr), 'dd/MM/yyyy HH:mm', { locale: locale === 'th' ? th : enUS }); } catch { return dateStr; }
  };

  return (
    <div className="atmo-system min-h-screen bg-gray-950 text-gray-100">
      <Sidebar />
      <div className="lg:pl-64">
        <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
          <PageHeader
            title="คลังออเดอร์"
            subtitle="จัดการออเดอร์ทั้งหมด — ติดตามสถานะ ติดตั้ง รับประกัน"
            theme="system"
            icon={<Icon name="archive" size={26} />}
          />

          {/* Filters */}
          <div className="card p-4 mb-6">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-400">สถานะ:</label>
                <select value={filter} onChange={(e) => setFilter(e.target.value as any)}
                  className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm">
                  <option value="all">ทั้งหมด</option>
                  <option value="pending">รอดำเนินการ</option>
                  <option value="confirmed">ยืนยันแล้ว</option>
                  <option value="installing">กำลังติดตั้ง</option>
                  <option value="installed">ติดตั้งแล้ว</option>
                  <option value="completed">เสร็จสิ้น</option>
                  <option value="cancelled">ยกเลิก</option>
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
              <div className="flex items-center gap-2 ml-auto">
                <button onClick={() => setViewMode('table')} className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : 'btn-outline'}`}>
                  <Icon name="list" size={14} /> ตาราง
                </button>
                <button onClick={() => setViewMode('kanban')} className={`btn btn-sm ${viewMode === 'kanban' ? 'btn-primary' : 'btn-outline'}`}>
                  <Icon name="kanban" size={14} /> กานบาน
                </button>
              </div>
            </div>
          </div>

          {viewMode === 'table' ? (
            <div className="card p-4">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>S/N</th>
                      <th>ลูกค้า</th>
                      <th>รุ่น</th>
                      <th>จำนวน</th>
                      <th>วันที่ออก</th>
                      <th>สถานะ</th>
                      <th>วันสิ้นสุดประกัน</th>
                      <th>การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-8 text-slate-500">ไม่พบออเดอร์</td></tr>
                    ) : (
                      filteredOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-slate-800/50 cursor-pointer" onClick={() => setSelectedOrderId(order.id)}>
                          <td className="font-mono text-sm">{order.serialNumbers?.[0]?.slice(-8) || '-'}</td>
                          <td>{order.customer?.name || '-'}</td>
                          <td className="text-slate-400 text-sm">{order.modelName || '-'}</td>
                          <td className="text-center">{order.quantity}</td>
                          <td className="text-slate-400 text-sm">{format(new Date(order.createdAt), 'dd/MM/yyyy', { locale: locale === 'th' ? th : enUS })}</td>
                          <td>
                            <span className={`badge ${getStatusColor(order.status).replace('bg-', 'badge-')}`}>
                              {getStatusLabel(order.status)}
                            </span>
                          </td>
                          <td className="text-slate-400 text-sm">{order.warrantyEnd ? format(new Date(order.warrantyEnd), 'dd/MM/yyyy', { locale: locale === 'th' ? th : enUS }) : '-'}</td>
                          <td>
                            <select value={order.status} onChange={(e) => handleStatusChange(order.id, e.target.value)}
                              className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs">
                              {statusOptions.map(s => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="card p-4">
                {/* Kanban Board */}
                <div className="kanban">
                  {statusOptions.map(status => (
                    <div key={status.value} className="kanban-col">
                      <div className="kanban-title" style={{ backgroundColor: status.color }}>
                        {status.label}
                        <span className="ml-2 text-xs bg-white/20 px-2 py-0.5 rounded">
                          {orders.filter(o => o.status === status.value).length}
                        </span>
                      </div>
                      <div className="kanban-items">
                        {filteredOrders
                          .filter(o => o.status === status.value)
                          .map(order => (
                            <div key={order.id} className="kanban-item" onClick={() => setSelectedOrderId(order.id)}>
                              <div className="font-mono text-sm font-bold">{order.serialNumbers?.[0]?.slice(-8) || '-'}</div>
                              <div className="text-sm text-slate-300">{order.customer?.name || '-'}</div>
                              <div className="text-xs text-slate-500 mt-1">{order.modelName}</div>
                              <div className="text-xs text-slate-500 mt-2">{format(new Date(order.createdAt), 'dd/MM/yyyy', { locale: locale === 'th' ? th : enUS })}</div>
                              {order.warrantyEnd && (
                                <div className={`text-xs mt-2 ${new Date(order.warrantyEnd) < new Date() ? 'text-red-400' : 'text-yellow-400'}`}>
                                  ประกันสิ้นสุด: {format(new Date(order.warrantyEnd), 'dd/MM/yyyy', { locale: locale === 'th' ? th : enUS })}
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Order Detail Modal */}
            <Modal open={!!selectedOrderId} onClose={() => setSelectedOrderId(null)} title="รายละเอียดออเดอร์" size="lg">
              {selectedOrderId && (() => {
                const order = getOrder(selectedOrderId);
                if (!order) return <div className="p-8 text-center text-slate-500">ไม่พบข้อมูล</div>;
                return (
                  <div className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <div className="text-xs text-slate-400">Order ID</div>
                        <div className="font-mono text-sm">{order.id}</div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs text-slate-400">Serial Numbers</div>
                        <div className="font-mono text-sm">{order.serialNumbers?.join(', ') || '-'}</div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs text-slate-400">ลูกค้า</div>
                        <div className="font-medium">{order.customer?.name || '-'}</div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs text-slate-400">เบอร์โทร</div>
                        <div className="text-slate-300">{order.customer?.phone || '-'}</div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs text-slate-400">รุ่น</div>
                        <div className="font-medium">{order.modelName || '-'}</div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs text-slate-400">จำนวน</div>
                        <div className="font-medium">{order.quantity}</div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs text-slate-400">วันที่ออกใบ</div>
                        <div>{formatDateFull(order.createdAt)}</div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs text-slate-400">สถานะ</div>
                        <div>
                          <span className={`badge ${getStatusColor(order.status).replace('bg-', 'badge-')}`}>
                            {getStatusLabel(order.status)}
                          </span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs text-slate-400">วันสิ้นสุดประกัน</div>
                        <div className={order.warrantyEnd ? (new Date(order.warrantyEnd) < new Date() ? 'text-red-400' : 'text-green-400') : 'text-slate-400'}>
                          {order.warrantyEnd ? formatDateFull(order.warrantyEnd) : '-'}
                        </div>
                      </div>
                      {order.installedAt && (
                        <div className="space-y-2">
                          <div className="text-xs text-slate-400">วันที่ติดตั้ง</div>
                          <div>{formatDateFull(order.installedAt)}</div>
                        </div>
                      )}
                      {order.price && (
                        <div className="space-y-2">
                          <div className="text-xs text-slate-400">ราคา</div>
                          <div className="font-bold text-lg">{order.price.toLocaleString()} บาท</div>
                        </div>
                      )}
                      {order.notes && (
                        <div className="space-y-2">
                          <div className="text-xs text-slate-400">หมายเหตุ</div>
                          <div className="text-slate-300">{order.notes}</div>
                        </div>
                      )}
                    </div>

                    <div className="modal-footer">
                      <select value={order.status} onChange={(e) => handleStatusChange(order.id, e.target.value)}
                        className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm">
                        {statusOptions.map(s => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                      <button onClick={() => setSelectedOrderId(null)} className="btn btn-secondary">ปิด</button>
                    </div>
                  </div>
                )))}
              </Modal>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SoverienWarehousePage;