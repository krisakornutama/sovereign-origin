"use client";
import { useCallback, useEffect, useState } from "react";
import Sidebar from "../components/layout/Sidebar";
import PageHeader from "../components/ui/PageHeader";
import StatusPill from "../components/ui/StatusPill";
import ScreenPanel from "../components/machine-console/ScreenPanel";
import FilePanel from "../components/machine-console/FilePanel";
import { authFetch } from "../lib/apiFetch";
import { getApiUrl } from "../lib/config";
import { useAuthStore } from "../stores/useAuthStore";
import { useMachineControl } from "../hooks/useMachineControl";

/**
 * Machine Console — คอนโซลรวมสำหรับ "เครื่องในเครือข่าย"
 *
 * รวมความสามารถที่เคยกระจัดกระจายไว้ที่เดียว:
 *   แท็บ "จอ"   → ดูจอสด + ควบคุมเมาส์/คีย์บอร์ด
 *   แท็บ "ไฟล์" → เรียกดู/แก้ไข/ลบไฟล์บนเครื่องนั้น
 * (งาน AI ยังอยู่ที่หน้า Agent Queue — คนละงานกัน แต่ดูเครื่องเดียวกันได้)
 *
 * ต้องล็อกอินเป็น SUPERADMIN — ช่องนี้สั่งการเครื่องอื่นได้ทั้งเครื่อง
 * ถ้าไม่ใช่ จะได้คำตอบจาก HUB ว่าไม่มีสิทธิ์ (ไม่ใช่ซ่อนแล้วเงียบ)
 */

interface MachineRow {
  id: string;
  name: string;
  os?: string;
  status?: string;
  last_heartbeat?: string | null;
  /** IP ที่เครื่องติดต่อเข้ามาล่าสุด (จาก heartbeat — HUB เก็บในหน่วยความจำ) */
  ip?: string | null;
  ipSeenAt?: string | null;
  /** อายุสัญญาณล่าสุดเป็นวินาที — HUB คิดจาก heartbeat จริง (null = ยังไม่เคยส่ง) */
  stale_sec?: number | null;
  // ── สิทธิ์ควบคุม (เพิ่ม 11/10/69) ──
  /** HUB = คุมเครื่องอื่นได้ · USER = รับคำสั่ง + สั่งงาน AI ได้ */
  role?: string;
  /** ผ่านการกดยืนยันบนเครื่องเป้าหมายแล้วหรือยัง (ไม่ยืนยัน = ยังคุมไม่ได้) */
  lanVerified?: boolean;
  /** ผู้ใช้อื่นที่ผูกกับเครื่องนี้ (หลายคนคุมเครื่องเดียวกันได้) */
  hubUserIds?: string[];
}

/** แถวผลการสั่งอัปเดตแบบรวม — อยู่ในตารางเดียวกันกับคอนโซล ไม่ต้องเปิดทีละเครื่อง */
interface BulkRow {
  id: string;
  name: string;
  state: "pending" | "sent" | "failed";
  detail: string;
}

/**
 * สถานะที่คนอ่านออกทันที — เครื่องที่ปิดอยู่ต้องเห็นคำว่า "ออฟไลน์"
 * (เดิมมีแค่จุดสีเทา ผู้ใช้ต้องเดาเอาเองว่าหมายถึงอะไร)
 */
function machineStatusView(m: MachineRow): { label: string; dot: string; tone: string } {
  if (m.status === "online") return { label: "ออนไลน์", dot: "bg-emerald-400", tone: "text-emerald-400" };
  if (m.status === "disabled") return { label: "ปิดใช้งาน", dot: "bg-amber-500", tone: "text-amber-400" };
  if (m.stale_sec == null) return { label: "ออฟไลน์ · ไม่เคยส่งสัญญาณ", dot: "bg-gray-600", tone: "text-gray-500" };
  const mins = Math.round(m.stale_sec / 60);
  return { label: `ออฟไลน์ · เงียบ ${mins} นาที`, dot: "bg-gray-600", tone: "text-gray-500" };
}

type Tab = "screen" | "files" | "access";

export default function MachineConsolePage() {
  const API = getApiUrl();
  const { isAuthenticated } = useAuthStore();
  const control = useMachineControl();

  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("screen");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // สถานะของการ "สั่งอัปเดตจาก HUB" — แยกจาก error ของการโหลดรายการเครื่อง
  const [busyType, setBusyType] = useState("");
  const [updateNote, setUpdateNote] = useState("");
  const [updateError, setUpdateError] = useState("");
  // ── สั่งอัปเดต "ทุกเครื่องที่ออนไลน์" พร้อมกัน (เจ้าของสั่ง 11/10/69) ──────
  // ปุ่มเดียวสั่งทั้งวง LAN แล้วเก็บผลของแต่ละเครื่องไว้ในหน้านี้
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkNote, setBulkNote] = useState("");


  const load = useCallback(async () => {
    try {
      // /mine = เฉพาะเครื่องที่ "ผู้ใช้คนนี้" ผูกไว้และยืนยัน LAN แล้ว (11/10/69)
      // เดิมใช้ /api/agent-machines (ทุกเครื่อง) ⇒ SUPERADMIN คนหนึ่งเห็นและกดเครื่องคนอื่นได้
      const res = await authFetch(`${API}/api/agent-machines/mine`);
      if (!res.ok) {
        setError(`โหลดรายการเครื่องไม่สำเร็จ (HTTP ${res.status})`);
        setLoading(false);
        return;
      }
      const data = (await res.json()) as { machines?: MachineRow[] };
      const list = data.machines ?? [];
      setMachines(list);
      setActiveId((cur) => cur ?? list[0]?.id ?? null);
      setError("");
    } catch (err) {
      setError(String((err as Error)?.message || err));
    } finally {
      setLoading(false);
    }
  }, [API]);

  // ── สิทธิ์ควบคุม (เพิ่ม 11/10/69) ────────────────────────────────────────
  // กติกาที่เจ้าของยืนยัน: เครื่อง USER สั่งงาน AI ได้ แต่คุมเครื่องอื่นไม่ได้
  // · เครื่องอยู่ใต้ผู้ใช้ได้หลายคน · ยืนยัน LAN ต้องกดบนเครื่องเป้าหมาย
  const [pairCode, setPairCode] = useState("");
  const [pairInput, setPairInput] = useState("");
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessNote, setAccessNote] = useState("");

  /** เรียก API สิทธิ์แล้วคืนข้อความพร้อม error ที่อ่านรู้เรื่อง */
  const callAccess = useCallback(
    async (path: string, init?: RequestInit): Promise<string> => {
      const res = await authFetch(`${API}${path}`, {
        method: init?.method ?? "GET",
        headers: { "content-type": "application/json", ...(init?.headers || {}) },
        body: init?.body,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; hint?: string };
      if (!res.ok) return `${data.error || `HTTP ${res.status}`}${data.hint ? ` — ${data.hint}` : ""}`;
      if (data.code) setPairCode(data.code);
      return "";
    },
    [API],
  );

  /** ตั้งบทบาทเครื่อง: HUB = คุมเครื่องอื่นได้ · USER = รับคำสั่ง + สั่งงาน AI ได้ */
  const setRole = useCallback(
    async (machineId: string, role: string) => {
      setAccessBusy(true);
      setAccessNote("");
      const err = await callAccess(`/api/agent-machines/${machineId}/role`, {
        method: "PUT",
        body: JSON.stringify({ role }),
      });
      setAccessNote(err || (role === "HUB" ? "ตั้งเป็น HUB แล้ว — คุมเครื่องอื่นได้" : "ตั้งเป็น USER แล้ว"));
      setAccessBusy(false);
      await load();
    },
    [callAccess, load],
  );

  /** ขอคู่ → ได้รหัส 6 หลักไปพิมพ์ที่เครื่องเป้าหมาย */
  const startPairing = useCallback(
    async (machineId: string) => {
      setAccessBusy(true);
      setAccessNote("");
      setPairCode("");
      const err = await callAccess(`/api/agent-machines/${machineId}/pair`, { method: "POST" });
      setAccessNote(err || "ได้รหัสแล้ว — เอาไปพิมพ์ที่เครื่องเป้าหมาย (รหัสใช้ครั้งเดียว)");
      setAccessBusy(false);
    },
    [callAccess],
  );

  /** ยืนยันด้วยรหัส (ปุ่มบนเครื่องเป้าหมายจะกดตรงนี้) */
  const confirmPairing = useCallback(
    async (machineId: string, approve: boolean) => {
      setAccessBusy(true);
      setAccessNote("");
      const err = await callAccess(`/api/agent-machines/${machineId}/pair/confirm`, {
        method: "POST",
        body: JSON.stringify({ code: pairInput, approve }),
      });
      setAccessNote(err || (approve ? "ยืนยันแล้ว — คุมเครื่องนี้ได้" : "ถอนการยืนยันแล้ว"));
      setPairInput("");
      setAccessBusy(false);
      await load();
    },
    [callAccess, load, pairInput],
  );

  /** ถอดเครื่องออกจากผู้ใช้คนนี้ */
  const unlink = useCallback(
    async (machineId: string) => {
      setAccessBusy(true);
      setAccessNote("");
      const err = await callAccess(`/api/agent-machines/${machineId}/link`, { method: "DELETE" });
      setAccessNote(err || "ถอดเครื่องออกจากคุณแล้ว");
      setAccessBusy(false);
      await load();
    },
    [callAccess, load],
  );

  /** ผูกเครื่องนี้ให้อยู่ใต้ผู้ใช้คนนี้ */
  const link = useCallback(
    async (machineId: string) => {
      setAccessBusy(true);
      setAccessNote("");
      const err = await callAccess(`/api/agent-machines/${machineId}/link`, { method: "POST" });
      setAccessNote(err || "ผูกเครื่องนี้กับคุณแล้ว (ยังต้องยืนยัน LAN ก่อนคุมได้)");
      setAccessBusy(false);
      await load();
    },
    [callAccess, load],
  );


  // ── สั่งอัปเดตโค้ดของเครื่องจาก HUB ──────────────────────────────────────
  // เจ้าของสั่ง 11/10/69: hub ต้องเห็นเครื่อง 2 3 4 พร้อมสั่งให้อัปเดตได้
  // คำสั่งวิ่งผ่านช่องควบคุม (machine-control) ⇒ audit log บันทึกว่าครั้งใดใครสั่งเครื่องไหน
  const sendUpdate = useCallback(
    async (type: "update.check" | "update.apply", machineId: string, machineName: string) => {
      if (type === "update.apply" && typeof window !== "undefined") {
        const ok = window.confirm(`สั่งอัปเดตโค้ดของ "${machineName}" จาก HUB?\nเครื่องจะรีสตาร์ทตัวเองหลังอัปเดตเสร็จ`);
        if (!ok) return;
      }
      setBusyType(type);
      setUpdateNote("");
      setUpdateError("");
      try {
        const res = await authFetch(`${API}/api/machine-control/command`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ machineId, type }),
        });
        const data = (await res.json().catch(() => ({}))) as { command?: { id?: string }; error?: string };
        if (!res.ok) {
          setUpdateError(data?.error || `สั่งไม่สำเร็จ (HTTP ${res.status})`);
          return;
        }
        setUpdateNote(
          type === "update.apply"
            ? `ส่งคำสั่งอัปเดตแล้ว (${data?.command?.id ?? "ไม่ทราบรหัส"}) — เครื่องจะรีสตาร์ทเองเมื่ออัปเดตเสร็จ`
            : `ส่งคำสั่งตรวจเวอร์ชันแล้ว (${data?.command?.id ?? "ไม่ทราบรหัส"}) — ผลจะกลับมาที่ป้ายสถานะของเครื่อง`,
        );
      } catch (err) {
        setUpdateError(String((err as Error)?.message || err));
      } finally {
        setBusyType("");
      }
    },
    [API],
  );

  // ── สั่งอัปเดตทุกเครื่องที่ออนไลน์พร้อมกัน ───────────────────────────────
  // ยิงทีละเครื่องผ่านช่องควบคุมเดิม (ไม่ต้องมี endpoint ใหม่ให้ HUB ต้องรีสตาร์ท)
  // เครื่องที่ปิดอยู่ถูกตัดออกตั้งแต่ต้น — ไม่ส่งคำสั่งไปค้างคิวให้รอเปล่า
  const sendUpdateAll = useCallback(
    async (targets: MachineRow[]) => {
      setUpdateNote("");
      setUpdateError("");
      setBulkNote("");
      if (targets.length === 0) {
        setBulkRows([]);
        setUpdateError("ยังไม่มีเครื่องที่ออนไลน์ให้สั่ง — เครื่องที่ปิดอยู่จะถูกข้าม (ไม่ส่งคำสั่งค้างไว้)");
        return;
      }
      if (typeof window !== "undefined") {
        const list = targets.map((m) => `· ${m.name}`).join("\n");
        const ok = window.confirm(
          `สั่งอัปเดตโค้ด ${targets.length} เครื่องที่ออนไลน์?\n${list}\n\nแต่ละเครื่องจะรีสตาร์ทตัวเองเมื่ออัปเดตเสร็จ`,
        );
        if (!ok) return;
      }
      setBulkBusy(true);
      setBulkRows(targets.map((m) => ({ id: m.id, name: m.name, state: "pending", detail: "กำลังส่งคำสั่ง…" })));
      let sent = 0;
      let failed = 0;
      for (const m of targets) {
        try {
          const res = await authFetch(`${API}/api/machine-control/command`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ machineId: m.id, type: "update.apply" }),
          });
          const data = (await res.json().catch(() => ({}))) as { command?: { id?: string }; error?: string };
          if (res.ok) sent += 1;
          else failed += 1;
          setBulkRows((rows) =>
            rows.map((r): BulkRow =>
              r.id === m.id
                ? res.ok
                  ? { ...r, state: "sent", detail: `ส่งแล้ว · รหัสคำสั่ง ${data?.command?.id ?? "—"}` }
                  : { ...r, state: "failed", detail: data?.error || `HTTP ${res.status}` }
                : r,
            ),
          );
        } catch (err) {
          failed += 1;
          const msg = String((err as Error)?.message || err);
          setBulkRows((rows) => rows.map((r): BulkRow => (r.id === m.id ? { ...r, state: "failed", detail: msg } : r)));
        }
      }
      setBulkBusy(false);
      setBulkNote(
        `ส่งคำสั่งแล้ว ${sent} เครื่อง${failed ? ` · ไม่สำเร็จ ${failed} เครื่อง` : ""} — เครื่องที่รับคำสั่งจะอัปเดตแล้วรีสตาร์ทเอง`,
      );
      void load();
    },
    [API, load],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    void load();
    const timer = setInterval(() => void load(), 20000);
    return () => clearInterval(timer);
  }, [isAuthenticated, load]);

  if (!isAuthenticated) {
    return (
      <div className="flex">
        <Sidebar />
        <main className="p-6 text-gray-400">กรุณาเข้าสู่ระบบก่อน</main>
      </div>
    );
  }

  const active = machines.find((m) => m.id === activeId) ?? null;
  const onlineMachines = machines.filter((m) => m.status === "online");

  return (
    <div className="flex">
      <Sidebar />
      <main className="p-6 space-y-6">
        <PageHeader
          eyebrow="ระบบ"
          title="คอนโซลเครื่อง"
          subtitle="เลือกเครื่องในเครือข่าย แล้วดูจอ ควบคุม หรือจัดการไฟล์จากที่เดียว"
        />

        {/* สถานะช่องเชื่อมต่อ — ผู้ใช้ต้องรู้ทันทีว่าคำสั่งจะไปถึงหรือไม่ */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <StatusPill
            variant={control.connected ? "ok" : "warn"}
            label={control.connected ? "HUB เชื่อมต่อแล้ว" : "ยังไม่เชื่อมต่อ HUB"}
            pulse={control.connected}
          />
          {control.joinedMachine ? <StatusPill variant="ok" label="กำลังดูจอเครื่องที่เลือก" /> : null}
          {control.error ? <span className="text-red-300">{control.error}</span> : null}
        </div>

        {/* ปุ่มเดียวสั่งทั้งวง LAN + ผลรายเครื่องอยู่ในที่เดียว (เจ้าของสั่ง 11/10/69) */}
        <div className="flex flex-wrap items-center gap-3 rounded border border-gray-800 bg-gray-900/30 px-3 py-2">
          <button
            type="button"
            disabled={bulkBusy || onlineMachines.length === 0}
            onClick={() => void sendUpdateAll(onlineMachines)}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {bulkBusy ? "กำลังสั่งทุกเครื่อง…" : `อัปเดตทุกเครื่องที่ออนไลน์ (${onlineMachines.length})`}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-300"
          >
            รีเฟรชรายชื่อ
          </button>
          <span className="text-xs text-gray-500">
            ออนไลน์ {onlineMachines.length}/{machines.length} เครื่อง — เครื่องที่ปิดอยู่จะถูกข้าม
          </span>
        </div>

        {bulkNote ? (
          <p className="rounded bg-emerald-900/20 px-3 py-2 text-xs text-emerald-300">{bulkNote}</p>
        ) : null}

        {bulkRows.length > 0 ? (
          <div className="overflow-hidden rounded border border-gray-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-900/60 text-gray-400">
                <tr>
                  <th className="px-3 py-2 font-medium">เครื่อง</th>
                  <th className="px-3 py-2 font-medium">ผลการสั่งอัปเดต</th>
                  <th className="px-3 py-2 font-medium">รายละเอียด</th>
                </tr>
              </thead>
              <tbody>
                {bulkRows.map((r) => (
                  <tr key={r.id} className="border-t border-gray-800/70">
                    <td className="px-3 py-2 text-gray-200">{r.name}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          r.state === "sent"
                            ? "text-emerald-400"
                            : r.state === "failed"
                              ? "text-red-300"
                              : "text-gray-400"
                        }
                      >
                        {r.state === "sent" ? "ส่งแล้ว" : r.state === "failed" ? "ไม่สำเร็จ" : "กำลังส่ง…"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-400">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {error ? <p className="rounded bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</p> : null}

        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          {/* เลือกเครื่อง */}
          <aside className="space-y-2">
            <h2 className="text-xs uppercase tracking-wide text-gray-500">เครื่องที่ลงทะเบียน</h2>
            {loading ? <p className="text-sm text-gray-500">กำลังโหลด…</p> : null}
            {!loading && machines.length === 0 ? (
              <p className="text-sm text-gray-500">
                ยังไม่มีเครื่อง — ลงทะเบียนได้ที่หน้า Agent Queue แล้วนำ token ไปวางที่เครื่องนั้น
              </p>
            ) : null}
            <ul className="space-y-1">
              {machines.map((m) => {
                const view = machineStatusView(m);
                return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(m.id)}
                    className={`w-full rounded border px-3 py-2 text-left text-sm ${
                      m.id === activeId
                        ? "border-emerald-700 bg-emerald-900/20 text-white"
                        : "border-gray-800 text-gray-300 hover:bg-gray-800/40"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${view.dot}`} />
                      <span className="truncate">{m.name}</span>
                    </span>
                    <span className={`mt-0.5 block truncate text-xs ${view.tone}`}>{view.label}</span>
                    {m.ip ? (
                      <span className="mt-0.5 block truncate text-xs text-emerald-500/80">IP {m.ip}</span>
                    ) : null}
                    {m.last_heartbeat ? (
                      <span className="mt-0.5 block truncate text-xs text-gray-500">
                        ครั้งสุดท้าย {new Date(m.last_heartbeat).toLocaleString("th-TH")}
                      </span>
                    ) : null}
                  </button>
                </li>
                );
              })}
            </ul>
          </aside>

          {/* พื้นที่ทำงานของเครื่องที่เลือก */}
          <section className="space-y-4">
            {!active ? (
              <p className="text-sm text-gray-500">เลือกเครื่องทางซ้ายก่อน</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b border-gray-800 pb-2">
                  <h2 className="mr-2 text-lg text-white">{active.name}</h2>
                  {(["screen", "files", "access"] as Tab[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={`rounded px-3 py-1 text-sm ${
                        tab === t ? "bg-emerald-600 text-white" : "border border-gray-700 text-gray-300"
                      }`}
                    >
                      {t === "screen" ? "จอ" : t === "files" ? "ไฟล์" : "สิทธิ์ควบคุม"}
                    </button>
                  ))}
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busyType !== ""}
                      onClick={() => void sendUpdate("update.check", active.id, active.name)}
                      className="rounded border border-gray-700 px-3 py-1 text-sm text-gray-300 disabled:opacity-50"
                    >
                      {busyType === "update.check" ? "กำลังตรวจ…" : "ตรวจเวอร์ชัน"}
                    </button>
                    <button
                      type="button"
                      disabled={busyType !== ""}
                      onClick={() => void sendUpdate("update.apply", active.id, active.name)}
                      className="rounded bg-emerald-700 px-3 py-1 text-sm text-white disabled:opacity-50"
                    >
                      {busyType === "update.apply" ? "กำลังสั่ง…" : "สั่งอัปเดตจาก HUB"}
                    </button>
                  </span>
                </div>

                {updateNote ? (
                  <p className="rounded bg-emerald-900/20 px-3 py-2 text-xs text-emerald-300">{updateNote}</p>
                ) : null}
                {updateError ? (
                  <p className="rounded bg-red-900/30 px-3 py-2 text-xs text-red-300">{updateError}</p>
                ) : null}

                <p className="text-xs text-gray-500">
                  สั่งงาน AI ให้เครื่องนี้ → หน้า Agent Queue · "สั่งอัปเดตจาก HUB" = คำสั่ง update.apply
                  ผ่านช่องควบคุม (ตรวจก่อนได้ด้วย update.check — ไม่แตะไฟล์)
                </p>

                {tab === "screen" ? (
                  <ScreenPanel machineId={active.id} machineName={active.name} control={control} />
                ) : tab === "access" ? (
                  /* ── สิทธิ์ควบคุม (เจ้าของสั่ง 11/10/69) ──
                     HUB = คุมเครื่องอื่นได้ · USER = รับคำสั่ง + สั่งงาน AI ได้
                     ยืนยัน LAN ต้องกดยืนยันบนเครื่องเป้าหมาย (ดู IP อย่างเดียวไม่พอ) */
                  <div className="space-y-3 text-sm text-gray-300">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-white">บทบาทเครื่อง:</span>
                      <button
                        type="button"
                        disabled={accessBusy || active.role === "HUB"}
                        onClick={() => void setRole(active.id, "HUB")}
                        className="rounded bg-emerald-700 px-3 py-1 text-white disabled:opacity-50"
                      >
                        HUB (คุมเครื่องอื่นได้)
                      </button>
                      <button
                        type="button"
                        disabled={accessBusy || active.role === "USER"}
                        onClick={() => void setRole(active.id, "USER")}
                        className="rounded border border-gray-700 px-3 py-1 disabled:opacity-50"
                      >
                        USER (สั่งงาน AI ได้)
                      </button>
                      <span className="text-xs text-gray-500">
                        ปัจจุบัน: {active.role === "HUB" ? "HUB" : "USER"}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-white">สถานะ LAN:</span>
                      {active.lanVerified ? (
                        <span className="text-emerald-400">ยืนยันแล้ว — คุมเครื่องนี้ได้</span>
                      ) : (
                        <span className="text-amber-400">ยังไม่ยืนยัน — คุมเครื่องนี้ไม่ได้</span>
                      )}
                      <button
                        type="button"
                        disabled={accessBusy}
                        onClick={() => void startPairing(active.id)}
                        className="rounded border border-gray-700 px-3 py-1 disabled:opacity-50"
                      >
                        ขอรหัสคู่
                      </button>
                      <button
                        type="button"
                        disabled={accessBusy}
                        onClick={() => void confirmPairing(active.id, false)}
                        className="rounded border border-gray-700 px-3 py-1 disabled:opacity-50"
                      >
                        ถอนการยืนยัน
                      </button>
                    </div>

                    {pairCode && (
                      <div className="rounded border border-emerald-800 bg-emerald-900/20 px-3 py-2">
                        <div className="text-white">รหัสคู่ (ใช้ครั้งเดียว):</div>
                        <div className="font-mono text-2xl tracking-widest text-emerald-300">{pairCode}</div>
                        <div className="mt-1 text-xs text-gray-400">
                          เอาไปพิมพ์ที่เครื่องเป้าหมาย (หน้าขอคู่ของแอป) แล้วกดยืนยัน — ดู IP อย่างเดียวไม่พอ
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={pairInput}
                        onChange={(e) => setPairInput(e.target.value)}
                        placeholder="พิมพ์รหัส 6 หลัก"
                        inputMode="numeric"
                        maxLength={6}
                        className="w-32 rounded border border-gray-700 bg-black px-2 py-1 text-white"
                      />
                      <button
                        type="button"
                        disabled={accessBusy}
                        onClick={() => void confirmPairing(active.id, true)}
                        className="rounded bg-emerald-700 px-3 py-1 text-white disabled:opacity-50"
                      >
                        ยืนยันด้วยรหัส
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 border-t border-gray-800 pt-2">
                      <span className="text-white">การผูก:</span>
                      {(active.hubUserIds ?? []).length > 0 ? (
                        <>
                          <span className="text-gray-400">
                            ผูกกับผู้ใช้ {active.hubUserIds!.length} คน (หลายคนคุมเครื่องเดียวกันได้)
                          </span>
                          <button
                            type="button"
                            disabled={accessBusy}
                            onClick={() => void unlink(active.id)}
                            className="rounded border border-gray-700 px-3 py-1 disabled:opacity-50"
                          >
                            ถอดผูกของฉัน
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={accessBusy}
                          onClick={() => void link(active.id)}
                          className="rounded border border-gray-700 px-3 py-1 disabled:opacity-50"
                        >
                          ผูกเครื่องนี้กับฉัน
                        </button>
                      )}
                    </div>

                    {accessNote && <div className="text-amber-300">{accessNote}</div>}
                  </div>
                ) : (
                  <FilePanel machineId={active.id} control={control} />
                )}
              </>
            )}
          </section>
        </div>

        <p className="rounded border border-amber-900/50 bg-amber-900/10 px-3 py-2 text-xs text-amber-300">
          ช่องนี้สั่งเมาส์/คีย์บอร์ด/ไฟล์ของเครื่องปลายทางได้จริง — เปิดให้เฉพาะผู้ใช้ระดับ SUPERADMIN
          และทุกคำสั่งที่เปลี่ยนไฟล์/เปิด-ปิดการควบคุมจะถูกบันทึกไว้ใน audit log
        </p>
      </main>
    </div>
  );
}
