import { useEffect } from 'react';
import Head from 'next/head';
import { FeedbackButton } from '../../components/public/FeedbackButton';
import { trackPageView } from '../../lib/visitorTrack';

// P17 — คู่มือคู่ค้า: สิทธิประโยชน์ · วิธีติดตั้ง QR ป้าย · ขั้นตอนขอเชื่อมระบบ IoT
//  หน้าคงที่ (ไม่มี API) — เนื้อหาอัปเดตตามรอบอนุมัติจริง

const BENEFITS = [
  { icon: '📍', title: 'หมุดบนแผนที่ร่วม', detail: 'ลูกค้าในพื้นที่เห็นร้านคุณบนแผนที่คู่ค้า (เปิด 24/7) พร้อมชื่อ หมวด ที่อยู่ เบอร์ร้าน' },
  { icon: '🏷️', title: 'QR ป้ายหน้าร้าน', detail: 'ได้ QR ป้ายของร้านตัวเอง — ลูกค้าสแกนแล้วเห็นหมุดร้านคุณทันที (พิมพ์ติดหน้าร้าน/ใบเสร็จได้)' },
  { icon: '🛠️', title: 'บริการ IoT แก้ปัญหาจริง', detail: 'ขอให้ทีมงานติดตั้ง/ดูแลระบบ IoT ในร้าน — เซ็นเซอร์ แจ้งเตือน ตามรอยงานซ่อมแบบโปร่งใส' },
  { icon: '🤝', title: 'เครือข่ายและสัญญาณลูกค้า', detail: 'ร้านในเครือข่ายแนะนำกันเอง — ทุกเสียงตอบรับจากลูกค้าถูกใช้พัฒนาบริการร่วมกัน' },
];

const QR_STEPS = [
  'หลังอนุมัติ เข้าลิงก์ที่ทีมงานส่งให้ (หรือบอกทีมงานว่าต้องการ QR ป้าย)',
  'ทีมงานกดสร้าง QR ป้ายร้านคุณจากระบบ — QR ชี้มาที่หมุดร้านของคุณบนแผนที่โดยเฉพาะ',
  'กด "พิมพ์ป้าย" — ได้ QR ขนาดเหมาะติดหน้าร้าน/เคาน์เตอร์ (กระดาษ A4 ธรรมดาก็พอ)',
  'ลูกค้าสแกน → เห็นชื่อร้านคุณบนแผนที่ทันที ไม่ต้องพิมพ์ค้นหา',
];

const IOT_STEPS = [
  { title: '1 · บอกปัญหาที่อยากแก้', detail: 'เช่น "ห้องเย็นล่มไม่รู้ตัว" · "ไม่รู้ว่าร้านมีคนช่วงไหน" · "สต็อกหาย" — เขียนสั้น ๆ ในฟอร์มความคิดเห็นหรือโทรทีมงาน' },
  { title: '2 · ทีมงานเสนอชุดอุปกรณ์ + ใบเสนอราคา', detail: 'เลือกเฉพาะที่จำเป็น — พร้อมค่าอุปกรณ์/ค่าติดตั้งแยกชัด ไม่มีบังคับรายเดือน' },
  { title: '3 · รับลิงก์ชำระ PromptPay', detail: 'บิลเป็นลิงก์ส่วนตัว — สแกนจ่ายได้ทันที ตรวจสถานะบิลได้ตลอด (รอชำระ/ชำระแล้ว)' },
  { title: '4 · ติดตั้ง + ตามรอยงานซ่อม', detail: 'งานติดตั้ง/ซ่อมมีสถานะจริงในระบบ (รอดำเนินการ → กำลังทำ → เสร็จ) — ดูได้จากลิงก์บิลของคุณ' },
];

export default function PartnerGuidePage() {
  useEffect(() => {
    trackPageView('/partners/guide');
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Head>
        <title>คู่มือคู่ค้า — Sovereign Origin</title>
        <meta name="description" content="คู่มือพันธมิตร: สิทธิประโยชน์การเป็นคู่ค้า วิธีติดตั้ง QR ป้ายหน้าร้าน และขั้นตอนขอเชื่อมระบบ IoT" />
        <meta name="robots" content="index,follow" />
        <link rel="canonical" href="https://sovereignoriginshop.dpdns.org/partners/guide/" />
        <meta property="og:site_name" content="Sovereign Origin" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="คู่มือคู้ค้า — Sovereign Origin" />
        <meta property="og:description" content="คู่มือพันธมิตร: สิทธิประโยชน์การเป็นคู้ค้า วิธีติดตั้ง QR ป้ายหน้าร้าน และขั้นตอนขอเชื่อมระบบ IoT" />
        <meta property="og:url" content="https://sovereignoriginshop.dpdns.org/partners/guide/" />
      </Head>

      <main className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        <header className="text-center space-y-2">
          <div className="text-4xl" aria-hidden>📖</div>
          <h1 className="text-2xl font-bold">คู่มือคู่ค้าเครือข่าย</h1>
          <p className="text-sm text-gray-400">สิ่งที่ได้ · วิธีใช้ · ทางขอความช่วยเหลือ — สรุปสั้น ๆ ในหน้าเดียว</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">🎁 สิทธิประโยชน์ของคู่ค้า</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {BENEFITS.map((b) => (
              <div key={b.title} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="text-xl mb-1" aria-hidden>{b.icon}</div>
                <h3 className="text-sm font-semibold mb-1">{b.title}</h3>
                <p className="text-xs text-gray-400 leading-relaxed">{b.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">🏷️ วิธีติดตั้ง QR ป้ายหน้าร้าน</h2>
          <ol className="space-y-2">
            {QR_STEPS.map((s, i) => (
              <li key={i} className="flex gap-3 items-start rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <span className="mono text-xs text-emerald-400 mt-0.5">{i + 1}</span>
                <p className="text-sm text-gray-300 leading-relaxed">{s}</p>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-gray-500">
            QR ของคู่ค้าทำได้เฉพาะร้านที่อนุมัติแล้ว — ป้ายแสดงเฉพาะข้อมูลที่ร้านยินยอมเผยแพร่แล้ว (ชื่อ/หมวด/ที่อยู่)
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">🛠️ ขั้นตอนขอเชื่อมระบบ IoT</h2>
          <div className="space-y-2">
            {IOT_STEPS.map((s) => (
              <div key={s.title} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <h3 className="text-sm font-medium text-emerald-300 mb-1">{s.title}</h3>
                <p className="text-xs text-gray-400 leading-relaxed">{s.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center space-y-3">
          <h2 className="text-base font-semibold">พร้อมเริ่มแล้ว?</h2>
          <p className="text-sm text-gray-400">ยังไม่เป็นคู่ค้า — สมัครฟรี ปักหมุดร้านบนแผนที่ได้เลย</p>
          <div className="flex flex-wrap justify-center gap-3 pt-1">
            <a href="/partners/" className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold px-5 py-2.5 text-sm transition">🗺️ ไปหน้าสมัคร/แผนที่</a>
            <a href="/shop/" className="rounded-xl border border-white/15 hover:border-emerald-500/50 px-5 py-2.5 text-sm transition">ดูชิ้นงานที่เปิดให้สนับสนุน</a>
          </div>
        </section>

        <footer className="text-center text-[10px] text-gray-600 pt-2">
          เครือข่ายคู่ค้า Sovereign Origin · <a href="/about/" className="hover:text-gray-400 underline underline-offset-2">เกี่ยวกับเรา</a> · <a href="/demo/" className="hover:text-gray-400 underline underline-offset-2">ลองเล่นระบบ</a>
        </footer>
      </main>
      <FeedbackButton page="/partners/guide" />
    </div>
  );
}
