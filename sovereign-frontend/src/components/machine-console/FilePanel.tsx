"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlResult, useMachineControl } from "../../hooks/useMachineControl";

/**
 * FilePanel — เรียกดู/แก้ไขไฟล์บนเครื่องปลายทาง
 *
 * รูปแบบการเรียก: ส่งคำสั่งไป (ได้ commandId กลับมาใน ack) → รอผลที่มี commandId ตรงกัน
 * ⇒ ต้องจับคู่ให้ถูก ไม่งั้นผลของ "ลบไฟล์" อาจถูกนำไปแสดงเป็นผลของ "อ่านไฟล์"
 *   (ผู้ใช้จะเห็นข้อมูลสลับกันโดยไม่มี error ให้จับ)
 *
 * ทุกการกระทำที่เปลี่ยนไฟล์ต้องยืนยันก่อน — ช่องนี้อ่าน-เขียนได้ทั้งไดรฟ์
 */

interface Entry {
  name: string;
  isDir: boolean;
  size: number | null;
  mtime: string | null;
  path: string;
}

interface Props {
  machineId: string;
  control: ReturnType<typeof useMachineControl>;
}

/** เพดานรอผลจากเครื่องปลายทาง — ตรงกับ timeout ฝั่ง HUB */
const RESULT_TIMEOUT_MS = 31_000;

export default function FilePanel({ machineId, control }: Props) {
  const { sendFs, fsResult } = control;
  const [path, setPath] = useState("E:\\");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const pendingRef = useRef(new Map<string, (r: ControlResult) => void>());

  // จับคู่ผลลัพธ์กับคำสั่งที่รออยู่ — หัวใจของการไม่สลับผลกัน
  useEffect(() => {
    if (!fsResult?.commandId) return;
    const resolve = pendingRef.current.get(fsResult.commandId);
    if (resolve) {
      pendingRef.current.delete(fsResult.commandId);
      resolve(fsResult);
    }
  }, [fsResult]);

  /** ส่งคำสั่งไฟล์หนึ่งคำสั่ง แล้วรอผลของ "คำสั่งนั้น" */
  const runFs = useCallback(
    async (op: string, payload: Record<string, unknown>) => {
      const ack = await sendFs(machineId, op, payload);
      if (!ack.ok || !ack.commandId) {
        return { ok: false, error: String(ack.error || "ส่งคำสั่งไม่สำเร็จ") } as unknown as ControlResult;
      }
      const commandId = String(ack.commandId);
      return await new Promise<ControlResult>((resolve) => {
        const timer = setTimeout(() => {
          if (pendingRef.current.delete(commandId)) {
            resolve({ ok: false, error: "เครื่องปลายทางไม่ตอบภายใน 31 วินาที" } as ControlResult);
          }
        }, RESULT_TIMEOUT_MS);
        pendingRef.current.set(commandId, (r) => {
          clearTimeout(timer);
          resolve(r);
        });
      });
    },
    [machineId, sendFs]
  );

  const loadDir = useCallback(
    async (target: string) => {
      setBusy(true);
      setError("");
      setMessage("");
      const res = await runFs("list", { path: target });
      setBusy(false);
      const data = res.result as { path?: string; parent?: string | null; entries?: Entry[] } | null;
      if (!res.ok || !data?.entries) {
        setError(res.error || "อ่านรายการไม่สำเร็จ");
        return;
      }
      setPath(data.path || target);
      setParent(data.parent ?? null);
      setEntries(data.entries);
      setSelected(null);
      setContent(null);
    },
    [runFs]
  );

  useEffect(() => {
    void loadDir(path);
    // โหลดครั้งแรก (และเมื่อสลับเครื่อง) — หลังจากนั้นเป็นการกดเองของผู้ใช้
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId]);

  const openFile = useCallback(
    async (file: string) => {
      setBusy(true);
      setError("");
      setMessage("");
      const res = await runFs("read", { path: file });
      setBusy(false);
      const data = res.result as { text?: string; base64?: string; binary?: boolean; size?: number } | null;
      if (!res.ok) {
        setError(res.error || "อ่านไฟล์ไม่สำเร็จ");
        return;
      }
      setSelected(file);
      setBinary(Boolean(data?.binary));
      setContent(data?.binary ? null : data?.text ?? "");
      setMessage(`อ่านแล้ว ${data?.size ?? 0} ไบต์`);
    },
    [runFs]
  );

  const saveFile = useCallback(async () => {
    if (!selected || content === null) return;
    setBusy(true);
    setError("");
    setMessage("");
    const res = await runFs("write", { path: selected, text: content });
    setBusy(false);
    if (!res.ok) {
      setError(res.error || "บันทึกไม่สำเร็จ");
      return;
    }
    setMessage(`บันทึกแล้ว: ${selected}`);
    await loadDir(path);
  }, [content, loadDir, path, runFs, selected]);

  const makeFolder = useCallback(async () => {
    const name = window.prompt("ชื่อโฟลเดอร์ใหม่");
    if (!name) return;
    setBusy(true);
    const res = await runFs("mkdir", { path: `${path}\\${name}` });
    setBusy(false);
    if (!res.ok) setError(res.error || "สร้างโฟลเดอร์ไม่สำเร็จ");
    else {
      setMessage(`สร้างโฟลเดอร์แล้ว: ${name}`);
      await loadDir(path);
    }
  }, [loadDir, path, runFs]);

  const removeEntry = useCallback(
    async (entry: Entry) => {
      const what = entry.isDir ? "โฟลเดอร์" : "ไฟล์";
      const extra = entry.isDir ? "\n(ถ้าไม่ว่างจะลบไม่ได้ — ต้องยืนยันแบบลบทั้งต้นไม้)" : "";
      if (!window.confirm(`ลบ${what}นี้?\n${entry.path}${extra}`)) return;
      setBusy(true);
      const res = await runFs("delete", { path: entry.path, recursive: entry.isDir });
      setBusy(false);
      if (!res.ok) setError(res.error || "ลบไม่สำเร็จ");
      else {
        setMessage(`ลบแล้ว: ${entry.name}`);
        await loadDir(path);
      }
    },
    [loadDir, path, runFs]
  );

  const renameEntry = useCallback(
    async (entry: Entry) => {
      const name = window.prompt("ชื่อใหม่", entry.name);
      if (!name || name === entry.name) return;
      setBusy(true);
      const res = await runFs("rename", { from: entry.path, to: `${path}\\${name}` });
      setBusy(false);
      if (!res.ok) setError(res.error || "เปลี่ยนชื่อไม่สำเร็จ");
      else {
        setMessage(`เปลี่ยนชื่อแล้ว: ${entry.name} → ${name}`);
        await loadDir(path);
      }
    },
    [loadDir, path, runFs]
  );

  const download = useCallback(
    async (file: string) => {
      setBusy(true);
      const res = await runFs("read", { path: file, encoding: "base64" });
      setBusy(false);
      const data = res.result as { base64?: string } | null;
      if (!res.ok || !data?.base64) {
        setError(res.error || "ดึงไฟล์ไม่สำเร็จ");
        return;
      }
      const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes]));
      const a = document.createElement("a");
      a.href = url;
      a.download = file.split(/[\\/]/).pop() || "download.bin";
      a.click();
      URL.revokeObjectURL(url);
    },
    [runFs]
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => parent && void loadDir(parent)}
          disabled={!parent || busy}
          className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 disabled:opacity-40"
        >
          ↑ ขึ้น
        </button>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void loadDir(path);
          }}
          className="min-w-[240px] flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1 font-mono text-xs text-gray-200"
          placeholder="เช่น E:\My work"
        />
        <button
          type="button"
          onClick={() => void loadDir(path)}
          disabled={busy}
          className="rounded bg-gray-700 px-3 py-1 text-xs text-white disabled:opacity-40"
        >
          ไป
        </button>
        <button
          type="button"
          onClick={() => void makeFolder()}
          disabled={busy}
          className="rounded border border-gray-700 px-3 py-1 text-xs text-gray-300 disabled:opacity-40"
        >
          + โฟลเดอร์
        </button>
      </div>

      {error ? <p className="rounded bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</p> : null}
      {message ? <p className="rounded bg-emerald-900/20 px-3 py-2 text-xs text-emerald-300">{message}</p> : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="max-h-[420px] overflow-auto rounded-lg border border-gray-800">
          {entries.length === 0 ? (
            <p className="p-3 text-xs text-gray-500">{busy ? "กำลังอ่าน…" : "ไม่มีรายการ"}</p>
          ) : (
            <ul className="divide-y divide-gray-800">
              {entries.map((entry) => (
                <li key={entry.path} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-800/40">
                  <button
                    type="button"
                    onClick={() => (entry.isDir ? void loadDir(entry.path) : void openFile(entry.path))}
                    className="flex-1 truncate text-left"
                    title={entry.path}
                  >
                    <span className={entry.isDir ? "text-amber-300" : "text-gray-200"}>
                      {entry.isDir ? "📁 " : "📄 "}
                      {entry.name}
                    </span>
                    {!entry.isDir && entry.size !== null ? (
                      <span className="ml-2 text-gray-500">{entry.size} B</span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => void renameEntry(entry)}
                    className="text-gray-500 hover:text-gray-200"
                    title="เปลี่ยนชื่อ"
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeEntry(entry)}
                    className="text-gray-500 hover:text-red-400"
                    title="ลบ"
                  >
                    🗑
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-gray-800 p-3">
          {!selected ? (
            <p className="text-xs text-gray-500">เลือกไฟล์เพื่อดู/แก้ไข</p>
          ) : binary ? (
            <div className="space-y-2">
              <p className="text-xs text-amber-300">ไฟล์ไบนารี — แสดงเป็นข้อความไม่ได้</p>
              <p className="break-all font-mono text-xs text-gray-400">{selected}</p>
              <button
                type="button"
                onClick={() => void download(selected)}
                className="rounded bg-gray-700 px-3 py-1 text-xs text-white"
              >
                ดาวน์โหลด
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="break-all font-mono text-xs text-gray-400">{selected}</p>
              <textarea
                value={content ?? ""}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                className="h-[320px] w-full rounded border border-gray-700 bg-gray-950 p-2 font-mono text-xs text-gray-200"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void saveFile()}
                  disabled={busy || content === null}
                  className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
                >
                  บันทึกทับ
                </button>
                <button
                  type="button"
                  onClick={() => void loadDir(path)}
                  className="rounded border border-gray-700 px-3 py-1 text-xs text-gray-300"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={() => void download(selected)}
                  className="rounded border border-gray-700 px-3 py-1 text-xs text-gray-300"
                >
                  ดาวน์โหลด
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
