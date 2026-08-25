"use client";
import { useState, useEffect, useCallback } from "react";
import Sidebar from "../components/layout/Sidebar";
import PageHeader from "../components/ui/PageHeader";
import Icon from "../components/ui/Icon";
import { authFetch } from "../lib/apiFetch";
import { useAuthStore } from "../stores/useAuthStore";
import { useLanguageStore } from "../stores/useLanguageStore";
import Link from "next/link";

interface AutonomyItem { key: string; label: string; days: number | null; detail: string; ok: boolean | null }
interface Settings { people: number; waterTankL: number; waterLPerPersonDay: number; foodKgPerPersonDay: number; targetDays: number }
interface Overview {
  settings: Settings; autonomy: AutonomyItem[];
  weakest: AutonomyItem | null;
  resources: { waterL: number; foodKg: number; fuelL: number; seedCount: number; medicineCount: number; toolCount: number; batterySocPct: number | null; moneyMonths: number | null };
}

const TARGET_ICON: Record<string, string> = {
  water: "droplet", food: "package", energy: "zap", money: "coin",
  fuel: "zap", seed: "farm", medicine: "health", tool: "settings",
};

export default function SelfReliancePage() {
  const { isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [data, setData] = useState<Overview | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/selfreliance/overview`);
      if (r.ok) { const d = await r.json(); setData(d); setForm(d.settings); }
    } catch {}
  }, []);
  useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

  const save = async () => {
    if (!form) return;
    setSaving(true); setErr("");
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/selfreliance/settings`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || "บันทึกไม่สำเร็จ"); }
      setMsg("บันทึกการตั้งค่าบ้านแล้ว"); setEditing(false);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  if (!isHydrated) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t("common.loading", "กำลังโหลด...")}</div>;
  if (!isAuthenticated) return <div className="text-white p-8">{t("health.unauthorized", "Unauthorized")}</div>;

  const dayColor = (item: AutonomyItem) => {
    if (item.days == null) return "text-gray-500";
    if (item.ok === false) return "text-rose-400";
    return "text-emerald-400";
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3">
          <PageHeader
            eyebrow="พึ่งพาตัวเอง" title="วันรอด — Days of Autonomy"
            subtitle="อยู่ตัวคนเดียวได้กี่วัน: น้ำ · อาหาร · ไฟ · เงิน — ตัวที่สั้นที่สุด = จุดอ่อนที่ต้องเสริมก่อน"
            icon={<Icon name="shield" size={18} />}
            actions={<Link href="/inventory" className="text-sm text-sky-400 hover:underline">← คลังทรัพยากร</Link>}
          />
        </header>

        <main className="max-w-5xl mx-auto p-6 space-y-4 w-full">
          {msg && <div className="inset p-3 text-sm text-emerald-300">{msg}</div>}
          {err && <div className="inset p-3 text-sm text-red-400">{err}</div>}

          {/* จุดอ่อนของบ้าน */}
          {data?.weakest && (
            <div className={`rounded-xl border p-4 ${data.weakest.ok === false ? "border-rose-700 bg-rose-950/30" : "border-amber-700 bg-amber-950/30"}`}>
              <div className="text-xs text-gray-400">จุดอ่อนที่สุดของบ้านตอนนี้</div>
              <div className="text-lg font-bold text-white">{data.weakest.label} — เหลือ {data.weakest.days} วัน</div>
              <div className="text-xs text-gray-400 mt-0.5">{data.weakest.detail}</div>
            </div>
          )}

          {/* การ์ดวันรอดทุกทรัพยากร */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(data?.autonomy ?? []).map((a) => {
              const pct = a.days != null ? Math.min(100, Math.round((a.days / (data?.settings.targetDays ?? 30)) * 100)) : null;
              return (
                <div key={a.key} className="card p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm flex items-center gap-1.5">
                      <Icon name={TARGET_ICON[a.key] ?? "package"} size={14} className="text-gray-400" /> {a.label}
                    </span>
                    <span className={`text-2xl font-bold ${dayColor(a)}`}>
                      {a.days != null ? `${a.days}` : "—"}
                      {a.days != null && <span className="text-xs text-gray-500 font-normal ml-1">วัน</span>}
                    </span>
                  </div>
                  {pct != null && (
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className={`h-full ${a.ok === false ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  <div className="text-[11px] text-gray-500">{a.detail}</div>
                  {a.ok === false && a.days != null && <div className="text-[11px] text-rose-400">ต่ำกว่าเป้า {data?.settings.targetDays} วัน — เสริมก่อน</div>}
                </div>
              );
            })}
          </div>

          {/* ตั้งค่าบ้าน */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm flex items-center gap-1.5"><Icon name="settings" size={14} /> ตั้งค่าบ้าน (ใช้จริงของคุณ)</h3>
              {!editing ? (
                <button onClick={() => setEditing(true)} className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg">แก้ไข</button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={save} disabled={saving} className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-bold disabled:opacity-50">{saving ? "บันทึก…" : "บันทึก"}</button>
                  <button onClick={() => { setEditing(false); setForm(data?.settings ?? null); }} className="text-xs px-3 py-1.5 bg-gray-700 rounded-lg">ยกเลิก</button>
                </div>
              )}
            </div>
            {form && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                {([
                  ["people", "คนในบ้าน", "คน"],
                  ["waterTankL", "ถังน้ำรวม", "ลิตร"],
                  ["waterLPerPersonDay", "ใช้น้ำ/คน/วัน", "ลิตร"],
                  ["foodKgPerPersonDay", "อาหาร/คน/วัน", "kg"],
                  ["targetDays", "เป้าวันรอด", "วัน"],
                ] as const).map(([key, label, unit]) => (
                  <div key={key}>
                    <label className="text-gray-400 block mb-1">{label}</label>
                    <input
                      type="number" step="any" disabled={!editing}
                      value={String(form[key] ?? "")}
                      onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                      className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm disabled:opacity-60"
                    />
                    <span className="text-[10px] text-gray-500">{unit}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-gray-500 mt-2">ข้อมูลมาจากของจริง: คลัง <Link href="/inventory" className="text-sky-400 underline">/inventory</Link> (น้ำ/อาหาร kg) + เซ็นเซอร์แบต + งบดุล <Link href="/treasury" className="text-sky-400 underline">/treasury</Link></p>
          </div>

          {/* ศาสตร์เสริม — ชี้ไปหน้าที่เกี่ยว */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {[
              { href: "/farm", icon: "farm", label: "ฟาร์ม+เมล็ดพันธุ์", desc: `${data?.resources.seedCount ?? 0} รายการเมล็ด` },
              { href: "/healing", icon: "healing", label: "สมุนไพร+ยา", desc: `${data?.resources.medicineCount ?? 0} รายการยา` },
              { href: "/restaurant", icon: "inventory", label: "อาหารจากฟาร์ม", desc: "สูตรใช้ของผลิตเอง" },
              { href: "/system", icon: "wifi", label: "ไฟ+เน็ต+router", desc: data?.resources.batterySocPct != null ? `แบต ${data.resources.batterySocPct.toFixed(0)}%` : "ดูสถานะ" },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="card p-3 hover:border-emerald-700 transition-colors">
                <div className="font-bold flex items-center gap-1.5"><Icon name={l.icon} size={13} className="text-emerald-400" /> {l.label}</div>
                <div className="text-gray-500 mt-0.5">{l.desc}</div>
              </Link>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
