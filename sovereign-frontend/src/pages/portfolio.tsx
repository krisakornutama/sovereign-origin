"use client";
// พอร์ตย้ายไปอยู่ที่ /treasury (Treasury & Wealth Engine — unified view)
// หน้านี้เหลือไว้ให้ deep link + สิทธิ์ /portfolio เก่า ยังพาไปที่ใหม่
//
// ── สถานะ SEO (ตัดสินใจ 4/10/69): ไม่ประกาศ — noindex ถาวร ──
// เหตุผล: หน้านี้ไม่มีเนื้อหาของตัวเองเลย มีแค่ `router.replace('/treasury')`
// และ /treasury เป็นหน้าในระบบที่ล็อกอิน + ต้องเป็น SUPERADMIN (ตรวจใน treasury.tsx แล้ว)
// ประกาศหน้า redirect ที่พาไปหน้า login-gated = ส่ง Google ไปหน้าที่มันเข้าไม่ได้
// อีกอย่าง ในโค้ดทั้งระบบมีแต่การอ้างถึง /portfolio ในฐานะสิทธิ์/API path
// (useFeatureStore · /api/portfolio/summary) ไม่มีลิงก์จากหน้าสาธารณะใด ๆ
// → กติกาเดียว: ไม่มีเนื้อหาให้อ่าน = ไม่ต้องประกาศ (แทนการปล่อยให้กลายเป็นหน้าว่างใน sitemap)
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import SeoHead from '../components/public/SeoHead';

export default function PortfolioRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/treasury');
  }, [router]);
  return (
    <>
      <SeoHead
        title="ย้ายไป /treasury — Sovereign Origin"
        description="หน้านี้เป็นทางเลือกของ deep link เก่า และพาไปที่ /treasury (หน้าในระบบที่ต้องล็อกอิน)"
        path="/portfolio"
        noindex
      />
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">→ /treasury</div>
    </>
  );
}