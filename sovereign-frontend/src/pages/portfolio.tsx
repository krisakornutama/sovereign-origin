"use client";
// พอร์ตย้ายไปอยู่ที่ /treasury (Treasury & Wealth Engine — unified view)
// หน้านี้เหลือไว้ให้ deep link + สิทธิ์ /portfolio เก่า ยังพาไปที่ใหม่
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function PortfolioRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/treasury');
  }, [router]);
  return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">→ /treasury</div>;
}