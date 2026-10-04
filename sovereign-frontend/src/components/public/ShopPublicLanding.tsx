"use client";
// src/components/public/ShopPublicLanding.tsx
// P24 ต่อ (3/10/69) — หน้า /shop ต้องมี h1 + เนื้อหาตอน SSR ไม่ใช่รอ JS
//
// เคสจริง: ShopPage ตัดสิน "ร้านไหน" จาก query string ใน useEffect → ตอน SSR ได้แค่
// <ShopShell>Loading → HTML ที่ Googlebot ดึงได้ 4,248 B ไม่มี h1 เลย (วัดจริง 3/10/69)
//
// หลักการ (เหมือน SensorsPublic):
//   1. คอมโพเนนต์นี้เป็นข้อมูลตัวอย่างล้วน ไม่ยิง API ไม่มี token ไม่มีชื่อผู้สนับสนุน
//      → ข้อมูลลูกค้าหลุดออกไปไม่ได้ แม้ต่อ URL ?order= ของจริง (หน้านั้นแสดง OrderView แยก)
//   2. ใช้เฉพาะตอน "ยังไม่รู้ว่าเปิดร้านไหน" = ตอน SSR และตอน fetch ไม่ได้ผล
//   3. พอฝั่ง client รู้รหัสร้านแล้ว ShopPage สลับไปแสดงหน้าร้านจริง (h1 เดียวเหมือนเดิม)
import { FounderCredit } from './FounderCredit';
import SeoHead from './SeoHead';

const SAMPLE_PRODUCTS = [
  { name: 'ชุดอุปกรณ์วัดความชื้นดิน', spec: 'SHT31 + ESP32 · ส่งค่าทุก 10 วินาที', price: '฿1,290' },
  { name: 'อุปกรณ์วัดระดับน้ำอัลตร้าโซนิก', spec: 'HC-SR04 + ESP8266 · กันน้ำ IP65', price: '฿890' },
  { name: 'ชุดเซ็นเซอร์แปลงปลูกผัก 6 ตัว', spec: 'อุณหภูมิ · ความชื้น · pH · EC · แสง · น้ำ', price: '฿2,450' },
  { name: 'แผงโซลาร์สำหรับประตูเก็บสินค้า', spec: 'กันฝน · เปิด–ปิดอัตโนมัติตอนพลบ', price: '฿1,750' },
];

const STEPS = [
  ['เลือกชิ้นงาน', 'กดสนับสนุนชิ้นที่สนใจ ปรับจำนวนได้ตามต้องการ'],
  ['กรอกช่องทางติดต่อ', 'ใส่ชื่อกับเบอร์โทร เพื่อให้ทีมงานจัดส่งหรือติดตั้ง'],
  ['รับลิงก์ PromptPay', 'QR ฝังยอดไว้แล้ว — สแกนด้วยแอปธนาคารได้ทันที'],
  ['ติดตามสถานะได้เสมอ', 'ลิงก์ส่วนตัวเปิดดูยอดค้างและสถานะได้โดยไม่ต้องล็อกอิน'],
];

export default function ShopPublicLanding() {
  return (
    <div className="bg-gray-950 min-h-screen text-gray-100">
      {/* SeoHead ต้องอยู่ในคอมโพเนนต์นี้เอง — หน้าร้านเดิมใส่ไว้ใน ShopShell แต่ branch
          นี้ return ออกมานอก ShopShell ถ้าไม่ใส่เองจะหลุด title/canonical (seo-preflight จับได้) */}
      <SeoHead
        title="หน้าร้านชิ้นงานและอุปกรณ์ — Sovereign Origin"
        description="หน้าร้านสาธารณะของ Sovereign Origin — ชุดอุปกรณ์และซอฟต์แวร์พร้อมบัตรตามรอยการผลิต รองรับการสั่งซื้อออนไลน์ผ่าน PromptPay"
        path="/shop"
      />
      <main className="max-w-3xl mx-auto px-4 py-12 space-y-10">
        <header className="space-y-3">
          <div className="mono text-[10px] tracking-[0.3em] uppercase text-emerald-400/80">หน้าร้านสนับสนุน</div>
          <h1 className="font-ledger text-3xl md:text-4xl font-bold glow-text">
            ร้านชิ้นงานและอุปกรณ์ของ Sovereign Origin
          </h1>
          <p className="text-sm text-gray-400 leading-relaxed max-w-2xl">
            ร้านออนไลน์ที่เปิดให้สนับสนุนโครงการ — สินค้าทุกชิ้นเป็นของจริงที่ผลิตจากระบบตัวเอง แต่ละชิ้นมี
            บัตรหลักฐานการผลิตตามรอยย้อนกลับได้ตั้งแต่แปลงปลูกจนถึงมือคุณ ชำระผ่าน PromptPay และมีลิงก์ติดตาม
            สถานะส่วนตัวให้โดยไม่ต้องสมัครสมาชิก
          </p>
        </header>

        <section className="space-y-3" aria-label="ชิ้นงานตัวอย่าง">
          <h2 className="font-ledger text-lg text-gray-200">ชิ้นงานตัวอย่างในร้าน</h2>
          <div className="card divide-y divide-dashed divide-gray-800">
            {SAMPLE_PRODUCTS.map((p) => (
              <div key={p.name} className="px-4 py-3 flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium text-[15px] text-gray-100">{p.name}</span>
                <span className="mono text-emerald-300 font-semibold ml-auto">{p.price}</span>
                <span className="w-full text-[11px] text-gray-500">{p.spec}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-600">
            ⚠️ รายการข้างต้นเป็น <b className="text-gray-500">ตัวอย่าง</b> เพื่ออธิบายว่าร้านนี้ขายอะไร —
            รายการและราคาจริงจะขึ้นเมื่อเปิดร้าน รอบนั้น
          </p>
        </section>

        <section className="space-y-3" aria-label="ขั้นตอนการสนับสนุน">
          <h2 className="font-ledger text-lg text-gray-200">สนับสนุนทำได้ 4 ขั้นตอน</h2>
          <ol className="grid gap-3 sm:grid-cols-2">
            {STEPS.map(([title, desc], i) => (
              <li key={title} className="card p-4 space-y-1">
                <div className="mono text-[11px] text-emerald-400/80">ขั้นที่ {i + 1}</div>
                <div className="font-ledger text-sm text-gray-200">{title}</div>
                <div className="text-[12px] text-gray-500 leading-relaxed">{desc}</div>
              </li>
            ))}
          </ol>
        </section>

        <section className="card p-5 space-y-3">
          <h2 className="font-ledger text-base text-gray-200">บัตรหลักฐานการผลิต — ของชิ้นที่ต่างจากร้านทั่วไป</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            สินค้าที่ผลิตจากผลผลิตของแปลงจะมีล็อตผูกไว้กับชิ้นงาน — เปิดการ์ดของสินค้าแล้วกด “ดูที่มาเต็มของล็อตนี้”
            เพื่อดูว่าเก็บเกี่ยวเมื่อไร แปรรูปที่ไหน ผ่านการตรวจคุณภาพหรือไม่ และเข้ามือคุณเมื่อใด
            ความน่าเชื่อถือจึงมาจากข้อมูล ไม่ใช่คำโฆษณา
          </p>
          <a href="/trace" className="inline-block px-4 py-2 rounded-lg border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-sm">
            ดูระบบตามรอยสินค้า →
          </a>
        </section>

        <section className="space-y-2">
          <h2 className="font-ledger text-lg text-gray-200">คำถามที่พบบ่อย</h2>
          <dl className="space-y-3">
            {[
              ['สนับสนุนแล้วได้อะไร?', 'ได้ชิ้นงานตามที่ระบุในหน้าร้าน พร้อมบัตรหลักฐานการผลิตและลิงก์ติดตามสถานะส่วนตัว'],
              ['ชำระเงินยังไง?', 'ถ้ายืนยันคำสั่งซื้อ ระบบจะออก QR PromptPay ที่ฝังยอดไว้แล้ว สแกนจ่ายได้ทันทีจากแอปธนาคาร'],
              ['ไม่สะดวกรับชิ้นงาน?', 'เลือกสนับสนุนตามศรัทธาได้ — กำหนดยอดเอง ไม่ต้องรับของ เงินเข้ากองทุนพัฒนาระบบเต็มจำนวน'],
              ['เปิดร้านรอบใหม่เมื่อไร?', 'รอบถัดไปขึ้นตามคิวผลิตของทีมงาน — กดปุ่มความคิดเห็นมุมขวาล่างเพื่อรับการแจ้งเตือน'],
            ].map(([q, a]) => (
              <div key={q} className="border-b border-dashed border-gray-800 pb-2">
                <dt className="text-sm font-medium text-gray-200">{q}</dt>
                <dd className="text-[12px] text-gray-500 leading-relaxed mt-0.5">{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card p-5 space-y-2">
          <h2 className="font-ledger text-base text-gray-200">ยังไม่เปิดร้านรอบนี้?</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            ลองเล่นระบบทั้งหมดก่อนได้ที่สนามทดลอง — ฟาร์ม ปศุสัตว์ การเงิน ตามรอยสินค้า ด้วยข้อมูลตัวอย่าง
            ไม่ต้องสมัครและไม่มีล็อกอินขวาง หรืออ่านที่มาและหลักการใช้เงินได้ที่หน้าเกี่ยวกับเรา
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <a href="/demo" className="px-4 py-2 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-medium">
              🧪 เข้าสนามทดลอง
            </a>
            <a href="/about" className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-300 text-sm">
              เกี่ยวกับเรา
            </a>
          </div>
        </section>

        <FounderCredit />
      </main>
    </div>
  );
}