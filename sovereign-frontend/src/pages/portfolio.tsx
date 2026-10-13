"use client";
// พอร์ตย้ายไปอยู่ที่ /treasury (Treasury & Wealth Engine — unified view)
// หน้านี้เหลือไว้ให้ deep link + สิทธิ์ /portfolio เก่า ยังพาไปที่ใหม่
//
// 13/10/69: ถอด SeoHead (metadata ของเว็บ) ออก — โปรเจกต์นี้เป็นแอป desktop เท่านั้น
//   หน้านี้เป็นทางเลือกของ deep link เก่า (ไม่ใช่หน้าเนื้อหา) → ไม่ต้องมี title/canonical
//   ของเดิมอยู่ที่ E:\My work\Sovereign-Web-Standalone
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function PortfolioRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/treasury');
  }, [router]);
  return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">→ /treasury</div>;
}