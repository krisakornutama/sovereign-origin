// src/lib/useHideInternalNav.ts
// คำสั่งเจ้าของ 3/10/69: "ซ่อน Sidebar และเมนูภายในออกจากหน้าสาธารณะ เหลือเฉพาะผู้ที่ล็อกอินแล้ว"
//
// เหตุผลที่ต้องทำ: หน้าสาธารณะ (/trace /mbti /hover-cards …) เป็นหน้าที่ประกาศใน sitemap ให้ Google
// ก่อนหน้านี้ HTML ที่บอทดึงได้มีเมนูภายในทั้งหมด (Dashboard / Users / Settings / Backup …)
// = เปิดโครงสร้างภายในของระบบให้บอทและผู้เยี่ยมชมเห็นโดยไม่ตั้งใจ
// (WAF บล็อกหน้าในระบบไว้ 403 อยู่แล้ว จึงไม่รั่วข้อมูล — แต่ "ไม่รั่ว" ≠ "ไม่ควรเห็น")
//
// กติกาที่ใช้: ซ่อนเมนูภายใน เมื่อ (อยู่บนหน้าสาธารณะ) และ (ยังไม่ล็อกอิน)
//  - เจ้าของ/ผู้ดูแลที่ล็อกอินแล้วเห็นเมนูครบทุกหน้าเหมือนเดิม (ไม่ไปแตะงานภายในของเขา)
//  - ผู้เยี่ยมชม/บอทไม่เห็นโครงสร้างภายในเลย
//  - หน้าในระบบ (path อื่นที่ไม่ใช่หน้าสาธารณะ) ไม่ถูกแตะเลย → ไม่มี flash ตอนเจ้าของเปิดใช้งาน
//
// ทำเป็น hook เดียวใช้ร่วมกัน (Sidebar · MobileNav · CommandPalette) เพราะกติกาเดียวกันต้องตรงกันเสมอ
// ถ้าแยกเขียนทีละไฟล์จะหลุดได้อีก (เคยหลุดแบบนี้มาแล้ว: ประกาศใน sitemap แต่ไม่ได้ซ่อน)
'use client';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '../stores/useAuthStore';
import { isPublicPath } from './publicAccess';

/** true = ต้องซ่อน Sidebar / แถบเมนูมือถือ / Command Palette ทิ้ง */
export function useHideInternalNav(): boolean {
  const pathname = usePathname() || '/';
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isPublicPath(pathname) && !isAuthenticated;
}