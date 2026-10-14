// components/business/soverien/types.ts
// โมเดลข้อมูลของชุดเครื่องมือ "Soverien" (14/10/69)
// ไฟล์นี้มี "type" อย่างเดียว — ตั้งใจให้ Node เอาไปทดสอบตรง ๆ ได้โดยไม่ต้องแปลง
// (ค่าคงที่จริงอยู่ใน store.ts เพราะไฟล์นั้นต้อง import ได้โดยไม่มี runtime dependency)
//
// เก็บใน localStorage ตามที่สั่ง — ไม่ต้องมี migration (อยู่ระหว่าง Cold Soak)
// ทุกฟิลด์วันที่เก็บเป็น ISO 8601 (YYYY-MM-DD) ยกเว้น createdAt ที่ใช้เวลาเต็ม

export type Model = {
  id: string;
  name: string;      // ชื่อที่แสดงใน dropdown
  prefix: string;    // คำนำหน้า S/N เช่น Soverign-Temp → Soverign-Temp-000
  price: number;     // ราคาต่อหน่วย (บาท) ใช้คำนวณรายได้รวม
  active: boolean;
  lastNo: number;    // ตัวเลขล่าสุดที่ออกไปแล้ว (เริ่ม -1 = ยังไม่ออกเลย)
};

export type SerialStatus = 'STOCK' | 'SOLD' | 'VOID';

export type Serial = {
  sn: string;
  modelId: string;
  issuedAt: string;    // วันที่ "ออก serial" (ไม่ใช่วันขาย)
  orderId?: string;    // ผูกออเดอร์เมื่อขายออก
  status: SerialStatus;
  createdAt: string;
};

export type OrderStatus = 'ACTIVE' | 'VOID';

export type Order = {
  id: string;
  no: string;                 // เลขออเดอร์ของร้าน เช่น SO-0001
  issueDate: string;          // วันที่ออกใบ (แก้ได้)
  customerName: string;
  phone: string;
  address?: string;
  line?: string;
  note?: string;
  serials: string[];          // S/N ที่ออกไปกับออเดอร์นี้
  unitPrice: number;
  total: number;
  warrantyStart: string;      // = issueDate + shippingDays
  warrantyEnd: string;        // = warrantyStart + warrantyDays
  status: OrderStatus;
  createdAt: string;
};

export type StickerConfig = {
  widthMm: number;
  heightMm: number;
  dpi: number;
  serialX: number;    // พิกัดบนภาพ (0..1 สัดส่วนกับขนาดภาพ)
  serialY: number;
  serialSize: number; // px
  serialColor: string;
  showQr: boolean;
  qrX: number;
  qrY: number;
  qrSize: number;
  templateDataUrl?: string;   // ภาพต้นแบบจากผู้ใช้ (base64)
};

export type Settings = {
  models: Model[];
  nearExpiryDays: number;   // default 30
  shippingDays: number;    // default 14 (ขนส่ง)
  warrantyDays: number;    // default 365 (1 ปี)
  pin?: string;             // PIN 4 หลัก (optional) กันหน้าออเดอร์/คลัง
  lastBackupAt?: string;
  sticker: StickerConfig;
};

export type Db = {
  version: 1;
  models: Model[];
  serials: Serial[];
  orders: Order[];
  settings: Settings;
  orderSeq: number;
};