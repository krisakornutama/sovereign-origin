"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { useMachineControl } from "../../hooks/useMachineControl";

/**
 * ScreenPanel — ดูจอเครื่องปลายทางแบบสด + ควบคุมเมาส์/คีย์บอร์ด
 *
 * จุดที่ต้องระวังจริง (ไม่ใช่รายละเอียดเล็กน้อย):
 *
 * 1) พิกัดส่งเป็น "สัดส่วน 0..1" ของจอ ไม่ใช่พิกเซล
 *    เพราะภาพถูกย่อ (เช่น 1920 → 1280) ⇒ พิกเซลที่เห็น ≠ พิกเซลบนจอจริง
 *    ฝั่งเครื่องปลายทางเป็นคนแปลงสัดส่วน → พิกัดจริงด้วยค่าที่ตัวเองรู้อยู่แล้ว
 *
 * 2) เมาส์ขยับถูกจำกัดความถี่ (~25 ครั้ง/วินาที) แต่ "คลิก" ต้องส่งพิกัดก่อนเสมอ
 *    ไม่งั้นจะไปคลิกที่ตำแหน่งเคอร์เซอร์เดิม ซึ่งผู้ใช้ไม่ได้ตั้งใจ
 *
 * 3) ต้องมีปุ่ม "ปล่อยการควบคุม" — ผู้ใช้ที่เปิดดูจอเพื่อดูเฉย ๆ ต้องไม่เผลอ
 *    ขยับเมาส์เครื่องคนอื่นเพราะลากเมาส์ผ่านหน้าจอ
 */

const MOVE_INTERVAL_MS = 40; // ~25 ครั้ง/วินาที — พอให้ลื่น แต่ไม่ท่วมช่อง

interface Props {
  machineId: string;
  machineName: string;
  control: ReturnType<typeof useMachineControl>;
}

export default function ScreenPanel({ machineId, machineName, control }: Props) {
  const { joinedMachine, frame, connected, join, leave, sendInput, setFps } = control;
  const [released, setReleased] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const lastMoveRef = useRef(0);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const joined = joinedMachine === machineId;

  // ออกจากห้องเมื่อสลับเครื่อง/ปิดหน้า — ไม่งั้นเครื่องปลายทางสตรีมค้างตลอดกาล
  useEffect(() => {
    if (!joined) return;
    return () => {
      void leave(machineId);
    };
  }, [joined, machineId, leave]);

  /** แปลงตำแหน่งเมาส์บนจอ → สัดส่วน 0..1 ของจอเครื่องปลายทาง */
  const toFraction = useCallback((clientX: number, clientY: number) => {
    const el = imgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      fx: (clientX - rect.left) / rect.width,
      fy: (clientY - rect.top) / rect.height,
    };
  }, []);

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (released) return;
      const now = Date.now();
      if (now - lastMoveRef.current < MOVE_INTERVAL_MS) return;
      lastMoveRef.current = now;
      const frac = toFraction(e.clientX, e.clientY);
      if (!frac) return;
      void sendInput(machineId, { kind: "mouse", action: "move", ...frac });
    },
    [machineId, released, sendInput, toFraction]
  );

  /** ปุ่มเมาส์: ขยับไปที่ตำแหน่งนั้นก่อนเสมอ แล้วค่อยกด/ปล่อย */
  const onMouseButton = useCallback(
    (action: "down" | "up", e: React.MouseEvent) => {
      if (released) return;
      const frac = toFraction(e.clientX, e.clientY);
      if (frac) void sendInput(machineId, { kind: "mouse", action: "move", ...frac });
      const button = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
      void sendInput(machineId, { kind: "mouse", action, button });
    },
    [machineId, released, sendInput, toFraction]
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (released) return;
      void sendInput(machineId, { kind: "mouse", action: "wheel", deltaY: e.deltaY });
    },
    [machineId, released, sendInput]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (released) return;
      // ปุ่มที่เบราว์เซอร์ใช้เอง (F5, Ctrl+R, F12…) ไม่ส่งไปเครื่องปลายทาง
      e.preventDefault();
      void sendInput(machineId, { kind: "key", action: "down", key: e.key, code: e.code });
    },
    [machineId, released, sendInput]
  );

  const onKeyUp = useCallback(
    (e: React.KeyboardEvent) => {
      if (released) return;
      e.preventDefault();
      void sendInput(machineId, { kind: "key", action: "up", key: e.key, code: e.code });
    },
    [machineId, released, sendInput]
  );

  if (!joined) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-6 text-center space-y-3">
        <p className="text-gray-300">
          เปิดดูจอของ <span className="font-medium text-white">{machineName}</span> แบบสด
        </p>
        <p className="text-xs text-gray-500">
          เปิดแล้วคุณจะสั่งเมาส์/คีย์บอร์ดของเครื่องนั้นได้ และเครื่องนั้นจะเริ่มส่งภาพหน้าจอมาที่นี่
        </p>
        <button
          type="button"
          disabled={!connected}
          onClick={() => void join(machineId, 5)}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {connected ? "เปิดดูจอ" : "กำลังเชื่อมต่อ HUB…"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className={`inline-flex items-center gap-1.5 ${frame ? "text-emerald-400" : "text-amber-400"}`}>
          <span className={`h-2 w-2 rounded-full ${frame ? "bg-emerald-400" : "bg-amber-400"}`} />
          {frame ? `ภาพสด seq ${frame.seq}` : "รอภาพแรกจากเครื่อง…"}
        </span>
        {frame?.width ? (
          <span className="text-gray-500">
            {frame.width}×{frame.height}
          </span>
        ) : null}

        <label className="flex items-center gap-1 text-gray-400">
          fps
          <select
            defaultValue={5}
            onChange={(e) => void setFps(machineId, Number(e.target.value))}
            className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-200"
          >
            {[2, 3, 5, 8, 12].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setReleased((v) => !v)}
          className={`rounded px-3 py-1 text-xs font-medium ${
            released ? "bg-amber-600 text-white" : "border border-gray-700 text-gray-300"
          }`}
        >
          {released ? "การควบคุมถูกปล่อย — กดเพื่อคุมต่อ" : "ปล่อยการควบคุม"}
        </button>

        <button
          type="button"
          onClick={() => void leave(machineId)}
          className="rounded border border-gray-700 px-3 py-1 text-xs text-gray-300"
        >
          ปิดการดูจอ
        </button>
      </div>

      {released ? (
        <p className="rounded border border-amber-800/60 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
          กำลังดูอยู่เฉย ๆ — เมาส์/คีย์บอร์ดของคุณจะไม่ถูกส่งไปที่เครื่องนั้น
        </p>
      ) : null}

      {/* คลิกตรงนี้ก่อนพิมพ์ — คีย์บอร์ดจะถูกส่งไปที่เครื่องปลายทาง */}
      <div
        ref={boxRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(e) => e.preventDefault()}
        className="w-full overflow-hidden rounded-lg border border-gray-800 bg-black outline-none focus:border-emerald-700"
      >
        {frame ? (
          <img
            ref={imgRef}
            src={`data:${frame.mime};base64,${frame.data}`}
            alt={`จอของ ${machineName}`}
            className={`w-full select-none ${released ? "cursor-default" : "cursor-crosshair"}`}
            draggable={false}
            onMouseMove={onMouseMove}
            onMouseDown={(e) => onMouseButton("down", e)}
            onMouseUp={(e) => onMouseButton("up", e)}
            onWheel={onWheel}
          />
        ) : (
          <div className="flex h-64 items-center justify-center text-sm text-gray-500">
            กำลังรอภาพหน้าจอ… (ถ้าค้างนาน ตรวจว่าฝั่งเครื่องเปิด ENABLE_REMOTE_CONTROL และ PowerShell ทำงานได้)
          </div>
        )}
      </div>
    </div>
  );
}
