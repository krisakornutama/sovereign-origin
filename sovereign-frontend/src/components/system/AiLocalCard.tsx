"use client";
import { useState, useEffect, useCallback } from "react";
import { authFetch } from "../../lib/apiFetch";

interface AiLocalStatus {
  enabled: boolean;
  autoStart: boolean;
  modelPath: string;
  modelExists: boolean;
  modelSizeMb: number | null;
  loaded: boolean;
  error: string | null;
}

export default function AiLocalCard() {
  const [s, setS] = useState<AiLocalStatus | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/system/ai-local/status`);
      if (r.ok) setS(await r.json());
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleEnabled = async () => {
    if (!s) return;
    setBusy("toggle");
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/system/ai-local/enabled`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      if (r.ok) setS(await r.json());
    } finally { setBusy(""); }
  };
  const toggleAuto = async () => {
    if (!s) return;
    setBusy("auto");
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/system/ai-local/auto-start`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoStart: !s.autoStart }),
      });
      if (r.ok) setS(await r.json());
    } finally { setBusy(""); }
  };
  const loadModel = async () => {
    setBusy("load");
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/system/ai-local/load`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) alert(d.error || "โหลดไม่สำเร็จ");
      await load();
    } finally { setBusy(""); }
  };

  if (!s) return null;

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
          <span className={`w-2.5 h-2.5 rounded-full ${s.enabled && s.loaded ? "bg-emerald-500" : s.enabled ? "bg-amber-500 animate-pulse" : "bg-gray-600"}`} /> AI Local — ปิดเป็นค่าเริ่มต้น
        </h2>
        <span className="text-[10px] text-gray-500">{s.enabled ? (s.loaded ? "พร้อม" : "เปิดอยู่ (ยังไม่โหลด)") : "ปิดอยู่"}</span>
      </div>

      <p className="text-xs text-gray-400">
        AI รันในเครื่องคุณเอง (node-llama-cpp) — ปิดเป็นค่าเริ่มต้น ต้องกดเปิดเอง ไม่เปิดเองจนกว่าคุณจะยินยอม
      </p>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="inset rounded-lg p-3">
          <div className="text-gray-400">โมเดล</div>
          <div className="font-bold text-gray-200 truncate">{s.modelPath}</div>
          <div className="text-gray-500">{s.modelExists ? `${s.modelSizeMb} MB` : "ยังไม่มีไฟล์ — วาง GGUF ที่ path นี้"}</div>
        </div>
        <div className="inset rounded-lg p-3">
          <div className="text-gray-400">สถานะ</div>
          <div className="font-bold" style={{ color: s.loaded ? "#34d399" : s.enabled ? "#f59e0b" : "#9ca3af" }}>
            {s.loaded ? "โหลดแล้ว" : s.enabled ? "รอโหลด" : "ปิด"}
          </div>
          {s.error && <div className="text-rose-400 text-[11px] mt-1">{s.error}</div>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={toggleEnabled}
          disabled={!!busy}
          className={`px-4 py-2 rounded-lg text-sm font-bold ${s.enabled ? "bg-rose-700 hover:bg-rose-600 text-white" : "bg-emerald-600 hover:bg-emerald-500 text-white"} disabled:opacity-50`}
        >
          {busy === "toggle" ? "..." : s.enabled ? "ปิด AI Local" : "เปิด AI Local"}
        </button>
        <button
          onClick={toggleAuto}
          disabled={!!busy || !s.enabled}
          className={`px-3 py-2 rounded-lg text-xs ${s.autoStart ? "bg-sky-700 text-white" : "bg-gray-800 text-gray-400"} disabled:opacity-40`}
        >
          {s.autoStart ? "✓ Auto-start เปิด" : "Auto-start ปิด"} (เปิดเครื่องแล้วรันเอง)
        </button>
        {s.enabled && !s.loaded && s.modelExists && (
          <button onClick={loadModel} disabled={!!busy} className="px-3 py-2 bg-amber-700 hover:bg-amber-600 rounded-lg text-xs font-bold disabled:opacity-50">
            {busy === "load" ? "กำลังโหลด..." : "โหลดโมเดลตอนนี้"}
          </button>
        )}
      </div>

      <p className="text-[10px] text-gray-600">
        ปิด = ระบบหลักทำงานปกติ ไม่กิน RAM · เปิด = โหลดโมเดล (~4GB RAM) · Auto-start = เปิดเครื่องแล้วโหลดเอง (ต้องยินยอมก่อน)
      </p>
    </section>
  );
}
