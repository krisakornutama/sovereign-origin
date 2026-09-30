// src/services/demo-sandbox.service.ts
//
// PUBLIC DEMO SANDBOX (P: Publishing) — ข้อมูลตัวอย่างคงตัวในโค้ด (ในตัวเอง)
// หลักการ: สนามทดลองสาธารณะ **ต้องไม่แตะ DB จริงแม้แต่อ่าน** — ข้อมูลครอบครัว/ฟาร์ม/การเงินจริง
// แยกขาดจากโลกสาธารณะ 100% (แค่ "อ่าน" ก็ยังเปิดไม่ได้) จึง hardcode เป็นข้อมูลเดโม่ล้วน
// ทุก endpoint เสิร์ฟจากที่นี่เท่านั้น · rate limit อยู่ที่ route layer
// P12: `publicCatalog()` — แคตตาล็อกโมดูลทั้งหมดที่อาจขายจริง (metadata จาก scanner — ไม่มีราคา/รายได้/ข้อมูลภายใน)
import { scanAllModules } from './software-catalog.service';

export interface DemoSensorPoint {
  at: string;
  soilMoisture: number;
  temperature: number;
  humidity: number;
}

export interface DemoAnimal {
  tag: string;
  name: string;
  species: string;
  breed: string;
  ageMonths: number;
  weightKg: number;
  status: 'HEALTHY' | 'VACCINATING' | 'WATCH';
  note: string;
}

export interface DemoPortfolioLine {
  symbol: string;
  name: string;
  assetClass: 'STOCK' | 'GOLD' | 'CRYPTO' | 'CASH';
  quantity: number;
  avgPrice: number;
  price: number;
}

// ── ข้อมูลเดโม่คงตัว (จัดวันที่อิง "วันนี้" ให้ดูสดเสมอ — ไม่มีของจริงปน) ──

const SENSOR_SERIES: Array<{ hoursAgo: number; soil: number; temp: number; humid: number }> = [
  { hoursAgo: 48, soil: 61, temp: 27.5, humid: 72 },
  { hoursAgo: 42, soil: 59, temp: 28.1, humid: 70 },
  { hoursAgo: 36, soil: 57, temp: 29.0, humid: 67 },
  { hoursAgo: 30, soil: 52, temp: 31.2, humid: 60 },
  { hoursAgo: 24, soil: 48, temp: 32.0, humid: 55 },
  { hoursAgo: 18, soil: 44, temp: 33.5, humid: 50 },
  { hoursAgo: 12, soil: 42, temp: 30.8, humid: 54 },
  { hoursAgo: 6, soil: 39, temp: 29.6, humid: 58 },
  { hoursAgo: 1, soil: 68, temp: 28.9, humid: 63 }, // รดน้ำอัตโนมัติ 6 ชม.ก่อน → ความชื้นเด้งกลับ
];

const ANIMALS: DemoAnimal[] = [
  { tag: 'TH-0071', name: 'นาเดีย', species: 'โคเนื้อ', breed: 'บราห์มัน', ageMonths: 38, weightKg: 412, status: 'HEALTHY', note: 'ฉีดวัคซีนปากและเท้าเปื่อยครบ — น้ำหนักขึ้นตามเป้า' },
  { tag: 'TH-0072', name: 'ทองแท้', species: 'โคเนื้อ', breed: 'บราห์ัน x แท้พื้นเมือง', ageMonths: 30, weightKg: 355, status: 'WATCH', note: 'ไอเล็กน้อย — แยกเฝ้าดู 7 วัน (จบ 28/9/69)' },
  { tag: 'TH-0103', name: 'หมูดำ', species: 'สุกร', breed: 'หมูดำพื้นเมือง', ageMonths: 7, weightKg: 62, status: 'HEALTHY', note: 'โตดี — ประเมินส่งต่ออีก ~2 เดือน' },
  { tag: 'TH-0108', name: 'แม่หงส์', species: 'สุกร', breed: 'แลนด์เรซ', ageMonths: 24, weightKg: 178, status: 'VACCINATING', note: 'นัดฉีดวัคซีนรอบ 6 เดือน — วันที่ 3/10/69' },
  { tag: 'TH-0111', name: 'ไก่ดำ', species: 'ไก่พื้นเมือง', breed: 'ไก่ดำหงส์', ageMonths: 10, weightKg: 1.8, status: 'HEALTHY', note: 'วางไข่เฉลี่ย 4 ฟอง/สัปดาห์' },
];

const PORTFOLIO: DemoPortfolioLine[] = [
  { symbol: 'THB-CASH', name: 'เงินสด/เงินฝากออมทรัพย์', assetClass: 'CASH', quantity: 120000, avgPrice: 1, price: 1 },
  { symbol: 'GOLD-BAHT', name: 'ทองคำแท่ง 96.5%', assetClass: 'GOLD', quantity: 3.75, avgPrice: 36200, price: 41850 },
  { symbol: 'PTT', name: 'ปตท. (PTT)', assetClass: 'STOCK', quantity: 300, avgPrice: 32.5, price: 29.75 },
  { symbol: 'CPF', name: 'เจริญโภคภัณฑ์อาหาร (CPF)', assetClass: 'STOCK', quantity: 500, avgPrice: 26.1, price: 28.4 },
  { symbol: 'BTC', name: 'Bitcoin', assetClass: 'CRYPTO', quantity: 0.015, avgPrice: 2450000, price: 2890000 },
];

const hoursAgoIso = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();

/** แปลงซีรีส์เซนเซอร์เป็นจุดที่มี timestamp สด (อิงเวลาปัจจุบันตอนเรียก) */
export function demoFarmOverview(): {
  plot: { name: string; crop: string; areaSqm: number; zone: string };
  series: DemoSensorPoint[];
  summary: { soilTrend: string; lastIrrigationHoursAgo: number; harvestEstimate: string };
  note: string;
} {
  const series = SENSOR_SERIES.map((p) => ({
    at: hoursAgoIso(p.hoursAgo),
    soilMoisture: p.soil,
    temperature: p.temp,
    humidity: p.humid,
  }));
  return {
    plot: { name: 'แปลงตัวอย่าง โซนเดโม่', crop: 'มะเขือเทศออร์แกนิก', areaSqm: 120, zone: 'demo-A' },
    series,
    summary: {
      soilTrend: 'ความชื้นลด 61→39% แล้วเด้งกลับ 68% หลังระบบรดน้ำอัตโนมัติทำงานเอง',
      lastIrrigationHoursAgo: 6,
      harvestEstimate: 'ประมาณการเก็บเกี่ยวรอบถัดไป ~10 วัน (โซน A — ดูสีผลผลิต)',
    },
    note: 'ข้อมูลตัวอย่างเพื่อสาธิตระบบ — ไม่ใช่ข้อมูลฟาร์มจริง',
  };
}

export function demoLivestock(): {
  herd: DemoAnimal[];
  summary: { total: number; healthy: number; watch: number; nextVaccine: string };
  note: string;
} {
  return {
    herd: ANIMALS,
    summary: {
      total: ANIMALS.length,
      healthy: ANIMALS.filter((a) => a.status === 'HEALTHY').length,
      watch: ANIMALS.filter((a) => a.status !== 'HEALTHY').length,
      nextVaccine: 'แม่หงส์ (สุกร) — 3/10/69',
    },
    note: 'ข้อมูลตัวอย่างเพื่อสาธิตระบบ — ไม่ใช่ข้อมูลฝูงจริง',
  };
}

/** พอร์ตจำลอง — ตัวเลขคงตัว (ไม่ยิงราคาตลาดจริง) */
export function demoFinance(): {
  lines: Array<DemoPortfolioLine & { value: number; pnl: number; pnlPct: string }>;
  summary: { totalValue: number; totalPnl: number; totalPnlPct: string; byClass: Record<string, number> };
  note: string;
} {
  const lines = PORTFOLIO.map((l) => {
    const value = l.quantity * l.price;
    const cost = l.quantity * l.avgPrice;
    const pnl = Math.round((value - cost) * 100) / 100;
    return { ...l, value: Math.round(value * 100) / 100, pnl, pnlPct: cost > 0 ? `${((pnl / cost) * 100).toFixed(1)}%` : '0.0%' };
  });
  const totalValue = Math.round(lines.reduce((s, l) => s + l.value, 0) * 100) / 100;
  const totalPnl = Math.round(lines.reduce((s, l) => s + l.pnl, 0) * 100) / 100;
  const byClass: Record<string, number> = {};
  for (const l of lines) byClass[l.assetClass] = Math.round(((byClass[l.assetClass] ?? 0) + l.value) * 100) / 100;
  return {
    lines,
    summary: {
      totalValue,
      totalPnl,
      totalPnlPct: `${((totalPnl / (totalValue - totalPnl)) * 100).toFixed(1)}%`,
      byClass,
    },
    note: 'ตัวเลขจำลองคงตัว เพื่อสาธิตหน้าจอระบบ — ไม่ใช่พอร์ตจริง',
  };
}

// ── P12: แคตตาล็อกโมดูลทั้งหมดที่อาจขายจริง (ให้ผู้ทดลองเห็นความสามารถครบระบบ) ──
// ดึงจาก scanner จริง (software-catalog.service — สแกนโค้ดสด) แต่เปิดเฉพาะ metadata ปลอดภัย:
// จำนวน endpoint/บรรทัดโค้ด/ชุดทดสอบ = พิสูจน์ขนาด+คุณภาพได้ โดยไม่เปิดราคาแนะนำต้นทุน/ข้อมูลรายได้
const DEMO_MODULE_NOTES: Record<string, string> = {
  farm: 'ปลูกอะไร รดน้ำเมื่อไหร่ ให้ผลเท่าไหร่ — เห็นครบเป็นกราฟ',
  livestock: 'จัดการฝูงสัตว์ วัคซีน น้ำหนัก สุขภาพรายตัว',
  trace: 'สินค้าแต่ละล็อตมาจากไหน ผ่านอะไรมาบ้าง — ลูกค้าสแกนดูได้',
  business: 'ร้าน/ออเดอร์/ชำระเงิน PromptPay — ระบบขายของครบวงจร',
  shop: 'หน้าร้านสาธารณะ + ตะกร้า + สถานะออเดอร์ผ่านลิงก์ลับ',
  inventory: 'คลังของ วันหมดอายุ จุดสั่งซื้อ — หมดสต็อกไม่ทันรู้ตัว',
  finance: 'พอร์ตลงทุน กำไร-ขาดทุน แยกตามชนิดสินทรัพย์',
  treasury: 'กลยุทธ์เงินทุนหลายแบบ จากพื้นฐานถึงเชิงรุก',
  restaurant: 'ระบบหลังบ้านร้านอาหาร เมนู วัตถุดิบ ยอดขาย',
  health: 'สุขภาพคนในบ้าน น้ำหนัก ความดัน น้ำตาล',
  documents: 'จัดเก็บเอกสาร ค้นด้วย AI สรุปเนื้อหาอัตโนมัติ',
  vision: 'กล้อง AI แยกคน สัตว์ ยานพาหนะ — เตือนเฉพาะของสำคัญ',
  automation: 'ตั้งเงื่อนไขให้บ้าน/ฟาร์มทำงานเอง ตามเวลาหรือเซนเซอร์',
  energy: 'ไฟ แบตเตอรี่ พลังงานสด — รู้ก่อนว่าจะไม่พอ',
  alerts: 'ศูนย์เตือนทุกอย่างในระบบ จ่ายตามระดับความสำคัญ',
  dashboard: 'หน้าจอรวมทุกระบบเป็นภาพเดียว',
};

export interface PublicCatalogModule {
  key: string;
  name: string;
  note: string;
  endpoints: number;
  loc: number;
  testRefs: number;
}

export function publicCatalog(): { modules: PublicCatalogModule[]; total: number; note: string } {
  const facts = scanAllModules();
  const modules: PublicCatalogModule[] = facts.map((f) => ({
    key: f.key,
    name: f.key.charAt(0).toUpperCase() + f.key.slice(1),
    note: DEMO_MODULE_NOTES[f.key] ?? '',
    endpoints: f.endpoints,
    loc: f.loc,
    testRefs: f.testRefs,
  }));
  return {
    modules,
    total: modules.length,
    note: 'จำนวน endpoint/บรรทัดโค้ด/ชุดทดสอบ มาจากการสแกนโค้ดจริงของระบบ — โมดูลที่มีชุดทดสอบครอบ = ตรวจคุณภาพอัตโนมัติทุกวัน',
  };
}

// ── P12: ล็อตตามรอยตัวอย่าง (sandbox — โครงเดียวกับระบบจริงแต่เป็นข้อมูลปลอม ไม่แตะ DB) ──
export interface DemoLotInfo {
  lotCode: string;
  crop: string;
  plot: string;
  quantity: number;
  harvestedAt: string;
  events: Array<{ type: string; detail: string }>;
  note: string;
}

type DemoLotSeed = Omit<DemoLotInfo, 'harvestedAt'> & { daysAgo: number };
const DEMO_LOTS: DemoLotSeed[] = [
  {
    lotCode: 'LOT-D3M9C4', crop: 'มะเขือเทศ', plot: 'แปลงมะเขือเทศโซน A', quantity: 18,
    daysAgo: 8,
    events: [
      { type: 'HARVESTED', detail: 'เก็บเกี่ยว 18 กก. จากแปลงโซน A — ความชื้นดินช่วงเก็บ 58-62%' },
      { type: 'TESTED', detail: 'ตรวจคุณภาพผ่าน — ขนาดผลสม่ำเสมอ ไม่พบร่องรอยแมลง' },
      { type: 'PROCESSED', detail: 'คัดแยกเกรด A 12 กก. / B 6 กก. บรรจุกล่องพร้อมขาย' },
      { type: 'SOLD', detail: 'จำหน่ายผ่านหน้าร้านสาธารณะ — สถานะปัจจุบัน: ขายแล้ว' },
    ],
    note: 'ล็อตตัวอย่างสำหรับเดโม่ — ระบบจริงจะโชว์ล็อตของคุณเองครบทุกเหตุการณ์',
  },
  {
    lotCode: 'LOT-DMS01A', crop: 'ชุดอุปกรณ์ DMS (Dead-Man Switch)', plot: 'สายการผลิตอุปกรณ์', quantity: 5,
    daysAgo: 2,
    events: [
      { type: 'ASSEMBLED', detail: 'ประกอบบอร์ด ESP32-S3 + โมด็อม 4G ครบ 5 ชุด' },
      { type: 'FLASHED', detail: 'แฟลชเฟิร์มแวร์ v0.4.0 — บูตผ่าน ส่ง heartbeat ปกติ' },
      { type: 'TESTED', detail: 'Drill ตัดฮาร์ตบีตจำลอง: แจ้งเตือนที่ T+90s/T+180s — ผ่านทั้ง 5 ชุด' },
      { type: 'PACKAGED', detail: 'แพ็กกล่อง + ติด QR ตามรอย (สแกนแล้วมาหน้านี้)' },
    ],
    note: 'อุปกรณ์จริงที่ขายมีบัตรประวัติแบบนี้ติดไปกับเครื่อง — ลูกค้าเห็นที่มาของเครื่องตัวเอง',
  },
  {
    lotCode: 'LOT-SWV040', crop: 'ซอฟต์แวร์ Sovereign v0.4.0', plot: 'สายปล่อยเวอร์ชัน', quantity: 0,
    daysAgo: 1,
    events: [
      { type: 'BUILT', detail: 'สร้างบิลด์ v0.4.0 — ครบทุกโมดูลในแคตตาล็อก' },
      { type: 'TESTED', detail: 'ชุดทดสอบอัตโนมัติผ่านครบ + ผ่าน quality gate 5 ด่าน' },
      { type: 'PUBLISHED', detail: 'ปล่อยเวอร์ชันสำหรับสินค้าซอฟต์แวร์บนหน้าร้าน' },
    ],
    note: 'ซอฟต์แวร์ที่ขายผูกกับล็อตเวอร์ชัน — ลูกค้ารู้ว่าได้บิลด์ไหนที่ผ่านการทดสอบอะไร',
  },
];

export function demoLot(code: string): DemoLotInfo | null {
  const c = String(code ?? '').trim().toUpperCase();
  const found = DEMO_LOTS.find((l) => l.lotCode === c);
  if (!found) return null;
  const { daysAgo, ...rest } = found;
  return { ...rest, harvestedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString() };
}

export function demoShop(): DemoLotInfo['events'] extends never ? never : Array<{ sku: string; name: string; price: number; warrantyMonths: number; lotCode: string | null; inStock: boolean; note: string }> {
  return [
    { sku: 'DMS-KIT-ESP32', name: 'ชุดประกอบ DMS — ESP32-S3 + SIM7600G 4G HAT', price: 1290, warrantyMonths: 6, lotCode: 'LOT-DMS01A', inStock: true, note: 'ประกอบเองได้ใน 1 ชม. — มาพร้อมเฟิร์มแวร์ตั้งค่าพร้อมใช้' },
    { sku: 'DMS-READY-PI', name: 'ชุด DMS พร้อมใช้ — Raspberry Pi Zero 2 W + โมเด็ม 4G', price: 2490, warrantyMonths: 6, lotCode: 'LOT-DMS01A', inStock: true, note: 'ตั้งค่ามาแล้ว ใส่ซิมใช้ได้ทันที' },
    { sku: 'DMS-SETUP-PRO', name: 'ชุด DMS + เชื่อมต่อระบบให้', price: 2990, warrantyMonths: 12, lotCode: 'LOT-DMS01A', inStock: true, note: 'ทีมงานตั้งค่าเชื่อมระบบเฝ้าระวังของคุณให้ครบ' },
    { sku: 'SW-TRACE', name: 'ระบบตามรอยผลผลิต (Traceability)', price: 1490, warrantyMonths: 12, lotCode: 'LOT-SWV040', inStock: true, note: 'ซอฟต์แวร์แยกโมดูล — ลูกค้าสแกน QR ดูที่มาสินค้าได้เอง' },
  ];
}
