import { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import { useSoverienStore } from '../stores/useSoverienStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { format } from 'date-fns';
import { th, enUS } from 'date-fns/locale';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

interface StickerSettings {
  serialPosition: { x: number; y: number };
  serialFontSize: number;
  serialColor: string;
  warrantyPosition: { x: number; y: number };
  warrantyFontSize: number;
  warrantyColor: string;
  qrPosition?: { x: number; y: number };
  qrSize?: number;
  showQr: boolean;
  stickerWidth: number; // mm
  stickerHeight: number; // mm
  dpi: number;
}

const DEFAULT_STICKER_SETTINGS: StickerSettings = {
  serialPosition: { x: 50, y: 30 },
  serialFontSize: 24,
  serialColor: '#000000',
  warrantyPosition: { x: 50, y: 80 },
  warrantyFontSize: 14,
  warrantyColor: '#000000',
  qrPosition: { x: 85, y: 15 },
  qrSize: 20,
  showQr: true,
  stickerWidth: 40,
  stickerHeight: 20,
  dpi: 300,
};

export default function SoverienStickerPage() {
  const { t, locale } = useLanguageStore();
  const {
    serials,
    orders,
    stickerTemplates,
    addStickerTemplate,
    updateStickerTemplate,
    deleteStickerTemplate,
    activeStickerTemplateId,
    setActiveStickerTemplate,
    settings,
  } = useSoverienStore();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(activeStickerTemplateId);
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateForm, setTemplateForm] = useState<Partial<any>>({ ...DEFAULT_STICKER_SETTINGS, name: '' });
  const [previewSerial, setPreviewSerial] = useState<string>('');
  const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(null);
  const [stickerSettings, setStickerSettings] = useState<StickerSettings>(DEFAULT_STICKER_SETTINGS);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const templates = stickerTemplates;
  const activeTemplate = templates.find(t => t.id === selectedTemplateId);

  const localeDateFns = locale === 'th' ? th : enUS;

  const handleTemplateChange = (id: string) => {
    setSelectedTemplateId(id);
    setActiveStickerTemplate(id);
    const template = templates.find(t => t.id === id);
    if (template) {
      setStickerSettings({
        serialPosition: template.serialPosition,
        serialFontSize: template.serialFontSize,
        serialColor: template.serialColor,
        warrantyPosition: template.warrantyPosition,
        warrantyFontSize: template.warrantyFontSize,
        warrantyColor: template.warrantyColor,
        qrPosition: template.qrPosition,
        qrSize: template.qrSize,
        showQr: template.showQr ?? true,
        stickerWidth: template.stickerWidth ?? DEFAULT_STICKER_SETTINGS.stickerWidth,
        stickerHeight: template.stickerHeight ?? DEFAULT_STICKER_SETTINGS.stickerHeight,
        dpi: template.dpi ?? DEFAULT_STICKER_SETTINGS.dpi,
      });
    }
  };

  const handleAddTemplate = async () => {
    if (!templateForm.name.trim()) return;
    const templateData = { ...templateForm, ...stickerSettings };
    const id = useSoverienStore.getState().addStickerTemplate(templateData);
    setSelectedTemplateId(id);
    setShowTemplateModal(false);
    setTemplateForm({ ...DEFAULT_STICKER_SETTINGS, name: '' });
  };

  const handleUpdateTemplate = async () => {
    if (!editingTemplateId) return;
    const templateData = { ...templateForm, ...stickerSettings };
    useSoverienStore.getState().updateStickerTemplate(editingTemplateId, templateData);
    setEditingTemplateId(null);
    setShowTemplateModal(false);
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('ลบเทมเพลตนี้หรือไม่?')) return;
    useSoverienStore.getState().deleteStickerTemplate(id);
    if (selectedTemplateId === id) setSelectedTemplateId(null);
  };

  const generateSticker = async (serialNumber: string, settings: StickerSettings): Promise<Blob> => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    
    const dpr = window.devicePixelRatio || 1;
    const mmToPx = (mm: number) => (mm / 25.4) * settings.dpi;
    
    canvas.width = mmToPx(settings.stickerWidth);
    canvas.height = mmToPx(settings.stickerHeight);
    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;

    ctx.scale(settings.dpi / 96, settings.dpi / 96);

    // Draw background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, mmToPx(settings.stickerWidth), mmToPx(settings.stickerHeight));

    // Draw border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);

    // Draw Serial Number
    const serial = activeTemplate?.name || 'Soverien-Temp-001';
    ctx.font = `bold ${settings.serialFontSize}px Arial`;
    ctx.fillStyle = settings.serialColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const mmToPxX = (mm: number) => (mm / 25.4) * 300;
    const mmToPxY = (mm: number) => (mm / 25.4) * 300;
    ctx.fillText('Soverien-Temp-001', mmToPxX(settings.serialPosition.x), mmToPxY(settings.serialPosition.y));

    // Draw Warranty Date
    const warrantyEnd = '31/12/2025';
    ctx.font = `${settings.warrantyFontSize}px Arial`;
    ctx.fillStyle = settings.warrantyColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`ประกันถึง: ${warrantyEnd}`, mmToPxX(settings.warrantyPosition.x), mmToPxY(settings.warrantyPosition.y));

    // Draw QR Code (placeholder)
    if (settings.showQr) {
      const qrSize = mmToPx(settings.qrSize ?? 20);
      const qrX = mmToPx(settings.qrPosition?.x ?? 85);
      const qrY = mmToPx(settings.qrPosition?.y ?? 15);
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(qrX, qrY, qrSize, qrSize);
      ctx.strokeStyle = '#000';
      ctx.strokeRect(qrX, qrY, qrSize, qrSize);
      ctx.fillStyle = '#000';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('QR', qrX + qrSize/2, qrY + qrSize/2 + 3);
    }

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob!), 'image/png');
    });
  };

  const generateAndDownload = async (serialNumber: string) => {
    const blob = await generateSticker(serialNumber, stickerSettings);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sticker-${serialNumber}.png`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAll = async () => {
    const zip = new JSZip();
    for (const sn of selectedSerials) {
      const blob = await generateSticker(sn, stickerSettings);
      zip.file(`sticker-${sn}.png`, await blob.arrayBuffer());
    }
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `stickers-${Date.now()}.zip`);
  };

  const localeDateFns = locale === 'th' ? th : enUS;

  return (
    <div className="atmo-system min-h-screen bg-gray-950 text-gray-100">
      <Sidebar />
      <div className="lg:pl-64">
        <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
          <PageHeader
            title="สร้างสติกเกอร์"
            subtitle="สร้างสติกเกอร์ Serial + QR Code สำหรับแปะหน้าอุปกรณ์"
            theme="system"
            icon={<Icon name="tag" size={26} />}
          />

          {/* Template Selector */}
          <div className="card p-4 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h3 className="font-semibold">เทมเพลตสติกเกอร์</h3>
              <button onClick={() => { setTemplateForm({ ...DEFAULT_STICKER_SETTINGS, name: '' }); setShowTemplateModal(true); setEditingTemplateId(null); }}
                className="btn btn-primary btn-sm flex items-center gap-2">
                <Icon name="plus" size={14} /> เพิ่มเทมเพลต
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {stickerTemplates.map(t => (
                <button
                  key={t.id}
                  onClick={() => handleTemplateChange(t.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    selectedTemplateId === t.id
                      ? 'bg-primary text-white border-primary'
                      : 'bg-slate-800 border border-slate-600 hover:bg-slate-700'
                  }`}
                >
                  {t.name}
                </button>
              ))}
              <button onClick={() => { setShowTemplateModal(true); setEditingTemplateId(null); setTemplateForm({ ...DEFAULT_STICKER_SETTINGS, name: '' }); }}
                className="px-4 py-2 rounded-lg text-sm border border-slate-600 hover:bg-slate-700/50 text-slate-400">
                + เพิ่มเทมเพลต
              </button>
            </div>
          </div>

          {/* Sticker Settings */}
          <div className="card p-4 mb-6">
            <h3 className="font-semibold mb-4">ตั้งค่าสติกเกอร์</h3>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="col-span-2">
                <label className="form-label">ขนาดสติกเกอร์ (มม.)</label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="form-label text-xs">กว้าง (mm)</label>
                    <input type="number" min="10" max="100" step="1" value={stickerSettings.stickerWidth}
                      onChange={(e) => setStickerSettings({ ...stickerSettings, stickerWidth: Number(e.target.value) })}
                      className="w-full" />
                  </div>
                  <div>
                    <label className="form-label text-xs">สูง (mm)</label>
                    <input type="number" min="10" max="100" step="1" value={stickerSettings.stickerHeight}
                      onChange={(e) => setStickerSettings({ ...stickerSettings, stickerHeight: Number(e.target.value) })}
                      className="w-full" />
                  </div>
                </div>
                <div>
                  <label className="form-label text-xs">DPI</label>
                  <input type="number" min="72" max="600" step="1" value={stickerSettings.dpi}
                    onChange={(e) => setStickerSettings({ ...stickerSettings, dpi: Number(e.target.value) })}
                    className="w-full" />
                </div>
              </div>

              <div>
                <label className="form-label">Serial Number</label>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="form-label text-xs">X (mm)</label>
                    <input type="number" step="1" value={stickerSettings.serialPosition.x}
                      onChange={(e) => setStickerSettings({ ...stickerSettings, serialPosition: { ...stickerSettings.serialPosition, x: Number(e.target.value) } })}
                      className="w-full" />
                  </div>
                  <div>
                    <label className="form-label text-xs">Y (mm)</label>
                    <input type="number" step="1" value={stickerSettings.serialPosition.y}
                      onChange={(e) => setStickerSettings({ ...stickerSettings, serialPosition: { ...stickerSettings.serialPosition, y: Number(e.target.value) } })}
                      className="w-full" />
                  </div>
                  <div>
                    <label className="form-label text-xs">ขนาดฟอนต์</label>
                    <input type="number" min="8" max="48" step="1" value={stickerSettings.serialFontSize}
                      onChange={(e) => setStickerSettings({ ...stickerSettings, serialFontSize: Number(e.target.value) })}
                      className="w-full" />
                  </div>
                </div>
                <div>
                  <label className="form-label">สี Serial</label>
                  <div className="color-input">
                    <input type="color" value={stickerSettings.serialColor}
                      onChange={(e) => setStickerSettings({ ...stickerSettings, serialColor: e.target.value })}
                      className="w-12 h-8" />
                    <input type="text" value={stickerSettings.serialColor}
                      onChange={(e) => setStickerSettings({ ...stickerSettings, serialColor: e.target.value })}
                      className="w-full font-mono text-sm" />
                  </div>
                </div>
              </div>

              <div>
                <label className="form-label">วันที่สิ้นสุดประกัน</label>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="form-label text-xs">X (mm)</label>
                    <input type="number" step="1" value={stickerSettings.warrantyPosition.x}
                      onChange={(e) => setStickerSettings({ ...stickerSettings, warrantyPosition: { ...stickerSettings.warrantyPosition, x: Number(e.target.value) } })}
                      className="w-full" />
                  </div>
                  <div>
                    <label className="form-label text-xs">Y (mm)</label>
                    <input type="number" step="1" value={stickerSettings.warrantyPosition.y}
                      onChange={(e) => setStickerSettings({ ...stickerSettings, warrantyPosition: { ...stickerSettings.warrantyPosition, y: Number(e.target.value) } })}
                      className="w-full" />
                  </div>
                  <div>
                    <label className="form-label text-xs">ขนาดฟอนต์</label>
                    <input type="number" min="8" max="24" step="1" value={stickerSettings.warrantyFontSize}
                      onChange={(e) => setStickerSettings({ ...stickerSettings, warrantyFontSize: Number(e.target.value) })}
                      className="w-full" />
                  </div>
                </div>
                <div>
                  <label className="form-label">สี วันที่</label>
                  <div className="color-input">
                    <input type="color" value={stickerSettings.warrantyColor}
                      onChange={(e) => setStickerSettings({ ...stickerSettings, warrantyColor: e.target.value })}
                      className="w-12 h-8" />
                    <input type="text" value={stickerSettings.warrantyColor}
                      onChange={(e) => setStickerSettings({ ...stickerSettings, warrantyColor: e.target.value })}
                      className="w-full font-mono text-sm" />
                  </div>
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={stickerSettings.showQr}
                    onChange={(e) => setStickerSettings({ ...stickerSettings, showQr: e.target.checked })} />
                  <span className="text-sm">แสดง QR Code</span>
                </label>
                <div className="grid grid-cols-3 gap-4 mt-2">
                  <div>
                    <label className="form-label text-xs">QR X (mm)</label>
                    <input type="number" step="1" value={stickerSettings.qrPosition?.x ?? 85}
                      onChange={(e) => setStickerSettings({ ...stickerSettings, qrPosition: { ...stickerSettings.qrPosition, x: Number(e.target.value) } })}
                      className="w-full" />
                  </div>
                  <div>
                    <label className="form-label text-xs">QR Y (mm)</label>
                    <input type="number" step="1" value={stickerSettings.qrPosition?.y ?? 15}
                      onChange={(e) => setStickerSettings({ ...stickerSettings, qrPosition: { ...stickerSettings.qrPosition, y: Number(e.target.value) } })}
                      className="w-full" />
                  </div>
                  <div>
                    <label className="form-label text-xs">QR Size (mm)</label>
                    <input type="number" min="5" max="50" step="1" value={stickerSettings.qrSize ?? 20}
                      onChange={(e) => setStickerSettings({ ...stickerSettings, qrSize: Number(e.target.value) })}
                      className="w-full" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="card p-4 mb-6">
            <h3 className="font-semibold mb-4">Preview สติกเกอร์</h3>
            <div className="flex flex-wrap gap-4">
              <div className="preview-wrapper">
                <canvas ref={canvasRef} className="sticker-canvas" width={472} height={236} />
              </div>
              <div className="flex flex-col gap-2">
                <button className="btn btn-primary" onClick={() => generateAndDownload('Soverien-Temp-001')}>
                  <Icon name="download" size={14} /> ดาวน์โหลด PNG
                </button>
                <button className="btn btn-secondary" onClick={downloadAll} disabled={selectedSerials.length === 0}>
                  <Icon name="download" size={14} /> ดาวน์โหลดทั้งหมด ZIP ({selectedSerials.length})
                </button>
                <div className="flex items-center gap-2 pt-2">
                  <input type="checkbox" checked={selectedSerials.length > 0} onChange={() => {}} disabled />
                  <span className="text-xs text-slate-400">เลือกทั้งหมด ({serials.filter(s => s.status !== 'expired').length} รายการ)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Serial Selection for Batch */}
          <div className="card p-4">
            <h3 className="font-semibold mb-4">เลือก Serial สำหรับสร้างสติกเกอร์</h3>
            <div className="flex items-center gap-4 mb-4">
              <button onClick={() => setSelectedSerials(serials.filter(s => s.status === 'available').map(s => s.serialNumber))}
                className="btn btn-sm btn-outline">เลือกทั้งหมดที่ว่าง</button>
              <button onClick={() => setSelectedSerials([])} className="btn btn-sm btn-outline">ล้างเลือก</button>
              <span className="text-sm text-slate-400 ml-auto">เลือกแล้ว: {selectedSerials.length} รหัส</span>
            </div>
            <div className="table-wrap" style={{ maxHeight: '300px' }}>
              <table>
                <thead>
                  <tr>
                    <th><input type="checkbox" onChange={(e) => setSelectedSerials(e.target.checked ? serials.filter(s => s.status !== 'expired').map(s => s.serialNumber) : [])} /></th>
                    <th>Serial Number</th>
                    <th>สถานะ</th>
                    <th>รุ่น</th>
                    <th>วันที่สร้าง</th>
                  </tr>
                </thead>
                <tbody>
                  {serials.filter(s => s.status !== 'expired').slice(0, 50).map(s => (
                    <tr key={s.serialNumber} className={`hover:bg-slate-800/50 ${selectedSerials.includes(s.serialNumber) ? 'bg-primary/10' : ''}`}>
                      <td><input type="checkbox" checked={selectedSerials.includes(s.serialNumber)} onChange={(e) => setSelectedSerials(e.target.checked ? [...selectedSerials, s.serialNumber] : selectedSerials.filter(sn => sn !== s.serialNumber))} /></td>
                      <td className="font-mono text-sm">{s.serialNumber}</td>
                      <td><span className={`badge ${s.status === 'available' ? 'badge-green' : s.status === 'sold' ? 'badge-blue' : s.status === 'installed' ? 'badge-green' : 'badge-yellow'}`}>{s.status}</span></td>
                      <td className="text-slate-400 text-sm">{serials.find(x => x.serialNumber === s.serialNumber)?.modelName || '-'}</td>
                      <td className="text-slate-400 text-sm">{format(new Date(s.createdAt), 'dd/MM/yyyy', { locale: locale === 'th' ? th : enUS })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={downloadAll} disabled={selectedSerials.length === 0} className="btn btn-primary">
                <Icon name="download" size={14} /> ดาวน์โหลด ZIP ({selectedSerials.length} ไฟล์)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SoverienStickerPage;