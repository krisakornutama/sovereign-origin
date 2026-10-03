"use client";
// Device Manager — รวมกับ Sensor Data ไว้หน้าเดียว (ดูแท็บ "ข้อมูลเซ็นเซอร์")
//
// P24 ต่อ (3/10/69): บนโดเมนสาธารณะหน้านี้ต้องมีเนื้อหาให้ Google อ่าน
// เดิม SensorsHub ต้อง login → SSR ได้แค่ "Unauthorized" = h1=0 (วัดจริงบนโดเมนแล้ว)
// แก้โดยสลับเป็น "มุมมองตัวอย่าง" (ข้อมูลสมมติ ไม่ยิง API) เฉพาะตอนเปิดจากโดเมนสาธารณะ
// ส่วนเครื่องเจ้าของ (localhost/LAN) ยังเป็น SensorsHub จริงทุกประการ — เพราะสลับหลัง mount
// (แพตเทิร์นเดียวกับหน้าแรกใน index.tsx) → render ครั้งแรกของ client ตรงกับ SSR ไม่เกิด mismatch
import { useEffect, useState } from 'react';
import SensorsHub from '../components/sensors/SensorsHub';
import SensorsPublic from '../components/public/SensorsPublic';
import { FounderCredit } from '../components/public/FounderCredit';
import SeoHead from '../components/public/SeoHead';
import { isPublicHostname, isLocalHostname } from '../lib/publicAccess';

const SEO = {
  title: 'ข้อมูลเซ็นเซอร์และจัดการอุปกรณ์ — Sovereign Origin',
  description:
    'ดูค่าจากเซ็นเซอร์และจัดการอุปกรณ์ IoT — แบตเตอรี่ น้ำ อุณหภูมิ ความปลอดภัย และแผนผังอุปกรณ์ แบบเรียลไทม์',
  path: '/sensors',
};

export default function SensorsPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const showPublic = isPublicHostname() && !(mounted && isLocalHostname());

  if (showPublic) {
    return (
      <div className="bg-gray-950 min-h-screen">
        <SeoHead {...SEO} />
        <SensorsPublic />
        <FounderCredit className="pb-4" />
      </div>
    );
  }

  return (
    <div className="bg-gray-950 min-h-screen">
      <SeoHead {...SEO} />
      <SensorsHub initialTab="devices" />
      <FounderCredit className="pb-4" />
    </div>
  );
}
