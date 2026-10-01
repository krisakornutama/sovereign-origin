"use client";
// Device Manager — รวมกับ Sensor Data ไว้หน้าเดียว (ดูแท็บ "ข้อมูลเซ็นเซอร์")
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
