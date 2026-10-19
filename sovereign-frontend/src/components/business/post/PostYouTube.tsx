"use client";
// components/business/post/PostYouTube.tsx
// ────────────────────────────────────────────────────────────────────────────
// การ์ด "อัปโหลดขึ้น YouTube อัตโนมัติ" (โหมด B) — อยู่ในแท็บ 📣 โพสต์
//
// ทำไมต้องมีทั้งที่โหมด A (เปิดหน้าเว็บอัปโหลด) ใช้ได้อยู่แล้ว
//   โหมด A ต้องลากไฟล์เองทุกครั้ง ⇒ คลิปเดียว 3 แพลตฟอร์ม = ลาก 3 รอบ
//   โหมด B อัปโหลดจากไฟล์ที่เลือกไว้แล้วได้เลย (ตั้งค่า OAuth ครั้งเดียว ใช้ได้ตลอด)
//
// ⚠ ค่าเริ่มต้นความเป็นส่วนตัว = "ส่วนตัว" ไม่ใช่ "สาธารณะ"
//   คลิปที่ขึ้นสาธารณะแล้วมีคนเห็นแล้วเรียกคืนไม่ได้ ⇒ ต้องให้เจ้าของเลือกเองเสมอ
// ⚠ ความลับทั้งหมด (client secret / token) อยู่ใน main process
//   หน้านี้เห็นได้แค่ "มี/ไม่มี" กับชื่อช่อง — ห้ามส่งค่าลับผ่านสะพาน
// ⚠ แอปที่ติดตั้งไว้ก่อนอัปเดตจะไม่มีฟังก์ชันเหล่านี้ → ต้องซ่อนการ์ดทิ้ง ไม่ใช่พังทั้งหน้า
// ⭐ เจ้าของสั่งชัดเจน: "การเชื่อมต่อบัญชีต้องผ่านใน Sovereign OS ทั้งหมด อย่าทำด้านนอก"
//   ⇒ หน้าอนุญาตของ Google เปิดในหน้าต่างของแอป (BrowserWindow) ไม่ใช่เบราว์เซอร์ภายนอก
//   ⇒ รหัสแอป Google ฝังมากับตัวแอป → เจ้าของไม่ต้อง import ไฟล์ JSON เอง
//     (ขั้น import ยังเหลือไว้เป็นทางสำรอง เผื่อเครื่องที่ไฟล์ฝังมาหาย)
// ────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { Alert, BTN_GHOST, BTN_GOOD, BTN_PRIMARY, Card, Hint, INPUT_CLS } from './ui';
import { postBridge, youtubeBridge } from './bridge';
import type { YoutubeBridge, YoutubeProgress, YoutubeStatus } from './bridge';

const PRIVACY_OPTS = [
  { v: 'private', label: 'ส่วนตัว — ปลอดภัยสุด (เปลี่ยนเป็นสาธารณะทีหลังได้)' },
  { v: 'unlisted', label: 'ไม่แสดงรายการ — ใครมีลิงก์ก็ดูได้' },
  { v: 'public', label: 'สาธารณะ — ขึ้น YouTube ทันที' },
];

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const mb = n / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

export default function PostYouTube({
  title, description, videoPath, videoName, onMsg,
}: {
  title: string;
  description: string;
  videoPath: string;
  videoName: string;
  onMsg: (text: string, kind: 'ok' | 'error' | 'warn') => void;
}) {
  const [bridge, setBridge] = useState<YoutubeBridge | null>(null);
  const [known, setKnown] = useState(false); // ตรวจสะพานเสร็จแล้วหรือยัง (กันการ์ดกะพริบ)
  const [status, setStatus] = useState<YoutubeStatus | null>(null);
  const [job, setJob] = useState<'' | 'import' | 'connect' | 'upload' | 'disconnect'>('');
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [privacy, setPrivacy] = useState('private');
  const [showPaste, setShowPaste] = useState(false);
  const [paste, setPaste] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [blocked, setBlocked] = useState(false);

  const refresh = useCallback(async (b: YoutubeBridge) => {
    const s = await b.status();
    if (s) setStatus(s);
  }, []);

  useEffect(() => {
    const b = youtubeBridge(typeof window === 'undefined' ? null : window);
    setBridge(b);
    setKnown(true);
    if (b && b.available) void refresh(b);
  }, [refresh]);

  // ความคืบหน้ามาจาก main ผ่าน IPC — ต้องถอนการสมัครตอน unmount ไม่งั้นฟังซ้อน
  useEffect(() => {
    if (!bridge || !bridge.available) return;
    const off = bridge.onProgress((p: YoutubeProgress) => {
      if (p && (p.done === true || p.ok === true)) {
        setProgress(null);
        return;
      }
      if (typeof p.sent === 'number' && typeof p.total === 'number' && p.total > 0) {
        setProgress({ sent: p.sent, total: p.total });
      }
    });
    return typeof off === 'function' ? off : undefined;
  }, [bridge]);

  const guard = useCallback((b: YoutubeBridge | null): b is YoutubeBridge => {
    if (!b) { onMsg('ต้องเปิดจากแอป Sovereign OS (ไม่ใช่เว็บ)', 'error'); return false; }
    if (!b.available) { onMsg('แอปเวอร์ชันนี้ยังไม่มีปุ่มอัปโหลดอัตโนมัติ — กรุณาอัปเดตแอป', 'error'); return false; }
    return true;
  }, [onMsg]);

  const doImportDialog = useCallback(async () => {
    if (!guard(bridge)) return;
    setJob('import');
    const r = await bridge.importDialog();
    setJob('');
    if (r.cancelled) return;
    if (r.ok) { await refresh(bridge); onMsg('อ่านไฟล์แล้ว — ขั้นต่อไปกด "เชื่อมต่อบัญชี YouTube"', 'ok'); }
    else onMsg(r.message || 'นำเข้าไฟล์ไม่สำเร็จ', 'error');
  }, [bridge, guard, onMsg, refresh]);

  const doImportText = useCallback(async () => {
    if (!guard(bridge)) return;
    if (!paste.trim()) { onMsg('วางเนื้อหาไฟล์ JSON ที่ดาวน์โหลดจาก Google ก่อน', 'warn'); return; }
    setJob('import');
    const r = await bridge.importText(paste);
    setJob('');
    if (r.ok) { setPaste(''); setShowPaste(false); await refresh(bridge); onMsg('อ่านค่าจาก JSON แล้ว', 'ok'); }
    else onMsg(r.message || 'อ่าน JSON ไม่สำเร็จ', 'error');
  }, [bridge, guard, onMsg, paste, refresh]);

  const doConnect = useCallback(async (external = false) => {
    if (!guard(bridge)) return;
    setJob('connect');
    setNote(external
      ? 'กำลังเปิดหน้าเว็บให้อนุญาต (ครั้งเดียว — ทางเลือกสุดท้ายเมื่อ Google บล็อกหน้าต่างในแอป)'
      : 'กำลังเปิดหน้าอนุญาตในแอปนี้ — เลือกบัญชี Google แล้วกด "อนุญาต" (ไม่ต้องสลับไปเบราว์เซอร์)');
    const r = await bridge.connect(external);
    setJob('');
    setNote('');
    if (r.ok) {
      setBlocked(false);
      await refresh(bridge);
      setVideoId(null);
      onMsg(`เชื่อมต่อแล้ว: ${r.channelTitle || 'ช่อง YouTube ของคุณ'}`, 'ok');
    } else {
      setBlocked(r.blocked === true);
      onMsg(r.message || 'เชื่อมต่อไม่สำเร็จ', 'error');
    }
  }, [bridge, guard, onMsg, refresh]);

  const doDisconnect = useCallback(async () => {
    if (!guard(bridge)) return;
    if (!window.confirm('ตัดการเชื่อมต่อ YouTube? ครั้งหน้าที่จะอัปโหลดต้องกดอนุญาตใหม่')) return;
    setJob('disconnect');
    const r = await bridge.disconnect();
    setJob('');
    await refresh(bridge);
    onMsg(r.ok ? 'ตัดการเชื่อมต่อแล้ว' : (r.message || 'ตัดการเชื่อมต่อไม่สำเร็จ'), r.ok ? 'ok' : 'error');
  }, [bridge, guard, onMsg, refresh]);

  const doUpload = useCallback(async () => {
    if (!guard(bridge)) return;
    if (!videoPath) { onMsg('เลือกไฟล์วิดีโอก่อน (การ์ดด้านบน)', 'warn'); return; }
    if (!title.trim()) { onMsg('ใส่ชื่อคลิปก่อน — YouTube ไม่รับคลิปที่ไม่มีชื่อ', 'warn'); return; }
    setJob('upload');
    setVideoId(null);
    setProgress({ sent: 0, total: 0 });
    const r = await bridge.upload({ filePath: videoPath, title, description, privacy });
    setJob('');
    setProgress(null);
    if (r.ok) {
      setVideoId(r.videoId || null);
      const where = privacy === 'public' ? 'ขึ้นสาธารณะแล้ว' : privacy === 'unlisted' ? 'ตั้งเป็นไม่แสดงรายการแล้ว' : 'ตั้งเป็นส่วนตัวไว้ก่อน';
      onMsg(`อัปโหลดสำเร็จ (${where})${r.videoId ? ` · id ${r.videoId}` : ''}`, 'ok');
    } else {
      onMsg(r.message || 'อัปโหลดไม่สำเร็จ', 'error');
    }
  }, [bridge, description, guard, onMsg, privacy, title, videoPath]);

  const doCancel = useCallback(async () => {
    if (!bridge) return;
    await bridge.cancel();
    onMsg('กำลังยกเลิก… (หยุดที่ก้อนข้อมูลถัดไป)', 'warn');
  }, [bridge, onMsg]);

  // ยังไม่รู้ผลตรวจสะพาน (ช่วง prerender/เฟรมแรก) → ไม่วาดอะไรเลย กันการ์ดกะพริบ
  if (!known) return null;
  // ไม่ใช่แอปเดสก์ท็อป หรือแอปเก่า → ซ่อนทั้งการ์ด (โหมด A ยังใช้ได้ปกติ)
  if (!bridge || !bridge.available) return null;

  const connected = status?.connected === true;
  const hasClient = status?.hasClient === true;
  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.sent / progress.total) * 100)) : 0;

  return (
    <Card
      title="🚀 อัปโหลดขึ้น YouTube อัตโนมัติ"
      sub="ใช้ไฟล์ที่เลือกไว้ด้านบน ไม่ต้องลากไฟล์ซ้ำ — ตั้งค่าครั้งเดียวแล้วใช้ได้ตลอด"
      right={connected ? (
        <button type="button" className={BTN_GHOST} onClick={doDisconnect} disabled={job !== ''}>ตัดการเชื่อมต่อ</button>
      ) : undefined}
    >
      {!status?.secure && (
        <Alert kind="warn">
          เครื่องนี้ยังใช้ระบบเข้ารหัสของ Windows ไม่ได้ — แอปจะไม่เก็บความลับใด ๆ ให้ (ปลอดภัยไว้ก่อน)
        </Alert>
      )}

      {/* ขั้นที่ 1 — ยังไม่มี Client ID/Secret (ปกติไม่ต้องทำ: รหัสแอปฝังมากับ Sovereign OS แล้ว) */}
      {!hasClient && (
        <div className="space-y-2">
          <p className="text-sm text-gray-300">
            แอปนี้ยังไม่มีรหัสแอป Google ติดตั้งมาด้วย — ถ้าเป็นการติดตั้งปกติไม่ต้องเห็นข้อความนี้
            (ต้องมีไฟล์ <code className="text-cyan-300">youtube-client.json</code> ในโฟลเดอร์แอป)
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_GOOD} onClick={doImportDialog} disabled={job !== ''}>
              {job === 'import' ? 'กำลังอ่าน…' : '📂 เลือกไฟล์ JSON จาก Google'}
            </button>
            <button type="button" className={BTN_GHOST} onClick={() => setShowPaste((v) => !v)} disabled={job !== ''}>
              {showPaste ? 'ซ่อนช่องวางข้อความ' : 'หรือวางข้อความ JSON เอง'}
            </button>
          </div>
          {showPaste && (
            <div className="space-y-2">
              <textarea
                className={`${INPUT_CLS} h-24 font-mono text-xs`}
                placeholder='{"installed":{"client_id":"...","client_secret":"..."}}'
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                spellCheck={false}
              />
              <button type="button" className={BTN_GHOST} onClick={doImportText} disabled={job !== ''}>อ่านข้อความนี้</button>
            </div>
          )}
          <Hint>
            ไฟล์นี้เก็บไว้เฉพาะในเครื่องคุณ (เข้ารหัสด้วย Windows) — ไม่ถูกส่งขึ้นเซิร์ฟเวอร์และไม่ขึ้น git
          </Hint>
        </div>
      )}

      {/* ขั้นที่ 2 — มี client แล้ว แต่ยังไม่เชื่อมบัญชี */}
      {hasClient && !connected && (
        <div className="space-y-2">
          <p className="text-sm text-gray-300">
            กดเชื่อมต่อ — หน้าอนุญาตของ Google จะเปิดขึ้น <b>ในหน้าต่างของแอปนี้</b> (ไม่เด้งออกไปเบราว์เซอร์นอก)
            {status?.clientHint ? <span className="text-gray-500"> · client {status.clientHint}</span> : null}
          </p>
          <button type="button" className={BTN_PRIMARY} onClick={() => void doConnect(false)} disabled={job !== ''}>
            {job === 'connect' ? 'กำลังรออนุญาตในหน้าต่างของแอป…' : '🔗 เชื่อมต่อบัญชี YouTube'}
          </button>
          {note && <Hint>{note}</Hint>}
          {blocked && (
            <div className="space-y-2">
              <Alert kind="warn">
                Google ไม่ยอมให้อนุญาตในหน้าต่างของแอปเครื่องนี้ — ถ้าจำเป็นต้องเชื่อมต่อตอนนี้
                ใช้ทางเลือกสุดท้ายด้านล่าง (เปิดเบราว์เซอร์ภายนอกครั้งเดียว)
              </Alert>
              <button type="button" className={BTN_GHOST} onClick={() => void doConnect(true)} disabled={job !== ''}>
                🌐 เปิดในเบราว์เซอร์ (ทางเลือกสุดท้าย)
              </button>
            </div>
          )}
          {status?.clientSource === 'embedded' ? (
            <Hint>รหัสแอป Google ฝังมากับ Sovereign OS แล้ว — ไม่ต้องดาวน์โหลดหรือวางไฟล์ใด ๆ</Hint>
          ) : (
            <button type="button" className="text-xs text-gray-500 hover:text-gray-300 underline" onClick={doImportDialog} disabled={job !== ''}>
              เปลี่ยนไฟล์ JSON เป็นอันอื่น
            </button>
          )}
        </div>
      )}

      {/* ขั้นที่ 3 — เชื่อมต่อแล้ว → อัปโหลดได้ */}
      {connected && (
        <div className="space-y-3">
          <p className="text-sm text-emerald-300">
            ✅ เชื่อมต่ออยู่{status?.channelTitle ? <> กับช่อง <b>{status.channelTitle}</b></> : null}
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-[240px] text-xs text-gray-400">
              ความเป็นส่วนตัว
              <select className={`${INPUT_CLS} mt-1`} value={privacy} onChange={(e) => setPrivacy(e.target.value)} disabled={job === 'upload'}>
                {PRIVACY_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </label>
            <button type="button" className={BTN_GOOD} onClick={doUpload} disabled={job !== '' || !videoPath}>
              {job === 'upload' ? 'กำลังอัปโหลด…' : '⬆️ อัปโหลดขึ้น YouTube'}
            </button>
            {job === 'upload' && (
              <button type="button" className={BTN_GHOST} onClick={doCancel}>ยกเลิก</button>
            )}
          </div>

          {!videoPath && <Hint>ยังไม่ได้เลือกไฟล์วิดีโอ — เลือกที่การ์ด "วิดีโอ" ด้านบนก่อน</Hint>}
          {videoPath && (
            <Hint>
              ไฟล์: <span className="text-gray-300">{videoName || videoPath.split(/[\\/]/).pop()}</span>
              {progress ? ` · ส่งแล้ว ${pct}% (${fmtBytes(progress.sent)} / ${fmtBytes(progress.total)})` : ''}
            </Hint>
          )}

          {progress && (
            <div className="h-2 rounded bg-slate-800 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-cyan-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}

          {videoId && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-gray-400">ลิงก์คลิป:</span>
              <code className="text-cyan-300 select-all">https://www.youtube.com/watch?v={videoId}</code>
              <button
                type="button"
                className="text-gray-400 hover:text-gray-200 underline"
                onClick={() => { const b = postBridge(typeof window === 'undefined' ? null : window); void b?.openExternal(`https://www.youtube.com/watch?v=${videoId}`); }}
              >
                เปิดดู
              </button>
            </div>
          )}

          <Hint>
            โควตาฟรีของ YouTube อยู่ที่ประมาณ {status?.freePerDay ?? 6} คลิป/วัน — เกินแล้วระบบจะบอก ไม่ใช่พังเงียบ ·
            ถ้าต้องการลงทุกแพลตฟอร์ม ใช้การ์ดด้านล่างสำหรับ Facebook/TikTok/Instagram ควบคู่ได้
          </Hint>
        </div>
      )}
    </Card>
  );
}
