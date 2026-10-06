"use client";
import { useState, useEffect, useCallback } from "react";
import Sidebar from "../components/layout/Sidebar";
import PageHeader from "../components/ui/PageHeader";
import StatCard from "../components/ui/StatCard";
import StatusPill from "../components/ui/StatusPill";
import Icon from "../components/ui/Icon";
import { authFetch } from "../lib/apiFetch";
import { useAuthStore } from "../stores/useAuthStore";

/**
 * Agent Queue — สั่งงานให้ agent บนเครื่องคอมอีกเครื่องทำ
 *
 * หลักการ: โมเดลมาจากผู้ใช้เสมอ (ช่องเลือกเอง) — หน้านี้ไม่ตั้งค่าโมเดลแทน
 * และงานที่ระบบจัดว่าเสี่ยงจะถูกพักรอกดใน Telegram ไม่วิ่งเข้าเครื่องทันที
 */

interface QueueRow {
  id: string;
  roleName: string;
  prompt: string;
  status: string;
  priority: number;
  machineId: string | null;
  machineName: string;
  executor: string | null;
  model: string | null;
  risk: string | null;
  result: string | null;
  error: string | null;
  exitCode: number | null;
  logTail: string | null;
  screenshotUrl: string | null;
  createdAt: string | null;
  canCancel: boolean;
}

interface MachineRow {
  id: string;
  name: string;
  os?: string;
  status?: string;
  executors?: unknown;
  last_heartbeat?: string | null;
}

interface Stats {
  queued: number;
  running: number;
  awaitingApproval: number;
  done: number;
  error: number;
  total: number;
}

interface CallStatus {
  provider: string;
  enabled: boolean;
  blandReady: boolean;
  twilioReady: boolean;
  /** มีเบอร์ให้โทรแล้วหรือยัง — ไม่มี = เปิด provider แล้วก็โทรไม่ออก */
  hasPhone: boolean;
  phoneMasked: string;
}

const API = process.env.NEXT_PUBLIC_API_URL;

/** executor ที่ระบบรองรับ — ตรงกับฝั่ง runner */
const EXECUTORS = ["opencode", "freebuff", "echo"] as const;

const STATUS_META: Record<string, { label: string; variant: "ok" | "warn" | "err" | "off" }> = {
  queued: { label: "รอคิว", variant: "off" },
  running: { label: "กำลังรัน", variant: "warn" },
  awaiting_approval: { label: "รออนุมัติ", variant: "warn" },
  done: { label: "เสร็จ", variant: "ok" },
  error: { label: "ล้มเหลว", variant: "err" },
  cancelled: { label: "ยกเลิก", variant: "off" },
};

const emptyForm = {
  prompt: "",
  machineId: "",
  executor: "opencode",
  model: "",
  agent: "",
  workspace: "",
  priority: 0,
  risk: "" as "" | "low" | "high",
};

export default function AgentQueuePage() {
  const { isAuthenticated, isHydrated } = useAuthStore();
  const [jobs, setJobs] = useState<QueueRow[]>([]);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [callStatus, setCallStatus] = useState<CallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [registerName, setRegisterName] = useState("");
  const [registerToken, setRegisterToken] = useState("");
  const [phoneInput, setPhoneInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [queueRes, machineRes, callRes] = await Promise.all([
        authFetch(`${API}/api/agent-machines/queue?limit=100`),
        authFetch(`${API}/api/agent-machines`),
        authFetch(`${API}/api/agent-machines/call-status`),
      ]);
      if (!queueRes.ok) throw new Error(`HTTP ${queueRes.status}`);
      const queue = await queueRes.json();
      setJobs(queue.jobs ?? []);
      setStats(queue.stats ?? null);
      if (machineRes.ok) {
        const m = await machineRes.json();
        setMachines(m.machines ?? []);
      }
      if (callRes.ok) setCallStatus(await callRes.json());
    } catch (e: any) {
      setError(e.message || "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) void load();
  }, [isAuthenticated, load]);

  // ดึงใหม่ทุก 5 วินาที — งานบนเครื่องอีกเครื่องรายงานผลเข้ามาตลอด
  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [isAuthenticated, load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.prompt.trim()) return setError("กรอกงานที่ต้องการสั่ง");
    if (!form.machineId) return setError("เลือกเครื่องที่จะทำงาน");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await authFetch(`${API}/api/agent-machines/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machineId: form.machineId,
          executor: form.executor,
          prompt: form.prompt.trim(),
          model: form.model.trim() || null,
          agent: form.agent.trim() || null,
          workspace: form.workspace.trim() || null,
          priority: Number(form.priority) || 0,
          risk: form.risk || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setMessage(
        body.needsApproval
          ? "งานนี้ถูกจัดว่าเสี่ยง — รอกดอนุมัติใน Telegram"
          : "ส่งเข้าคิวแล้ว เครื่องจะหยิบไปทำ"
      );
      setForm(emptyForm);
      await load();
    } catch (e: any) {
      setError(e.message || "ส่งงานไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: "cancel" | "repeat") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await authFetch(`${API}/api/agent-machines/queue/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setMessage(action === "cancel" ? "ยกเลิกงานแล้ว" : "เพิ่มงานซ้ำลงคิวแล้ว");
      await load();
    } catch (e: any) {
      setError(e.message || "ทำรายการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function registerMachine(e: React.FormEvent) {
    e.preventDefault();
    if (!registerName.trim()) return setError("กรอกชื่อเครื่อง");
    setBusy(true);
    setError("");
    try {
      const res = await authFetch(`${API}/api/agent-machines/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: registerName.trim(), executors: EXECUTORS }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      // token โชว์ครั้งเดียว — ผู้ใช้เอาไปใส่ในเครื่องนั้น
      setRegisterToken(String(body.token || ""));
      setRegisterName("");
      await load();
    } catch (e: any) {
      setError(e.message || "ลงทะเบียนไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function savePhone(e: React.FormEvent) {
    e.preventDefault();
    if (!phoneInput.trim()) return setError("กรอกเบอร์โทรก่อนบันทึก");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await authFetch(`${API}/api/agent-machines/call-phone`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneInput.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setMessage(`บันทึกเบอร์แล้ว (${body.phoneMasked}) — กดทดสอบโทรได้เลย`);
      setPhoneInput("");
      await load();
    } catch (e: any) {
      setError(e.message || "บันทึกเบอร์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function clearPhone() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await authFetch(`${API}/api/agent-machines/call-phone`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setMessage(body.hasPhone ? "ลบ override แล้ว — ยังใช้เบอร์จาก env อยู่" : "ลบเบอร์แล้ว");
      await load();
    } catch (e: any) {
      setError(e.message || "ลบเบอร์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function testCall() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await authFetch(`${API}/api/agent-machines/call-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setMessage(
        body.ok
          ? `กำลังโทรทดสอบผ่าน ${body.provider} — รอรับสาย`
          : `ยังโทรไม่ออก: ${body.reason || "ไม่ทราบสาเหตุ"}`
      );
    } catch (e: any) {
      setError(e.message || "ทดสอบโทรไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function openScreenshot(url: string) {
    setError("");
    try {
      // endpoint ภาพต้องมี JWT — <a href> แนบ header ไม่ได้ จึงดึงเป็น blob แล้วเปิด
      const res = await authFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e: any) {
      setError(e.message || "เปิดภาพหน้าจอไม่สำเร็จ");
    }
  }

  if (!isHydrated) return null;
  if (!isAuthenticated) {
    return (
      <div>
        <Sidebar />
        <main className="p-6 text-gray-400">กรุณาเข้าสู่ระบบก่อน</main>
      </div>
    );
  }

  const onlineCount = machines.filter((m) => m.status === "online").length;

  return (
    <div>
      <Sidebar />
      <main className="p-6 space-y-6">
        <PageHeader
          eyebrow="ระบบ"
          title="Agent Queue"
          subtitle="สั่งงานให้ agent บนเครื่องคอมอีกเครื่องทำ และเฝ้าดูคิวแบบเรียลไทม์"
        />

        {error && <div role="alert" className="rounded-lg border border-rose-800/50 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">{error}</div>}
        {message && <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">{message}</div>}

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          <StatCard label="รอคิว" value={stats?.queued ?? 0} />
          <StatCard label="กำลังรัน" value={stats?.running ?? 0} />
          <StatCard label="รออนุมัติ" value={stats?.awaitingApproval ?? 0} />
          <StatCard label="เสร็จ" value={stats?.done ?? 0} />
          <StatCard label="ล้มเหลว" value={stats?.error ?? 0} />
          <StatCard label="เครื่องออนไลน์" value={`${onlineCount}/${machines.length}`} />
        </div>

        {/* ── เครื่อง ── */}
        <section className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-200">เครื่องที่ลงทะเบียน</h2>
            <button onClick={() => void load()} className="text-xs text-gray-500 hover:text-gray-300">รีเฟรช</button>
          </div>
          {machines.length === 0 ? (
            <p className="text-sm text-gray-500">ยังไม่มีเครื่อง — ลงทะเบียนเครื่องที่จะทำงานด้านล่าง</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {machines.map((m) => (
                <div key={m.id} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-200 truncate">{m.name}</span>
                    <StatusPill
                      variant={m.status === "online" ? "ok" : m.status === "disabled" ? "err" : "off"}
                      label={m.status === "online" ? "ออนไลน์" : m.status === "disabled" ? "ปิดใช้" : "ออฟไลน์"}
                    />
                  </div>
                  <code className="mono mt-2 block truncate text-[11px] text-gray-500" title="id สำหรับ @machine:">{m.id}</code>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={registerMachine} className="flex flex-wrap items-end gap-3 border-t border-gray-800 pt-4">
            <label className="flex-1 min-w-[200px] text-xs text-gray-400">
              ชื่อเครื่องใหม่
              <input
                value={registerName}
                onChange={(e) => setRegisterName(e.target.value)}
                placeholder="เช่น คอมเครื่องที่ 2"
                className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 outline-none focus:border-emerald-600"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md border border-emerald-700/60 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-300 disabled:opacity-50"
            >
              ลงทะเบียนเครื่อง
            </button>
          </form>

          {registerToken && (
            <div className="rounded-lg border border-amber-800/50 bg-amber-950/30 p-3 text-xs text-amber-200">
              <p className="mb-2 font-semibold">token นี้จะแสดงครั้งเดียว — เอาไปใส่ในไฟล์ .env ของเครื่องนั้น</p>
              <code className="mono block break-all rounded bg-black/40 p-2">{registerToken}</code>
            </div>
          )}
        </section>

        {/* ── ระบบโทร ── */}
        <section className="card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-200">ระบบโทรแจ้งเตือน</h2>
            {callStatus && (
              <span className="text-[11px] text-gray-500">
                provider: {callStatus.enabled ? callStatus.provider : "ปิดอยู่"}
                {callStatus.enabled && !callStatus.blandReady && !callStatus.twilioReady && (
                  <span className="text-amber-400"> · ยังไม่มีคีย์ของ provider</span>
                )}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">
            เบอร์นี้คือปลายทางที่ระบบจะโทรหาตอนงานเสร็จ/รออนุมัติ — ต้องเป็นรูปแบบสากล E.164 (เช่น +66812345678)
          </p>

          {callStatus?.hasPhone ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
              <span className="text-sm text-gray-300">
                เบอร์ปัจจุบัน: <code className="mono text-emerald-300">{callStatus.phoneMasked}</code>
              </span>
              <button
                onClick={() => void testCall()}
                disabled={busy}
                className="rounded border border-emerald-700/60 px-3 py-1 text-[11px] text-emerald-300 disabled:opacity-50"
              >
                ทดสอบโทร
              </button>
              <button
                onClick={() => void clearPhone()}
                disabled={busy}
                className="rounded border border-gray-700 px-3 py-1 text-[11px] text-gray-400 hover:border-rose-700 hover:text-rose-300 disabled:opacity-50"
              >
                ลบเบอร์
              </button>
            </div>
          ) : (
            <p className="text-xs text-amber-400">
              ยังไม่ได้ตั้งเบอร์โทร — เปิด CALL_PROVIDER ไว้ก็โทรไม่ออกจนกว่าจะกรอกเบอร์ด้านล่าง
            </p>
          )}

          <form onSubmit={savePhone} className="flex flex-wrap items-end gap-3 border-t border-gray-800 pt-4">
            <label className="flex-1 min-w-[220px] text-xs text-gray-400">
              เบอร์โทรปลายทาง (E.164)
              <input
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="+66812345678"
                className={inputCls}
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md border border-emerald-700/60 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-300 disabled:opacity-50"
            >
              {callStatus?.hasPhone ? "เปลี่ยนเบอร์" : "บันทึกเบอร์"}
            </button>
          </form>
        </section>

        {/* ── สั่งงาน ── */}
        <section className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-200">สั่งงานใหม่</h2>
          <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
            <label className="text-xs text-gray-400 md:col-span-2">
              งานที่ต้องการสั่ง
              <textarea
                value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                rows={3}
                placeholder="เช่น รีเซ็ตฐานข้อมูลแล้วสรุปยอดขายเดือนนี้"
                className="mono mt-1 w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 outline-none focus:border-emerald-600"
              />
            </label>

            <Field label="เครื่อง">
              <select
                value={form.machineId}
                onChange={(e) => setForm({ ...form, machineId: e.target.value })}
                className={inputCls}
              >
                <option value="">— เลือกเครื่อง —</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </Field>

            <Field label="agent">
              <select
                value={form.executor}
                onChange={(e) => setForm({ ...form, executor: e.target.value })}
                className={inputCls}
              >
                {EXECUTORS.map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            </Field>

            <Field label="โมเดล (ผู้ใช้เลือกเอง)">
              <input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="เช่น qwen3:4b หรือ ollama/gemma3"
                className={inputCls}
              />
            </Field>

            <Field label="workspace (ไม่บังคับ)">
              <input
                value={form.workspace}
                onChange={(e) => setForm({ ...form, workspace: e.target.value })}
                placeholder="โฟลเดอร์ที่ให้ agent ทำงาน"
                className={inputCls}
              />
            </Field>

            <Field label="ลำดับความสำคัญ (สูง = ทำก่อน)">
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                className={inputCls}
              />
            </Field>

            <Field label="ความเสี่ยง (ไม่ระบุ = ให้ระบบเดา)">
              <select
                value={form.risk}
                onChange={(e) => setForm({ ...form, risk: e.target.value as "" | "low" | "high" })}
                className={inputCls}
              >
                <option value="">ให้ระบบเดา</option>
                <option value="low">ต่ำ — สั่งได้เลย</option>
                <option value="high">สูง — ต้องรอกด</option>
              </select>
            </Field>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-md border border-emerald-700/60 bg-emerald-950/40 px-5 py-2 text-sm text-emerald-300 disabled:opacity-50"
              >
                {busy ? "กำลังส่ง…" : "ส่งเข้าคิว"}
              </button>
            </div>
          </form>
        </section>

        {/* ── คิว ── */}
        <section className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-200">คิวงาน ({jobs.length})</h2>
            {callStatus && (
              <span className="text-[11px] text-gray-500">
                ระบบโทร: {callStatus.enabled ? callStatus.provider : "ปิดอยู่"}
              </span>
            )}
          </div>

          {loading && jobs.length === 0 ? (
            <p className="text-sm text-gray-500">กำลังโหลด…</p>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-gray-500">ยังไม่มีงานในคิว</p>
          ) : (
            <div className="space-y-2">
              {jobs.map((j) => {
                const meta = STATUS_META[j.status] ?? { label: j.status, variant: "off" as const };
                return (
                  <div key={j.id} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill variant={meta.variant} label={meta.label} />
                      <span className="text-xs text-gray-400">{j.machineName || "HUB"}</span>
                      {j.executor && <span className="text-[11px] text-gray-500">{j.executor}</span>}
                      {j.model && <span className="text-[11px] text-gray-500">{j.model}</span>}
                      {j.priority !== 0 && <span className="text-[11px] text-amber-500">priority {j.priority}</span>}
                      {j.risk === "high" && <span className="text-[11px] text-rose-400">เสี่ยง</span>}
                      <code className="mono ml-auto text-[11px] text-gray-600">{j.id.slice(0, 8)}</code>
                    </div>

                    <p className="mono mt-2 line-clamp-3 text-xs text-gray-300">{j.prompt}</p>

                    {j.error && <p className="mt-1 line-clamp-2 text-[11px] text-rose-400">{j.error}</p>}
                    {!j.error && j.result && <p className="mt-1 line-clamp-2 text-[11px] text-emerald-400">{j.result}</p>}

                    {j.screenshotUrl && (
                      <button
                        onClick={() => void openScreenshot(j.screenshotUrl as string)}
                        className="mt-2 inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline"
                      >
                        <Icon name="external" size={12} /> ดูภาพหน้าจอตอนจบงาน
                      </button>
                    )}

                    {j.logTail && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] text-gray-500 hover:text-gray-300">log ท้าย</summary>
                        <pre className="mono mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-[10px] text-gray-400">{j.logTail}</pre>
                      </details>
                    )}

                    <div className="mt-2 flex gap-2">
                      {j.canCancel && (
                        <button
                          onClick={() => void act(j.id, "cancel")}
                          disabled={busy}
                          className="rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-400 hover:border-rose-700 hover:text-rose-300 disabled:opacity-50"
                        >
                          ยกเลิก
                        </button>
                      )}
                      {j.status === "done" && (
                        <button
                          onClick={() => void act(j.id, "repeat")}
                          disabled={busy}
                          className="rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-400 hover:border-emerald-700 hover:text-emerald-300 disabled:opacity-50"
                        >
                          ทำซ้ำ
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

const inputCls =
  "mono mt-1 w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 outline-none focus:border-emerald-600";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs text-gray-400">
      {label}
      {children}
    </label>
  );
}