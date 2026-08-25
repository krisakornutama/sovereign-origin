"use client";
// ─────────────────────────────────────────────────────────────
//  RouterCard — Archer MR505 + เน็ตซิม ครบทั้งเส้นทาง
//  router_state (LAN) · wan_state (ซิม) · latency · อุปกรณ์ต่อ · Mbps
//  API: GET/POST /api/system/wan*
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import { authFetch } from "../../lib/apiFetch";
import Icon from "../ui/Icon";

interface WanData {
  up: boolean; latencyMs: number | null; host: string; lastCheck: string;
  router: { up: boolean; latencyMs: number | null; since: string };
  lanDevices: { ip: string; latencyMs: number }[];
  lastSpeedtest: { mbps: number; at: string } | null;
  subnet: string; routerHost: string;
}

function Dot({ ok }: { ok: boolean }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${ok ? "bg-emerald-500" : "bg-rose-500"} ${ok ? "" : "animate-pulse"}`} />;
}

export default function RouterCard() {
  const [d, setD] = useState<WanData | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/system/wan`);
      if (res.ok) setD(await res.json());
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 15_000);
    return () => clearInterval(iv);
  }, [load]);

  const act = async (path: string, label: string) => {
    setBusy(path); setMsg("");
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/system/wan/${path}`, { method: "POST" });
      const data = await res.json();
      if (path === "speedtest") setMsg(`⚡ ${data.mbps} Mbps (${(data.bytes / 1e6).toFixed(1)}MB ใน ${(data.ms / 1000).toFixed(1)}s)`);
      else if (path === "check") setMsg(data.issue === "OK" ? "✅ ทั้งเส้นทางปกติ" : `⚠️ ${data.issue === "LAN_DOWN" ? "Router/สาย LAN มีปัญหา" : "ซิม/สัญญาณ LTE หลุด (router ปกติ)"}`);
      await load();
    } catch { setMsg("ล้มเหลว"); }
    finally { setBusy(""); }
  };

  if (!d) return null;
  const issue = d.router.up && d.up ? null : !d.router.up ? "LAN_DOWN" : "SIM_DOWN";

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
          <Icon name="wifi" size={15} className="text-sky-400" /> Router &amp; Internet — Archer MR505
        </h2>
        <div className="flex gap-1.5">
          <button onClick={() => act("check", "check")} disabled={!!busy} className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg disabled:opacity-50">{busy === "check" ? "กำลังตรวจ…" : "ตรวจเลย"}</button>
          <button onClick={() => act("speedtest", "speedtest")} disabled={!!busy} className="text-xs px-3 py-1.5 bg-sky-800/60 hover:bg-sky-700/60 border border-sky-700/50 rounded-lg disabled:opacity-50">{busy === "speedtest" ? "กำลังวัด…" : "วัดความเร็ว"}</button>
        </div>
      </div>
      {msg && <div className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800/50 rounded-lg px-3 py-2">{msg}</div>}
      {issue && <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/50 rounded-lg px-3 py-2">⚠️ {issue === "LAN_DOWN" ? "Router/สาย LAN ไม่ตอบ — ตรวจสายแลนกับโน้ตบุ๊ค" : "ซิม/สัญญาณ LTE หลุด — router ปกติ รอสัญญาณกลับ"}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="inset rounded-lg p-3">
          <div className="text-[11px] text-gray-400 flex items-center gap-1.5"><Dot ok={d.router.up} /> Router (LAN)</div>
          <div className="text-xl font-bold">{d.router.up ? `${d.router.latencyMs ?? "—"}ms` : "หลุด"}</div>
          <div className="text-[10px] text-gray-500">{d.routerHost}</div>
        </div>
        <div className="inset rounded-lg p-3">
          <div className="text-[11px] text-gray-400 flex items-center gap-1.5"><Dot ok={d.up} /> Internet (ซิม 4G)</div>
          <div className="text-xl font-bold">{d.up ? `${d.latencyMs ?? "—"}ms` : "หลุด"}</div>
          <div className="text-[10px] text-gray-500">via {d.host}</div>
        </div>
        <div className="inset rounded-lg p-3">
          <div className="text-[11px] text-gray-400">อุปกรณ์ต่อ router</div>
          <div className="text-xl font-bold">{d.lanDevices?.length ?? "—"} <span className="text-xs text-gray-500 font-normal">เครื่อง</span></div>
          <div className="text-[10px] text-gray-500">subnet {d.subnet}.x</div>
        </div>
        <div className="inset rounded-lg p-3">
          <div className="text-[11px] text-gray-400">ความเร็วดาวน์โหลด</div>
          <div className="text-xl font-bold text-sky-400">{d.lastSpeedtest ? `${d.lastSpeedtest.mbps}` : "—"}<span className="text-xs text-gray-500 font-normal"> Mbps</span></div>
          <div className="text-[10px] text-gray-500">{d.lastSpeedtest ? new Date(d.lastSpeedtest.at).toLocaleTimeString("th-TH") : "ยังไม่วัด"}</div>
        </div>
      </div>

      {d.lanDevices && d.lanDevices.length > 0 && (
        <div className="text-[11px] text-gray-500 flex flex-wrap gap-1.5">
          {d.lanDevices.map((dev) => (
            <span key={dev.ip} className="px-2 py-0.5 rounded bg-gray-950/70 border border-gray-800">{dev.ip} · {dev.latencyMs}ms</span>
          ))}
        </div>
      )}
      <p className="text-[10px] text-gray-600">ตรวจ router ทุก 60 วิ · สแกนอุปกรณ์ทุก 5 นาที · speedtest ทุก 30 นาที — เตือน Telegram เมื่อหลุด/เจออุปกรณ์ใหม่</p>
    </section>
  );
}
