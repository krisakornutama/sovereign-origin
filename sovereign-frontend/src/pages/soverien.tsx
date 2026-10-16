"use client";
// pages/soverien.tsx
// หน้าเครื่องมือ Soverien โดยตรง — เปิดได้แม้ยังไม่ล็อกอิน / ยังไม่ได้สร้างธุรกิจ (16/10/69)
//
// เหตุผลที่ต้องมีหน้านี้: เครื่องมือทั้งชุดเก็บข้อมูลใน localStorage ของเครื่องนี้เอง
//   ไม่ต้องพึ่งเซิร์ฟเวอร์ ไม่ต้องพึ่งธุรกิจ แต่เดิมมันซ่อนอยู่ใต้ /business
//   → พอ token หมดอายุ (ระบบลบให้เองตามปกติ) เจ้าของจะเข้าเครื่องมือของตัวเองไม่ได้เลย
//   → อาการที่เจอจริง 16/10/69: หน้าขึ้น "ยังไม่มีธุรกิจ" แล้วเครื่องมือหายไปทั้งชุด
//
// ⚠ ไม่แตะ src/lib/navigation.ts (ไฟล์ protected ตามกฎโปรเจกต์)
//   → หน้านี้เข้าผ่านปุ่มใน /business และผ่านลิงก์ตรง /soverien
import Head from 'next/head';
import SoverienHub from '../components/business/soverien/SoverienHub';
import Sidebar from '../components/layout/Sidebar';
import Icon from '../components/ui/Icon';
import Link from 'next/link';

export default function SoverienPage() {
  return (
    <>
      <Head>
        <title>เครื่องมือ Soverien · Sovereign OS</title>
      </Head>
      <div className="min-h-screen bg-gray-950 text-gray-100 flex">
        {/* มี Sidebar ตามกฎ sidebar-rule — ทุกหน้าต้องเดินหน้าต่อได้ */}
        <Sidebar />
        <div className="lg:pl-64 flex-1 min-w-0">
          <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
            <header className="flex items-center gap-3 flex-wrap">
              <Icon name="package" size={26} />
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold">เครื่องมือ Soverien</h1>
                <p className="text-xs text-gray-400">
                  ข้อมูลทั้งหมดเก็บในเครื่องนี้ · ไม่ต้องล็อกอิน · ไม่ต้องมีธุรกิจ
                </p>
              </div>
              <Link href="/business" className="text-xs text-cyan-400 hover:underline">
                ไปหน้าธุรกิจ →
              </Link>
            </header>
            <SoverienHub />
          </div>
        </div>
      </div>
    </>
  );
}
