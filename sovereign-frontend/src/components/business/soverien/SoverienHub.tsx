"use client";
// components/business/soverien/SoverienHub.tsx
// จุดรวมชุดเครื่องมือ "Soverien" 9 ส่วน (14/10/69)
// วางเป็นแท็บย่อยในหน้า "ธุรกิจของฉัน" — ไม่แตะ BusinessWorkspace (เต็มเพดาน 400 บรรทัดแล้ว)
//
// ── เรียงตามลำดับการทำงานจริงของร้าน ไม่เรียงตามชื่อเมนู ──
//   เดิมมี 9 แท็กเรียงกัน รกจนมองไม่ออกว่าต้องกดอะไรก่อน (เจ้าของบอก 14/10/69)
//   รวมเหลือ 5 แท็บ แล้วซ่อนรายละเอียดไว้ใน "หัวข้อย่อย" ขนาดเล็ก
//   1. สรุป          ← เปิดเข้ามาก่อนต้องเห็นภาพรวม
//   2. ออกออเดอร์     → ออกออเดอร์ · คู่มือขาย        (ขาย)
//   3. สติกเกอร์      → ออก Serial · พิมพ์สติกเกอร์    (ทำป้าย)
//   4. ติดตาม        → คลังออเดอร์ · ตรวจประกัน · ลูกค้า (หลังขาย)
//   5. ตั้งค่า        ← สำรอง/ความปลอดภัย
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
import TelegramNotifyCard from './TelegramNotifyCard';
import { PinGate } from './ui';

type TabKey = 'summary' | 'sell' | 'sticker' | 'track' | 'settings';
type SectionKey = 'order' | 'guide' | 'serial' | 'design' | 'vault' | 'warranty' | 'crm' | 'notify';

const TABS: Array<{ key: TabKey; label: string; icon: string; needPin?: boolean }> = [
  { key: 'summary', label: 'สรุป', icon: '📊' },
  { key: 'sell', label: 'ออกออเดอร์', icon: '🧾', needPin: true },
  { key: 'sticker', label: 'สติกเกอร์', icon: '🏷️' },
  { key: 'track', label: 'ติดตาม', icon: '📦', needPin: true },
  { key: 'settings', label: 'ตั้งค่า', icon: '⚙️' },
];

const SECTIONS: Record<TabKey, Array<{ key: SectionKey; label: string }>> = {
  summary: [],
  sell: [{ key: 'order', label: 'ออกออเดอร์' }, { key: 'guide', label: 'คู่มือขาย' }],
  sticker: [{ key: 'serial', label: 'ออก Serial' }, { key: 'design', label: 'พิมพ์สติกเกอร์' }],
  track: [
    { key: 'vault', label: 'คลังออเดอร์' },
    { key: 'warranty', label: 'ตรวจประกัน' },
    { key: 'crm', label: 'ลูกค้า' },
    { key: 'notify', label: '🔔 แจ้งเตือน' },
  ],
  settings: [],
};

const DEFAULT_SECTION: Record<TabKey, SectionKey | null> = {
  summary: null, sell: 'order', sticker: 'design', track: 'vault', settings: null,
};

const SAVE_FAILED_MSG = '⚠ บันทึกลงเครื่องไม่สำเร็จ (พื้นที่เก็บเต็ม) — สิ่งที่เพิ่งทำไป "ยังไม่ถูกเก็บ" ถ้าปิดแอปจะหาย · กด “ส่งออกไฟล์สำรอง (JSON)” ที่แท็บตั้งค่าเพื่อล้างพื้นที่';

export default function SoverienHub() {
  const [db, setDbState] = useState<Db | null>(null);
  const [tab, setTab] = useState<TabKey>('summary');
  const [section, setSection] = useState<SectionKey>('order');
  const [unlocked, setUnlocked] = useState(false);
  const [stickerPreset, setStickerPreset] = useState<string[] | undefined>();
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // โหลดจาก localStorage หลัง mount (SSR ไม่มี window)
  useEffect(() => { setDbState(load()); }, []);

  const setDb = useCallback((d: Db) => {
    // ⚠ ต้องรายงานทันทีเมื่อบันทึกไม่สำเร็จ (17/10/69)
    //   เดิม save() เงียบ ๆ เมื่อโควตาเต็ม → หน้าขึ้น "ออกออเดอร์แล้ว" แต่ข้อมูลไม่เคยถูกเก็บ
    //   และไม่มีใครรู้จนกว่าจะเปิดแอปใหม่ แล้วทุกอย่างหายไป
    const saved = save(d);
    setDbState(d);
    setSaveErr(saved ? null : SAVE_FAILED_MSG);
  }, []);

  const go = useCallback((t: TabKey) => {
    setTab(t);
    setSection(DEFAULT_SECTION[t] ?? 'order');
  }, []);

  // ข้ามไปหน้าสติกเกอร์ให้อัตโนมัติหลังออกออเดอร์/กด "ทำสติกเกอร์" ในคลัง
  const goSticker = useCallback(() => {
    setTab('sticker');
    setSection('design');
  }, []);

  if (!db) return <div className="text-sm text-gray-500 py-8 text-center">กำลังโหลดข้อมูล…</div>;

  const cur = TABS.find((t) => t.key === tab)!;
  const locked = !!db.settings.pin && cur.needPin && !unlocked;
  const secs = SECTIONS[tab];

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

      {/* ขึ้นคงที่ทุกแท็บเมื่อบันทึกไม่สำเร็จ — ห้ามปล่อยให้เจ้าของคิดว่าข้อมูลถูกเก็บแล้ว (17/10/69) */}
      {saveErr && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {saveErr}
        </div>
      )}

      {/* แท็บหลัก 5 อัน — เหลือเท่าที่จำได้ ไม่ต้องเลื่อนหา */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="เครื่องมือ Soverien">
        {TABS.map((t) => (
          <button key={t.key} role="tab" type="button" aria-selected={tab === t.key}
            onClick={() => go(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition ${
              tab === t.key ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200' : 'border-slate-700 text-gray-400 hover:bg-slate-700/30'}`}>
            <span aria-hidden>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* หัวข้อย่อย — เล็กกว่าแท็บหลักมาก ไม่แย่งสายตา */}
      {secs.length > 1 && (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label={`หัวข้อย่อย ${cur.label}`}>
          {secs.map((s) => (
            <button key={s.key} role="tab" type="button" aria-selected={section === s.key}
              onClick={() => setSection(s.key)}
              className={`px-2 py-0.5 rounded-full text-[11px] border transition ${
                section === s.key ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-200' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {locked ? (
        <PinGate pin={db.settings.pin!} onUnlock={() => setUnlocked(true)} title={`${cur.icon} ${cur.label} — ใส่ PIN`} />
      ) : (
        <>
          {tab === 'summary' && <SummaryCards db={db} />}

          {tab === 'sell' && section === 'order' && (
            <OrderCreate db={db} setDb={setDb} onDone={(sns) => { setStickerPreset(sns); goSticker(); }} />
          )}
          {tab === 'sell' && section === 'guide' && <SalesGuide />}

          {tab === 'sticker' && section === 'serial' && <SerialIssuer db={db} setDb={setDb} />}
          {tab === 'sticker' && section === 'design' && (
            <StickerStudio db={db} setDb={setDb} presetSerials={stickerPreset}
              onClearPreset={() => setStickerPreset(undefined)} />
          )}

          {tab === 'track' && section === 'vault' && (
            <OrderVault db={db} setDb={setDb} onGenSticker={(sns) => { setStickerPreset(sns); goSticker(); }} />
          )}
          {tab === 'track' && section === 'warranty' && <WarrantyCheck db={db} />}
          {tab === 'track' && section === 'crm' && <CustomerCRM db={db} />}
          {/* แจ้งเตือน Telegram เข้าห้องธุรกิจ (16/10/69) — เพิ่มในแท็บ "ติดตาม" ตามที่เจ้าของขอ */}
          {tab === 'track' && section === 'notify' && <TelegramNotifyCard db={db} />}

          {tab === 'settings' && <BackupSecurity db={db} setDb={setDb} />}
        </>
      )}
    </div>
  );
}