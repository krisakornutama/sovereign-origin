"use client";

/**
 * GlassLabSection — เวทีทดลองวัสดุ "Liquid Glass" ของ Sovereign OS
 *
 * รวมทั้ง 3 องค์ประกอบที่นำเข้ามาไว้ในที่เดียว เพื่อให้เห็นของจริงและเทียบโทนได้ทันที:
 *   1) ShaderGradientBackdrop — ฉากหลังไล่สีเคลื่อนไหว (WebGL ผ่าน @shadergradient/react)
 *   2) GlassOrb              — วัตถุ 3D เนื้อแก้ว (React Three Fiber)
 *   3) GlassSurface          — การ์ดกระจกเหลวแบบไม่ใช้ WebGL (SVG displacement)
 *
 * ทุกชั้นหยุดเคลื่อนไหวเองเมื่อผู้ใช้เปิด prefers-reduced-motion และไม่บล็อก pointer
 * หน้านี้เป็น "ห้องแสดงตัวอย่าง" — หน้าจริงจะยกวัสดุนี้ไปใช้หลังจัดหน้าเฮิร์บ/แดชบอร์ดรอบถัดไป
 */
import { useState } from "react";
import GlassSurface from "./GlassSurface";
import GlassOrb from "./GlassOrb";
import ShaderGradientBackdrop from "./ShaderGradientBackdrop";
import {
  GLASS_PALETTE_LABEL,
  GLASS_PALETTE_ORDER,
  type GlassGradientPalette,
} from "./glassPalettes";
import { useLanguageStore } from "../../stores/useLanguageStore";

export default function GlassLabSection() {
  const t = useLanguageStore((s) => s.t);
  const [palette, setPalette] = useState<GlassGradientPalette>("aurora");

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-cyan-300/80">Liquid Glass</div>
          <h2 className="mt-1 text-xl font-semibold text-gray-100">
            {t("glass.title", "พื้นผิวแก้วเหลว + ฉาก 3D")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-400">
            {t(
              "glass.subtitle",
              "วัสดุชุดใหม่ของ Sovereign OS — กระจกหักเหแสง (SVG), ฉากหลังไล่สีแบบ shader และวัตถุ 3D เรนเดอร์ด้วย React Three Fiber",
            )}
          </p>
        </div>

        {/* สลับชุดสี — ใช้ปุ่มจริงเพื่อให้ทดสอบด้วยคีย์บอร์ด/เครื่องอ่านหน้าจอได้ */}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("glass.palette", "ชุดสี")}>
          {GLASS_PALETTE_ORDER.map((key) => {
            const active = key === palette;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setPalette(key)}
                aria-pressed={active}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-100"
                    : "border-white/10 bg-white/5 text-gray-300 hover:border-white/25 hover:text-white"
                }`}
              >
                {t(`glass.palette.${key}`, GLASS_PALETTE_LABEL[key].th)}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── ฮีโร่: ฉาก gradient + orb 3D + กระจกจริง ── */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gray-950">
        <ShaderGradientBackdrop palette={palette} opacity={0.8} />

        {/* ชั้นไล่สีให้ตัวอักษรอ่านชัด: จอเล็ก = ไล่บนลงล่าง · จอใหญ่ = ไล่ซ้ายไปขวา (สีสันของ shader ยังสดทางขวา) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-gray-950/70 via-gray-950/20 to-gray-950/70 md:bg-gradient-to-r md:from-gray-950/70 md:via-gray-950/10 md:to-transparent"
        />

        <div className="relative grid gap-6 p-5 md:grid-cols-[1.15fr_1fr] md:p-7">
          <div className="flex flex-col justify-between gap-5">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 py-1 text-[11px] text-gray-200 backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {t("glass.badge", "WebGL ทำงานเฉพาะหน้านี้")}
              </div>
              <h3 className="mt-3 text-2xl font-semibold leading-snug text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)]">
                {t("glass.heroTitle", "แก้วที่หักเหแสงจริง ไม่ใช่แค่ทำโปร่งใส")}
              </h3>
              <p className="mt-2 max-w-md text-sm text-gray-100/90 drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)]">
                {t(
                  "glass.heroBody",
                  "ขอบกระจกคำนวณการหักเหตามกฎของสเนลล์ ไล่แสงสีที่ขอบ และมีไฮไลต์ตามมุมแสง — ส่วนฉากหลังเป็น shader ที่ไหลต่อเนื่องแบบไม่กิน CPU",
                )}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <GlassSurface radius={999} tone="panel" interactive className="px-4 py-2 text-xs text-white">
                {t("glass.pillOne", "กดได้ (interactive)")}
              </GlassSurface>
              <GlassSurface radius={999} tone="contrast" className="px-4 py-2 text-xs text-gray-100">
                {t("glass.pillTwo", "แผงทึบ อ่านง่าย")}
              </GlassSurface>
              <GlassSurface radius={999} tone="light" className="px-4 py-2 text-xs text-gray-900">
                {t("glass.pillThree", "โหมดสว่าง")}
              </GlassSurface>
            </div>
          </div>

          {/* ฉาก 3D — สูงจำกัด เพื่อไม่ให้กิน GPU ตอนเลื่อนผ่าน */}
          <div className="relative min-h-[240px]">
            <GlassOrb palette={palette} height={280} />
          </div>
        </div>
      </div>

      {/* ── การ์ดตัวอย่าง 3 โทน (ไม่ใช้ WebGL — วางได้หลายใบพร้อมกัน) ── */}
      <div className="grid gap-4 md:grid-cols-3">
        <GlassSurface radius={22} tone="panel" className="p-5">
          <div className="text-[11px] uppercase tracking-wide text-gray-400">
            {t("glass.cardPanelEyebrow", "Panel")}
          </div>
          <div className="mt-1 text-base font-medium text-gray-100">
            {t("glass.cardPanelTitle", "การ์ดเนื้อหาทั่วไป")}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-gray-400">
            {t("glass.cardPanelBody", "โปร่ง เห็นพื้นหลัง — เหมาะกับตัวเลข/กราฟที่ไม่ต้องอ่านนาน")}
          </p>
        </GlassSurface>

        <GlassSurface radius={22} tone="contrast" className="p-5">
          <div className="text-[11px] uppercase tracking-wide text-gray-400">
            {t("glass.cardContrastEyebrow", "Contrast")}
          </div>
          <div className="mt-1 text-base font-medium text-gray-100">
            {t("glass.cardContrastTitle", "แผงควบคุมสำคัญ")}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-gray-400">
            {t("glass.cardContrastBody", "ทึบกว่า — ใช้กับฟอร์ม/ปุ่มยืนยันที่ห้ามอ่านผิด")}
          </p>
        </GlassSurface>

        <GlassSurface radius={22} tone="light" className="p-5 text-gray-900">
          <div className="text-[11px] uppercase tracking-wide text-gray-600">
            {t("glass.cardLightEyebrow", "Light")}
          </div>
          <div className="mt-1 text-base font-medium">
            {t("glass.cardLightTitle", "โหมดสว่าง / ป้ายเล็ก")}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-gray-700">
            {t("glass.cardLightBody", "ใช้กับหน้าสาธารณะหรือป้ายลอยบนภาพสว่าง")}
          </p>
        </GlassSurface>
      </div>

      <p className="text-[11px] leading-relaxed text-gray-500">
        {t(
          "glass.footnote",
          "หมายเหตุ: ฉาก 3D และ shader ถูกโหลดแบบแยก chunk (ไม่กระทบหน้าแรก) · ถ้าเครื่องไม่รองรับ WebGL จะเห็นเฉพาะชั้นกระจก · ปิดการเคลื่อนไหวอัตโนมัติเมื่อ OS ตั้ง Reduced motion",
        )}
      </p>
    </section>
  );
}
