"use client";

/**
 * GlassOrb — ประตูเดียวของฉาก 3D (React Three Fiber)
 *
 * หน้าเว็บใช้คอมโพเนนต์นี้เท่านั้น — ข้างในค่อยโหลด GlassOrbScene แบบ dynamic + ssr:false
 * พร้อมภาพแทน (placeholder) ที่เป็น gradient เบลอ เพื่อไม่ให้การ์ดกระพริบระหว่างรอ chunk
 *
 * สองชั้นประหยัดพลังงาน:
 *   1) หยุดหมุนเมื่อผู้ใช้เปิด prefers-reduced-motion
 *   2) หยุดเรนเดอร์เมื่อเลื่อนออกนอกจอ (IntersectionObserver) — เปลี่ยน frameloop เป็น demand
 *      ไม่งั้น canvas จะวาด 60 เฟรม/วิ ต่อไปแม้ผู้ใช้เลื่อนไปอ่านส่วนอื่นแล้ว
 */
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useReducedMotion } from "./useReducedMotion";
import type { GlassGradientPalette } from "./glassPalettes";

function OrbPlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="h-28 w-28 rounded-full bg-gradient-to-br from-cyan-400/40 via-sky-500/30 to-emerald-400/20 blur-xl" />
    </div>
  );
}

const GlassOrbScene = dynamic(() => import("./GlassOrbScene"), {
  ssr: false,
  loading: () => <OrbPlaceholder />,
});

export type GlassOrbProps = {
  palette?: GlassGradientPalette;
  className?: string;
  /** ความสูงของกล่อง (px) — ต้องมีความสูงจริงไม่ใช่ auto ไม่งั้น canvas จะสูง 0 */
  height?: number;
};

export default function GlassOrb({ palette = "aurora", className = "", height = 320 }: GlassOrbProps) {
  const reduced = useReducedMotion();
  const boxRef = useRef<HTMLDivElement | null>(null);
  // เริ่มที่ true เพื่อให้เฟรมแรกมีภาพ (observer จะปรับตามจริงทันทีหลัง mount)
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setOnScreen(entry.isIntersecting);
      },
      // เผื่อขอบ 200px: เริ่มวาดก่อนเลื่อนมาถึง จะได้ไม่เห็นภาพนิ่งแวบแรก
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={boxRef} className={`relative w-full ${className}`} style={{ height }}>
      <GlassOrbScene palette={palette} animate={!reduced && onScreen} />
    </div>
  );
}
