"use client";

/**
 * GlassSurface — กระจกเหลว (Liquid Glass) ของ Sovereign OS
 *
 * ใช้ไลบรารี @vepando/liquid-glass-react (MIT, React 18+, ไม่ใช้ WebGL):
 *   • เนื้อกระจก = backdrop-filter + SVG feDisplacementMap ที่คำนวณจากฟิสิกส์ Snell
 *   • ขอบแก้วมีไฮไลต์ (specular rim) ตามมุมแสง
 *   • ใช้วาด "พื้นผิว" ได้หลายชั้นพร้อมกัน ไม่กิน WebGL context เหมือนกระจกที่เรนเดอร์ด้วย canvas
 *
 * หมายเหตุสำคัญ: ต้องมี `import "@vepando/liquid-glass-react/style.css"` ครั้งเดียวใน _app.tsx
 * (global CSS ของ Pages Router import ได้เฉพาะ _app) — ถ้าไม่มี จะเหลือแค่กล่องโปร่งใสไม่มีสไตล์
 */
import type { CSSProperties, ReactNode } from "react";
import { LiquidGlass } from "@vepando/liquid-glass-react";

/**
 * โทนของกระจก — ปรับ tint ให้น้ำหนักต่างกันตามตำแหน่งการใช้งาน
 *   panel    = การ์ดเนื้อหา (โปร่งกว่า เห็นพื้นหลัง)
 *   contrast = แผงควบคุมสำคัญ (ทึบกว่า อ่านตัวอักษรง่าย)
 *   light    = ธีมสว่าง (ใช้กับหน้าสาธารณะ/ป้ายเล็ก)
 */
export type GlassTone = "panel" | "contrast" | "light";

const TINT: Record<GlassTone, string> = {
  panel: "rgba(15, 23, 42, 0.55)",
  contrast: "rgba(8, 10, 14, 0.74)",
  light: "rgba(255, 255, 255, 0.55)",
};

export type GlassSurfaceProps = {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** รัศมีมุม (px) — ใส่ 999 สำหรับทรงแคปซูล/วงกลม */
  radius?: number;
  tone?: GlassTone;
  /** ความเบลอของฉากหลัง (px) — 0 = กระจกใสดุจน้ำ */
  blur?: number;
  /** ความกว้างขอบโค้งที่หักเหแสง (px) — ไม่ใส่ = ให้ไลบรารีคำนวณจากขนาด */
  bezel?: number;
  /** ความหนาแก้ว (px) — ยิ่งหนายิ่งหักเหแรง */
  thickness?: number;
  /** การกระจายแสงสี (สีรุ้งที่ขอบ) 0 = ปิด */
  dispersion?: number;
  /** ความสว่างของไฮไลต์ขอบ 0..1 */
  specular?: number;
  /** กดแล้วยุบ/ขยายเหมือนคอนโทรล iOS */
  interactive?: boolean;
  /** เปิดชั้นหักเหแสง — ปิดได้เมื่อซ้อนการ์ดหลายชั้นจนภาพกวน */
  refraction?: boolean;
  onClick?: () => void;
};

export default function GlassSurface({
  children,
  className = "",
  style,
  radius = 20,
  tone = "panel",
  blur = 14,
  bezel,
  thickness,
  dispersion = 0.08,
  specular = 0.9,
  interactive = false,
  refraction = true,
  onClick,
}: GlassSurfaceProps) {
  return (
    <LiquidGlass
      radius={radius}
      tint={TINT[tone]}
      blur={blur}
      bezel={bezel}
      thickness={thickness}
      dispersion={dispersion}
      specular={specular}
      interactive={interactive}
      refraction={refraction ? 1 : 0}
      className={className}
      style={style}
      onClick={onClick}
    >
      {children}
    </LiquidGlass>
  );
}
