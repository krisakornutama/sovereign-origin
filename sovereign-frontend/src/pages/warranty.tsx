"use client";
// pages/warranty.tsx
// หน้า "ตรวจประกัน" แบบเต็มจอ — ปลายทางของ QR ที่พิมพ์ลงป้ายสติกเกอร์ (14/10/69)
// สเปกเจ้าของ: "QR Code — สแกนแล้วเปิดหน้า 'ตรวจประกัน' พร้อมกรอก S/N ให้"
// → ต้องเป็นหน้าเดี่ยวที่เปิดจาก URL ได้โดยไม่ต้องเข้าเมนูเครื่องมือก่อน
//
// ข้อมูลอยู่ใน localStorage ของเครื่องนี้ (เก็บแบบ local-first ตามที่เจ้าของสั่ง)
// → เปิดจากเครื่องอื่น/มือถือจะไม่เจอข้อมูล แต่ยังแสดงหน้า UI ปกติ
import { useEffect, useState } from 'react';
import type { Db } from '../components/business/soverien/types';
import { load } from '../components/business/soverien/store';
import WarrantyCheck from '../components/business/soverien/WarrantyCheck';
import Sidebar from '../components/layout/Sidebar';
import Icon from '../components/ui/Icon';

export default function WarrantyPage() {
  const [db, setDb] = useState<Db | null>(null);

  useEffect(() => { setDb(load()); }, []);

  return (
    <div className="atmo-nature min-h-screen bg-gray-950 text-gray-100">
      {/* มี Sidebar ตามกฎ sidebar-rule ของโปรเจกต์ — คนที่สแกน QR
          ต้องยังเดินไปหน้าอื่นต่อได้ ไม่ใช่ติดอยู่ที่หน้าจอเดียว */}
      <Sidebar />
      <div className="lg:pl-64">
        <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
          <header className="flex items-center gap-3">
            <Icon name="check-circle" size={26} />
            <div>
              <h1 className="font-ledger text-xl">ตรวจประกันอุปกรณ์ Soverien</h1>
              <p className="text-xs text-gray-500">สแกน QR บนป้ายอุปกรณ์ หรือพิมพ์หมายเลขประจำเครื่องด้านล่าง</p>
            </div>
          </header>

          {db ? (
            <WarrantyCheck db={db} />
          ) : (
            <div className="text-sm text-gray-500 py-10 text-center">กำลังโหลด…</div>
          )}
        </div>
      </div>
    </div>
  );
}