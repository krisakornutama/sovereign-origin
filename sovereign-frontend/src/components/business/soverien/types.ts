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

export type StickerFit = 'cover' | 'contain' | 'stretch';
export type StickerAlign = 'left' | 'center' | 'right';

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
  /**
   * ที่อยู่ปลายทางของ QR (เช่น https://โดเมนของคุณ)
   * เว้นว่าง = ใช้ origin ของเครื่องที่เปิดแอปอยู่ (localhost ตอนรันบนเครื่องตัวเอง)
   * ต้องตั้งเป็นโดเมนจริง ถ้าจะให้ลูกค้าสแกนด้วยมือถือ (14/10/69)
   */
  qrBaseUrl?: string;
  templateDataUrl?: string;   // ภาพต้นแบบจากผู้ใช้ (base64)

  // ── เพิ่ม 14/10/69 จากอาการที่เจ้าของบอก: ──
  //   "ย่อภาพให้เล็กไม่ได้ / ปรับตัวอักษรไม่คล่อง / ตัวหนังสือไม่ชัด"
  tplFit: StickerFit;      // ย่อภาพต้นแบบลงสติกเกอร์: เต็มจอ(ตัดขอบ) / พอดีทั้งหมด / ยืดเต็ม
  tplScale: number;        // 0.2–3  ย่อ/ขยายเพิ่มจากโหมดข้างบน
  tplX: number;            // -1..1  เลื่อนภาพต้นแบบแนวนอน
  tplY: number;            // -1..1  เลื่อนภาพต้นแบบแนวตั้ง
  /**
   * ขนาดภาพต้นแบบบนป้ายเป็นมิลลิเมตร — 0 = ให้ระบบคำนวณจาก tplFit เอง (16/10/69)
   * เจ้าของถาม: "ผมสามารถกำหนดความกว้างและสูงของภาพได้มั้ย เพราะภาพมันเล็กกว่าที่ควรจะเป็น"
   *   → ใส่ค่าแค่ข้างเดียวได้ อีกข้างจะคำนวณตามสัดส่วนภาพให้เอง (ภาพจะไม่บิด)
   */
  tplWMm: number;
  tplHMm: number;
  serialAlign: StickerAlign;
  serialPlate: boolean;    // วางพื้นหลังหลัง S/N ให้อ่านออกแม้ทับภาพ
  serialPlateColor: string;
  showWarranty: boolean;   // แสดง/ซ่อนบรรทัดวันสิ้นประกัน
  warrantyColor: string;
  /**
   * ฟอนต์ของข้อความบนป้าย — เจ้าของใช้ Garuda (16/10/69)
   * เก็บเป็นชื่อ CSS font-family เต็ม แล้วปล่อยให้ผู้ใช้เลือกเองได้
   * ⚠ ถ้าเครื่องไม่มีฟอนต์นี้ canvas จะเงียบ ๆ ไปใช้ฟอนต์สำรอง
   *   → ต้องเช็คด้วย sticker-fonts.ts ว่ามีจริง ไม่ใช่แค่เขียนชื่อลงไป
   */
  serialFont: string;
  /** ทำตัวหนา — Garuda มี GARA.TTF/GARABD.TTF สองไฟล์แยกกัน */
  serialBold: boolean;
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

/**
 * แม่แบบป้ายที่ตั้งค่าไว้แล้ว (14/10/69)
 *   เจ้าของบอกว่าต้องจัดวางทุกครั้ง = ยากเกินไป
 *   → ตั้งค่าครั้งเดียว ตั้งชื่อไว้ แล้วกดชื่อเดียวจบ
 *   มีหลายแบบป้ายได้ (หลัก / กล่องเล็ก / ตัวอย่าง) แต่ละแบบจำค่าของตัวเอง
 */
export type StickerPreset = { id: string; name: string; cfg: StickerConfig };

export type Db = {
  version: 1;
  models: Model[];
  serials: Serial[];
  orders: Order[];
  settings: Settings;
  orderSeq: number;
  stickerPresets: StickerPreset[];
};