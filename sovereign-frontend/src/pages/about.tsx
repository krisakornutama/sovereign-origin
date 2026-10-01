import { useState, useEffect } from 'react';
import Head from 'next/head';
import { getApiUrl } from '../lib/config';
import { FeedbackButton } from '../components/public/FeedbackButton';
import { trackPageView } from '../lib/visitorTrack';

// P16 — /about: องค์กรไม่แสวงหากำไร — วิสัยทัศน์ · การใช้เงินสนับสนุน · ความโปร่งใส
//  ตัวเลขทั้งหมดดึงจาก GET /api/shop/transparency (ของจริงจาก DB ไม่มี PII)

interface Transparency {
  supportersCount: number;
  openWorkCount: number;
  partnersCount: number;
  productionLotsCount: number;
  weeklyVisitors: number;
  updatedAt: string;
}

const BUDGET = [
  { icon: '🔧', label: 'วัสดุอุปกรณ์ชุดถัดไป', pct: '≈ 60%', detail: 'ESP32/SIM โมดูล · แผงวงจร · กล่อง — ผลิตชุดใหม่ให้ผู้สนับสนุนรอบถัดไป' },
  { icon: '💻', label: 'พัฒนาฟีเจอร์ที่ผู้ใช้ขอจริง', pct: '≈ 25%', detail: 'ฟีเจอร์จากความต้องการที่เก็บจากปุ่มความคิดเห็น/แบบสอบถาม — ไม่ใช่สิ่งที่เราคิดเอง' },
  { icon: '🖥️', label: 'เซิร์ฟเวอร์ & การสำรองข้อมูล', pct: '≈ 15%', detail: 'คงระบบตามรอย แผนที่คู่ค้า และหน้าร้านให้เดิน 24/7 พร้อม backup นอกเครื่อง' },
];

export default function AboutPage() {
  const [stats, setStats] = useState<Transparency | null>(null);

  useEffect(() => {
    trackPageView('/about');
    fetch(`${getApiUrl()}/api/shop/transparency`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  const num = (n?: number) => (typeof n === 'number' ? n.toLocaleString('th-TH') : '—');

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Head>
        <title>เกี่ยวกับเรา — Sovereign Origin</title>
        <meta name="description" content="องค์กรไม่แสวงหากำไร — เทคโนโลยีเพื่อผู้ผลิตรายย่อย: วิสัยทัศน์ การใช้เงินสนับสนุน และความโปร่งใส" />
        <meta name="author" content="กฤษกรณ์ อุตมะ" />
        <meta property="og:title" content="Sovereign Origin — องค์กรไม่แสวงหากำไร" />
        <meta property="og:description" content="เทคโนโลยีเพื่อผู้ผลิตรายย่อย — ก่อตั้งและดูแลโดย กฤษกรณ์ อุตมะ" />
        <meta property="og:type" content="website" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'Sovereign Origin',
          alternateName: 'Sovereign Origin Foundation',
          url: 'https://sovereignoriginshop.dpdns.org',
          founder: {
            '@type': 'Person',
            name: 'กฤษกรณ์ อุตมะ',
            alternateName: 'Krisakorn Uttama',
            jobTitle: 'ผู้ก่อตั้งและผู้ดูแลโครงการ',
            sameAs: ['https://github.com/krisakornutama'],
          },
        }) }} />
      </Head>

      <main className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        <header className="text-center space-y-3">
          <div className="text-4xl" aria-hidden>🌾</div>
          <h1 className="text-2xl font-bold">Sovereign Origin</h1>
          <p className="text-sm text-emerald-400 font-medium">องค์กรไม่แสวงหากำไร (Non-profit)</p>
          <p className="text-sm text-gray-400 leading-relaxed max-w-xl mx-auto">
            เราสร้างเทคโนโลยีเพื่อให้ผู้ผลิตรายย่อย — ฟาร์ม ร้านค้า SME ช่างอิสระ —
            มีเครื่องมือดิจิทัลที่เข้าถึงได้ ตามรอยได้จริง และเป็นเจ้าของข้อมูลของตัวเอง
          </p>
        </header>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-3">
          <h2 className="text-lg font-semibold">🎯 เราเชื่อว่าอะไร</h2>
          <ul className="text-sm text-gray-300 space-y-2 leading-relaxed list-disc pl-5">
            <li><b className="text-gray-100">ทุกชิ้นงานต้องตามรอยได้</b> — อุปกรณ์ทุกชุดมีบัตรหลักฐานการผลิต ซอฟต์แวร์ทุกเวอร์ชันมีล็อต release ที่ตรวจสอบย้อนหลังได้</li>
            <li><b className="text-gray-100">ผู้ใช้เป็นคนกำหนดทิศทาง</b> — ฟีเจอร์ถัดไปมาจากความต้องการจริงที่เก็บจากผู้ใช้ ไม่ใช่การเดา</li>
            <li><b className="text-gray-100">เงินสนับสนุนต้องโปร่งใส</b> — ทุกบาทกลับไปลงทุนในภารกิจ ไม่ใช่กำไรใครคนเดียว และเรารายงานสถิติเปิดให้ดูตลอด</li>
            <li><b className="text-gray-100">เครือข่ายคือแรง</b> — ร้านค้า ช่าง และผู้ให้บริการเติบโตไปด้วยกันบนแผนที่เดียวกัน</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-3">
          <h2 className="text-lg font-semibold">👤 ผู้ก่อตั้งและผู้ดูแลโครงการ</h2>
          <div className="flex items-start gap-3">
            <div className="text-3xl" aria-hidden>👨‍💻</div>
            <div className="space-y-1">
              <div className="text-base font-semibold text-gray-100">กฤษกรณ์ อุตมะ <span className="text-xs text-gray-500 font-normal">(Krisakorn Uttama)</span></div>
              <p className="text-sm text-gray-400 leading-relaxed">
                ผู้ก่อตั้งและผู้ดูแลโครงการ Sovereign Origin — ออกแบบ พัฒนา และดูแลระบบทั้งหมด:
                ซอฟต์แวร์ อุปกรณ์ IoT หน้าร้าน และระบบตามรอยทุกชิ้นงาน
              </p>
              <a href="https://github.com/krisakornutama" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"/></svg>
                github.com/krisakornutama
              </a>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <h2 className="text-lg font-semibold">💰 เงินสนับสนุนถูกใช้อย่างไร</h2>
          <div className="space-y-3">
            {BUDGET.map((b) => (
              <div key={b.label} className="flex gap-3 items-start">
                <div className="text-xl mt-0.5" aria-hidden>{b.icon}</div>
                <div className="flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-gray-200">{b.label}</span>
                    <span className="mono text-sm text-emerald-400 whitespace-nowrap">{b.pct}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{b.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-500 border-t border-white/10 pt-3">
            สัดส่วนโดยประมาณจากแผนปฏิบัติการปีนี้ — รายจ่ายจริงจะสรุปรวมใน digest รายสัปดาห์ของโครงการ
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">📊 ความโปร่งใสแบบเรียลไทม์</h2>
            {stats?.updatedAt && (
              <span className="text-[10px] text-gray-600 mono">
                อัปเดต {new Date(stats.updatedAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: 'ผู้สนับสนุน/ออเดอร์สด', value: num(stats?.supportersCount), icon: '🤝' },
              { label: 'ชิ้นงานที่เปิดรับ', value: num(stats?.openWorkCount), icon: '📦' },
              { label: 'คู่ค้าในแผนที่', value: num(stats?.partnersCount), icon: '🗺️' },
              { label: 'ล็อตการผลิตที่บันทึก', value: num(stats?.productionLotsCount), icon: '🏭' },
              { label: 'ผู้มาเยือน 7 วัน', value: num(stats?.weeklyVisitors), icon: '👥' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-white/10 bg-black/20 p-3 text-center">
                <div className="text-xl mb-1" aria-hidden>{s.icon}</div>
                <div className="mono text-lg text-emerald-300 font-semibold">{s.value}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-500">
            ตัวเลขเหล่านี้ดึงจากระบบจริงของโครงการ ณ ขณะนั้น — ไม่มีการปรับแต่ง
          </p>
        </section>

        <section className="text-center space-y-2">
          <h2 className="text-base font-semibold">สนับสนุนภารกิจของเรา</h2>
          <p className="text-sm text-gray-400">เลือกได้ทั้งรับชิ้นงานกลับไป หรือสนับสนุนตามศรัทธาโดยไม่รับชิ้นงาน</p>
          <div className="flex flex-wrap justify-center gap-3 pt-1">
            <a href="/shop" className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold px-5 py-2.5 text-sm transition">🤝 เข้าหน้าสนับสนุน</a>
            <a href="/partners" className="rounded-xl border border-white/15 hover:border-emerald-500/50 px-5 py-2.5 text-sm transition">🗺️ ดู/สมัครแผนที่คู่ค้า</a>
            <a href="/demo" className="rounded-xl border border-white/15 hover:border-emerald-500/50 px-5 py-2.5 text-sm transition">🧪 ลองเล่นระบบ</a>
          </div>
        </section>

        <footer className="text-center text-[10px] text-gray-600 pt-4 space-y-1">
          <div>Sovereign Origin · ดูแลโดย <b className="text-gray-500">กฤษกรณ์ อุตมะ</b></div>
          <div>
            <a href="/shop" className="hover:text-gray-400 underline underline-offset-2">สนับสนุนโครงการ</a> · <a href="/partners" className="hover:text-gray-400 underline underline-offset-2">แผนที่คู่ค้า</a> · <a href="/demo" className="hover:text-gray-400 underline underline-offset-2">เดโม่</a> · <a href="/trace" className="hover:text-gray-400 underline underline-offset-2">ตามรอย</a> · <a href="/about" className="hover:text-gray-400 underline underline-offset-2">เกี่ยวกับเรา</a>
          </div>
        </footer>
      </main>
      <FeedbackButton page="/about" />
    </div>
  );
}
