"use client";
import { useCallback, useEffect, useState } from "react";
import Sidebar from "../components/layout/Sidebar";
import PageHeader from "../components/ui/PageHeader";
import Icon from "../components/ui/Icon";
import FleetPolicyPanel from "../components/fleet/FleetPolicyPanel";
import FleetEnrollmentPanel from "../components/fleet/FleetEnrollmentPanel";
import FleetMachinesTable from "../components/fleet/FleetMachinesTable";
import { authFetch } from "../lib/apiFetch";
import { getApiUrl } from "../lib/config";
import { useAuthStore } from "../stores/useAuthStore";
import {
  fmtDate,
  type Channel,
  type EnrollToken,
  type FleetMachine,
  type FleetOverview,
  type FleetPolicyView,
  type MachineOverrideInput,
} from "../lib/fleetTypes";

/**
 * Fleet Console — ศูนย์ควบคุมเครื่องหลายเครื่องสำหรับองค์กร
 *
 * หน้านี้เป็น "ห้องควบคุม" ไม่ใช่หน้าคุมจอทีละเครื่อง:
 *   • ภาพรวม compliance ของทุกเครื่อง (ออนไลน์/ออฟไลน์/ต้องอัปเดต/ถูกกัก)
 *   • ช่องทางอัปเดต stable / beta / canary + rollout %
 *   • site / group / tags ต่อเครื่อง (สำหรับหลายสาขา)
 *   • รหัสเชิญแบบมีวันหมดอายุ/จำนวนเครื่อง/เพิกถอนได้
 *   • หมุน machine token เมื่อสงสัยว่าคีย์รั่ว
 *
 * ทุก endpoint เป็น SUPERADMIN เท่านั้น — ถ้า API ยังไม่ถูกโหลด (404)
 * หน้าาจะบอกตรง ๆ ว่าให้ restart core-api หลัง Cold Soak ไม่ใช่เงียบ ๆ
 */

function Stat({
  label,
  value,
  detail,
  tone = "text-gray-100",
}: {
  label: string;
  value: number | string;
  detail?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
      {detail && <div className="mt-0.5 text-xs text-gray-500">{detail}</div>}
    </div>
  );
}

export default function FleetPage() {
  const API = getApiUrl();
  const { isHydrated, isAuthenticated } = useAuthStore();

  const [overview, setOverview] = useState<FleetOverview | null>(null);
  const [tokens, setTokens] = useState<EnrollToken[]>([]);
  const [policyDraft, setPolicyDraft] = useState<FleetPolicyView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [oneTime, setOneTime] = useState<{ title: string; token: string; note: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyMachine, setBusyMachine] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ovRes, tokRes] = await Promise.all([
        authFetch(`${API}/api/fleet/overview`),
        authFetch(`${API}/api/fleet/enroll-tokens`),
      ]);

      if (ovRes.status === 404 || tokRes.status === 404) {
        setError("API /api/fleet ยังไม่ถูกโหลดบน HUB — โค้ดพร้อมแล้วแต่ยังไม่ restart core-api (ทำได้หลัง Cold Soak)");
        return;
      }
      if (ovRes.status === 403 || tokRes.status === 403) {
        setError("หน้านี้ต้องล็อกอินเป็น SUPERADMIN");
        return;
      }
      if (!ovRes.ok) throw new Error(`overview HTTP ${ovRes.status}`);
      if (!tokRes.ok) throw new Error(`enroll-tokens HTTP ${tokRes.status}`);

      const ov = (await ovRes.json()) as FleetOverview;
      const tk = (await tokRes.json()) as { tokens?: EnrollToken[] };
      setOverview(ov);
      setPolicyDraft({ ...ov.policy });
      setTokens(tk.tokens ?? []);
    } catch (err) {
      setError(`โหลดข้อมูลฝูงเครื่องไม่สำเร็จ: ${String((err as Error)?.message || err)}`);
    } finally {
      setLoading(false);
    }
  }, [API]);

  useEffect(() => {
    if (isAuthenticated) void load();
  }, [isAuthenticated, load]);

  async function savePolicy() {
    if (!policyDraft) return;
    setSavingPolicy(true);
    setError("");
    try {
      const res = await authFetch(`${API}/api/fleet/policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultChannel: policyDraft.defaultChannel,
          requireLanVerification: policyDraft.requireLanVerification,
          channels: {
            stable: { rolloutPercent: policyDraft.channels.stable.rolloutPercent },
            beta: { rolloutPercent: policyDraft.channels.beta.rolloutPercent },
            canary: { rolloutPercent: policyDraft.channels.canary.rolloutPercent },
          },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(`บันทึกนโยบายไม่สำเร็จ: ${String((err as Error)?.message || err)}`);
    } finally {
      setSavingPolicy(false);
    }
  }

  async function createToken(input: { label: string; maxUses: number; expiresInHours: number }): Promise<boolean> {
    setTokenBusy(true);
    setTokenError("");
    try {
      const res = await authFetch(`${API}/api/fleet/enroll-tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        token?: string;
        tokenRecord?: EnrollToken;
      };
      if (!res.ok || !body.token) throw new Error(body.error || `HTTP ${res.status}`);
      setOneTime({
        title: `รหัสเชิญ: ${body.tokenRecord?.label ?? input.label}`,
        token: body.token,
        note: "คัดลอกไปวางในตัวติดตั้งเครื่องใหม่ — ระบบจะไม่แสดงรหัสนี้ซ้ำอีก",
      });
      await load();
      return true;
    } catch (err) {
      setTokenError(String((err as Error)?.message || err));
      return false;
    } finally {
      setTokenBusy(false);
    }
  }

  async function revokeToken(row: EnrollToken) {
    if (!window.confirm(`เพิกถอนรหัส "${row.label}"? เครื่องที่ยังไม่ติดตั้งจะใช้รหัสนี้ไม่ได้อีก`)) return;
    setTokenBusy(true);
    setTokenError("");
    try {
      const res = await authFetch(`${API}/api/fleet/enroll-tokens/${row.id}/revoke`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setTokenError(String((err as Error)?.message || err));
    } finally {
      setTokenBusy(false);
    }
  }

  async function changeChannel(machine: FleetMachine, channel: Channel) {
    setBusyMachine(machine.id);
    setError("");
    try {
      const res = await authFetch(`${API}/api/fleet/machines/${machine.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(`เปลี่ยนช่องทางไม่สำเร็จ: ${String((err as Error)?.message || err)}`);
    } finally {
      setBusyMachine("");
    }
  }

  async function saveOverride(machine: FleetMachine, input: MachineOverrideInput): Promise<boolean> {
    setBusyMachine(machine.id);
    setError("");
    try {
      const res = await authFetch(`${API}/api/fleet/machines/${machine.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await load();
      return true;
    } catch (err) {
      setError(`บันทึกข้อมูลเครื่องไม่สำเร็จ: ${String((err as Error)?.message || err)}`);
      return false;
    } finally {
      setBusyMachine("");
    }
  }

  async function rotateToken(machine: FleetMachine) {
    if (
      !window.confirm(
        `หมุน token ของ "${machine.name}"? token เดิมจะใช้ไม่ได้ทันที และเครื่องนั้นจะหลุดจาก HUB จนกว่าจะตั้งค่าใหม่`,
      )
    ) {
      return;
    }
    setBusyMachine(machine.id);
    setError("");
    try {
      const res = await authFetch(`${API}/api/fleet/machines/${machine.id}/rotate-token`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string; token?: string };
      if (!res.ok || !body.token) throw new Error(body.error || `HTTP ${res.status}`);
      setOneTime({
        title: `token ใหม่ของ ${machine.name}`,
        token: body.token,
        note: "ตั้งค่าบนเครื่องนั้นทันที — token เดิมถูกเพิกถอนแล้ว",
      });
      await load();
    } catch (err) {
      setError(`หมุน token ไม่สำเร็จ: ${String((err as Error)?.message || err)}`);
    } finally {
      setBusyMachine("");
    }
  }

  async function copyOneTime() {
    if (!oneTime) return;
    try {
      await navigator.clipboard.writeText(oneTime.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">กำลังโหลด...</div>;
  }
  if (!isAuthenticated) {
    return <div className="min-h-screen bg-gray-950 text-white p-8">Unauthorized</div>;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <main className="flex-1 min-w-0 p-4 md:p-6 space-y-6">
        <PageHeader
          eyebrow="Sovereign OS · Enterprise"
          title="ศูนย์ควบคุมฝูงเครื่อง"
          subtitle="ภาพรวมเครื่องทั้งหมด ช่องทางอัปเดตแบบ staged rollout รหัสเชิญรายสาขา และการหมุน token — ทำงานได้โดยไม่ต้อง migrate DB"
          icon={<Icon name="system" size={18} />}
          actions={
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              {loading ? "กำลังโหลด..." : "รีเฟรช"}
            </button>
          }
        />

        {error && (
          <div className="rounded-xl border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">{error}</div>
        )}

        {oneTime && (
          <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-emerald-200">{oneTime.title}</div>
                <div className="text-xs text-emerald-300/80 mt-0.5">{oneTime.note}</div>
              </div>
              <button
                type="button"
                onClick={() => setOneTime(null)}
                className="rounded border border-emerald-800 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-900/40"
              >
                ปิด
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="flex-1 min-w-[260px] rounded-lg border border-emerald-800/60 bg-gray-950 px-3 py-2 font-mono text-xs text-emerald-200 break-all">
                {oneTime.token}
              </code>
              <button
                type="button"
                onClick={() => void copyOneTime()}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                {copied ? "คัดลอกแล้ว" : "คัดลอก"}
              </button>
            </div>
          </div>
        )}

        {overview ? (
          <>
            <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <Stat label="เครื่องทั้งหมด" value={overview.summary.total} detail={`ออนไลน์ ${overview.summary.online}`} />
              <Stat
                label="ต้องดูแล"
                value={overview.summary.attention}
                detail="ออฟไลน์/ต้องอัปเดต/ถูกกัก"
                tone={overview.summary.attention ? "text-amber-300" : "text-emerald-300"}
              />
              <Stat
                label="มีอัปเดต"
                value={overview.summary.updateAvailable}
                detail={`พร้อมรับ ${overview.summary.updateEligible}`}
                tone={overview.summary.updateAvailable ? "text-amber-300" : "text-gray-100"}
              />
              <Stat
                label="ถูกกัก"
                value={overview.summary.held}
                detail="รอรอบ rollout"
                tone={overview.summary.held ? "text-amber-300" : "text-gray-100"}
              />
              <Stat label="ยังไม่ยืนยัน LAN" value={overview.summary.unverified} detail="ยังคุมเครื่องไม่ได้" />
              <Stat
                label="รหัสเชิญที่ใช้ได้"
                value={overview.enrollment.usable}
                detail={`ทั้งหมด ${overview.enrollment.total} ใบ`}
                tone={overview.enrollment.usable ? "text-emerald-300" : "text-amber-300"}
              />
            </section>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {policyDraft && (
                <FleetPolicyPanel
                  policy={policyDraft}
                  channels={overview.channels}
                  saving={savingPolicy}
                  onChange={setPolicyDraft}
                  onSave={() => void savePolicy()}
                />
              )}
              <FleetEnrollmentPanel
                tokens={tokens}
                busy={tokenBusy}
                error={tokenError}
                onCreate={createToken}
                onRevoke={(row) => void revokeToken(row)}
              />
            </div>

            <FleetMachinesTable
              machines={overview.machines}
              publishedRunnerVersion={overview.published.runner.version}
              busyMachine={busyMachine}
              onChannel={(machine, channel) => void changeChannel(machine, channel)}
              onSaveOverride={saveOverride}
              onRotate={(machine) => void rotateToken(machine)}
            />

            <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4 md:p-5">
                <h2 className="text-sm font-semibold text-gray-100">เวอร์ชันที่เผยแพร่บน HUB</h2>
                <div className="mt-3 space-y-2 text-sm">
                  {[
                    {
                      label: "Runner / agent",
                      row: overview.published.runner,
                      detail: `${overview.published.runner.files} ไฟล์`,
                    },
                    { label: "Desktop app", row: overview.published.desktop, detail: overview.published.desktop.asset ?? "—" },
                    { label: "Node kit", row: overview.published.nodeKit, detail: overview.published.nodeKit.asset ?? "—" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-start justify-between gap-3 rounded-lg border border-gray-800 px-3 py-2"
                    >
                      <div>
                        <div className="text-gray-300">{item.label}</div>
                        <div className="text-[11px] text-gray-600">{item.detail}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-xs text-gray-300">
                          {item.row.published ? item.row.version ?? "—" : "ยังไม่เผยแพร่"}
                        </div>
                        <div className="text-[10px] text-gray-600">{fmtDate(item.row.generatedAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-amber-900/40 bg-amber-950/10 p-4 md:p-5 text-sm text-amber-100/80">
                <h2 className="text-sm font-semibold text-amber-200">หลักปฏิบัติของศูนย์นี้</h2>
                <ul className="mt-2 space-y-1.5 text-xs leading-relaxed list-disc list-inside">
                  <li>การอัปเดตถูกกักตามช่องทางและเปอร์เซ็นต์แบบ deterministic — เครื่องเดิมได้กลุ่มเดิม</li>
                  <li>รหัสเชิญและ machine token แสดงครั้งเดียว — เก็บเฉพาะ hash</li>
                  <li>ทุกการเปลี่ยนนโยบาย/สร้างหรือเพิกถอนรหัส/หมุน token ถูกบันทึกใน audit log</li>
                  <li>เครื่องที่ยังไม่ยืนยัน LAN จะไม่ถูกนับว่าพร้อม แม้ heartbeat จะสด</li>
                  <li>หน้านี้ยังไม่เห็นบนเครื่องที่เสิร์ฟ :3000 จนกว่าจะ rebuild หลัง Cold Soak</li>
                </ul>
              </div>
            </section>
          </>
        ) : (
          !loading &&
          !error && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-6 text-sm text-gray-400">
              ยังไม่มีข้อมูล
            </div>
          )
        )}
      </main>
    </div>
  );
}
