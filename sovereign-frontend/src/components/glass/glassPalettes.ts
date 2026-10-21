/**
 * glassPalettes — ชุดสีของฉาก shader gradient (ข้อมูลล้วน ไม่ import ไลบรารี)
 *
 * แยกไฟล์ออกมาโดยตั้งใจ: หน้าเว็บ/คอมโพเนนต์ห่อที่ "ไม่ต้องโหลด WebGL" จะได้
 * ใช้ชื่อชุดสี/ป้ายกำกับได้โดยไม่ลาก three.js + shadergradient เข้า bundle ของหน้า
 * (ตัวฉากจริงอยู่ใน ShaderGradientScene.tsx ซึ่งโหลดผ่าน next/dynamic เท่านั้น)
 */

export type GlassGradientPalette = "aurora" | "ember" | "abyss";

export type GlassPaletteColors = {
  /** สีหลัก (เงาแก้ว/แสงหลัก) */
  color1: string;
  /** สีกลาง (เนื้อแก้ว) */
  color2: string;
  /** สีรอง (ขอบ/ไฮไลต์) */
  color3: string;
};

/** สีที่ปรับให้เข้ากับธีมมืดของ Sovereign OS (ค่าอ้างอิง CHROMATIC ของ globals.css) */
export const GLASS_PALETTES: Record<GlassGradientPalette, GlassPaletteColors> = {
  // เขียวมรกต–ฟ้า (ค่าตั้งต้น: เข้ากับ atmo-power / ระบบพลังงาน)
  aurora: { color1: "#22d3ee", color2: "#0ea5e9", color3: "#34d399" },
  // ส้ม–ทอง (เข้ากับ atmo-wealth / การเงิน)
  ember: { color1: "#fb923c", color2: "#f59e0b", color3: "#f43f5e" },
  // ม่วง–คราม (เข้ากับ atmo-mind / AI)
  abyss: { color1: "#818cf8", color2: "#6366f1", color3: "#22d3ee" },
};

export const GLASS_PALETTE_ORDER: GlassGradientPalette[] = ["aurora", "ember", "abyss"];

export const GLASS_PALETTE_LABEL: Record<GlassGradientPalette, { th: string; en: string }> = {
  aurora: { th: "แสงเหนือ", en: "Aurora" },
  ember: { th: "ถ่านทอง", en: "Ember" },
  abyss: { th: "ห้วงลึก", en: "Abyss" },
};

/** สีของ orb 3D — ใช้ชุดเดียวกับ gradient เพื่อให้ทั้งการ์ดเป็นเนื้อเดียวกัน */
export const GLASS_ORB_COLORS: Record<GlassGradientPalette, [string, string, string]> = {
  aurora: ["#22d3ee", "#0ea5e9", "#34d399"],
  ember: ["#fb923c", "#f59e0b", "#f43f5e"],
  abyss: ["#818cf8", "#6366f1", "#22d3ee"],
};
