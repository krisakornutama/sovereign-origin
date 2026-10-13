import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import { useSoverienStore } from '../stores/useSoverienStore';
import { format } from 'date-fns';
import { th, enUS } from 'date-fns/locale';
import { useLanguageStore } from '../stores/useLanguageStore';

export default function SoverienSerialPage() {
  const router = useRouter();
  const { t, locale } = useLanguageStore();
  const {
    models,
    serials,
    addModel,
    generateSerials,
    getNextSerial,
    updateSerial,
  } = useSoverienStore();

  const [selectedModelId, setSelectedModelId] = useState<string>(models[0]?.id || '');
  const [generateCount, setGenerateCount] = useState(10);
  const [showModelModal, setShowModelModal] = useState(false);
  const [modelForm, setModelForm] = useState({ name: '', prefix: 'Soverien-' });
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const localeDateFns = locale === 'th' ? th : enUS;

  const selectedModel = models.find(m => m.id === selectedModelId);
  const modelSerials = serials.filter(s => s.modelId === selectedModelId);
  const availableSerials = modelSerials.filter(s => s.status === 'available');
  const soldSerials = modelSerials.filter(s => s.status === 'sold' || s.status === 'installed');
  const nextSerial = selectedModel ? getNextSerial(selectedModel.id) : '-';

  const handleGenerate = async () => {
    if (!selectedModelId) return;
    setBusy(true);
    try {
      const generated = useSoverienStore.getState().generateSerials(selectedModelId, generateCount);
      setNotice({ ok: true, text: `สร้าง Serial ${generated.length} รหัสสำเร็จ (เริ่ม ${generated[0]} ถึง ${generated[generated.length - 1]})` });
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const handleAddModel = async () => {
    if (!modelForm.name.trim() || !modelForm.prefix.trim()) {
      setNotice({ ok: false, text: 'กรอกชื่อและคำนำหน้าก่อน' });
      return;
    }
    const id = useSoverienStore.getState().addModel(modelForm);
    setNotice({ ok: true, text: `เพิ่มรุ่น "${modelForm.name}" แล้ว` });
    setModelForm({ name: '', prefix: 'Soverien-' });
    setShowModelModal(false);
  };

  const handleUpdateModel = async () => {
    if (!editingModelId || !modelForm.name.trim() || !modelForm.prefix.trim()) return;
    useSoverienStore.getState().updateModel(editingModelId, modelForm);
    setNotice({ ok: true, text: 'อัปเดตรุ่นแล้ว' });
    setEditingModelId(null);
    setModelForm({ name: '', prefix: 'Soverien-' });
  };

  const handleDeleteModel = async (id: string) => {
    if (!confirm('ลบรุ่นนี้หรือไม่? Serial ที่สร้างจากรุ่นนี้จะถูกลบด้วย')) return;
    useSoverienStore.getState().deleteModel(id);
    setNotice({ ok: true, text: 'ลบรุ่นแล้ว' });
  };

  const handleStatusChange = (serialNumber: string, status: any) => {
    updateSerial(serialNumber, { status });
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try { return format(new Date(dateStr), 'dd/MM/yyyy HH:mm', { locale: locale === 'th' ? th : enUS }); } catch { return dateStr; }
  };

  return (
    <div className="atmo-system min-h-screen bg-gray-950 text-gray-100">
      <Sidebar />
      <div className="lg:pl-64">
        <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
          <PageHeader
            title="ออก Serial Number"
            subtitle="สร้างและจัดการ Serial Number สำหรับอุปกรณ์ IoT Soverien"
            theme="system"
            icon={<Icon name="hash" size={26} />}
          />

          {notice && (
            <div className={`text-sm rounded-lg border px-3 py-2 ${notice.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>
              {notice.text}
            </div>
          )}

          {/* Model Selector & Actions */}
          <div className="card p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <label className="text-sm text-slate-400">รุ่นอุปกรณ์:</label>
                <select
                  value={selectedModelId}
                  onChange={(e) => setSelectedModelId(e.target.value)}
                  className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm min-w-[250px]"
                >
                  {models.map(m => (
                    <option key={m.id} value={m.id}>{m.name} ({m.prefix})</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-sm text-slate-400">จำนวน:</label>
                  <input type="number" min="1" max="1000" value={generateCount}
                    onChange={(e) => setGenerateCount(Number(e.target.value) || 1)}
                    className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm w-24" />
                </div>
                <button onClick={handleGenerate} disabled={busy || !selectedModelId}
                  className="btn btn-success flex items-center gap-2">
                  <Icon name="zap" size={14} /> ออก Serial {generateCount} รหัส
                </button>
              </div>
            </div>

            <div className="grid sm:grid-cols-4 gap-4">
              <div className="p-3 bg-slate-800/50 rounded-lg space-y-1">
                <div className="text-xs text-slate-400">รุ่นปัจจุบัน</div>
                <div className="font-bold text-lg">{selectedModel?.name || '-'}</div>
              </div>
              <div className="p-3 bg-slate-800/50 rounded-lg space-y-1">
                <div className="text-xs text-slate-400">คำนำหน้า</div>
                <div className="font-bold text-lg font-mono text-cyan-300">{selectedModel?.prefix || '-'}</div>
              </div>
              <div className="p-3 bg-slate-800/50 rounded-lg space-y-1">
                <div className="text-xs text-slate-400">Serial ถัดไป</div>
                <div className="font-bold text-lg font-mono text-cyan-300">{selectedModel ? getNextSerial(selectedModel.id) : '-'}</div>
              </div>
              <div className="p-3 bg-slate-800/50 rounded-lg space-y-1">
                <div className="text-xs text-slate-400">Serial ว่าง / ทั้งหมด</div>
                <div className="font-bold text-lg text-green-400">{availableSerials.length} / {modelSerials.length}</div>
              </div>
            </div>
          </div>

          {/* Model Management Modal */}
          <Modal open={showModelModal} onClose={() => setShowModelModal(false)} title={editingModelId ? 'แก้ไขรุ่น' : 'เพิ่มรุ่นใหม่'}>
            <div className="space-y-4">
              <div>
                <label className="form-label required">ชื่อรุ่น</label>
                <input value={modelForm.name} onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })}
                  placeholder="เช่น Temp Sensor" className="w-full" />
              </div>
              <div>
                <label className="form-label required">คำนำหน้า Serial</label>
                <input value={modelForm.prefix} onChange={(e) => setModelForm({ ...modelForm, prefix: e.target.value })}
                  placeholder="Soverien-Temp" className="w-full" />
                <div className="help-text">Serial จะมีรูปแบบ: คำนำหน้า-001, คำนำหน้า-002, ...</div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => { setShowModelModal(false); setModelForm({ name: '', prefix: 'Soverien-' }); setEditingModelId(null); }} className="btn btn-secondary">ยกเลิก</button>
                <button onClick={editingModelId ? handleUpdateModel : handleAddModel} className="btn btn-primary">
                  {editingModelId ? 'อัปเดต' : 'เพิ่มรุ่น'}
                </button>
              </div>
            </div>
          </Modal>

          {/* Models List */}
          <div className="card p-4">
            <h3 className="font-semibold mb-4">จัดการรุ่นอุปกรณ์</h3>
            <div className="space-y-2">
              {models.map((model) => (
                <div key={model.id} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <span className="px-2 py-1 bg-primary/20 text-primary text-sm rounded font-mono">{model.prefix}</span>
                    <span className="font-medium">{model.name}</span>
                    <span className="text-xs text-slate-400">Serial ถัดไป: {getNextSerial(model.id)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setModelForm({ name: model.name, prefix: model.prefix }); setEditingModelId(model.id); setShowModelModal(true); }}
                      className="btn btn-sm btn-outline">แก้ไข</button>
                    <button onClick={() => handleDeleteModel(model.id)} className="btn btn-sm btn-danger">ลบ</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Serials List */}
          <div className="card p-4 mt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Serial Numbers ({modelSerials.length})</h3>
              <div className="flex items-center gap-2">
                <select className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm" onChange={(e) => {
                  // Filter logic would go here
                }}>
                  <option value="all">ทั้งหมด</option>
                  <option value="available">ว่าง</option>
                  <option value="sold">ขายแล้ว</option>
                  <option value="installed">ติดตั้งแล้ว</option>
                </select>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Serial Number</th>
                    <th>สถานะ</th>
                    <th>วันที่สร้าง</th>
                    <th>ออเดอร์</th>
                    <th>ลูกค้า</th>
                    <th>การจัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {modelSerials.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-slate-500">ยังไม่มี Serial สำหรับรุ่นนี้</td></tr>
                  ) : (
                    modelSerials.map((s) => (
                      <tr key={s.serialNumber} className="hover:bg-slate-800/50">
                        <td className="font-mono text-sm">{s.serialNumber}</td>
                        <td>
                          <select value={s.status} onChange={(e) => handleStatusChange(s.serialNumber, e.target.value)}
                            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs">
                            <option value="available">ว่าง</option>
                            <option value="sold">ขายแล้ว</option>
                            <option value="installed">ติดตั้งแล้ว</option>
                            <option value="warranty">ในประกัน</option>
                            <option value="expired">หมดประกัน</option>
                          </select>
                        </td>
                        <td className="text-slate-400 text-sm">{formatDate(s.createdAt)}</td>
                        <td>{s.orderId || '-'}</td>
                        <td>{s.customerId || '-'}</td>
                        <td>
                          <button className="btn btn-sm btn-outline text-xs" onClick={() => {
                            navigator.clipboard.writeText(s.serialNumber);
                            alert('คัดลอก ' + s.serialNumber + ' แล้ว');
                          }}>คัดลอก</button>
                        </td>
                      </tr>
                    )))
                  }
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

export default SoverienSerialPage;