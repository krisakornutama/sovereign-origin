"use client";
import { useState, useEffect, useCallback } from "react";
import Sidebar from "../components/layout/Sidebar";
import PageHeader from "../components/ui/PageHeader";
import Icon from "../components/ui/Icon";
import { authFetch } from "../lib/apiFetch";
import { useAuthStore } from "../stores/useAuthStore";
import { useLanguageStore } from "../stores/useLanguageStore";

interface CrisisMode {
  id: string;
  mode: string;
  active: boolean;
  actions: string[];
  activatedAt: string | null;
}

const MODE_META: Record<string, { label: string; icon: string; color: string; desc: string; emoji: string }> = {
  flood: { label: "น้ำท่วม", icon: "droplet", color: "sky", emoji: "🌊", desc: "ปิดรีเลย์ non-critical · สำรองข้อมูล · DEFCON 2" },
  blackout: { label: "ดับไฟ", icon: "zap", color: "amber", emoji: "⚡", desc: "ปิดรีเลย์ non-critical · ประหยัดไฟ · สำรองข้อมูล" },
  security: { label: "ปลอดภัย", icon: "shield", color: "rose", emoji: "🛡️", desc: "DEFCON 1 · ล็อกประตู · เปิดกล้อง" },
};

const MODE_ORDER = ["flood", "blackout", "security"] as const;

function modeBadge(mode: string) {
  const meta = MODE_META[mode];
  if (!meta) return null;
  return `${meta.emoji} ${meta.label}`;
}

export default function CrisisPage() {
  const { isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [modes, setModes] = useState<CrisisMode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/crisis/modes`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const list: CrisisMode[] = (body.modes ?? []).map((m: any) => ({
        ...m,
        actions: Array.isArray(m.actions) ? m.actions : [],
      }));
      // sort by MODE_ORDER
      list.sort((a, b) => MODE_ORDER.indexOf(a.mode as any) - MODE_ORDER.indexOf(b.mode as any));
      setModes(list);
    } catch (e: any) {
      setError(e.message || "โหลดโหมดวิกฤตไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) load();
  }, [isAuthenticated, load]);

  const activate = async (mode: string) => {
    setBusy(mode);
    setError("");
    setMessage("");
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/crisis/modes/${mode}/activate`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `activate ${mode} ไม่สำเร็จ`);
      setMessage(`เปิดโหมด ${modeBadge(mode) ?? mode} แล้ว`);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const deactivate = async (mode: string) => {
    setBusy(mode);
    setError("");
    setMessage("");
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/crisis/modes/${mode}/deactivate`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `ปิดโหมด ${mode} ไม่สำเร็จ`);
      setMessage(`ปิดโหมด ${modeBadge(mode) ?? mode} แล้ว`);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (!isHydrated)
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">
        {t("common.loading", "กำลังโหลด...")}
      </div>
    );
  if (!isAuthenticated) return <div className="text-white p-8">Unauthorized</div>;

  const activeMode = modes.find((m) => m.active) ?? null;

  const getModeCard = (key: string) => modes.find((m) => m.mode === key) ?? null;

  return (
    <div className="atmo-wellness min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-6xl mx-auto w-full">
          <PageHeader
            eyebrow={t("common.nav.group.security", "ความปลอดภัย")}
            title={t("common.nav.crisis", "โหมดวิกฤต")}
            subtitle="Crisis Playbooks — กดปุ่มเดียวสั่งทั้งบ้าน: น้ำท่วม / ดับไฟ / ปลอดภัย (เปิดได้ทีละโหมด)"
            icon={<Icon name="shield" size={18} />}
            actions={
              <button
                onClick={load}
                disabled={loading}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-50"
              >
                <Icon name="refresh" size={14} /> {t("common.refresh", "รีเฟรช")}
              </button>
            }
          />

          {error && <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded px-4 py-2 text-sm">{error}</div>}
          {message && <div className="bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 rounded px-4 py-2 text-sm">{message}</div>}

          {/* Active banner */}
          {activeMode ? (
            <div className="rounded-xl border border-amber-700 bg-amber-950/30 p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_10px_rgba(251,191,36,0.7)]" />
                  <span className="text-sm font-bold text-amber-200">โหมดที่เปิดอยู่: {modeBadge(activeMode.mode) ?? activeMode.mode}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">ACTIVE</span>
                </div>
                <span className="text-[11px] text-gray-400">
                  {activeMode.activatedAt ? `เปิดเมื่อ ${new Date(activeMode.activatedAt).toLocaleString("th-TH")}` : ""}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {(activeMode.actions ?? []).map((a, i) => (
                  <span key={i} className="text-xs px-2 py-1 rounded-full bg-gray-800 border border-gray-700 text-gray-200">
                    {a}
                  </span>
                ))}
              </div>
              <div className="mt-2">
                <button
                  onClick={() => deactivate(activeMode.mode)}
                  disabled={busy === activeMode.mode}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-bold disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {busy === activeMode.mode ? "กำลังปิด…" : "ปิดโหมดนี้"}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 text-sm text-gray-400 flex items-center gap-2">
              <Icon name="shield" size={14} className="text-gray-500" />
              ยังไม่มีโหมดวิกฤตที่เปิดอยู่ — กดปุ่มด้านล่างเพื่อเปิดโหมดที่ต้องการ (เปิดได้ทีละโหมด)
            </div>
          )}

          {/* 3 big buttons */}
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-gray-500">
              <span className="w-4 h-4 border-2 border-gray-600 border-t-emerald-500 rounded-full animate-spin" />
              <span className="text-sm">กำลังโหลด…</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {MODE_ORDER.map((key) => {
                const m = getModeCard(key);
                const meta = MODE_META[key];
                const isActive = m?.active ?? false;
                const actions: string[] = m?.actions ?? [];
                const isBusy = busy === key;
                return (
                  <div
                    key={key}
                    className={`card p-5 space-y-3 flex flex-col ${isActive ? "border-amber-600/50 bg-amber-950/15 ring-1 ring-amber-500/20" : "hover:border-gray-700"}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-10 h-10 rounded-xl flex items-center justify-center text-lg border bg-gray-800 border-gray-700">
                          <Icon name={meta.icon} size={20} className={isActive ? "text-amber-400" : "text-gray-400"} />
                        </span>
                        <div>
                          <div className="font-bold text-sm flex items-center gap-1.5">
                            <span>{meta.emoji}</span> {meta.label}
                            <span className="text-[10px] font-mono text-gray-500">{key}</span>
                          </div>
                          <div className="text-[11px] text-gray-500">{meta.desc}</div>
                        </div>
                      </div>
                      {isActive ? (
                        <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-500 text-white tracking-widest">ACTIVE</span>
                      ) : (
                        <span className="text-[10px] px-2 py-1 rounded-full bg-gray-800 text-gray-400 border border-gray-700">IDLE</span>
                      )}
                    </div>

                    <div className="space-y-1.5 min-h-[56px]">
                      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Actions</div>
                      {actions.length ? (
                        <ul className="space-y-1">
                          {actions.map((a, i) => (
                            <li key={i} className="text-sm text-gray-200 flex items-start gap-1.5">
                              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                              <span>{a}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-xs text-gray-500">— ยังไม่มี actions (เปิดโหมดเพื่อโหลดค่าเริ่มต้น) —</div>
                      )}
                    </div>

                    {m?.activatedAt && (
                      <div className="text-[11px] text-gray-500">เปิดเมื่อ {new Date(m.activatedAt).toLocaleString("th-TH")}</div>
                    )}

                    <div className="flex gap-2 pt-2 mt-auto">
                      {!isActive ? (
                        <button
                          onClick={() => activate(key)}
                          disabled={!!isBusy}
                          className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                        >
                          {isBusy ? (
                            <>
                              <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> กำลังเปิด…
                            </>
                          ) : (
                            <>เปิดโหมด {meta.label}</>
                          )}
                        </button>
                      ) : (
                        <button
                          onClick={() => deactivate(key)}
                          disabled={!!isBusy}
                          className="flex-1 py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-white font-bold text-sm disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                        >
                          {isBusy ? (
                            <>
                              <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> กำลังปิด…
                            </>
                          ) : (
                            <>ปิดโหมด</>
                          )}
                        </button>
                      )}
                    </div>

                    {isActive && (
                      <div className="text-[11px] text-amber-300/80 text-center">โหมดนี้กำลังใช้งาน — เปิดโหมดอื่นจะปิดโหมดนี้อัตโนมัติ</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Help */}
          <div className="card p-4 text-xs text-gray-500 space-y-1">
            <div className="font-semibold text-gray-300 flex items-center gap-1.5">
              <Icon name="info" size={13} /> วิธีใช้
            </div>
            <ul className="list-disc list-inside space-y-0.5">
              <li>กด “เปิดโหมด” → ระบบจะปิดโหมดอื่นทันที เปิดได้ทีละโหมดเท่านั้น</li>
              <li>Actions จะถูกตั้งเป็นค่าเริ่มต้นของโหมดนั้น: flood — ปิดรีเลย์ non-critical, สำรองข้อมูล, DEFCON 2 · blackout — ปิดรีเลย์ non-critical, ประหยัดไฟ, สำรองข้อมูล · security — DEFCON 1, ล็อกประตู, เปิดกล้อง</li>
              <li>กด “ปิดโหมด” เพื่อยกเลิกโหมดปัจจุบัน</li>
            </ul>
          </div>
        </main>
      </div>
    </div>
  );
}
