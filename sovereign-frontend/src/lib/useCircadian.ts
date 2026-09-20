"use client";

/**
 * Circadian — โทนบรรยากาศตามเวลาของวัน (เข้ากับปรัชญา "วิถีชีวิต" ของระบบ)
 * ─────────────────────────────────────────────────────────────────
 *  05:00–11:59 → atmo-dawn   แดดเช้าอำพันอ่อน (เริ่มต้นวัน)
 *  12:00–16:59 → atmo-day    ฟ้าใสแจ่ม (ช่วงทำงานเต็มสมรรถนะ)
 *  17:00–19:59 → atmo-dusk   ส้มอุ่น+ม่วงพลบค่ำ (ช่วงเปลี่ยนผ่าน)
 *  20:00–04:59 → ''          กลางคืน = โทนคอนโซลฐาน (พักสายตา ไฟนีออนต่ำ)
 *
 * SSR-safe: เรียกบน server ได้โดยไม่พัง (จะได้ค่ากลาง) — ฝั่ง client
 * hook จะ re-check ทุก 60 วิ เพื่อให้ค้างคืนหน้าจอเปลี่ยนโทนตามเวลาจริง
 */
export type CircadianPhase = 'dawn' | 'day' | 'dusk' | 'night';

export function circadianPhase(d: Date = new Date()): CircadianPhase {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'dawn';
  if (h >= 12 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'night';
}

/** คลาส atmo-* ของช่วงเวลาปัจจุบัน (กลางคืน = '' คือโทนฐาน) — ใช้แบบไม่มี state */
export function circadianClass(d: Date = new Date()): string {
  const phase = circadianPhase(d);
  return phase === 'night' ? '' : `atmo-${phase}`;
}

import { useEffect, useState, type CSSProperties } from 'react';

/** hook สำหรับหน้าที่อยากให้โทนเปลี่ยนตามเวลาจริง (re-check ทุก 60 วิ) */
export function useCircadianAtmo(): string {
  const [cls, setCls] = useState<string>(() => (typeof window === 'undefined' ? '' : circadianClass()));
  useEffect(() => {
    const tick = () => setCls(circadianClass());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  return cls;
}

/**
 * สีเน้นของเมนู (ตัวแปร --atmo-nav / --atmo-nav-text) ต่อคลาสธีม
 * ใช้กับ component ที่ render อยู่นอก root div ของหน้า (MobileNav, CommandPalette)
 * เพราะคลาส atmo-* ของหน้าครอบไม่ถึง — ใส่เป็น inline style แทน
 * ต้องตรงกับนิยาม --atmo-nav ใน globals.css
 */
const ATMO_NAV_COLORS: Record<string, [string, string]> = {
  'atmo-power': ['#fbbf24', '#fde68a'],
  'atmo-wellness': ['#2dd4bf', '#5eead4'],
  'atmo-lotus': ['#caa856', '#e7d094'],
  'atmo-nature': ['#84cc16', '#bef264'],
  'atmo-guard': ['#fb7185', '#fda4af'],
  'atmo-wealth': ['#eab308', '#fde047'],
  'atmo-kitchen': ['#fb923c', '#fdba74'],
  'atmo-system': ['#22d3ee', '#67e8f9'],
  'atmo-dawn': ['#fbbf24', '#fde68a'],
  'atmo-day': ['#38bdf8', '#7dd3fc'],
  'atmo-dusk': ['#818cf8', '#a5b4fc'],
};

/** คืน inline style ตั้งตัวแปรสีเมนูตามคลาสธีม ('' = เขียวฐาน) */
export function atmoNavStyle(atmo: string): CSSProperties {
  const [nav, navText] = ATMO_NAV_COLORS[atmo] ?? ['#34d399', '#6ee7b7'];
  return { ['--atmo-nav']: nav, ['--atmo-nav-text']: navText } as CSSProperties;
}
