"use client";
// Device Manager — รวมกับ Sensor Data ไว้หน้าเดียว (ดูแท็บ "ข้อมูลเซ็นเซอร์")
import SensorsHub from '../components/sensors/SensorsHub';
import { FounderCredit } from '../components/public/FounderCredit';
import SeoHead from '../components/public/SeoHead';

export default function SensorsPage() {
  return (
    <div className="bg-gray-950 min-h-screen">
      <SeoHead
        title="ข้อมูลเซ็นเซอร์และจัดการอุปกรณ์ — Sovereign Origin"
        description="ดูค่าจากเซ็นเซอร์และจัดการอุปกรณ์ IoT — แบตเตอรี่ น้ำ อุณหภูมิ ความปลอดภัย และแผนผังอุปกรณ์ แบบเรียลไทม์"
        path="/sensors"
      />
      <SensorsHub initialTab="devices" />
      <FounderCredit className="pb-4" />
    </div>
  );
}
