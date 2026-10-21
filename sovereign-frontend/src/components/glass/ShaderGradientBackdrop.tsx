"use client";

/**
 * ShaderGradientBackdrop — พื้นหลังไล่สีเคลื่อนไหวสำหรับการ์ด/ฮีโร่
 *
 * ทำหน้าที่เป็น "ประตูเดียว" ที่อนุญาตให้หน้าเว็บเข้าถึงฉาก WebGL:
 *   • ห่อ ShaderGradientScene ด้วย next/dynamic + ssr:false (ไม่มี WebGL ตอน SSR)
 *   • หยุดเคลื่อนไหวอัตโนมัติเมื่อผู้ใช้เปิด prefers-reduced-motion
 *   • ไม่รับ pointer event ทั้งชั้น (กดทะลุได้) + ซ่อนจาก screen reader
 *   • ใส่ชั้นไล่สี (scrim) ทับเพื่อให้ตัวอักษรบนการ์ดอ่านง่ายเสมอ
 */
import dynamic from "next/dynamic";
import { useReducedMotion } from "./useReducedMotion";
import type { GlassGradientPalette } from "./glassPalettes";

const ShaderGradientScene = dynamic(() => import("./ShaderGradientScene"), {
  ssr: false,
  // ระหว่างโหลด chunk (ครั้งแรกของหน้า) ปล่อยให้เห็นพื้นหลังเดิมไปก่อน — ไม่มีจอกระพริบ
  loading: () => null,
});

export type ShaderGradientBackdropProps = {
  palette?: GlassGradientPalette;
  className?: string;
  /** ความทึบของฉาก (0..1) — ลดลงเมื่อต้องการให้เนื้อหาเด่น */
  opacity?: number;
  /** ชั้นไล่สีทับเพื่อเพิ่มคอนทราสต์ของตัวอักษร */
  scrim?: boolean;
};

export default function ShaderGradientBackdrop({
  palette = "aurora",
  className = "",
  opacity = 0.85,
  scrim = true,
}: ShaderGradientBackdropProps) {
  const reduced = useReducedMotion();

  return (
    <div
      aria-hidden="true"
      data-reduced-motion={reduced ? "1" : "0"}
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      style={{ opacity }}
    >
      <ShaderGradientScene palette={palette} animate={!reduced} />
      {scrim && (
        <div className="absolute inset-0 bg-gradient-to-b from-gray-950/5 via-gray-950/35 to-gray-950" />
      )}
    </div>
  );
}
