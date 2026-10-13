"use client";
// Device Manager — รวมกับ Sensor Data ไว้หน้าเดียว (ดูแท็บ "ข้อมูลเซ็นเซอร์")
//
// 13/10/69: ถอด "มุมมองตัวอย่างสำหรับผู้เยี่ยมชมเว็บ" (SensorsPublic) ออกจากโปรเจกต์นี้
//   คำสั่งเจ้าของ: "เว็บไซต์คุณไม่ต้องยุ่ง · พัฒนาแค่ app desktop"
//   → หน้านี้เหลือ SensorsHub จริงทุกประการ (ไม่ต้อง login เพราะอยู่หลังระบบแล้ว)
//   โค้ด SensorsPublic ถูกย้ายไป E:\My work\Sovereign-Web-Standalone
import SensorsHub from '../components/sensors/SensorsHub';
import { FounderCredit } from '../components/public/FounderCredit';

export default function SensorsPage() {
  return (
    <div className="bg-gray-950 min-h-screen">
      <SensorsHub initialTab="devices" />
      <FounderCredit className="pb-4" />
    </div>
  );
}