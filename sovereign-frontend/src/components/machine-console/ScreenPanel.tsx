"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { useMachineControl } from "../../hooks/useMachineControl";
import Icon from "../ui/Icon";

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
  /** มาจากลิงก์ "ควบคุมเครื่องนี้" → เปิดสตรีมให้เองทันที ไม่ต้องกด "เปิดดูจอ" อีกชั้น */
  autoJoin?: boolean;
}

export default function ScreenPanel({ machineId, machineName, control, autoJoin = false }: Props) {
  const { joinedMachine, frame, connected, join, leave, sendInput, setFps } = control;
  const [released, setReleased] = useState(false);
  const [text, setText] = useState("");
  const [textNote, setTextNote] = useState("");
  const [clipboardText, setClipboardText] = useState<string | null>(null);
  const [isFull, setIsFull] = useState(false);
  /** tick รายวินาที — ใช้วัดว่าเฟรมล่าสุดเก่าแค่ไหน (ภาพค้างต้องเห็นได้ ไม่ใช่เดา) */
  const [, setTick] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const lastMoveRef = useRef(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const lastFrameAtRef = useRef(0);
  /** ลองเปิดเองไปแล้วหรือยัง — กันลูป join ซ้ำเมื่อ component วาดใหม่ถี่ (เฟรมไหลทุกวินาที) */
  const autoTriedRef = useRef(false);

  const joined = joinedMachine === machineId;

  // เวลาที่ "เครื่องนี้" รับเฟรมล่าสุด — ใช้เวลาท้องถิ่น ไม่ใช้ timestamp จาก HUB
  // (นาฬิกาสองเครื่องอาจต่างกันได้ เป็นสิบวินาที → บอก "ภาพเก่า 30 วิ" ทั้งที่สด)
  useEffect(() => {
    if (frame) lastFrameAtRef.current = Date.now();
  }, [frame]);

  // วัดอายุภาพทุกวินาที — ภาพค้างคืออาการที่ผู้ใช้ต้องรู้ก่อนกดอะไร
  useEffect(() => {
    if (!joined) return;
    const timer = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [joined]);

  // ติดตามสถานะเต็มจอ (กด Esc ออกได้ — state ต้องตามให้ตรง)
  useEffect(() => {
    const onChange = () => setIsFull(document.fullscreenElement === boxRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /** สลับเต็มจอ — ใช้กับหน้าต่างรีโมทแยกได้ดีที่สุด */
  const toggleFullscreen = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen().catch(() => {});
  }, []);

  /** ส่งข้อความทั้งก้อนไปพิมพ์ที่เครื่องปลายทาง — ทางเดียวที่พิมพ์ไทยได้จริง
   *  (คีย์บอร์ดส่งทีละปุ่ม = layout ของเครื่องปลายทางเป็นตัวตัดสิน ภาษาไทยจะเพี้ยน) */
  const sendText = useCallback(async () => {
    const value = text.trim();
    if (!value || released) return;
    const ack = await sendInput(machineId, { kind: "text", text: value });
    if (ack.ok) {
      setText("");
      setTextNote("ส่งข้อความไปพิมพ์ที่เครื่องปลายทางแล้ว");
    } else {
      setTextNote(ack.error || "ส่งข้อความไม่สำเร็จ");
    }
    setTimeout(() => setTextNote(""), 4000);
  }, [machineId, released, sendInput, text]);

  /** คัดลอกจากคลิปบอร์ดและส่งไปพิมพ์ที่เครื่องปลายทาง */
  const readClipboardAndSend = useCallback(async () => {
    try {
      const clipboard = await navigator.clipboard.readText();
      setClipboardText(clipboard);
      const ack = await sendInput(machineId, { kind: "text", text: clipboard });
      if (ack.ok) {
        setTextNote("คัดลอกจากคลิปบอร์ดแล้วส่งไปพิมพ์ที่เครื่องปลายทางแล้ว");
        setTimeout(() => setTextNote(""), 4000);
      } else {
        setTextNote(ack.error || "ส่งข้อความไม่สำเร็จ");
      }
    } catch (e) {
      setTextNote("ไม่สามารถอ่านคลิปบอร์ดได้ — อาจปิดการใช้งานหรือเป็นหน้า HTTP");
      console.error('clipboard read error:', e);
    }
  }, [machineId, sendInput, released]);

  // เปลี่ยนเครื่อง = เริ่มนับใหม่ (ไม่ใช้สถานะ "ลองแล้ว" ของเครื่องก่อน)
  // และคืนสิทธิ์เมาส์/คีย์บอร์ดเสมอ — ห้ามพา "ปล่อยการควบคุม" ของเครื่องก่อนไปใช้กับเครื่องใหม่
  useEffect(() => {
    autoTriedRef.current = false;
    setReleased(false);
  }, [machineId]);

  // เปิดสตรีมเองเมื่อมาจากลิงก์ตรง — รอให้ socket ต่อ HUB สำเร็จก่อน
  useEffect(() => {
    if (!autoJoin || joined || !connected || autoTriedRef.current) return;
    autoTriedRef.current = true;
    void join(machineId, 5);
  }, [autoJoin, connected, join, joined, machineId]);

  // หลุดการเชื่อมต่อ → กลับมาออนไลน์แล้วต้องเปิดสตรีมใหม่เอง (ห้องฝั่ง HUB หายไปกับ socket เก่า)
  useEffect(() => {
    if (!connected) autoTriedRef.current = false;
  }, [connected]);

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
        {autoJoin && connected ? (
          <p className="text-xs text-gray-500">กำลังเปิดจอให้อัตโนมัติ…</p>
        ) : null}
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
        {frame && lastFrameAtRef.current ? (
          <span
            className={
              Date.now() - lastFrameAtRef.current > 5000 ? "text-amber-400" : "text-gray-500"
            }
            title="เวลาที่ได้รับเฟรมล่าสุด (นับจากนาฬิกาเครื่องนี้)"
          >
            อัปเดต {Math.max(0, Math.round((Date.now() - lastFrameAtRef.current) / 1000))} วิก่อน
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
          onClick={toggleFullscreen}
          className="rounded border border-gray-700 px-3 py-1 text-xs text-gray-300"
          title="เต็มจอ (กด Esc เพื่อออก)"
        >
          {isFull ? "ออกจากเต็มจอ" : "⛶ เต็มจอ"}
        </button>

        <button
          type="button"
          onClick={() => void leave(machineId)}
          className="rounded border border-gray-700 px-3 py-1 text-xs text-gray-300"
        >
          ปิดการดูจอ
        </button>
      </div>

      {!connected ? (
        <p className="rounded border border-rose-800/60 bg-rose-900/20 px-3 py-2 text-xs text-rose-300">
          ขาดการเชื่อมต่อ HUB — กำลังต่อใหม่ให้อัตโนมัติ (ภาพจะหยุดชั่วคราว)
        </p>
      ) : null}

      {released ? (
        <p className="rounded border border-amber-800/60 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
          กำลังดูอยู่เฉย ๆ — เมาส์/คีย์บอร์ดของคุณจะไม่ถูกส่งไปที่เครื่องนั้น
        </p>
      ) : null}

      <p className="text-xs text-gray-500">
        คลิกในภาพหนึ่งครั้งก่อนพิมพ์ — คีย์บอร์ด/เมาส์จะถูกส่งไปที่เครื่องปลายทาง
      </p>

      {/* คลิกตรงนี้ก่อนพิมพ์ — คีย์บอร์ดจะถูกส่งไปที่เครื่องปลายทาง */}
      <div
        ref={boxRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onClick={() => boxRef.current?.focus()}
        onContextMenu={(e) => e.preventDefault()}
        className={
          isFull
            ? "flex h-screen w-screen items-center justify-center overflow-hidden bg-black outline-none"
            : "w-full overflow-hidden rounded-lg border border-gray-800 bg-black outline-none focus:border-emerald-700"
        }
      >
        {frame ? (
          <img
            ref={imgRef}
            src={`data:${frame.mime};base64,${frame.data}`}
            alt={`จอของ ${machineName}`}
            className={`${isFull ? "max-h-full max-w-full object-contain" : "w-full"} select-none ${
              released ? "cursor-default" : "cursor-crosshair"
            }`}
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

      {/* พิมพ์ข้อความทั้งก้อน — ทางเดียวที่ภาษาไทยไปถึงเครื่องปลายทางได้ถูกต้อง */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-800 bg-gray-900/40 p-2">
        <label className="min-w-[220px] flex-1 text-xs text-gray-400">
          ส่งข้อความไปพิมพ์ที่เครื่องปลายทาง (ไทย/ยาว ๆ ใช้ช่องนี้)
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                void sendText();
              }
            }}
            disabled={released}
            maxLength={2000}
            rows={2}
            placeholder="พิมพ์ข้อความแล้วกด Enter (Shift+Enter = ขึ้นบรรทัดใหม่)"
            className="mt-1 w-full resize-y rounded border border-gray-700 bg-black px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-emerald-700 disabled:opacity-40"
          />
        </label>
        <button
          type="button"
          onClick={() => void readClipboardAndSend()}
          disabled={released}
          className="rounded bg-teal-700 px-3 py-1.5 text-xs text-white disabled:opacity-50"
          title="คัดลอกจากคลิปบอร์ดแล้วส่งไปพิมพ์ที่เครื่องปลายทาง"
        >
          <Icon name="copy" size={14} /> คลิป
        </button>
        {clipboardText && (
          <div className="mt-1 text-xs text-teal-300">คลิปบอร์ด: {clipboardText.substring(0, 50)}{clipboardText.length > 50 ? '…' : ''}</div>
        )
        }
        <button
          type="button"
          onClick={() => void sendText()}
          disabled={released || !text.trim()}
          className="rounded bg-emerald-700 px-3 py-1.5 text-xs text-white disabled:opacity-40"
        >
          ส่งข้อความ
        </button>
        {textNote ? <span className="text-xs text-emerald-300">{textNote}</span> : null}
      </div>
    </div>
  );
}
