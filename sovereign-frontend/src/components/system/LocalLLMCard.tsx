"use client";
import { useState, useEffect, useCallback } from "react";
import { useIsSuperadmin } from '../../lib/roles';
import { authFetch } from "../../lib/apiFetch";
import Icon from "../ui/Icon";
import { useAuthStore } from "../../stores/useAuthStore";

export default function LocalLLMCard() {
  const user = useAuthStore((s) => s.user);
  const isSuper = useIsSuperadmin();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [model, setModel] = useState("gemma3:4b");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/local-status`);
      if (r.ok) { const d = await r.json(); setEnabled(!!d.enabled); if (d.model) setModel(d.model); }
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async () => {
    if (!isSuper) return;
    const next = !enabled;
    setBusy(true); setMsg("");
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/enabled`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }),
      });
      if (r.ok) { setEnabled(next); setMsg(next ? "เปิด AI ในเครื่องแล้ว — โมเดลจะโหลดเมื่อมีการเรียกครั้งแรก" : "ปิด AI แล้ว — โมเดลถูกปล่อยจาก RAM"); }
      else setMsg("ล้มเหลว");
    } catch { setMsg("ล้มเหลว"); }
    setBusy(false);
  };

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
          <Icon name="ai" size={15} className={enabled ? "text-emerald-400" : "text-gray-500"} />
          AI ในเครื่อง (Local LLM)
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${enabled ? "bg-emerald-900/40 text-emerald-300 border-emerald-700" : "bg-gray-800 text-gray-400 border-gray-700"}`}>
            {enabled == null ? "…" : enabled ? "เปิด" : "ปิด"}
          </span>
        </h2>
        <button
          onClick={toggle}
          disabled={busy || !isSuper}
          className={`text-xs px-3 py-1.5 rounded-lg font-bold border ${enabled ? "bg-rose-900/40 hover:bg-rose-800/60 border-rose-700 text-rose-300" : "bg-emerald-900/40 hover:bg-emerald-800/60 border-emerald-700 text-emerald-300"} disabled:opacity-50`}
          title={!isSuper ? "เฉพาะ SUPERADMIN" : ""}
        >
          {busy ? "…" : enabled ? "ปิด AI" : "เปิด AI"}
        </button>
      </div>
      <p className="text-xs text-gray-500">
        ปิดเป็นค่าเริ่มต้น — ต้องกดเปิดเอง (ยินยอมชัด) ไม่เปิดเองตอนบูต โมเดลอยู่ใน <code>models/</code> ของโปรเจ็ก (offline 100%)
      </p>
      {msg && <div className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800/50 rounded-lg px-3 py-2">{msg}</div>}
      {!isSuper && <div className="text-xs text-gray-600">เฉพาะ SUPERADMIN กดเปิด/ปิดได้</div>}
    </section>
  );
}
