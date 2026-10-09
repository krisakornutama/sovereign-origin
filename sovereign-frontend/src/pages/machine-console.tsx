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
}

type Tab = "screen" | "files";

export default function MachineConsolePage() {
  const API = getApiUrl();
  const { isAuthenticated } = useAuthStore();
  const control = useMachineControl();

  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("screen");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/api/agent-machines`);
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
      <div>
        <Sidebar />
        <main className="p-6 text-gray-400">กรุณาเข้าสู่ระบบก่อน</main>
      </div>
    );
  }

  const active = machines.find((m) => m.id === activeId) ?? null;

  return (
    <div>
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
              {machines.map((m) => (
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
                      <span
                        className={`h-2 w-2 rounded-full ${m.status === "online" ? "bg-emerald-400" : "bg-gray-600"}`}
                      />
                      <span className="truncate">{m.name}</span>
                    </span>
                    {m.last_heartbeat ? (
                      <span className="mt-0.5 block truncate text-xs text-gray-500">
                        ครั้งสุดท้าย {new Date(m.last_heartbeat).toLocaleString("th-TH")}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
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
                  {(["screen", "files"] as Tab[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={`rounded px-3 py-1 text-sm ${
                        tab === t ? "bg-emerald-600 text-white" : "border border-gray-700 text-gray-300"
                      }`}
                    >
                      {t === "screen" ? "จอ" : "ไฟล์"}
                    </button>
                  ))}
                  <span className="ml-auto text-xs text-gray-500">
                    สั่งงาน AI ให้เครื่องนี้ → หน้า Agent Queue
                  </span>
                </div>

                {tab === "screen" ? (
                  <ScreenPanel machineId={active.id} machineName={active.name} control={control} />
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
