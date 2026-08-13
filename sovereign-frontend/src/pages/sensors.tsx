"use client";
// Device Manager — รวมกับ Sensor Data ไว้หน้าเดียว (ดูแท็บ "ข้อมูลเซ็นเซอร์")
import SensorsHub from '../components/sensors/SensorsHub';

export default function SensorsPage() {
  return <SensorsHub initialTab="devices" />;
}
