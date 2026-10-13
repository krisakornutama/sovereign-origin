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

export default function SoverienOrderPage() {
  const router = useRouter();
  const { t, locale } = useLanguageStore();
  const {
    models,
    serials,
    orders,
    customers,
    createOrder,
    updateOrder,
    createCustomer,
    getCustomerByPhone,
    getNextSerial,
  } = useSoverienStore();

  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [quantity, setQuantity] = useState(1);
  const [customerForm, setCustomerForm] = useState({
    name: '',
    phone: '',
    address: '',
    lineId: '',
    email: '',
    notes: '',
  });
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [newCustomer, setNewCustomer] = useState(false);
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);

  const localeDateFns = locale === 'th' ? th : enUS;

  const modelsList = models;
  const availableSerials = serials.filter(s => s.status === 'available');

  const handleCreateOrder = async () => {
    if (!selectedModelId) { setNotice({ ok: false, text: 'เลือกรุ่นอุปกรณ์ก่อน' }); return; }
    if (quantity < 1) { setNotice({ ok: false, text: 'จำนวนต้องมากกว่า 0' }); return; }
    if (!customerForm.name.trim() || !customerForm.phone.trim()) {
      setNotice({ ok: false, text: 'กรอกชื่อและเบอร์โทรลูกค้าก่อน' });
      return;
    }

    const model = models.find(m => m.id === selectedModelId);
    if (!model) return;

    const availableCount = serials.filter(s => s.modelId === selectedModelId && s.status === 'available').length;
    if (availableCount < quantity) {
      setNotice({ ok: false, text: `Serial ว่างไม่พอ (มี ${availableCount} ต้องการ ${quantity})` });
      return;
    }

    setBusy(true);
    try {
      // Create or get customer
      let customerId = selectedCustomerId;
      if (!customerId && customerForm.name.trim() && customerForm.phone.trim()) {
        const existing = getCustomerByPhone(customerForm.phone);
        if (existing) {
          customerId = existing.id;
        } else {
          customerId = createCustomer({
            name: customerForm.name.trim(),
            phone: customerForm.phone.trim(),
            address: customerForm.address || '',
            lineId: customerForm.lineId || '',
            email: customerForm.email || '',
            notes: customerForm.notes || '',
          });
        }
      }

      // Generate serials
      const generated = useSoverienStore.getState().generateSerials(selectedModelId, quantity);
      if (generated.length < quantity) {
        throw new Error('Serial ไม่พอ');
      }

      const model = models.find(m => m.id === selectedModelId)!;
      const warrantyStart = new Date(orderDate);
      warrantyStart.setDate(warrantyStart.getDate() + (settings?.shippingBufferDays || 14));
      const warrantyEnd = new Date(warrantyStart);
      warrantyEnd.setDate(warrantyEnd.getDate() + (settings?.warrantyDays || 365));

      const orderId = createOrder({
        serialNumbers: generated,
        modelId: selectedModelId,
        modelName: models.find(m => m.id === selectedModelId)?.name || '',
        quantity,
        customer: {
          id: customerId!,
          name: customerForm.name.trim(),
          phone: customerForm.phone.trim(),
          address: customerForm.address || '',
          lineId: customerForm.lineId || '',
          email: customerForm.email || '',
          notes: customerForm.notes || '',
          createdAt: new Date().toISOString(),
          totalOrders: 0,
          totalValue: 0,
        },
        quantity,
        status: 'pending',
        createdAt: new Date().toISOString(),
        warrantyStart: warrantyStart.toISOString(),
        warrantyEnd: warrantyEnd.toISOString(),
        notes,
        price: price ? Number(price) : undefined,
      });

      setNotice({ ok: true, text: `สร้างออเดอร์ ${orderId} สำเร็จ สร้าง Serial ${quantity} รหัส` });
      setQuantity(1);
      setCustomerForm({ name: '', phone: '', address: '', lineId: '', email: '', notes: '' });
      setSelectedCustomerId('');
      setNewCustomer(false);
      setOrderDate(new Date().toISOString().split('T')[0]);
      setPrice('');
      setNotes('');
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try { return format(new Date(dateStr), 'dd/MM/yyyy', { locale: locale === 'th' ? th : enUS }); } catch { return dateStr; }
  };

  const localeDateFns = locale === 'th' ? th : enUS;
  const { models: modelsList, serials: serialsList, orders: ordersList, customers: customersList, settings } = useSoverienStore();

  return (
    <div className="atmo-system min-h-screen bg-gray-950 text-gray-100">
      <Sidebar />
      <div className="lg:pl-64">
        <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
          <PageHeader
            title="ออกออเดอร์"
            subtitle="สร้างออเดอร์ขายอุปกรณ์ IoT — Auto-gen Serial + ลงทะเบียนลูกค้า"
            theme="system"
            icon={<Icon name="clipboard" size={26} />}
          />

          {notice && (
            <div className={`text-sm rounded-lg border px-3 py-2 ${notice.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>
              {notice.text}
            </div>
          )}

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Form */}
            <div className="lg:col-span-2 space-y-6">
              <div className="card p-4 space-y-4">
                <h3 className="font-semibold">1. เลือกรุ่นอุปกรณ์</h3>
                <div className="flex items-center gap-4">
                  <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm">
                    <option value="">-- เลือกรุ่นอุปกรณ์ --</option>
                    {modelsList.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.prefix}) - ถัดไป: {m.id ? useSoverienStore.getState().getNextSerial(m.id) : '-'}
                      </option>
                    ))}
                  </select>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-slate-400">จำนวน:</label>
                  <input type="number" min="1" max="100" value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value) || 1)}
                    className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm w-24" />
                </div>
              </div>
            </div>

            <div className="card p-4 space-y-4">
              <h3 className="font-semibold">2. ข้อมูลลูกค้า</h3>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-sm text-slate-400">ลูกค้าประจำ:</label>
                <select value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm flex-1">
                  <option value="">-- ลูกค้าใหม่ --</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name} - {c.phone}</option>
                  ))}
                </select>
                <label className="checkbox-group">
                  <input type="checkbox" checked={newCustomer} onChange={(e) => setNewCustomer(e.target.checked)} />
                  <span className="text-sm">ลูกค้าใหม่</span>
                </label>
              </div>

              {newCustomer || !selectedCustomerId ? (
                <div className="grid sm:grid-cols-2 gap-4">
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
                  <div className="sm:col-span-2">
                    <label className="form-label">ที่อยู่จัดส่ง</label>
                    <textarea value={customerForm.address} onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })}
                      rows={2} placeholder="ที่อยู่สำหรับจัดส่ง" className="w-full" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="form-label">หมายเหตุ</label>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                      rows={2} placeholder="หมายเหตุเพิ่มเติม" className="w-full" />
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                  <div className="font-medium text-emerald-300">ใช้ลูกค้าประจำ: {customers.find(c => c.id === selectedCustomerId)?.name}</div>
                  <div className="text-sm text-slate-400">{customers.find(c => c.id === selectedCustomerId)?.phone}</div>
                </div>
              )}
            </div>

            <div className="card p-4 space-y-4">
              <h3 className="font-semibold">3. ข้อมูลออเดอร์</h3>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="form-label required">วันที่ออกใบ</label>
                  <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="w-full" />
                </div>
                <div>
                  <label className="form-label">ราคาต่อหน่วย (บาท)</label>
                  <input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)}
                    placeholder="0.00" className="w-full" />
                </div>
                <div>
                  <label className="form-label">วันสิ้นสุดประกัน (คำนวณอัตโนมัติ)</label>
                  <input type="text" readOnly className="w-full bg-slate-800"
                    value={
                      (() => {
                        const start = new Date(orderDate);
                        start.setDate(start.getDate() + 14 + 365);
                        return format(start, 'dd/MM/yyyy', { locale: locale === 'th' ? th : enUS });
                      })()
                    } />
                </div>
              </div>
              <div>
                <label className="form-label">หมายเหตุ</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                  rows={2} placeholder="หมายเหตุเพิ่มเติม" className="w-full" />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-700">
              <button onClick={handleCreateOrder} disabled={busy} className="btn btn-primary btn-lg">
                <Icon name="check" size={16} /> {busy ? 'กำลังสร้าง...' : 'สร้างออเดอร์ + สร้าง Serial'}
              </button>
            </div>
          </div>
          </div>

          {/* Available Serials Info */}
          <div className="lg:col-span-1 space-y-6">
            <div className="card p-4">
              <h3 className="font-semibold mb-4">Serial พร้อมขาย</h3>
              <div className="space-y-2">
                {modelsList.map(m => {
                  const available = serials.filter(s => s.modelId === m.id && s.status === 'available').length;
                  const next = getNextSerial(m.id);
                  return available > 0 ? (
                    <div key={m.id} className="p-3 bg-slate-800/50 rounded-lg flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 bg-primary/20 text-primary text-xs rounded font-mono">{m.prefix}</span>
                          <span className="font-medium">{m.name}</span>
                        </div>
                        <div className="text-xs text-slate-400">ว่าง: {available} ตัว · ถัดไป: {next}</div>
                      </div>
                    </div>
                  ) : null;
                })}
              </div>
              {serials.filter(s => s.status === 'available').length === 0 && (
                <div className="text-center py-8 text-slate-500">
                  <Icon name="package" size={24} className="mx-auto mb-2 text-slate-600" />
                  <p>ไม่มี Serial ว่างอยู่</p>
                  <p className="text-xs">ไปหน้า "ออก Serial" เพื่อสร้างใหม่</p>
                </div>
              )}
            </div>

            <div className="card p-4 mt-4">
              <h3 className="font-semibold mb-4">ลูกค้าล่าสุด</h3>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {customers.slice(0, 10).map(c => (
                  <button key={c.id} onClick={() => { setSelectedCustomerId(c.id); setNewCustomer(false); }}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${selectedCustomerId === c.id ? 'bg-primary/10 border border-primary' : 'hover:bg-slate-800/50'}`}>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-sm text-slate-400">{c.phone} · {c.totalOrders} ออเดอร์</div>
                  </button>
                ))}
                {customers.length === 0 && <p className="text-slate-500 text-center py-4">ยังไม่มีลูกค้า</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SoverienOrderPage;