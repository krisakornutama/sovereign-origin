import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import Modal from '../components/ui/Modal';
import { useSoverienStore } from '../stores/useSoverienStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { format } from 'date-fns';
import { th, enUS } from 'date-fns/locale';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export default function SoverienSettingsPage() {
  const router = useRouter();
  const { t, locale } = useLanguageStore();
  const {
    settings,
    updateSettings,
    models,
    serials,
    orders,
    customers,
    stickerTemplates,
  } = useSoverienStore();

  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinAction, setPinAction] = useState<'verify' | 'set' | 'change'>('verify');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const localeDateFns = locale === 'th' ? th : enUS;

  const handleUpdateSettings = async (newSettings: any) => {
    updateSettings(newSettings);
    setNotice({ ok: true, text: 'บันทึกการตั้งค่าแล้ว' });
  };

  const handlePinSubmit = () => {
    if (pinAction === 'verify') {
      if (pinInput === settings.pin) {
        setPinModalOpen(false);
        setPinInput('');
      } else {
        setNotice({ ok: false, text: 'PIN ไม่ถูกต้อง' });
      }
    } else if (pinAction === 'set') {
      if (pinInput.length !== 4 || !/^\d{4}$/.test(pinInput)) {
        setNotice({ ok: false, text: 'PIN ต้องเป็นตัวเลข 4 หลัก' });
        return;
      }
      handleUpdateSettings({ pin: pinInput, pinEnabled: true });
      setPinModalOpen(false);
      setPinInput('');
      setNotice({ ok: true, text: 'ตั้งค่า PIN เรียบร้อย' });
    } else if (pinAction === 'change') {
      if (pinInput !== settings.pin) {
        setNotice({ ok: false, text: 'PIN เก่าไม่ถูกต้อง' });
        return;
      }
      if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
        setNotice({ ok: false, text: 'PIN ใหม่ต้องเป็นตัวเลข 4 หลัก' });
        return;
      }
      if (newPin !== confirmPin) {
        setNotice({ ok: false, text: 'PIN ใหม่ไม่ตรงกัน' });
        return;
      }
      handleUpdateSettings({ pin: newPin });
      setPinModalOpen(false);
      setNewPin('');
      setConfirmPin('');
      setNotice({ ok: true, text: 'เปลี่ยน PIN เรียบร้อย' });
    }
  };

  const openPinModal = (action: 'verify' | 'set' | 'change') => {
    setPinAction(action);
    setPinInput('');
    setNewPin('');
    setConfirmPin('');
    setPinModalOpen(true);
  };

  const handleExportAll = async () => {
    const data = {
      models: useSoverienStore.getState().models,
      serials: useSoverienStore.getState().serials,
      orders: useSoverienStore.getState().orders,
      customers: useSoverienStore.getState().customers,
      stickerTemplates: useSoverienStore.getState().stickerTemplates,
      settings: useSoverienStore.getState().settings,
      exportedAt: new Date().toISOString(),
      version: 1,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    saveAs(blob, `soverien-backup-${format(new Date(), 'yyyyMMdd-HHmm')}.json`);
    setNotice({ ok: true, text: 'ส่งออกข้อมูล JSON เรียบร้อย' });
  };

  const handleExportOrdersCSV = () => {
    const ordersData = useSoverienStore.getState().orders;
    const headers = ['Order ID', 'Serial Numbers', 'Customer Name', 'Customer Phone', 'Model', 'Quantity', 'Status', 'Created At', 'Warranty Start', 'Warranty End', 'Price', 'Notes'];
    const rows = useSoverienStore.getState().orders.map(o => [
      o.id,
      o.serialNumbers?.join('; ') || '',
      o.customer?.name || '',
      o.customer?.phone || '',
      o.modelName,
      o.quantity,
      o.status,
      format(new Date(o.createdAt), 'yyyy-MM-dd HH:mm'),
      o.warrantyStart ? format(new Date(o.warrantyStart), 'yyyy-MM-dd') : '',
      o.warrantyEnd ? format(new Date(o.warrantyEnd), 'yyyy-MM-dd') : '',
      o.price || '',
      o.notes || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `soverien-orders-${format(new Date(), 'yyyyMMdd')}.csv`);
    setNotice({ ok: true, text: 'ส่งออก CSV เรียบร้อย' });
  };

  const handleImportJSON = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result as string);
        // Here you would restore the data to the store
        // This is a simplified version - in reality you'd dispatch actions to restore each store
        setNotice({ ok: true, text: 'นำเข้าข้อมูลสำเร็จ (จำเป็นต้อง implement restore logic)' });
      } catch (e) {
        setNotice({ ok: false, text: 'ไฟล์ JSON ไม่ถูกต้อง' });
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="atmo-system min-h-screen bg-gray-950 text-gray-100">
      <Sidebar />
      <div className="lg:pl-64">
        <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
          <PageHeader
            title="ตั้งค่า Soverien"
            subtitle="จัดการการตั้งค่าระบบ PIN Backup/Restore และข้อมูลบริษัท"
            theme="system"
            icon={<Icon name="settings" size={26} />}
          />

          {notice && (
            <div className={`text-sm rounded-lg border px-3 py-2 ${notice.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>
              {notice.text}
            </div>
          )}

          {/* PIN Settings */}
          <div className="card p-6 space-y-6">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Icon name="lock" size={20} className="text-primary" />
              รหัส PIN (4 หลัก)
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg">
                <div>
                  <div className="font-medium">สถานะ PIN</div>
                  <div className="text-sm text-slate-400">{settings.pinEnabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</div>
                </div>
                {settings.pinEnabled ? (
                  <button onClick={() => handleUpdateSettings({ pinEnabled: false })} className="btn btn-secondary btn-sm">
                    ปิดใช้งาน PIN
                  </button>
                ) : (
                  <button onClick={() => openPinModal('set')} className="btn btn-primary btn-sm">
                    <Icon name="lock" size={14} /> ตั้งค่า PIN
                  </button>
                )}
              </div>

              {settings.pinEnabled && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <button onClick={() => openPinModal('change')} className="btn btn-outline">
                    <Icon name="rotate-ccw" size={14} /> เปลี่ยน PIN
                  </button>
                  <button onClick={() => handleUpdateSettings({ pin: '', pinEnabled: false })} className="btn btn-danger">
                    <Icon name="lock-open" size={14} /> ลบ PIN
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Company Info */}
          <div className="card p-6 space-y-6">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Icon name="building" size={20} className="text-primary" />
              ข้อมูลบริษัท
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">ชื่อบริษัท</label>
                <input value={settings.companyName} onChange={(e) => handleUpdateSettings({ companyName: e.target.value })}
                  className="w-full" />
              </div>
              <div>
                <label className="form-label">เบอร์โทร</label>
                <input value={settings.companyPhone} onChange={(e) => handleUpdateSettings({ companyPhone: e.target.value })}
                  placeholder="02-xxx-xxxx" className="w-full" />
              </div>
              <div>
                <label className="form-label">LINE ID</label>
                <input value={settings.companyLineId} onChange={(e) => handleUpdateSettings({ companyLineId: e.target.value })}
                  placeholder="line_id" className="w-full" />
              </div>
              <div>
                <label className="form-label">ที่อยู่</label>
                <textarea value={settings.companyAddress} onChange={(e) => handleUpdateSettings({ companyAddress: e.target.value })}
                  rows={3} className="w-full" />
              </div>
            </div>
          </div>

          {/* Warranty Settings */}
          <div className="card p-6 space-y-6">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Icon name="shield" size={20} className="text-primary" />
              การตั้งค่ารับประกัน
            </h2>
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="form-label">ระยะเวลารับประกัน (วัน)</label>
                <input type="number" min="1" max="3650" value={settings.warrantyDays}
                  onChange={(e) => handleUpdateSettings({ warrantyDays: Number(e.target.value) })}
                  className="w-full" />
                <div className="help-text">ค่าเริ่มต้น: 365 วัน (1 ปี)</div>
              </div>
              <div>
                <label className="form-label">วันขนส่ง (บัฟเฟอร์)</label>
                <input type="number" min="0" max="60" value={settings.shippingBufferDays}
                  onChange={(e) => handleUpdateSettings({ shippingBufferDays: Number(e.target.value) })}
                  className="w-full" />
                <div className="help-text">วันนับตั้งแต่ออกใบถึงเริ่มประกัน (ค่าเริ่มต้น: 14 วัน)</div>
              </div>
              <div>
                <label className="form-label">วันเตือนล่วงหน้า (วัน)</label>
                <input type="number" min="1" max="180" value={settings.warrantyAlertDays}
                  onChange={(e) => handleUpdateSettings({ warrantyAlertDays: Number(e.target.value) })}
                  className="w-full" />
                <div className="help-text">แจ้งเตือนล่วงหน้าก่อนหมดประกัน (ค่าเริ่มต้น: 30 วัน)</div>
              </div>
            </div>
          </div>

          {/* Backup & Restore */}
          <div className="card p-6 space-y-6">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Icon name="database" size={20} className="text-primary" />
              สำรองข้อมูล / กู้คืน
            </h2>
            <div className="flex flex-wrap gap-4">
              <button onClick={handleExportAll} className="btn btn-primary flex items-center gap-2">
                <Icon name="download" size={14} /> ส่งออกข้อมูลทั้งหมด (JSON)
              </button>
              <button onClick={handleExportOrdersCSV} className="btn btn-secondary flex items-center gap-2">
                <Icon name="file-text" size={14} /> ส่งออกออเดอร์ (CSV)
              </button>
              <div className="flex items-center gap-2">
                <input type="file" accept=".json" id="importFile" className="file-input" onChange={(e) => e.target.files[0] && handleImportJSON(e.target.files[0])} />
                <label htmlFor="importFile" className="file-label">
                  <Icon name="upload" size={14} /> นำเข้า JSON
                </label>
              </div>
            </div>
            <div className="mt-4 p-4 bg-slate-800/50 rounded-lg text-sm text-slate-400">
              <div className="font-medium mb-2">ข้อมูลที่รวมใน Backup:</div>
              <ul className="space-y-1 list-disc list-inside">
                <li>รุ่นอุปกรณ์ (Models)</li>
                <li>Serial Numbers ทั้งหมด</li>
                <li>ออเดอร์ทั้งหมด</li>
                <li>ลูกค้าทั้งหมด</li>
                <li>เทมเพลตสติกเกอร์</li>
                <li>การตั้งค่า (Settings)</li>
              </ul>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="card p-6 space-y-6 border border-red-500/30 bg-red-500/5">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-red-400">
              <Icon name="alert-triangle" size={20} />
              โซนอันตราย
            </h2>
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-red-300 mb-2 font-medium">⚠️ การกระทำเหล่านี้ไม่สามารถย้อนกลับได้</p>
              <p className="text-sm text-slate-400 mb-4">กรุณาอ่านให้เข้าใจก่อนกดปุ่ม</p>
              <div className="flex gap-4">
                <button className="btn btn-danger" onClick={() => {
                  if (confirm('ล้างข้อมูลทั้งหมด? ต้องพิมพ์ "DELETE ALL" เพื่อยืนยัน')) {
                    const input = prompt('พิมพ์ DELETE ALL เพื่อยืนยัน:');
                    if (input === 'DELETE ALL') {
                      useSoverienStore.getState().reset();
                      setNotice({ ok: true, text: 'ล้างข้อมูลทั้งหมดแล้ว' });
                    }
                  }
                }}>
                  <Icon name="trash-2" size={14} /> ล้างข้อมูลทั้งหมด
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}