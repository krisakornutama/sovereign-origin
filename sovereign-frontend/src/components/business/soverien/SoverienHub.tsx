"use client";
// components/business/soverien/SoverienHub.tsx
// จุดรวมชุดเครื่องมือ "Soverien" 9 ส่วน (14/10/69)
// วางเป็นแท็บย่อยในหน้า "ธุรกิจของฉัน" — ไม่แตะ BusinessWorkspace (เต็มเพดาน 400 บรรทัดแล้ว)
import { useCallback, useEffect, useState } from 'react';
import { Db } from './types';
import { load, save } from './store';
import SalesGuide from './SalesGuide';
import SerialIssuer from './SerialIssuer';
import StickerStudio from './StickerStudio';
import OrderCreate from './OrderCreate';
import OrderVault from './OrderVault';
import WarrantyCheck from './WarrantyCheck';
import SummaryCards from './SummaryCards';
import CustomerCRM from './CustomerCRM';
import BackupSecurity from './BackupSecurity';
import { PinGate } from './ui';

type TabKey = 'summary' | 'guide' | 'serial' | 'sticker' | 'order' | 'vault' | 'crm' | 'warranty' | 'settings';

const TABS: Array<{ key: TabKey; label: string; icon: string; needPin?: boolean }> = [
  { key: 'summary', label: 'สรุป', icon: '📊' },
  { key: 'guide', label: 'คู่มือขาย', icon: '📖' },
  { key: 'serial', label: 'ออก Serial', icon: '🔢' },
  { key: 'sticker', label: 'สติกเกอร์', icon: '🏷️' },
  { key: 'order', label: 'ออกออเดอร์', icon: '📝', needPin: true },
  { key: 'vault', label: 'คลังออเดอร์', icon: '📦', needPin: true },
  { key: 'crm', label: 'ลูกค้า', icon: '👥' },
  { key: 'warranty', label: 'ตรวจประกัน', icon: '🛡️' },
  { key: 'settings', label: 'สำรอง/ตั้งค่า', icon: '⚙️' },
];

export default function SoverienHub() {
  const [db, setDbState] = useState<Db | null>(null);
  const [tab, setTab] = useState<TabKey>('summary');
  const [unlocked, setUnlocked] = useState(false);
  const [stickerPreset, setStickerPreset] = useState<string[] | undefined>();

  // โหลดจาก localStorage หลัง mount (SSR ไม่มี window)
  useEffect(() => { setDbState(load()); }, []);

  const setDb = useCallback((d: Db) => {
    save(d);
    setDbState(d);
  }, []);

  if (!db) return <div className="text-sm text-gray-500 py-8 text-center">กำลังโหลดข้อมูล…</div>;

  const cur = TABS.find((t) => t.key === tab)!;
  const locked = !!db.settings.pin && cur.needPin && !unlocked;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <span className="text-xs px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
          เครื่องมือร้าน Soverien
        </span>
        <span className="text-xs text-gray-500">
          ข้อมูลเก็บในเครื่องนี้ (localStorage) · ควรสำรองเป็น JSON เป็นประจำ
        </span>
      </header>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="เครื่องมือ Soverien">
        {TABS.map((t) => (
          <button key={t.key} role="tab" type="button" aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-2.5 py-1.5 rounded-lg text-xs border transition ${
              tab === t.key ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200' : 'border-slate-700 text-gray-400 hover:bg-slate-700/30'}`}>
            <span aria-hidden>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {locked ? (
        <PinGate pin={db.settings.pin!} onUnlock={() => setUnlocked(true)} title={`${cur.icon} ${cur.label} — ใส่ PIN`} />
      ) : (
        <>
          {tab === 'summary' && <SummaryCards db={db} />}
          {tab === 'guide' && <SalesGuide />}
          {tab === 'serial' && <SerialIssuer db={db} setDb={setDb} />}
          {tab === 'sticker' && (
            <StickerStudio db={db} setDb={setDb} presetSerials={stickerPreset}
              onClearPreset={() => setStickerPreset(undefined)} />
          )}
          {tab === 'order' && <OrderCreate db={db} setDb={setDb} onDone={(sns) => { setStickerPreset(sns); setTab('sticker'); }} />}
          {tab === 'vault' && <OrderVault db={db} setDb={setDb} onGenSticker={(sns) => { setStickerPreset(sns); setTab('sticker'); }} />}
          {tab === 'crm' && <CustomerCRM db={db} />}
          {tab === 'warranty' && <WarrantyCheck db={db} />}
          {tab === 'settings' && <BackupSecurity db={db} setDb={setDb} />}
        </>
      )}
    </div>
  );
}