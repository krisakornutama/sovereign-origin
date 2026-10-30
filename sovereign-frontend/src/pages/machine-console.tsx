"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import Sidebar from "../components/layout/Sidebar";
import PageHeader from "../components/ui/PageHeader";
import StatusPill from "../components/ui/StatusPill";
import ScreenPanel from "../components/machine-console/ScreenPanel";
import FilePanel from "../components/machine-console/FilePanel";
import AccessPanel from "../components/machine-console/AccessPanel";
import { authFetch } from "../lib/apiFetch";
import { getApiUrl } from "../lib/config";
import { useIsSuperadmin } from "../lib/roles";
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
  /** ผู้ใช้คนนี้ผูก+ยืนยันเครื่องนี้แล้วหรือยัง — คุมได้จริงเฉพาะเมื่อ true (HUB คิดให้) */
  controllable?: boolean;
  /** เวลายืนยัน LAN (มีค่า = เครื่องนี้ผ่านการกดยืนยันที่ตัวเครื่องแล้ว) */
  lan_confirmed_at?: string | null;
}

/** สะพานของแอปเดสก์ท็อป (Electron) — ไม่มีในเบราว์เซอร์ธรรมดา */
type DesktopBridge = {
  openRemoteWindow?: (opts: {
    machineId: string;
    machineName?: string;
  }) => Promise<{ ok?: boolean; message?: string }> | void;
  /** ปักหมุดหน้าต่างปัจจุบันบนสุด (Electron) — ใช้ในหน้าต่างรีโมทแยก */
  setRemoteAlwaysOnTop?: (value: boolean) => Promise<{ ok?: boolean; alwaysOnTop?: boolean; message?: string }>;
};

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
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  // หน้านี้สั่งเครื่องอื่นได้ทั้งเครื่อง ⇒ SUPERADMIN เท่านั้น (HUB เป็นด่านจริงอยู่แล้ว
  // — ด่านนี้กันการเปิดรายชื่อเครื่อง/ปุ่มควบคุมให้คนที่ไม่มีสิทธิ์เห็น)
  const isSuperadmin = useIsSuperadmin();
  const control = useMachineControl();

  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("screen");
  /** มาจากลิงก์ "ควบคุมเครื่องนี้" ของหน้า Agent Queue → เปิดจอให้เองเลย ไม่ต้องกดซ้ำ */
  const [autoOpenScreen, setAutoOpenScreen] = useState(false);
  /** ปักหมุดหน้าต่างรีโมทบนสุด (เฉพาะหน้าต่างแยกในเดสก์ท็อป) */
  const [pinned, setPinned] = useState(false);
  /** machineId ที่มากับ URL — ใช้ตอนโหลดรอบแรกก่อน router พร้อม */
  const wantedRef = useRef("");
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
      if (!isSuperadmin) {
        setError("หน้านี้ใช้ได้เฉพาะผู้ใช้ระดับ SUPERADMIN");
        setLoading(false);
        return;
      }
      // เดิมใช้ /mine อย่างเดียว ⇒ เครื่องที่ยังไม่ได้ผูกกับบัญชีนี้ "หายไปจากทั้งหน้า"
      // ทั้งที่มันอยู่ในระบบและขึ้นใน Agent Queue (เจอจริง 30/10/69: เครื่อง 2 ผูกกับบัญชีเทสต์
      // คนเดียว คอนโซลจึงว่างเปล่า เหลือแต่หน้าสั่งงาน)
      // ตอนนี้: เห็นเครื่องทั้งหมดที่ลงทะเบียน + รู้ว่าคุมได้จริงหรือยัง ⇒ มีปุ่มผูกให้กดในหน้าเดียว
      const [allRes, mineRes] = await Promise.all([
        authFetch(`${API}/api/agent-machines`),
        authFetch(`${API}/api/agent-machines/mine`),
      ]);
      if (!allRes.ok) {
        setError(`โหลดรายการเครื่องไม่สำเร็จ (HTTP ${allRes.status})`);
        setLoading(false);
        return;
      }
      const allData = (await allRes.json()) as { machines?: MachineRow[] };
      const mineData = mineRes.ok ? ((await mineRes.json()) as { machines?: MachineRow[] }) : { machines: [] };
      const mineById = new Map((mineData.machines ?? []).map((m) => [m.id, m]));
      const merged: MachineRow[] = (allData.machines ?? []).map((m) => {
        const own = mineById.get(m.id);
        return {
          ...m,
          ...(own ?? {}),
          // "คุมได้" = ผูกกับผู้ใช้คนนี้ + ยืนยัน LAN แล้ว (ค่าเดียวกับด่านฝั่ง HUB)
          controllable: mineById.has(m.id),
          lanVerified: own?.lanVerified ?? m.lan_confirmed_at != null,
        };
      });
      // เผื่อ /mine คืนเครื่องที่ /all ไม่มี (ไม่ควรเกิด แต่ต้องไม่ทำเครื่องหาย)
      for (const own of mineData.machines ?? []) {
        if (!merged.some((m) => m.id === own.id)) merged.push({ ...own, controllable: true });
      }
      setMachines(merged);
      setActiveId((cur) => {
        if (cur && merged.some((m) => m.id === cur)) return cur;
        const wanted = wantedRef.current;
        if (wanted && merged.some((m) => m.id === wanted)) return wanted;
        // ค่าเริ่มต้น: เครื่องที่พร้อมควบคุมและออนไลน์ก่อน — ไม่ใช่เครื่องแรกที่บังเอิญอยู่ในลิสต์
        const pick =
          merged.find((m) => m.controllable && m.status === "online") ??
          merged.find((m) => m.controllable) ??
          merged.find((m) => m.status === "online") ??
          merged[0];
        return pick?.id ?? null;
      });
      setError("");
    } catch (err) {
      setError(String((err as Error)?.message || err));
    } finally {
      setLoading(false);
    }
  }, [API, isSuperadmin]);

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

  /** ผูกเครื่องนี้ให้อยู่ใต้ผู้ใช้คนนี้ — ผูกแล้วเปิดจอให้ต่อทันทีถ้าเครื่องผ่าน LAN แล้ว */
  const link = useCallback(
    async (machineId: string) => {
      setAccessBusy(true);
      setAccessNote("");
      const err = await callAccess(`/api/agent-machines/${machineId}/link`, { method: "POST" });
      setAccessNote(err || "ผูกเครื่องนี้กับคุณแล้ว");
      setAccessBusy(false);
      if (!err) setAutoOpenScreen(true);
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

  // ── ลิงก์ตรงจาก "เครื่องที่ลงทะเบียน": /machine-console?machine=<id>&tab=screen ──
  // ต้องรอ router พร้อมก่อน (static export) ไม่งั้น query ว่างแล้วเลือกเครื่องผิดตัว
  useEffect(() => {
    if (!router.isReady) return;
    const qm = typeof router.query.machine === "string" ? router.query.machine : "";
    const qt = typeof router.query.tab === "string" ? router.query.tab : "";
    if (qm) {
      wantedRef.current = qm;
      setActiveId(qm);
      setAutoOpenScreen(true);
      if (qt !== "files" && qt !== "access") setTab("screen");
    }
    if (qt === "files" || qt === "access" || qt === "screen") setTab(qt);
  }, [router.isReady, router.query.machine, router.query.tab]);

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
  /** เครื่องที่ผูกกับบัญชีนี้ + ยืนยัน LAN แล้ว — ค่าเดียวกับด่านของ HUB */
  const canControl = active?.controllable === true;
  const readyCount = machines.filter((m) => m.controllable).length;
  /** ในแอปเดสก์ท็อปมีสะพานเปิดหน้าต่างรีโมทแยกได้ (เบราว์เซอร์ไม่มี) */
  const desktop = typeof window !== "undefined" ? (window as Window & { sovereign?: DesktopBridge }).sovereign : undefined;
  /** หน้าต่างรีโมทแยกจาก Electron — ตัดเมนู/รายการเครื่องออกให้จอใหญ่ที่สุด */
  const popout = router.query.popout === "1";

  /** ปักหมุด/ยกเลิกปักหมุดหน้าต่างรีโมทบนสุด (desktop เท่านั้น) */
  const togglePin = () => {
    if (!desktop?.setRemoteAlwaysOnTop) return;
    const next = !pinned;
    Promise.resolve(desktop.setRemoteAlwaysOnTop(next))
      .then((r) => {
        if (r?.ok) setPinned(r.alwaysOnTop ?? next);
        else if (r?.message) setUpdateError(r.message);
      })
      .catch((e) => setUpdateError(String((e as Error)?.message || e)));
  };

  /** เปิดจอเครื่องนี้ในหน้าต่างแยก — ย้ายไปจอที่สอง/วางข้างงานอื่นได้ */
  const openRemoteWindow = () => {
    if (!active || !desktop?.openRemoteWindow) return;
    setUpdateError("");
    Promise.resolve(desktop.openRemoteWindow({ machineId: active.id, machineName: active.name }))
      .then((r) => {
        if (r && r.ok === false) setUpdateError(r.message || "เปิดหน้าต่างรีโมทไม่สำเร็จ");
      })
      .catch((e) => setUpdateError(String((e as Error)?.message || e)));
  };

  return (
    <div className={popout ? "" : "flex"}>
      {popout ? null : <Sidebar />}
      <main className={popout ? "p-3 space-y-3" : "p-6 space-y-6"}>
        {popout ? null : (
          <PageHeader
            eyebrow="ระบบ"
            title="คอนโซลเครื่อง"
            subtitle="เลือกเครื่องในเครือข่าย แล้วดูจอ ควบคุม หรือจัดการไฟล์จากที่เดียว"
          />
        )}

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
        <div className={popout ? "hidden" : "flex flex-wrap items-center gap-3 rounded border border-gray-800 bg-gray-900/30 px-3 py-2"}>
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

        <div className={popout ? "grid gap-3" : "grid gap-4 lg:grid-cols-[280px_1fr]"}>
          {/* เลือกเครื่อง */}
          <aside className={popout ? "hidden" : "space-y-2"}>
            <div className="flex items-baseline justify-between">
              <h2 className="text-xs uppercase tracking-wide text-gray-500">เครื่องที่ลงทะเบียน</h2>
              <span className="text-[11px] text-gray-500">
                พร้อมควบคุม {readyCount}/{machines.length}
              </span>
            </div>
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
                      {m.controllable ? (
                        <span className="ml-auto shrink-0 rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300">
                          คุมได้
                        </span>
                      ) : (
                        <span className="ml-auto shrink-0 rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-300">
                          ยังไม่ผูก
                        </span>
                      )}
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
                    {popout && desktop?.setRemoteAlwaysOnTop ? (
                      <button
                        type="button"
                        onClick={togglePin}
                        className={`rounded border px-3 py-1 text-sm ${
                          pinned
                            ? "border-amber-600 bg-amber-900/30 text-amber-200"
                            : "border-gray-700 text-gray-300"
                        }`}
                        title="ปักหมุดหน้าต่างนี้ให้อยู่บนสุด"
                      >
                        {pinned ? "📌 ปักหมุดอยู่" : "📌 ปักหมุดบนสุด"}
                      </button>
                    ) : null}
                    {desktop?.openRemoteWindow && canControl ? (
                      <button
                        type="button"
                        onClick={openRemoteWindow}
                        className="rounded border border-cyan-800 px-3 py-1 text-sm text-cyan-300"
                        title="เปิดจอเครื่องนี้ในหน้าต่างแยก (ย้ายไปจอที่สองได้)"
                      >
                        ⤢ เปิดหน้าต่างแยก
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busyType !== "" || !canControl}
                      title={canControl ? undefined : "ต้องผูกเครื่องนี้กับบัญชีคุณก่อน"}
                      onClick={() => void sendUpdate("update.check", active.id, active.name)}
                      className="rounded border border-gray-700 px-3 py-1 text-sm text-gray-300 disabled:opacity-50"
                    >
                      {busyType === "update.check" ? "กำลังตรวจ…" : "ตรวจเวอร์ชัน"}
                    </button>
                    <button
                      type="button"
                      disabled={busyType !== "" || !canControl}
                      title={canControl ? undefined : "ต้องผูกเครื่องนี้กับบัญชีคุณก่อน"}
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
                  canControl ? (
                    <ScreenPanel
                      machineId={active.id}
                      machineName={active.name}
                      control={control}
                      autoJoin={autoOpenScreen}
                    />
                  ) : (
                    /* เครื่องนี้ยังไม่ได้ผูกกับบัญชีนี้ — HUB กันไว้ไม่ให้คุมเครื่องคนอื่น
                       จึงต้องอธิบายให้เห็นทางออกในที่เดียว ไม่ใช่ปล่อยให้กดแล้วล้มเหลวเงียบ ๆ */
                    <div className="space-y-3 rounded-lg border border-amber-900/50 bg-amber-900/10 p-5">
                      <h3 className="text-base text-white">ยังควบคุมเครื่องนี้ไม่ได้</h3>
                      <p className="text-sm text-gray-300">
                        เครื่อง <span className="text-white">{active.name}</span> ลงทะเบียนอยู่
                        {active.status === "online" ? " และออนไลน์" : " แต่ตอนนี้ออฟไลน์"} — แต่ยังไม่ได้ผูกกับบัญชีของคุณ
                      </p>
                      {active.lanVerified ? (
                        <p className="text-xs text-emerald-300">
                          เครื่องนี้ผ่านการยืนยัน LAN แล้ว — ผูกแล้วควบคุมได้ทันที
                        </p>
                      ) : (
                        <p className="text-xs text-amber-300">
                          เครื่องนี้ยังไม่ยืนยัน LAN — ต้องกดยืนยันที่ตัวเครื่องก่อน (ขอรหัสคู่ในแท็บ “สิทธิ์ควบคุม”)
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={accessBusy}
                          onClick={() => void link(active.id)}
                          className="rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                        >
                          ผูกเครื่องนี้กับฉัน
                        </button>
                        <button
                          type="button"
                          onClick={() => setTab("access")}
                          className="rounded border border-gray-700 px-4 py-2 text-sm text-gray-300"
                        >
                          ไปที่สิทธิ์ควบคุม
                        </button>
                      </div>
                      {accessNote ? <p className="text-xs text-amber-300">{accessNote}</p> : null}
                    </div>
                  )
                ) : tab === "access" ? (
                  /* ── สิทธิ์ควบคุม — แยกเป็น component เพราะเพดานบรรทัดของ pages คือ 800 ── */
                  <AccessPanel
                    machine={active}
                    busy={accessBusy}
                    note={accessNote}
                    pairCode={pairCode}
                    pairInput={pairInput}
                    onPairInput={setPairInput}
                    onSetRole={(id, role) => void setRole(id, role)}
                    onStartPairing={(id) => void startPairing(id)}
                    onConfirmPairing={(id, approve) => void confirmPairing(id, approve)}
                    onLink={(id) => void link(id)}
                    onUnlink={(id) => void unlink(id)}
                  />
                ) : (
                  <FilePanel machineId={active.id} control={control} />
                )}
              </>
            )}
          </section>
        </div>

        {popout ? null : (
          <p className="rounded border border-amber-900/50 bg-amber-900/10 px-3 py-2 text-xs text-amber-300">
            ช่องนี้สั่งเมาส์/คีย์บอร์ด/ไฟล์ของเครื่องปลายทางได้จริง — เปิดให้เฉพาะผู้ใช้ระดับ SUPERADMIN
            และทุกคำสั่งที่เปลี่ยนไฟล์/เปิด-ปิดการควบคุมจะถูกบันทึกไว้ใน audit log
          </p>
        )}
      </main>
    </div>
  );
}
