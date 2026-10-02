"use client";
import { useAuthStore } from '../stores/useAuthStore';
import LoginForm from '../components/auth/LoginForm';
import { FounderCredit } from '../components/public/FounderCredit';
import SeoHead from '../components/public/SeoHead';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLanguageStore } from '../stores/useLanguageStore';
import { isPublicHostname, isLocalHostname } from '../lib/publicAccess';
import { getHomeVariant, trackCtaClick } from '../lib/visitorTrack';

export default function Home() {
  const { isAuthenticated, isHydrated, mustChangePassword } = useAuthStore();
  const router = useRouter();
  const t = useLanguageStore((s) => s.t);
  // A/B ลำดับการ์ด (P13): A = เดโม่ก่อน · B = ร้านก่อน — สุ่มครั้งเดียวจำค่าไว้ (วัด cta_click คู่กันในหน้า admin)
  const [variant, setVariant] = useState<'A' | 'B'>('A');
  useEffect(() => { setVariant(getHomeVariant()); }, []);
  // P24: สลับจาก "สาธารณะ" เป็น "เครื่องเรา" หลัง mount เท่านั้น (render ครั้งแรกบน client
  // ต้องตรงกับ SSR ไม่งั้น hydration mismatch) → เจ้าของที่เปิด localhost ยังได้ฟอร์มล็อกอิน
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const cta = (name: string) => () => trackCtaClick('/', name, variant);

  // P11 (30/9/69): บนโดเมนสาธารณะถ้า browser มี session เจ้าของอยู่แล้ว เด้งเข้า dashboard ตามเดิม
  useEffect(() => {
    if (isHydrated && isAuthenticated && isPublicHostname()) {
      router.push(mustChangePassword ? '/change-password' : '/dashboard');
    }
  }, [isHydrated, isAuthenticated, mustChangePassword, router]);

  // P22 (2/10/69): metadata ต้องอยู่ใน HTML ที่ server ส่งออกจริง — SSR คืน branch นี้เสมอ
  //   (isHydrated=false ตอนแรก) ถ้าไม่ใส่ตรงนี้ Google จะได้หน้าเปล่าไม่มี title/canonical
  const seo = {
    title: 'Sovereign Origin — ระบบฟาร์ม · ปศุสัตว์ · การเงิน ทดลองใช้ได้ทันที',
    description:
      'เปิดให้ทดลองใช้ฟรีด้วยข้อมูลตัวอย่าง — ฟาร์ม ปศุสัตว์ การเงิน ตามรอยสินค้า และหน้าร้าน ไม่ต้องสมัคร ไม่มีล็อกอินขวาง',
    path: '/',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Sovereign Origin',
      url: 'https://sovereignoriginshop.dpdns.org/',
      inLanguage: 'th',
    },
  };

  // P24 (3/10/69): โหมดสาธารณะต้องเรนเดอร์ได้ตอน SSR ไม่ใช่รอ hydrate
  // — เดิม `if (!isHydrated) → Loading` ทำให้ HTML ที่ Google ดึงได้แค่ "กำลังโหลด..."
  //   ไม่มี h1 ไม่มีเนื้อหา (เนื้อหาจริงโผล่หลัง JS รัน) · ตอนนี้ถ้า build เป็นโหมดสาธารณะ
  //   (NEXT_PUBLIC_PUBLIC_SITE=1) ให้เรนเดอร์ branch สาธารณะทันทีทั้ง server และ client
  //   → ไม่มี hydration mismatch · ส่วนเครื่องเจ้าของ (localhost/LAN) ยังเห็นฟอร์มล็อกอิน
  //   ตามเดิม เพราะสลับหลัง mount เท่านั้น
  const publicMode = isPublicHostname();
  const showPublic = publicMode && !(mounted && isLocalHostname());

  // รอจนกว่า store จะ hydrate ก่อนแสดงอะไร (ยกเว้นโหมดสาธารณะที่ไม่ต้องรู้สถานะล็อกอิน)
  if (!isHydrated && !showPublic) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <SeoHead {...seo} />
        <div className="text-emerald-400 text-sm tracking-wide glow-text">{t('common.loading', 'กำลังโหลด...')}</div>
      </div>
    );
  }

  // โหมดทดลอง (คำสั่งเจ้าของ 30/9/69: "เว็บนี้มันควรจะขึ้นเลย เปิดให้ใช้สำหรับทดลอง ไม่ใช่ให้เข้ารหัสใด ๆ")
  // ผู้มาเยือนโดเมนสาธารณะที่ยังไม่ล็อกอิน → หน้าทดลองทันที ไม่มีฟอร์มขวาง
  if (showPublic && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <SeoHead {...seo} />
        <main className="max-w-2xl mx-auto px-4 py-14 space-y-8">
          <header className="space-y-3 text-center pt-6">
            <div className="mono text-[10px] tracking-[0.3em] uppercase text-cyan-400/80">sovereign origin</div>
            <h1 className="font-ledger text-3xl md:text-4xl font-bold glow-text">ระบบฟาร์ม · ปศุสัตว์ · การเงิน<br />ลองใช้ได้ทันที ไม่ต้องสมัคร</h1>
            <p className="text-sm text-gray-400">
              เปิดให้ทดลองใช้งานฟรีด้วยข้อมูลตัวอย่าง — ไม่มีล็อกอินขวาง<br />
              ข้อมูลจริงอยู่หลังระบบภายในเท่านั้น
            </p>
          </header>

          <div className="grid gap-3">
            {(
              variant === 'B'
                ? [['shop', '🛒', 'ร้านอุปกรณ์ & ซอฟต์แวร์', 'ชุดอุปกรณ์ DMS · ซอฟต์แวร์แยกโมดูล — พร้อมบัตรตามรอยการผลิต', 'hover:border-emerald-500/60', 'text-emerald-300'],
                   ['demo', '🧪', 'เข้าสนามทดลอง', 'ฟาร์ม · ปศุสัตว์ · การเงิน · ตามรอย · ร้าน — ข้อมูลตัวอย่างล้วน', 'hover:border-cyan-500/60', 'text-cyan-300'],
                   ['trace', '🔎', 'ตามรอยผลผลิต', 'ใส่รหัสล็อตดูที่มาทั้งสาย — ต้นทางถึงมือคุณ', 'hover:border-amber-500/60', 'text-amber-300']]
                : [['demo', '🧪', 'เข้าสนามทดลอง', 'ฟาร์ม · ปศุสัตว์ · การเงิน · ตามรอย · ร้าน — ข้อมูลตัวอย่างล้วน', 'hover:border-cyan-500/60', 'text-cyan-300'],
                   ['shop', '🛒', 'ร้านอุปกรณ์ & ซอฟต์แวร์', 'ชุดอุปกรณ์ DMS · ซอฟต์แวร์แยกโมดูล — พร้อมบัตรตามรอยการผลิต', 'hover:border-emerald-500/60', 'text-emerald-300'],
                   ['trace', '🔎', 'ตามรอยผลผลิต', 'ใส่รหัสล็อตดูที่มาทั้งสาย — ต้นทางถึงมือคุณ', 'hover:border-amber-500/60', 'text-amber-300']]
            ).map(([href, icon, title, desc, borderCls, titleCls]) => (
              <a key={href} href={`/${href}`} onClick={cta(href)} className={`block card p-5 transition group ${borderCls}`}>
                <div className="flex items-baseline gap-3">
                  <span className="text-2xl">{icon}</span>
                  <div>
                    <div className={`font-ledger text-lg ${titleCls}`}>{title}</div>
                    <div className="text-xs text-gray-500">{desc}</div>
                  </div>
                </div>
              </a>
            ))}
          </div>

          <p className="text-center text-[11px] text-gray-600">
            เจอปัญหาหรืออยากเสนอฟีเจอร์ → ปุ่ม 💬 มุมขวาล่างของทุกหน้าทดลอง
          </p>

          <div className="pt-2 text-center">
            <a href="/login" className="text-[11px] text-gray-600 hover:text-gray-400 underline underline-offset-2">เข้าสู่ระบบ (ผู้ดูแลระบบ)</a>
          </div>

          <FounderCredit />
        </main>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm />;
  }

  return null;
}