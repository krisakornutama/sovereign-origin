"use client";
// components/business/soverien/BackupSecurity.tsx
// ส่วนที่ 9 — สำรอง/กู้คืนข้อมูล + ตั้งค่า + ความปลอดภัย (14/10/69)
// ⚠ ข้อมูลทั้งหมดอยู่ใน localStorage ของเบราว์เซอร์ → ล้าง cache = หาย จึงต้องมี backup
import { useEffect, useState } from 'react';
import type { Db } from './types';
import { DEFAULT_SETTINGS, KEY, wipeAll } from './backup';
import { normalizeDb } from './store';
import { guardSerialCounter } from './serial-guard';
import { ordersToCsv, serialsToCsv } from './csv';
import { downloadText, downloadBlob } from './zip';
import { Card, Field, inputCls, btnPrimary, btnGhost, btnDanger, Notice } from './ui';

const AUTO_BACKUP_DAYS = 7;

export default function BackupSecurity({ db, setDb }: { db: Db; setDb: (d: Db) => void }) {
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [stale, setStale] = useState(false);

  const s = db.settings;

  useEffect(() => {
    const last = s.lastBackupAt ? new Date(s.lastBackupAt).getTime() : 0;
    setStale(!last || Date.now() - last > AUTO_BACKUP_DAYS * 86400000);
  }, [s.lastBackupAt]);

  function patch(p: Partial<typeof s>) {
    // ⚠ 14/10/69: ต้องสร้าง object ใหม่ ไม่ใช่แก้ db เดิม (React เทียบ Object.is)
    setDb({ ...db, settings: { ...db.settings, ...p } });
  }

  function exportJson() {
    const d = db;
    patch({ lastBackupAt: new Date().toISOString() });
    downloadText(JSON.stringify(d, null, 2), `soverien-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    setMsg({ ok: true, text: 'ส่งออกไฟล์สำรองแล้ว · เก็บไฟล์นี้ไว้ในที่ปลอดภัย' });
  }

  function exportOrdersCsv() {
    downloadText(ordersToCsv(db), `soverien-orders-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
    setMsg({ ok: true, text: 'export ออเดอร์เป็น CSV แล้ว (เปิดใน Excel ได้)' });
  }

  function exportSerialsCsv() {
    downloadText(serialsToCsv(db), `soverien-serials-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
    setMsg({ ok: true, text: 'export รายการ serial เป็น CSV แล้ว' });
  }

  async function importJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      // ⚠ 17/10/69 ต้องผ่าน normalizeDb ให้เหมือน load() — เดิมใช้ object ดิบจากไฟล์
      //   ไฟล์เก่าที่ไม่มี settings.sticker → เปิดหน้าสติกเกอร์แล้ว crash ทันที
      const parsed = normalizeDb(JSON.parse(await file.text()) as Db);
      if (!parsed) throw new Error('ไฟล์นี้ไม่ใช่ข้อมูลของเครื่องมือ Soverien');
      // ⚠ กู้ข้อมูลห้ามทำให้ตัวนับ serial ถอยหลัง (กฎเหล็ก: ห้ามออกเลขซ้ำ แม้กู้/ล้าง)
      const raised = guardSerialCounter(parsed, db);
      const raiseNote = raised.length
        ? `\nปรับตัวนับขึ้นเพื่อไม่ให้เลขซ้ำกับที่เคยพิมพ์ไปแล้ว: ${raised.map((m) => `${m.prefix} → ${m.lastNo}`).join(' · ')}`
        : '';
      if (!window.confirm(`กู้คืน ${parsed.orders.length} ออเดอร์ · ${parsed.serials.length} serial ?\nข้อมูลปัจจุบันจะถูกแทนที่ทั้งหมด${raiseNote}`)) return;
      setDb(parsed);
      setMsg({ ok: true, text: raised.length ? 'กู้คืนข้อมูลเรียบร้อย · ตัวนับ serial ถูกยกขึ้นเพื่อกันเลขซ้ำ' : 'กู้คืนข้อมูลเรียบร้อย' });
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message ?? 'อ่านไฟล์ไม่สำเร็จ' });
    } finally {
      e.target.value = '';
    }
  }

  function wipe() {
    if (!window.confirm('ล้างข้อมูลทั้งหมดของเครื่องมือ Soverien ใช่หรือไม่?\n\nป้ายที่พิมพ์ออกไปแล้วจะตามหาประกันไม่ได้อีก และตัวนับ serial จะเริ่มใหม่ที่ 000')) return;
    if (window.prompt('พิมพ์คำว่า DELETE ALL เพื่อยืนยัน') !== 'DELETE ALL') {
      setMsg({ ok: false, text: 'ยกเลิก — ไม่ได้ลบข้อมูล' });
      return;
    }
    wipeAll();
    setDb({
      version: 1,
      models: JSON.parse(JSON.stringify(DEFAULT_SETTINGS.models)),
      serials: [],
      orders: [],
      settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      orderSeq: 0,
      stickerPresets: [],
    });
    setMsg({ ok: true, text: 'ล้างข้อมูลทั้งหมดแล้ว' });
  }

  function savePin() {
    if (!/^\d{4}$/.test(pin)) { setMsg({ ok: false, text: 'PIN ต้องเป็นตัวเลข 4 หลัก' }); return; }
    if (pin !== pin2) { setMsg({ ok: false, text: 'PIN สองครั้งไม่ตรงกัน' }); return; }
    patch({ pin });
    setPin(''); setPin2('');
    setMsg({ ok: true, text: 'ตั้ง PIN แล้ว — หน้า “ออกออเดอร์” และ “คลังออเดอร์” จะถาม PIN' });
  }

  return (
    <div className="space-y-4">
      {msg && <Notice kind={msg.ok ? 'ok' : 'err'}>{msg.text}</Notice>}

      {stale && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          ยังไม่ได้สำรองข้อมูลมานานแล้ว — ข้อมูลอยู่ในเบราว์เซอร์เครื่องนี้เท่านั้น
          {s.lastBackupAt ? ` (ครั้งล่าสุด ${new Date(s.lastBackupAt).toLocaleDateString('th-TH')})` : ''}
          · กด “ส่งออกไฟล์สำรอง (JSON)” ด้านล่าง
        </div>
      )}

      <Card title="สำรอง / กู้คืน" sub="ไฟล์ JSON เก็บทุกอย่าง (serial · ออเดอร์ · ลูกค้า · การตั้งค่า · ภาพต้นแบบป้าย)">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} onClick={exportJson}>ส่งออกไฟล์สำรอง (JSON)</button>
          <label className={`${btnGhost} cursor-pointer`}>
            กู้คืนจากไฟล์ JSON
            <input type="file" accept="application/json,.json" className="hidden" onChange={importJson} />
          </label>
          <button type="button" className={btnGhost} onClick={exportOrdersCsv}>ออเดอร์ → CSV</button>
          <button type="button" className={btnGhost} onClick={exportSerialsCsv}>Serial → CSV</button>
        </div>
        <p className="text-[11px] text-gray-500">
          เก็บไฟล์ไว้ที่ <span className="text-gray-400">E:\</span> หรือ Google Drive — อย่าเก็บแค่ในเครื่องนี้ล้วน
        </p>
        <p className="text-[11px] text-gray-500">ระบบจะเตือนให้สำรองทุก {AUTO_BACKUP_DAYS} วัน</p>
      </Card>

      <Card title="ตั้งค่าประกัน" sub="ใช้กับการคำนวณทุกที่ (ออกออเดอร์ · คลัง · ตรวจประกัน)">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="ระยะเวลาขนส่ง (วัน)" hint="นับประกันหลังของถึงมือลูกค้า">
            <input type="number" min={0} max={90} className={inputCls} value={s.shippingDays}
              onChange={(e) => patch({ shippingDays: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <Field label="ระยะเวลาประกัน (วัน)" hint="365 ≈ 1 ปี">
            <input type="number" min={1} max={3650} className={inputCls} value={s.warrantyDays}
              onChange={(e) => patch({ warrantyDays: Math.max(1, Number(e.target.value) || 365) })} />
          </Field>
          <Field label="เตือนเมื่อใกล้หมด (วัน)" hint="สีเหลืองในคลังออเดอร์">
            <input type="number" min={1} max={365} className={inputCls} value={s.nearExpiryDays}
              onChange={(e) => patch({ nearExpiryDays: Math.max(1, Number(e.target.value) || 30) })} />
          </Field>
        </div>
        <p className="text-[11px] text-gray-500">
          ออเดอร์ที่บันทึกไว้แล้วจะไม่ถูกคำนวณใหม่ — ถ้าต้องการให้ใช้ค่าใหม่กับออเดอร์เดิม ให้แก้ที่รายรายการในคลังออเดอร์
        </p>
      </Card>

      <Card title="ความปลอดภัย" sub="PIN 4 หลัก ปิดหน้าออกออเดอร์/คลังออเดอร์ (ไม่บังคับ — แอปเป็นเครื่องคนเดียว)">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={s.pin ? 'ตั้ง PIN ใหม่' : 'ตั้ง PIN (4 หลัก)'}>
            <input className={inputCls} inputMode="numeric" maxLength={4} value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" />
          </Field>
          <Field label="ยืนยัน PIN">
            <input className={inputCls} inputMode="numeric" maxLength={4} value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} placeholder="••••" />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} onClick={savePin}>{s.pin ? 'เปลี่ยน PIN' : 'ตั้ง PIN'}</button>
          {s.pin && <button type="button" className={btnGhost} onClick={() => { patch({ pin: undefined }); setMsg({ ok: true, text: 'ปิดการล็อกด้วย PIN แล้ว' }); }}>ปิดการล็อกด้วย PIN</button>}
        </div>
      </Card>

      <Card title="ล้างข้อมูล" sub="ย้อนกลับไม่ได้ — ให้สำรองไฟล์ JSON ก่อน">
        <button type="button" className={btnDanger} onClick={wipe}>ล้างข้อมูลทั้งหมด</button>
        <p className="text-[11px] text-gray-500">ต้องพิมพ์คำว่า DELETE ALL เพื่อยืนยัน · ล้างเฉพาะข้อมูลของเครื่องมือนี้ (ไม่กระทบระบบอื่น)</p>
        <p className="text-[11px] text-gray-600 mono">คีย์ใน localStorage: {KEY}</p>
      </Card>
    </div>
  );
}