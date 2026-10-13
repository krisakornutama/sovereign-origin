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

export default function SoverienCustomersPage() {
  const router = useRouter();
  const { t, locale } = useLanguageStore();
  const {
    customers,
    orders,
    createCustomer,
    updateCustomer,
    getCustomerByPhone,
  } = useSoverienStore();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [customerForm, setCustomerForm] = useState({
    name: '',
    phone: '',
    address: '',
    lineId: '',
    email: '',
    notes: '',
  });
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const localeDateFns = locale === 'th' ? th : enUS;

  const filteredCustomers = customers
    .filter(c => {
      if (filter === 'active' && c.totalOrders === 0) return false;
      if (filter === 'inactive' && c.totalOrders > 0) return false;
      if (search) {
        const s = search.toLowerCase();
        return c.name.toLowerCase().includes(s) ||
          c.phone.includes(s) ||
          c.email?.toLowerCase().includes(s) ||
          c.lineId?.toLowerCase().includes(s);
      }
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const stats = {
    total: customers.length,
    active: customers.filter(c => c.totalOrders > 0).length,
    inactive: customers.filter(c => c.totalOrders === 0).length,
    totalValue: customers.reduce((sum, c) => sum + c.totalValue, 0),
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try { return format(new Date(dateStr), 'dd/MM/yyyy', { locale: localeDateFns }); } catch { return dateStr; }
  };

  const formatCurrency = (value: number) => {
    return value.toLocaleString('th-TH') + ' บาท';
  };

  const handleCreateCustomer = async () => {
    if (!customerForm.name.trim() || !customerForm.phone.trim()) {
      setNotice({ ok: false, text: 'กรอกชื่อและเบอร์โทรก่อน' });
      return;
    }
    if (getCustomerByPhone(customerForm.phone)) {
      setNotice({ ok: false, text: 'เบอร์โทรนี้มีอยู่ในระบบแล้ว' });
      return;
    }
    setBusy(true);
    try {
      createCustomer({
        name: customerForm.name.trim(),
        phone: customerForm.phone.trim(),
        address: customerForm.address || '',
        lineId: customerForm.lineId || '',
        email: customerForm.email || '',
        notes: customerForm.notes || '',
      });
      setNotice({ ok: true, text: 'เพิ่มลูกค้าแล้ว' });
      setCustomerForm({ name: '', phone: '', address: '', lineId: '', email: '', notes: '' });
      setShowForm(false);
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateCustomer = async () => {
    if (!editingCustomerId) return;
    updateCustomer(editingCustomerId, customerForm);
    setNotice({ ok: true, text: 'อัปเดตลูกค้าแล้ว' });
    setEditingCustomerId(null);
    setShowForm(false);
    setCustomerForm({ name: '', phone: '', address: '', lineId: '', email: '', notes: '' });
  };

  const handleEdit = (customer: any) => {
    setEditingCustomerId(customer.id);
    setCustomerForm({
      name: customer.name,
      phone: customer.phone,
      address: customer.address || '',
      lineId: customer.lineId || '',
      email: customer.email || '',
      notes: customer.notes || '',
    });
    setShowForm(true);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try { return format(new Date(dateStr), 'dd/MM/yyyy', { locale: localeDateFns }); } catch { return dateStr; }
  };

  const formatCurrency = (value: number) => {
    return value.toLocaleString('th-TH') + ' บาท';
  };

  return (
    <div className="atmo-system min-h-screen bg-gray-950 text-gray-100">
      <Sidebar />
      <div className="lg:pl-64">
        <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
          <PageHeader
            title="จัดการลูกค้า"
            subtitle="CRM เบื้องต้น — รวมข้อมูลจากออเดอร์ทั้งหมด"
            theme="system"
            icon={<Icon name="users" size={26} />}
          />

          {notice && (
            <div className={`text-sm rounded-lg border px-3 py-2 ${notice.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>
              {notice.text}
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="card p-4 border-l-4 border-blue-500">
              <div className="text-3xl font-bold text-blue-400">{stats.total}</div>
              <div className="text-sm text-slate-400">ลูกค้าทั้งหมด</div>
            </div>
            <div className="card p-4 border-l-4 border-green-500">
              <div className="text-3xl font-bold text-green-400">{stats.active}</div>
              <div className="text-sm text-slate-400">ซื้อแล้ว</div>
            </div>
            <div className="card p-4 border-l-4 border-yellow-500">
              <div className="text-3xl font-bold text-yellow-400">{stats.inactive}</div>
              <div className="text-sm text-slate-400">ยังไม่ซื้อ</div>
            </div>
            <div className="card p-4 border-l-4 border-purple-500">
              <div className="text-3xl font-bold text-purple-400">{stats.totalValue.toLocaleString('th-TH')}</div>
              <div className="text-sm text-slate-400">มูลค่ารวม (บาท)</div>
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
                  <option value="active">ซื้อแล้ว</option>
                  <option value="inactive">ยังไม่ซื้อ</option>
                </select>
              </div>
              <div className="flex-1 max-w-md">
                <div className="search-box">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input type="text" placeholder="ค้นหา ชื่อ, เบอร์, อีเมล, LINE..." value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-10 py-2 text-sm" />
                </div>
              </div>
              <button onClick={() => { setCustomerForm({ name: '', phone: '', address: '', lineId: '', email: '', notes: '' }); setEditingCustomerId(null); setShowForm(true); }}
                className="btn btn-primary btn-sm flex items-center gap-2">
                <Icon name="plus" size={14} /> เพิ่มลูกค้า
              </button>
            </div>
          </div>

          {/* Customer Form Modal */}
          <Modal open={showForm} onClose={() => { setShowForm(false); setEditingCustomerId(null); setCustomerForm({ name: '', phone: '', address: '', lineId: '', email: '', notes: '' }); }} title={editingCustomerId ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้าใหม่'}>
            <div className="space-y-4">
              <div>
                <label className="form-label required">ชื่อ-นามสกุล</label>
                <input value={customerForm.name} onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                  placeholder="ชื่อ-นามสกุล" className="w-full" />
              </div>
              <div>
                <label className="form-label required">เบอร์โทร</label>
                <input value={customerForm.phone} onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                  placeholder="08x-xxx-xxxx" className="w-full" />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="form-label">LINE ID</label>
                  <input value={customerForm.lineId} onChange={(e) => setCustomerForm({ ...customerForm, lineId: e.target.value })}
                    placeholder="line_id" className="w-full" />
                </div>
                <div>
                  <label className="form-label">อีเมล</label>
                  <input type="email" value={customerForm.email} onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })}
                    placeholder="email@example.com" className="w-full" />
                </div>
              </div>
              <div>
                <label className="form-label">ที่อยู่จัดส่ง</label>
                <textarea value={customerForm.address} onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })}
                  rows={2} placeholder="ที่อยู่สำหรับจัดส่ง" className="w-full" />
              </div>
              <div>
                <label className="form-label">หมายเหตุ</label>
                <textarea value={customerForm.notes} onChange={(e) => setCustomerForm({ ...customerForm, notes: e.target.value })}
                  rows={2} placeholder="หมายเหตุเพิ่มเติม" className="w-full" />
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => { setShowForm(false); setEditingCustomerId(null); setCustomerForm({ name: '', phone: '', address: '', lineId: '', email: '', notes: '' }); }} className="btn btn-secondary">ยกเลิก</button>
                <button onClick={editingCustomerId ? handleEdit : handleCreateCustomer} disabled={busy} className="btn btn-primary">
                  {editingCustomerId ? 'อัปเดต' : 'เพิ่มลูกค้า'}
                </button>
              </div>
            </div>
          </Modal>

          {/* Customers Table */}
          <div className="card p-4">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ชื่อ</th>
                    <th>เบอร์โทร</th>
                    <th>LINE / Email</th>
                    <th>ออเดอร์</th>
                    <th>มูลค่ารวม</th>
                    <th>ออเดอร์ล่าสุด</th>
                    <th>สร้างเมื่อ</th>
                    <th>การจัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-slate-500">ไม่พบลูกค้า</td></tr>
                  ) : (
                    filteredCustomers.map((customer) => (
                      <tr key={customer.id} className="hover:bg-slate-800/50 cursor-pointer" onClick={() => router.push(`/soverien-customers?customer=${customer.id}`)}>
                        <td className="font-medium">{customer.name}</td>
                        <td className="font-mono text-sm">{customer.phone}</td>
                        <td className="text-slate-400 text-sm">
                          {customer.lineId && <div className="flex items-center gap-1 text-green-400"><Icon name="message-square" size={12} /> {customer.lineId}</div>}
                          {customer.email && <div className="text-slate-400 text-xs">{customer.email}</div>}
                        </td>
                        <td className="text-center font-bold">{customer.totalOrders}</td>
                        <td className="text-right font-medium text-purple-400">{customer.totalValue.toLocaleString('th-TH')}</td>
                        <td className="text-slate-400 text-sm">{customer.lastOrderAt ? format(new Date(customer.lastOrderAt), 'dd/MM/yyyy', { locale: localeDateFns }) : '-'}</td>
                        <td className="text-slate-400 text-sm">{formatDate(customer.createdAt)}</td>
                        <td>
                          <button onClick={(e) => { e.stopPropagation(); handleEdit(customer); }} className="btn btn-sm btn-outline text-xs">แก้ไข</button>
                        </td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => { setCustomerForm({ name: '', phone: '', address: '', lineId: '', email: '', notes: '' }); setEditingCustomerId(null); setShowForm(true); }} className="btn btn-primary">
                  <Icon name="plus" size={14} /> เพิ่มลูกค้า
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SoverienCustomersPage;