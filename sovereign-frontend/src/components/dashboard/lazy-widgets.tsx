"use client";

/**
 * Lazy dashboard widgets — แยก JS ก้อนหนักออกจาก first paint ของแดชบอร์ด
 *
 * เหตุผล: เจ้าของสั่ง 21/10/69 "ทำให้ใช้งานได้เร็วเข้า"
 *   • AiChatPanel (~300 บรรทัด + VoiceInput + useTTS) อยู่ในวิดเจ็ต "เด็ก" ซึ่งอยู่ใต้จอ
 *     ไม่ต้องมากับ JS ก้อนแรก — โหลดเมื่อเลื่อนไปถึง/หลัง hydration
 *   • VoiceCommand เป็นปุ่มลอย ใช้เมื่อผู้ใช้กด — โหลดตามหลังได้เช่นกัน
 *
 * ทำไมต้องมีไฟล์นี้: frontend-gate จำกัด line-budget ของ pages ≤ 800
 * การยัด dynamic(...) หลายก้อนใน dashboard.tsx ทำให้ไฟล์ยาวขึ้นโดยไม่จำเป็น
 * (dashboard มี baseline อยู่แล้ว — ยิ่งยาวยิ่งต้องอัปเดต baseline บ่อย)
 */
import dynamic from 'next/dynamic';

export const AiChatPanel = dynamic(() => import('./AiChatPanel'), {
  ssr: false,
  loading: () => (
    <div className="h-[380px] animate-pulse rounded-lg border border-gray-800 bg-gray-900/40" />
  ),
});

export const VoiceCommand = dynamic(() => import('./VoiceCommand'), { ssr: false });
