"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import io, { Socket } from "socket.io-client";
import { useAuthStore } from "../stores/useAuthStore";
import { getWsUrl } from "../lib/config";

/**
 * useMachineControl — ช่องควบคุมเครื่องระยะไกล (ดูจอ/เมาส์/คีย์บอร์ด/ไฟล์)
 *
 * แยกออกมาเป็น hook เพราะเป็นสถานะที่มีอายุ (socket) และมีรอบชีวิตชัดเจน:
 *   join → รับเฟรม/ผลลัพธ์ → leave/disconnect (ต้องสั่งหยุดสตรีมที่เครื่องปลายทาง)
 *
 * ข้อควรรู้จากของจริง:
 *   · ทุก emit ที่ต้องรู้ผลใช้ ack (callback) — ไม่เดาว่าสำเร็จ
 *   · การออกจากห้องต้องเกิดทั้งตอนกดออกและตอนปิดหน้า (disconnect) ไม่งั้น
 *     เครื่องปลายทางจะสตรีมค้างไว้ตลอดกาล
 */

export interface ControlFrame {
  machineId: string;
  seq: number;
  at: number;
  mime: string;
  width: number | null;
  height: number | null;
  data: string;
}

export interface ControlResult {
  machineId: string;
  commandId: string;
  ok: boolean;
  result: unknown;
  error: string | null;
}

export type AckResponse = { ok: boolean; error?: string; [key: string]: unknown };

/** ส่ง input event ไปเครื่องปลายทาง — ใช้ ack เพื่อรู้ว่า HUB รับหรือปฏิเสธ */
type EmitWithAck = (event: string, payload: Record<string, unknown>) => Promise<AckResponse>;

export function useMachineControl() {
  const token = useAuthStore((s) => s.token);
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [joinedMachine, setJoinedMachine] = useState<string | null>(null);
  const [frame, setFrame] = useState<ControlFrame | null>(null);
  const [lastResult, setLastResult] = useState<ControlResult | null>(null);
  /** ผลลัพธ์จากการทำงานไฟล์ (list/read/write) — แยกจาก result ของอินพุตที่ถี่กว่า */
  const [fsResult, setFsResult] = useState<ControlResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    const socket = io(getWsUrl(), { auth: { token }, transports: ["websocket"] });

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => {
      setConnected(false);
      // เครื่องปลายทางจะหยุดสตรีมให้เองเมื่อ socket หลุด (ฝั่ง HUB เห็น room ว่าง)
      setJoinedMachine(null);
    });
    socket.on("connect_error", (err: Error) => setError(String(err?.message || err)));

    socket.on("control:frame", (f: ControlFrame) => setFrame(f));
    socket.on("control:result", (r: ControlResult) => {
      setLastResult(r);
      // คำสั่งไฟล์เป็นคำสั่งเดียวที่ผู้ใช้รอผลแบบตัวต่อตัว — อินพุตไม่ต้องเก็บ
      if (r?.commandId) setFsResult(r);
      if (r && r.ok === false && r.error) setError(r.error);
    });

    socketRef.current = socket;
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  /** emit แล้วรอ ack — คืน { ok:false } แทนการ throw เมื่อยังไม่ต่อหรือ ack หมดเวลา */
  const emitAck = useCallback<EmitWithAck>((event, payload) => {
    return new Promise((resolve) => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        resolve({ ok: false, error: "ยังไม่เชื่อมต่อกับ HUB" });
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: "HUB ไม่ตอบภายใน 5 วินาที" });
      }, 5000);
      socket.emit(event, payload, (ack: AckResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ack ?? { ok: false, error: "ไม่ได้รับคำตอบ" });
      });
    });
  }, []);

  const join = useCallback(
    async (machineId: string, fps = 5) => {
      setError("");
      setFrame(null);
      const ack = await emitAck("control:join", { machineId, fps });
      if (ack.ok) setJoinedMachine(machineId);
      else setError(String(ack.error || "เปิดดูเครื่องไม่สำเร็จ"));
      return ack;
    },
    [emitAck]
  );

  const leave = useCallback(
    async (machineId: string) => {
      const ack = await emitAck("control:leave", { machineId });
      setJoinedMachine((cur) => (cur === machineId ? null : cur));
      setFrame(null);
      return ack;
    },
    [emitAck]
  );

  const sendInput = useCallback(
    (machineId: string, event: Record<string, unknown>) => emitAck("control:input", { machineId, event }),
    [emitAck]
  );

  const sendFs = useCallback(
    (machineId: string, op: string, payload: Record<string, unknown>) =>
      emitAck("control:fs", { machineId, op, payload }),
    [emitAck]
  );

  const setFps = useCallback(
    (machineId: string, fps: number) => emitAck("control:fps", { machineId, fps }),
    [emitAck]
  );

  const snapshot = useCallback((machineId: string) => emitAck("control:snapshot", { machineId }), [emitAck]);

  return {
    connected,
    joinedMachine,
    frame,
    lastResult,
    fsResult,
    error,
    clearError: () => setError(""),
    join,
    leave,
    sendInput,
    sendFs,
    setFps,
    snapshot,
  };
}
