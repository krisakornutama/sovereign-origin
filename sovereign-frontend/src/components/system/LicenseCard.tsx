"use client";
// ─────────────────────────────────────────────────────────────
//  LicenseCard — สถานะไลเซนส์ออฟไลน์ของเครื่องนี้
//  API: GET /api/license (คืนแค่สถานะ ไม่มี token)
//
//  ce        = ยังไม่มีไลเซนส์ที่ใช้ได้ → ทุกฟีเจอร์เปิด (ไม่ล็อกผู้ใช้)
//  licensed  = มีไลเซนส์ผ่าน → ฟีเจอร์นอกสิทธิ์ถูกปฏิเสธที่ API (403)
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../../lib/apiFetch";
import Icon from "../ui/Icon";
import { useLanguageStore } from "../../stores/useLanguageStore";

interface LicenseView {
  mode: "ce" | "licensed";
  configured: boolean;
  valid: boolean;
  reason: string;
  tier: string | null;
  features: string[];
  expiresAt: string | null;
  daysLeft: number | null;
  licensee: string | null;
  licenseId: string | null;
  machineBound: boolean;
  expiringSoon: boolean;
}

const REASON_LABEL: Record<string, string> = {
  "not-configured": "ยังไม่ได้ตั้งไลเซนส์ (SOVEREIGN_LICENSE)",
  ok: "ถูกต้อง",
  expired: "หมดอายุแล้ว",
  "wrong-machine": "ไลเซนส์นี้ไม่ได้ผูกกับเครื่องนี้",
  "bad-signature": "ลายเซ็นไม่ถูกต้อง — ไฟล์อาจถูกแก้",
  "bad-payload": "ข้อมูลในไลเซนส์ไม่ถูกต้อง",
  malformed: "ไฟล์ไลเซนส์เสียรูป",
  "no-public-key": "ไม่มี public key สำหรับตรวจลายเซ็น",
};

export default function LicenseCard() {
  const [lic, setLic] = useState<LicenseView | null>(null);
  const [error, setError] = useState("");
  const t = useLanguageStore((s) => s.t);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/license`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setLic(await res.json());
      setError("");
    } catch {
      setError(t("system.licenseUnreachable", "เชื่อมต่อ Core API ไม่ได้"));
    }
  }, [t]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, [load]);

  if (!lic && !error) return null;

  const licensed = lic?.mode === "licensed";
  const warn = Boolean(lic && (lic.valid === false && lic.configured)) || Boolean(lic?.expiringSoon);
  const tone = error ? "border-rose-800/50 bg-rose-950/20" : licensed && !warn ? "border-emerald-800/50 bg-emerald-950/20" : "border-amber-800/50 bg-amber-950/20";
  const expiry = lic?.expiresAt
    ? `${new Date(lic.expiresAt).toLocaleDateString("th-TH")}${lic.daysLeft !== null ? ` · ${t("system.licenseDaysLeft", "เหลือ {n} วัน", { n: lic.daysLeft })}` : ""}`
    : t("system.licensePerpetual", "ซื้อขาด · ไม่มีวันหมดอายุ");

  return (
    <section className={`rounded-xl border ${tone} p-4 space-y-3`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
          <Icon name="shield" size={15} className={licensed ? "text-emerald-400" : "text-amber-400"} />
          {t("system.licenseTitle", "ไลเซนส์ (License)")}
        </h2>
        <span className="text-[11px] px-2 py-0.5 rounded border border-gray-700 bg-gray-950/60 text-gray-300">
          {licensed ? (lic?.tier ?? "licensed") : "CE"}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-rose-300">{error}</p>
      ) : lic ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="inset rounded-lg p-3">
              <div className="text-[11px] text-gray-400">{t("system.licenseStatus", "สถานะ")}</div>
              <div className={`text-sm font-bold ${licensed ? "text-emerald-300" : "text-amber-300"}`}>
                {licensed ? t("system.licenseActive", "ใช้งานได้") : t("system.licenseCe", "โหมด CE (ทุกฟีเจอร์เปิด)")}
              </div>
              <div className="text-[10px] text-gray-500">{REASON_LABEL[lic.reason] ?? lic.reason}</div>
            </div>
            <div className="inset rounded-lg p-3">
              <div className="text-[11px] text-gray-400">{t("system.licenseExpiry", "วันหมดอายุ")}</div>
              <div className="text-sm font-bold">{expiry}</div>
              <div className="text-[10px] text-gray-500">{lic.licenseId ?? "—"}</div>
            </div>
            <div className="inset rounded-lg p-3">
              <div className="text-[11px] text-gray-400">{t("system.licenseFeatures", "ฟีเจอร์ในสิทธิ์")}</div>
              <div className="text-sm font-bold">{lic.features.includes("*") ? t("system.licenseAll", "ทั้งหมด") : lic.features.length}</div>
              <div className="text-[10px] text-gray-500">{lic.features.includes("*") ? "*" : lic.features.slice(0, 3).join(" · ") || "—"}</div>
            </div>
            <div className="inset rounded-lg p-3">
              <div className="text-[11px] text-gray-400">{t("system.licenseMachine", "การผูกเครื่อง")}</div>
              <div className="text-sm font-bold">{lic.machineBound ? t("system.licenseBound", "ผูกเครื่องนี้") : t("system.licenseUnbound", "ไม่ผูกเครื่อง")}</div>
              <div className="text-[10px] text-gray-500">{lic.licensee ?? "—"}</div>
            </div>
          </div>
          {lic.expiringSoon && (
            <p className="text-xs text-amber-300">
              {t("system.licenseExpiringSoon", "ไลเซนส์ใกล้หมดอายุ — ต่ออายุก่อนวันหมดเพื่อไม่ให้ฟีเจอร์นอกสิทธิ์ถูกปิด")}
            </p>
          )}
          {lic.configured && !lic.valid && (
            <p className="text-[11px] text-gray-500">
              {t("system.licenseCeNote", "ไลเซนส์ไม่ผ่าน = ระบบรันโหมด CE ข้อมูลและฟีเจอร์เดิมยังใช้ได้ — ตรวจไฟล์ไลเซนส์/public key ใน .env")}
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
