"use client";
import { Fragment, useMemo, useState } from "react";
import StatusPill from "../ui/StatusPill";
import {
  CHANNELS,
  CHANNEL_COPY,
  ago,
  complianceView,
  statusView,
  type Channel,
  type Compliance,
  type FleetMachine,
  type MachineOverrideInput,
} from "../../lib/fleetTypes";

/**
 * ตารางเครื่องในฝูง — ค้นหา/กรอง/แก้ site-group-tags/เปลี่ยนช่องทาง/หมุน token
 * แยกจากหน้าเพจเพื่อให้แต่ละไฟล์อยู่ใต้เพดาน 400 บรรทัด
 */
export default function FleetMachinesTable({
  machines,
  publishedRunnerVersion,
  busyMachine,
  onChannel,
  onSaveOverride,
  onRotate,
}: {
  machines: FleetMachine[];
  publishedRunnerVersion: string | null;
  busyMachine: string;
  onChannel: (machine: FleetMachine, channel: Channel) => void;
  onSaveOverride: (machine: FleetMachine, input: MachineOverrideInput) => Promise<boolean>;
  onRotate: (machine: FleetMachine) => void;
}) {
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<"all" | Channel>("all");
  const [complianceFilter, setComplianceFilter] = useState<"all" | Compliance>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ site: "", group: "", tags: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return machines.filter((m) => {
      if (channelFilter !== "all" && m.channel !== channelFilter) return false;
      if (complianceFilter !== "all" && m.compliance !== complianceFilter) return false;
      if (!q) return true;
      return [m.name, m.os, m.site, m.group, m.version, m.role, ...(m.tags ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [machines, search, channelFilter, complianceFilter]);

  function openEdit(machine: FleetMachine) {
    setEditingId(machine.id);
    setForm({
      site: machine.site ?? "",
      group: machine.group ?? "",
      tags: (machine.tags ?? []).join(", "),
      notes: machine.overrideNotes ?? "",
    });
  }

  async function save(machine: FleetMachine) {
    setSaving(true);
    try {
      const tags = form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const ok = await onSaveOverride(machine, {
        site: form.site.trim() || null,
        group: form.group.trim() || null,
        tags: tags.length ? tags : null,
        notes: form.notes.trim() || null,
      });
      if (ok) setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4 md:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-100">เครื่องในฝูง</h2>
          <p className="text-xs text-gray-500 mt-1">
            {filtered.length} จาก {machines.length} เครื่อง · สถานะคำนวณจาก heartbeat จริง
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ / site / version"
            className="w-56 rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-xs text-gray-200 placeholder:text-gray-600"
          />
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value as "all" | Channel)}
            className="rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-300"
          >
            <option value="all">ทุกช่องทาง</option>
            {CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {CHANNEL_COPY[channel].th}
              </option>
            ))}
          </select>
          <select
            value={complianceFilter}
            onChange={(e) => setComplianceFilter(e.target.value as "all" | Compliance)}
            className="rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-300"
          >
            <option value="all">ทุกสถานะ</option>
            <option value="ok">ปกติ</option>
            <option value="update">ควรอัปเดต</option>
            <option value="held">ถูกกัก</option>
            <option value="offline">ออฟไลน์</option>
            <option value="unverified">ยังไม่ยืนยัน LAN</option>
            <option value="unknown-version">ไม่ทราบเวอร์ชัน</option>
          </select>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-gray-500">
            <tr className="border-b border-gray-800">
              <th className="py-2 pr-3">เครื่อง</th>
              <th className="py-2 pr-3">สถานะ</th>
              <th className="py-2 pr-3">เวอร์ชัน</th>
              <th className="py-2 pr-3">ช่องทาง</th>
              <th className="py-2 pr-3">site / group</th>
              <th className="py-2 pr-3">ความพร้อม</th>
              <th className="py-2 text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/70">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-xs text-gray-500">
                  ไม่พบเครื่องที่ตรงตัวกรอง
                </td>
              </tr>
            )}
            {filtered.map((machine) => {
              const state = statusView(machine);
              const readiness = complianceView(machine.compliance);
              return (
                <Fragment key={machine.id}>
                  <tr className="align-top">
                    <td className="py-3 pr-3">
                      <div className="font-medium text-gray-100">{machine.name}</div>
                      <div className="text-[11px] text-gray-500">
                        {machine.os} · {machine.role ?? "USER"} · {ago(machine.staleSec)}
                      </div>
                      {machine.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {machine.tags.map((tag) => (
                            <span key={tag} className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <StatusPill variant={state.variant} label={state.label} pulse={machine.status === "online"} />
                    </td>
                    <td className="py-3 pr-3 font-mono text-xs text-gray-400">
                      {machine.version ?? "—"}
                      {machine.updateAvailable && (
                        <div className="mt-1 text-[10px] text-amber-300">เป้าหมาย {publishedRunnerVersion ?? "—"}</div>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <select
                        value={machine.channel}
                        disabled={busyMachine === machine.id}
                        onChange={(e) => onChannel(machine, e.target.value as Channel)}
                        className="rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200"
                      >
                        {CHANNELS.map((channel) => (
                          <option key={channel} value={channel}>
                            {CHANNEL_COPY[channel].th}
                          </option>
                        ))}
                      </select>
                      <div className="mt-1 text-[10px] text-gray-600">
                        {machine.channelSource === "override" ? "ตั้งเฉพาะเครื่อง" : "ตามค่าเริ่มต้น"} ·{" "}
                        {machine.rolloutPercent}%
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-xs text-gray-400">
                      <div>{machine.site ?? "—"}</div>
                      <div className="text-gray-600">{machine.group ?? "—"}</div>
                    </td>
                    <td className="py-3 pr-3">
                      <StatusPill variant={readiness.variant} label={readiness.label} />
                      {machine.reasons.length > 0 && (
                        <div className="mt-1 text-[10px] text-gray-600" title={machine.reasons.join(", ")}>
                          {machine.reasons.join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => (editingId === machine.id ? setEditingId(null) : openEdit(machine))}
                          className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
                        >
                          {editingId === machine.id ? "ปิด" : "ตั้งค่า"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onRotate(machine)}
                          disabled={busyMachine === machine.id}
                          className="rounded border border-rose-900/70 px-2 py-1 text-xs text-rose-300 hover:bg-rose-950/40 disabled:opacity-40"
                        >
                          หมุน token
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editingId === machine.id && (
                    <tr className="bg-gray-950/40">
                      <td colSpan={7} className="px-3 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                          <label className="text-xs text-gray-400">
                            site
                            <input
                              value={form.site}
                              onChange={(e) => setForm({ ...form, site: e.target.value })}
                              placeholder="เช่น สาขาเชียงใหม่"
                              className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-200"
                            />
                          </label>
                          <label className="text-xs text-gray-400">
                            group
                            <input
                              value={form.group}
                              onChange={(e) => setForm({ ...form, group: e.target.value })}
                              placeholder="เช่น ครัว / หน้าร้าน"
                              className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-200"
                            />
                          </label>
                          <label className="text-xs text-gray-400">
                            tags (คั่นด้วย ,)
                            <input
                              value={form.tags}
                              onChange={(e) => setForm({ ...form, tags: e.target.value })}
                              placeholder="pos, kitchen"
                              className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-200"
                            />
                          </label>
                          <label className="text-xs text-gray-400">
                            notes
                            <input
                              value={form.notes}
                              onChange={(e) => setForm({ ...form, notes: e.target.value })}
                              placeholder="หมายเหตุภายใน"
                              className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-200"
                            />
                          </label>
                        </div>
                        <div className="mt-3 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300"
                          >
                            ยกเลิก
                          </button>
                          <button
                            type="button"
                            onClick={() => void save(machine)}
                            disabled={saving || busyMachine === machine.id}
                            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                          >
                            {saving ? "กำลังบันทึก..." : "บันทึก"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
