"use client";
// src/components/public/SensorsPublic.tsx
// P24 ต่อ (3/10/69) — หน้า /sensors บนโดเมนสาธารณะต้องมีเนื้อหาให้อ่าน
//
// เคสจริง: SensorsHub ต้อง login (authFetch + useAuthStore) → ตอน SSR ได้แค่ "Unauthorized"
// → HTML ที่ Googlebot ดึงได้ = 0 <h1> (วัดจริง 3/10/69: /sensors/ h1=0 · 34,062 B)
//
// หลักการที่ยึด (สำคัญกว่าการได้ h1):
//   1. ไม่แตะ API และไม่แตะ auth store เลย → ไม่มีทางข้อมูลจริง/ข้อมูลลูกค้าหลุดออกไป
//   2. ทุกค่าที่แสดงเป็น "ตัวอย่าง" ที่ hardcode ในไฟล์นี้ พร้อมป้ายกำกับชัดเจน
//   3. คอมโพเนนต์ไม่มี hook อ่าน auth → render ฝั่ง server ได้ทันที (ไม่ต้องรอ hydrate)
//   4. หน้าจริงของเจ้าของ (localhost/LAN) ยังเป็น SensorsHub เหมือนเดิมทุกประการ
//      — สลับหลัง mount เท่านั้น (แพตเทิร์นเดียวกับหน้าแรก)
import { FounderCredit } from './FounderCredit';

// ค่าตัวอย่าง — เลขแต่งขึ้นสำหรับอธิบายเท่านั้น ไม่ใช่การวัดจริงจากฟาร์มใด
const SAMPLE_GAUGES = [
  { metric: 'อุณหภูมิอากาศ', value: '31.4 °C', hint: 'เซ็นเซอร์ DHT22 บนเสาสวน', tone: 'text-amber-300' },
  { metric: 'ความชื้นดิน', value: '48 %', hint: 'โซนเพาะกล้า — ชั้น 20 ซม.', tone: 'text-cyan-300' },
  { metric: 'ระดับน้ำในบ่อ', value: '1.82 ม.', hint: 'อัลตร้าโซนิก + ESP8266', tone: 'text-emerald-300' },
  { metric: 'กำลังไฟฟ้าโซลาร์', value: '4.6 kW', hint: 'อินเวอร์เตอร์สลับแหล่งพลังงาน', tone: 'text-green-300' },
];

const SAMPLE_DEVICES = [
  { id: 'ESP32-NODE-01', kind: 'ESP32 + SHT31', place: 'โรงเก็บพืชสด', status: 'ออนไลน์', since: 'อัปเดตทุก 10 วินาที' },
  { id: 'ESP8266-TANK-02', kind: 'ESP8266 + HC-SR04', place: 'บ่อเก็บน้ำหลัก', status: 'ออนไลน์', since: 'รายงานระดับน้ำ + แบตเตอรี่' },
  { id: 'ESP32-GATE-03', kind: 'ESP32 + PIR + Reed', place: 'ประตูโรงเก็บ', status: 'ออนไลน์', since: 'แจ้งเตือนเปิดประตูนอกเวลา' },
  { id: 'RPI-4-SOLAR-04', kind: 'Raspberry Pi 4', place: 'หลังคาโซลาร์', status: 'ออฟไลน์', since: 'ส่งค่าเมื่อกลับมาออนไลน์' },
];

const SUPPORTED_METRICS = [
  ['battery_soc', 'แบตเตอรี่ (%)'],
  ['temperature', 'อุณหภูมิ (°C)'],
  ['humidity', 'ความชื้นอากาศ (%)'],
  ['soil_moisture', 'ความชื้นดิน (%)'],
  ['water_level_cm', 'ระดับน้ำ (ซม.)'],
  ['power_kw', 'กำลังไฟฟ้า (kW)'],
  ['ec_value', 'ค่า EC ธาตุอาหาร'],
  ['ph', 'pH ดิน'],
  ['solar_radiation', 'แสงอาทิตย์ (W/m²)'],
  ['wind_speed', 'ความเร็วลม (m/s)'],
  ['rainfall', 'ปริมาณน้ำฝน (มม.)'],
  ['smoke', 'เฝ้าระวังควัน'],
  ['gas_leak', 'เฝ้าระวังแก๊สรั่ว'],
  ['door_state', 'สถานะประตู'],
  ['pir_motion', 'ตรวจจับการเคลื่อนไหว'],
  ['ultrasonic_distance', 'ระยะอัลตร้าโซนิก'],
];

export default function SensorsPublic() {
  return (
    <div className="bg-gray-950 min-h-screen text-gray-100">
      <main className="max-w-4xl mx-auto px-4 py-12 space-y-10">
        <header className="space-y-3">
          <div className="mono text-[10px] tracking-[0.3em] uppercase text-emerald-400/80">โมดูลเซ็นเซอร์ · IoT</div>
          <h1 className="font-ledger text-3xl md:text-4xl font-bold glow-text">
            ระบบเซ็นเซอร์และจัดการอุปกรณ์ — ดูค่าจากฟาร์มแบบเรียลไทม์
          </h1>
          <p className="text-sm text-gray-400 leading-relaxed max-w-2xl">
            Sovereign Origin รับค่าจากอุปกรณ์ ESP8266 / ESP32 / Raspberry Pi เข้าระบบผ่าน MQTT แล้วเก็บเป็นประวัติ
            เพื่อใช้ตัดสินใจเรื่องน้ำ ปุ๋ย พลังงาน และความปลอดภัยของแปลง — คนที่อยู่ในฟาร์มจึงดูสถานะล่าสุดได้จากโทรศัพท์
            แทนการเดินไปดูหน้าจู่ ๆ หน้านี้คือภาพรวมว่าระบบอ่านและจัดการอะไรได้บ้าง พร้อมค่าตัวอย่างประกอบ
          </p>
        </header>

        {/* ค่าตัวอย่าง — ตัวเลขทั้งหมดเป็นข้อมูลสมมติเพื่อการอธิบาย */}
        <section className="space-y-3" aria-label="ค่าตัวอย่างจากเซ็นเซอร์">
          <h2 className="font-ledger text-lg text-gray-200">ค่าที่ระบบอ่านได้ (ตัวอย่าง)</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SAMPLE_GAUGES.map((g) => (
              <div key={g.metric} className="card p-4">
                <div className="text-[11px] text-gray-500">{g.metric}</div>
                <div className={`mono text-2xl font-semibold mt-1 ${g.tone}`}>{g.value}</div>
                <div className="text-[10px] text-gray-600 mt-1">{g.hint}</div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-600">
            ⚠️ ตัวเลขทุกค่าในหน้านี้เป็น <b className="text-gray-500">ข้อมูลตัวอย่าง</b> ไม่ใช่การวัดจริง —
            ข้อมูลจริงของแปลงแต่ละเจ้าของอยู่หลังระบบภายในและไม่เปิดเผยต่อสาธารณะ
          </p>
        </section>

        {/* อุปกรณ์ตัวอย่าง */}
        <section className="space-y-3" aria-label="อุปกรณ์ตัวอย่าง">
          <h2 className="font-ledger text-lg text-gray-200">จัดการอุปกรณ์ (ตัวอย่าง)</h2>
          <div className="card divide-y divide-gray-800/80">
            {SAMPLE_DEVICES.map((d) => (
              <div key={d.id} className="px-4 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="mono text-sm text-gray-100">{d.id}</span>
                <span className="text-[11px] text-gray-500">{d.kind} · {d.place}</span>
                <span
                  className={`ml-auto text-[11px] ${d.status === 'ออนไลน์' ? 'text-emerald-400' : 'text-gray-500'}`}
                >
                  ● {d.status}
                </span>
                <span className="w-full text-[10px] text-gray-600">{d.since}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-600">
            ในระบบจริงเจ้าของเพิ่มอุปกรณ์เองได้ (พิมพ์รหัสอุปกรณ์ → วางบนเซ็นเซอร์) และลบทิ้งได้เมื่อเครื่องเสีย
          </p>
        </section>

        {/* เมตริกที่รองรับ — เนื้อหาที่ค้นหาคำเฉพาะได้จริง */}
        <section className="space-y-3" aria-label="เมตริกที่ระบบรองรับ">
          <h2 className="font-ledger text-lg text-gray-200">เซ็นเซอร์ที่ระบบรองรับ</h2>
          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 text-sm text-gray-400">
            {SUPPORTED_METRICS.map(([key, label]) => (
              <li key={key} className="flex items-baseline gap-2 border-b border-dashed border-gray-800/70 pb-1">
                <code className="mono text-[11px] text-cyan-400/80">{key}</code>
                <span className="text-[12px]">{label}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ทำไมถึงสำคัญ — ข้อความเชิงคุณค่า ปิดท้าย */}
        <section className="space-y-3">
          <h2 className="font-ledger text-lg text-gray-200">ทำไมต้องเก็บค่าทุกตัวเลข</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['📉', 'เห็นปัญหาก่อนเสียหาย', 'ระดับน้ำลดลงต่อเนื่องหรือค่า EC พุ่ง = สัญญาณต้องรดน้ำหรือเปลี่ยนสูตรปุ๋ย'],
              ['🧾', 'ตรวจสอบย้อนหลังได้', 'ค่าที่บันทึกไว้เป็นหลักฐานว่าระบบทำงานตามที่ออกแบบหรือไม่'],
              ['🔌', 'ลดค่าไฟ', 'การเทียบกำลังผลิตโซลาร์กับการใช้ไฟจริงทำให้เห็นว่าอุปกรณ์ไหนกินพลังงานเกิน'],
            ].map(([icon, title, desc]) => (
              <div key={title} className="card p-4 space-y-1">
                <div className="text-xl">{icon}</div>
                <div className="font-ledger text-sm text-gray-200">{title}</div>
                <div className="text-[12px] text-gray-500 leading-relaxed">{desc}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5 space-y-2">
          <h2 className="font-ledger text-base text-gray-200">อยากดูข้อมูลจริงในระบบทำงาน?</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            เข้าสนามทดลองได้ทันทีโดยไม่ต้องสมัคร — ข้อมูลชุดตัวอย่างของทั้งระบบ (ฟาร์ม ปศุสัตว์ การเงิน ตามรอยสินค้า)
            เปิดให้ลองกดดูได้ทุกเมนู หรือดูรายละเอียดที่มาและทีมงานได้ที่หน้าเกี่ยวกับเรา
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <a href="/demo" className="px-4 py-2 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-medium">
              🧪 เข้าสนามทดลอง
            </a>
            <a href="/about" className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-300 text-sm">
              เกี่ยวกับเรา
            </a>
            <a href="/shop" className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-300 text-sm">
              ดูหน้าร้าน
            </a>
          </div>
        </section>

        <FounderCredit />
      </main>
    </div>
  );
}