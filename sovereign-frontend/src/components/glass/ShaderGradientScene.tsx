"use client";

/**
 * ShaderGradientScene — ฉากไล่สีแบบ shader (WebGL) ของ Sovereign OS
 *
 * ใช้ @shadergradient/react (MIT) ซึ่งเรนเดอร์ผ่าน @react-three/fiber + three ที่โปรเจกต์ติดตั้งอยู่แล้ว
 * (ตัวไลบรารี import three/fiber จากภายนอก ไม่ได้พกสำเนา three มาด้วย)
 *
 * ⚠️ ไฟล์นี้ห้ามถูก import แบบ static จากหน้าไหน — ต้องผ่าน next/dynamic + ssr:false เท่านั้น
 *    (WebGL ต้องมี window; ถ้า SSR จะทำให้ build/หน้าเว็บพัง)
 *    ตัวห่อที่อนุญาตให้ใช้คือ ShaderGradientBackdrop.tsx
 *
 * เลือก lightType="3d" โดยตั้งใจ — โหมด "env" จะไปโหลดไฟล์ .hdr จากภายนอก
 * ซึ่งโดน CSP ของแอปบล็อก (connect-src ไม่ได้เปิดให้ host ภายนอก)
 */
import { ShaderGradient, ShaderGradientCanvas, presets } from "@shadergradient/react";
import { GLASS_PALETTES, type GlassGradientPalette } from "./glassPalettes";

export type ShaderGradientSceneProps = {
  palette?: GlassGradientPalette;
  /** false = หยุดเคลื่อนไหว (ผู้ใช้ขอ reduced motion) แต่ยังแสดงภาพนิ่งสวย ๆ */
  animate?: boolean;
};

export default function ShaderGradientScene({
  palette = "aurora",
  animate = true,
}: ShaderGradientSceneProps) {
  const colors = GLASS_PALETTES[palette] ?? GLASS_PALETTES.aurora;

  return (
    <ShaderGradientCanvas
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      className="sov-gradient-canvas"
      // pixelDensity 1 พอ: เป็นภาพเบลอฉากหลัง ไม่ต้องคมระดับ retina (ประหยัด GPU ~4 เท่า)
      pixelDensity={1}
      pointerEvents="none"
      lazyLoad
      threshold={0.05}
    >
      <ShaderGradient
        // ค่าตั้งต้นจาก preset "halo" ของไลบรารี = ชุด prop ที่ครบและผ่านการทดสอบมาแล้ว
        {...presets.halo.props}
        {...colors}
        animate={animate ? "on" : "off"}
        uSpeed={animate ? 0.28 : 0}
        uStrength={2.2}
        uDensity={1.15}
        uAmplitude={1.2}
        uFrequency={5.5}
        brightness={1}
        reflection={0.12}
        // ปิด grain: ที่ pixelDensity 1 เม็ด noise จะหยาบและไปรบกวนตัวอักษรบนการ์ด
        grain="off"
        lightType="3d"
      />
    </ShaderGradientCanvas>
  );
}
