// components/machine-console/AccessPanel.tsx
//
// ── แท็บ "สิทธิ์ควบคุม" ของหน้า /machine-console ─────────────────────────────
// แยกออกจากหน้าเพราะเพดานบรรทัดของ pages คือ 800 (หน้านี้แตะ 829 หลังเพิ่ม
// ทางเข้าควบคุมเครื่องจาก Agent Queue) — ตรรกะ/หน้าตาเดิมทั้งหมด ไม่มีการเปลี่ยนพฤติกรรม
//
// กติกาที่เจ้าของยืนยัน (11/10/69):
//   HUB  = คุมเครื่องอื่นได้ · USER = รับคำสั่ง + สั่งงาน AI ได้
//   เครื่องอยู่ใต้ผู้ใช้ได้หลายคน · ยืนยัน LAN ต้องกดยืนยันบนเครื่องเป้าหมาย
export interface AccessPanelMachine {
  id: string;
  role?: string;
  lanVerified?: boolean;
  hubUserIds?: string[] | null;
}

export interface AccessPanelProps {
  machine: AccessPanelMachine;
  busy: boolean;
  note: string;
  pairCode: string;
  pairInput: string;
  onPairInput: (value: string) => void;
  onSetRole: (machineId: string, role: string) => void;
  onStartPairing: (machineId: string) => void;
  onConfirmPairing: (machineId: string, approve: boolean) => void;
  onLink: (machineId: string) => void;
  onUnlink: (machineId: string) => void;
}

export default function AccessPanel({
  machine,
  busy,
  note,
  pairCode,
  pairInput,
  onPairInput,
  onSetRole,
  onStartPairing,
  onConfirmPairing,
  onLink,
  onUnlink,
}: AccessPanelProps) {
  const linkedCount = (machine.hubUserIds ?? []).length;

  return (
    <div className="space-y-3 text-sm text-gray-300">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-white">บทบาทเครื่อง:</span>
        <button
          type="button"
          disabled={busy || machine.role === "HUB"}
          onClick={() => onSetRole(machine.id, "HUB")}
          className="rounded bg-emerald-700 px-3 py-1 text-white disabled:opacity-50"
        >
          HUB (คุมเครื่องอื่นได้)
        </button>
        <button
          type="button"
          disabled={busy || machine.role === "USER"}
          onClick={() => onSetRole(machine.id, "USER")}
          className="rounded border border-gray-700 px-3 py-1 disabled:opacity-50"
        >
          USER (สั่งงาน AI ได้)
        </button>
        <span className="text-xs text-gray-500">
          ปัจจุบัน: {machine.role === "HUB" ? "HUB" : "USER"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-white">สถานะ LAN:</span>
        {machine.lanVerified ? (
          <span className="text-emerald-400">ยืนยันแล้ว — คุมเครื่องนี้ได้</span>
        ) : (
          <span className="text-amber-400">ยังไม่ยืนยัน — คุมเครื่องนี้ไม่ได้</span>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onStartPairing(machine.id)}
          className="rounded border border-gray-700 px-3 py-1 disabled:opacity-50"
        >
          ขอรหัสคู่
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onConfirmPairing(machine.id, false)}
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
          onChange={(e) => onPairInput(e.target.value)}
          placeholder="พิมพ์รหัส 6 หลัก"
          inputMode="numeric"
          maxLength={6}
          className="w-32 rounded border border-gray-700 bg-black px-2 py-1 text-white"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => onConfirmPairing(machine.id, true)}
          className="rounded bg-emerald-700 px-3 py-1 text-white disabled:opacity-50"
        >
          ยืนยันด้วยรหัส
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-800 pt-2">
        <span className="text-white">การผูก:</span>
        {linkedCount > 0 ? (
          <>
            <span className="text-gray-400">
              ผูกกับผู้ใช้ {linkedCount} คน (หลายคนคุมเครื่องเดียวกันได้)
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => onUnlink(machine.id)}
              className="rounded border border-gray-700 px-3 py-1 disabled:opacity-50"
            >
              ถอดผูกของฉัน
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => onLink(machine.id)}
            className="rounded border border-gray-700 px-3 py-1 disabled:opacity-50"
          >
            ผูกเครื่องนี้กับฉัน
          </button>
        )}
      </div>

      {note && <div className="text-amber-300">{note}</div>}
    </div>
  );
}
