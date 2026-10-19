"use client";
import { useState } from "react";
import StatusPill from "../ui/StatusPill";
import { fmtDate, type EnrollToken } from "../../lib/fleetTypes";

/**
 * แผงรหัสเชิญเครื่องใหม่ — แสดงรหัสจริงเพียงครั้งเดียวที่หน้าหลัก
 * component นี้ไม่มีสิทธิ์เห็น token จริง (รับเฉพาะ record ที่ไม่มี hash)
 */
export default function FleetEnrollmentPanel({
  tokens,
  busy,
  error,
  onCreate,
  onRevoke,
}: {
  tokens: EnrollToken[];
  busy: boolean;
  error: string;
  onCreate: (input: { label: string; maxUses: number; expiresInHours: number }) => Promise<boolean>;
  onRevoke: (row: EnrollToken) => void;
}) {
  const [form, setForm] = useState({ label: "", maxUses: "1", expiresInHours: "168" });

  async function submit() {
    const ok = await onCreate({
      label: form.label.trim(),
      maxUses: Number(form.maxUses),
      expiresInHours: Number(form.expiresInHours),
    });
    if (ok) setForm({ label: "", maxUses: "1", expiresInHours: "168" });
  }

  return (
    <section className="xl:col-span-2 rounded-2xl border border-gray-800 bg-gray-900/40 p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-100">รหัสเชิญเครื่องใหม่</h2>
          <p className="text-xs text-gray-500 mt-1">แสดงรหัสจริงครั้งเดียว · เก็บเฉพาะ hash · เพิกถอนรายใบได้</p>
        </div>
        <span className="rounded-full border border-gray-700 px-2 py-0.5 text-[11px] text-gray-400">
          ใช้ได้ {tokens.filter((t) => t.usable).length} ใบ
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-2">
        <input
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          placeholder="ชื่อรหัส เช่น สาขาเชียงใหม่"
          className="md:col-span-2 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600"
        />
        <label className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-400">
          <span className="shrink-0">เครื่องสูงสุด</span>
          <input
            type="number"
            min={1}
            max={1000}
            value={form.maxUses}
            onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
            className="w-full bg-transparent text-right text-gray-200 outline-none"
          />
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-400">
          <span className="shrink-0">หมดอายุ (ชม.)</span>
          <input
            type="number"
            min={1}
            max={8760}
            value={form.expiresInHours}
            onChange={(e) => setForm({ ...form, expiresInHours: e.target.value })}
            className="w-full bg-transparent text-right text-gray-200 outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || form.label.trim().length < 2}
          className="md:col-span-4 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? "กำลังสร้าง..." : "สร้างรหัสเชิญ"}
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-rose-300">{error}</div>}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-gray-500">
            <tr className="border-b border-gray-800">
              <th className="py-2 pr-3">ชื่อ</th>
              <th className="py-2 pr-3">รหัส</th>
              <th className="py-2 pr-3">ใช้แล้ว</th>
              <th className="py-2 pr-3">หมดอายุ</th>
              <th className="py-2 pr-3">สถานะ</th>
              <th className="py-2 text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/70">
            {tokens.length === 0 && (
              <tr>
                <td colSpan={6} className="py-5 text-center text-xs text-gray-500">
                  ยังไม่มีรหัสเชิญ — สร้างใบแรกด้านบน
                </td>
              </tr>
            )}
            {tokens.map((row) => (
              <tr key={row.id}>
                <td className="py-2 pr-3 text-gray-200">
                  <div>{row.label}</div>
                  {row.lastMachineName && <div className="text-[11px] text-gray-500">ล่าสุด: {row.lastMachineName}</div>}
                </td>
                <td className="py-2 pr-3 font-mono text-xs text-gray-400">{row.prefix}…</td>
                <td className="py-2 pr-3 text-xs text-gray-400">
                  {row.usedCount}/{row.maxUses}
                </td>
                <td className="py-2 pr-3 text-xs text-gray-400">
                  {row.expiresAt ? fmtDate(row.expiresAt) : "ไม่หมดอายุ"}
                </td>
                <td className="py-2 pr-3">
                  <StatusPill
                    variant={row.revokedAt ? "err" : row.expired ? "off" : row.usable ? "ok" : "warn"}
                    label={
                      row.revokedAt
                        ? "เพิกถอน"
                        : row.expired
                          ? "หมดอายุ"
                          : row.usable
                            ? "ใช้ได้"
                            : "ใช้ครบแล้ว"
                    }
                  />
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onRevoke(row)}
                    disabled={busy || Boolean(row.revokedAt)}
                    className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-40"
                  >
                    เพิกถอน
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
