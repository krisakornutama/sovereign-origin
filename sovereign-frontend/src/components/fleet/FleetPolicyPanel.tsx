"use client";
import type { Channel, FleetOverview, FleetPolicyView } from "../../lib/fleetTypes";
import { CHANNELS, CHANNEL_COPY, fmtDate } from "../../lib/fleetTypes";

/**
 * แผงนโยบายช่องทางอัปเดต — แยกจากหน้าหลักเพื่อให้เพจอยู่ใต้เพดาน 800 บรรทัด
 * ตัวเลข rollout เป็น % ของเครื่องในช่องทางนั้น (deterministic ตาม machine id)
 */
export default function FleetPolicyPanel({
  policy,
  channels,
  saving,
  onChange,
  onSave,
}: {
  policy: FleetPolicyView;
  channels: FleetOverview["channels"];
  saving: boolean;
  onChange: (next: FleetPolicyView) => void;
  onSave: () => void;
}) {
  function setPercent(channel: Channel, value: number) {
    onChange({
      ...policy,
      channels: {
        ...policy.channels,
        [channel]: { ...policy.channels[channel], rolloutPercent: value },
      },
    });
  }

  return (
    <section className="xl:col-span-1 rounded-2xl border border-gray-800 bg-gray-900/40 p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-100">ช่องทางอัปเดต</h2>
          <p className="text-xs text-gray-500 mt-1">กำหนดว่าใครได้อัปเดตก่อน — เครื่องเดิมอยู่ในกลุ่มเดิมเสมอ</p>
        </div>
        <span className="rounded-full border border-gray-700 px-2 py-0.5 text-[11px] text-gray-400">
          {policy.machineOverrideCount} override
        </span>
      </div>

      <div className="mt-4 space-y-4">
        <label className="block">
          <span className="text-xs text-gray-400">ช่องทางเริ่มต้นของเครื่องใหม่</span>
          <select
            value={policy.defaultChannel}
            onChange={(e) => onChange({ ...policy, defaultChannel: e.target.value as Channel })}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200"
          >
            {CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {CHANNEL_COPY[channel].th} — {CHANNEL_COPY[channel].hint}
              </option>
            ))}
          </select>
        </label>

        {CHANNELS.map((channel) => {
          const row = channels.find((item) => item.id === channel);
          return (
            <div key={channel}>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300">{CHANNEL_COPY[channel].th}</span>
                <span className="text-gray-500">
                  {policy.channels[channel].rolloutPercent}% · {row?.eligible ?? 0}/{row?.machines ?? 0} เครื่อง
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={policy.channels[channel].rolloutPercent}
                onChange={(e) => setPercent(channel, Number(e.target.value))}
                className="mt-1 w-full accent-emerald-500"
              />
            </div>
          );
        })}

        <label className="flex items-start gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={policy.requireLanVerification}
            onChange={(e) => onChange({ ...policy, requireLanVerification: e.target.checked })}
            className="mt-0.5 accent-emerald-500"
          />
          <span>ต้องยืนยัน LAN ก่อนถือว่าเครื่องพร้อม (แนะนำ)</span>
        </label>

        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? "กำลังบันทึก..." : "บันทึกนโยบาย"}
        </button>
        <div className="text-[11px] text-gray-600">แก้ล่าสุด: {fmtDate(policy.updatedAt)}</div>
      </div>
    </section>
  );
}
