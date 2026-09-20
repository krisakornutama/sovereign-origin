"use client";
import { useState, useEffect, useCallback } from "react";
import Sidebar from "../components/layout/Sidebar";
import PageHeader from "../components/ui/PageHeader";
import Icon from "../components/ui/Icon";
import { authFetch } from "../lib/apiFetch";
import { useAuthStore } from "../stores/useAuthStore";
import { useLanguageStore } from "../stores/useLanguageStore";

interface SkillRow {
  id: string;
  user_id: string | null;
  skill: string;
  level: number;
  note: string | null;
  updatedAt: string;
}
interface Summary {
  bySkill: Array<{ skill: string; avgLevel: number; count: number }>;
  total: number;
  avgLevel: number;
  lowSkills: number;
}

export default function SkillsPage() {
  const { isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [items, setItems] = useState<SkillRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ skill: "", level: 3, note: "" });
  const [editId, setEditId] = useState<string | null>(null);
  const [editLevel, setEditLevel] = useState(3);
  const [editNote, setEditNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [listRes, sumRes] = await Promise.all([
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/skill-matrix`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/skill-matrix/summary`),
      ]);
      if (!listRes.ok) throw new Error(`HTTP ${listRes.status}`);
      const body = await listRes.json();
      setItems(body.items ?? []);
      if (sumRes.ok) {
        const s = await sumRes.json();
        setSummary(s);
      }
    } catch (e: any) {
      setError(e.message || "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

  if (!isHydrated) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t("common.loading", "กำลังโหลด...")}</div>;
  if (!isAuthenticated) return <div className="text-white p-8">Unauthorized</div>;

  const create = async () => {
    if (!form.skill.trim()) return setMessage("ต้องระบุชื่อทักษะ");
    setSaving(true); setError(""); setMessage("");
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/skill-matrix`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill: form.skill.trim(), level: Number(form.level), note: form.note || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "บันทึกไม่สำเร็จ");
      setMessage(`บันทึก "${form.skill}" แล้ว`);
      setForm({ skill: "", level: 3, note: "" });
      load();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  const saveEdit = async (id: string) => {
    setSaving(true); setError("");
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/skill-matrix/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: Number(editLevel), note: editNote || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "แก้ไขไม่สำเร็จ");
      setEditId(null);
      setMessage("แก้ไขแล้ว");
      load();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  const remove = async (row: SkillRow) => {
    if (!window.confirm(`ลบ "${row.skill}"?`)) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/skill-matrix/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("ลบไม่สำเร็จ");
      setMessage(`ลบ "${row.skill}" แล้ว`);
      load();
    } catch (e: any) { setError(e.message); }
  };

  const avg = summary?.avgLevel ?? (items.length ? Math.round((items.reduce((s, r) => s + r.level, 0) / items.length) * 10) / 10 : 0);
  const lowCount = summary?.lowSkills ?? items.filter((r) => r.level < 3).length;

  return (
    <div className="atmo-wellness min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-6xl mx-auto w-full">
          <PageHeader
            eyebrow={t("common.nav.group.selfreliance", "วันรอด & สุขภาพ")}
            title={t("common.nav.skills", "ทักษะคน")}
            subtitle="เมทริกซ์ทักษะครอบครัว — ใครทำอะไรได้ระดับไหน และต้องเสริมจุดไหน"
            icon={<Icon name="users" size={18} />}
          />

          {error && <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded px-4 py-2 text-sm">{error}</div>}
          {message && <div className="bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 rounded px-4 py-2 text-sm">{message}</div>}

          {/* summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-4 text-center">
              <div className="text-xs text-gray-400">ระดับเฉลี่ย</div>
              <div className="text-2xl font-bold text-emerald-300">{avg}</div>
              <div className="text-[11px] text-gray-500">/ 5</div>
            </div>
            <div className="card p-4 text-center">
              <div className="text-xs text-gray-400">ทักษะทั้งหมด</div>
              <div className="text-2xl font-bold text-white">{summary?.total ?? items.length}</div>
              <div className="text-[11px] text-gray-500">รายการ</div>
            </div>
            <div className="card p-4 text-center">
              <div className="text-xs text-gray-400">ต้องเสริม (&lt;3)</div>
              <div className={`text-2xl font-bold ${lowCount ? "text-amber-400" : "text-gray-200"}`}>{lowCount}</div>
              <div className="text-[11px] text-gray-500">รายการ</div>
            </div>
          </div>

          {/* add form */}
          <div className="card panel-glow p-4 space-y-3">
            <div className="text-sm font-semibold text-gray-200 flex items-center gap-1.5"><Icon name="plus" size={14} className="text-gray-400" />เพิ่ม/อัปเดตทักษะ (ชื่อซ้ำ = อัปเดตระดับ)</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <input value={form.skill} onChange={(e) => setForm({ ...form, skill: e.target.value })} placeholder="ชื่อทักษะ เช่น ปลูกข้าว, ซ่อมปั๊ม *" className="input md:col-span-2" />
              <div>
                <label className="text-xs text-gray-400 block mb-1">ระดับ: {form.level}/5</label>
                <input type="range" min={1} max={5} value={form.level} onChange={(e) => setForm({ ...form, level: Number(e.target.value) })} className="w-full accent-emerald-500" />
              </div>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="หมายเหตุ" className="input" />
            </div>
            <button onClick={create} disabled={saving} className="btn-primary">{saving ? "กำลังบันทึก…" : t("common.save", "บันทึก")}</button>
          </div>

          {/* table */}
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-gray-500"><span className="w-4 h-4 border-2 border-gray-600 border-t-emerald-500 rounded-full animate-spin" /><span className="text-sm">กำลังโหลด…</span></div>
          ) : items.length === 0 ? (
            <div className="card p-8 text-center text-gray-500 text-sm">ยังไม่มีทักษะ — เพิ่มรายการแรกด้านบน</div>
          ) : (
            <div className="card panel-cyan overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-emerald-500/50 via-cyan-500/30 to-transparent" />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-950/40 backdrop-blur-sm">
                    <tr className="text-left text-emerald-400/70 border-b border-gray-800 text-[11px] uppercase tracking-widest">
                      <th className="px-4 py-3 font-semibold">ทักษะ</th>
                      <th className="px-4 py-3 font-semibold">ระดับ</th>
                      <th className="px-4 py-3 font-semibold">หมายเหตุ</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {items.map((row) => (
                      <tr key={row.id} className="hover:bg-gray-800/50 transition-colors">
                        <td className="px-4 py-3 font-semibold">{row.skill}</td>
                        <td className="px-4 py-3">
                          {editId === row.id ? (
                            <div className="flex items-center gap-2">
                              <input type="range" min={1} max={5} value={editLevel} onChange={(e) => setEditLevel(Number(e.target.value))} className="w-24 accent-emerald-500" />
                              <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${editLevel < 3 ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"}`}>{editLevel}/5</span>
                            </div>
                          ) : (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border font-bold ${row.level < 3 ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : row.level >= 4 ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-gray-500/15 text-gray-300 border-gray-500/30"}`}>{row.level}/5 {row.level < 3 && <Icon name="alert-triangle" size={11} />}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {editId === row.id ? (
                            <input value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="หมายเหตุ" className="input text-xs py-1" />
                          ) : (
                            <span className="text-gray-400 text-xs">{row.note ?? "—"}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {editId === row.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => saveEdit(row.id)} disabled={saving} className="text-xs px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold disabled:opacity-50">{t("common.save", "บันทึก")}</button>
                              <button onClick={() => setEditId(null)} className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded">ยกเลิก</button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => { setEditId(row.id); setEditLevel(row.level); setEditNote(row.note ?? ""); }} className="text-sky-400 hover:text-sky-300 text-xs inline-flex items-center gap-1"><Icon name="edit" size={12} />{t("common.edit", "แก้ไข")}</button>
                              <button onClick={() => remove(row)} className="text-red-400 hover:text-red-300 text-xs"><Icon name="trash" size={14} /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* summary by skill */}
          {summary && summary.bySkill.length > 0 && (
            <div className="card p-4 space-y-2">
              <h3 className="text-sm font-semibold text-gray-200">สรุปตามทักษะ (aggregate)</h3>
              <div className="grid md:grid-cols-2 gap-2">
                {summary.bySkill.map((s) => (
                  <div key={s.skill} className="flex items-center justify-between bg-gray-800/40 border border-gray-700/40 rounded-lg px-3 py-2 text-sm">
                    <span className="font-semibold">{s.skill}</span>
                    <span className="flex items-center gap-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded border font-bold ${s.avgLevel < 3 ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"}`}>avg {s.avgLevel}</span>
                      <span className="text-gray-400">{s.count} คน</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
