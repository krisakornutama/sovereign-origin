"use client";
// components/business/post/PostComposer.tsx
// ส่วนที่ 1 ของแท็บ "📣 โพสต์" — ชื่อคลิป (ช่องเดียวใช้ร่วมกัน) + ไฟล์วิดีโอ
//
// ⚠ ข้อเท็จจริงที่หล่อหลอมหน้านี้ (เขียนไว้กันคนแก้ทีหลังเข้าใจผิด):
//   เบราว์เซอร์ห้ามเว็บหนึ่ง "ยัดไฟล์" ใส่ file input ของอีกเว็บหนึ่ง — เป็นข้อจำกัดความปลอดภัยที่ตั้งใจ
//   ⇒ แอปนี้ "เลือกไฟล์ให้เองไม่ได้" สิ่งที่ทำได้จริงคือ: ตรวจไฟล์ให้, ชี้ว่าอยู่โฟลเดอร์ไหน,
//     แล้วให้เจ้าของลากไฟล์จาก Explorer ไปวางบนหน้าเว็บของแพลตฟอร์มเอง
//   ⇒ ถ้าไม่มีปุ่มนี้ เจ้าของจะต้องจำพาธไฟล์เอง = งานที่ควรลด
import { useRef, useState } from 'react';
import { BTN_GHOST, BTN_PRIMARY, Card, Counter, Hint, INPUT_CLS } from './ui';
import { formatBytes, isVideoFile, videoCheck } from './post-validate';
import { platformByKey, textStatus } from './post-model';
import type { PlatformKey } from './post-model';
import { NO_REVEAL_FOLDER, postBridge } from './bridge';

export interface PostComposerProps {
  title: string;
  onTitle: (v: string) => void;
  /** เพดานชื่อคลิปที่เข้มที่สุดในบรรดาแพลตฟอร์มที่เลือก */
  titleCap: number;
  videoPath: string;
  videoName: string;
  videoSize: number;
  targets: PlatformKey[];
  onVideo: (v: { path: string; name: string; size: number }) => void;
  onClearVideo: () => void;
  onMsg: (text: string, kind: 'ok' | 'error' | 'warn') => void;
}

export default function PostComposer(props: PostComposerProps) {
  const { title, onTitle, titleCap, videoPath, videoName, videoSize, targets, onVideo, onClearVideo, onMsg } = props;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const tStat = textStatus(title, titleCap);

  const pick = async () => {
    const b = postBridge(typeof window === 'undefined' ? undefined : window);
    // ไม่มีสะพาน (เปิดจากเว็บ) หรือแอปเก่าที่ยังไม่มี pickVideo → ใช้ <input type="file"> แทน
    // (ได้ชื่อ/ขนาด แต่เบราว์เซอร์ไม่ให้พาธไฟล์ — ดีกว่าให้ผู้ใช้กดแล้วเงียบ)
    if (!b || !b.hasPickVideo) { fileRef.current?.click(); return; }
    setBusy(true);
    const v = await b.pickVideo();
    setBusy(false);
    if (!v) return; // ผู้ใช้กดยกเลิก — เงียบไว้ ไม่ต้องเด้งข้อความ
    onVideo(v);
  };

  const reveal = async () => {
    const b = postBridge(typeof window === 'undefined' ? undefined : window);
    const r = await b?.showItemInFolder(videoPath);
    if (!r || !r.ok) onMsg(r?.message || NO_REVEAL_FOLDER, 'warn');
  };

  const onBrowserFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // ล้างก่อน เพื่อเลือกไฟล์เดิมซ้ำได้ (ไม่งั้น onChange ไม่ยิง)
    if (!f) return;
    if (!isVideoFile(f.name)) { onMsg(`ไฟล์ "${f.name}" ไม่ใช่วิดีโอที่อัปโหลดได้`, 'error'); return; }
    onVideo({ path: '', name: f.name, size: f.size });
  };

  return (
    <Card
      title="1) คลิปที่จะโพสต์"
      sub="ใส่ชื่อคลิปครั้งเดียว + เลือกไฟล์วิดีโอหนึ่งไฟล์ แล้วใช้ได้ทุกแพลตฟอร์มที่ติ๊กไว้"
      right={<Counter len={tStat.len} max={titleCap} />}
    >
      <label className="block space-y-1">
        <span className="text-xs text-gray-400">ชื่อคลิป (ใช้กับช่องชื่อของ YouTube / Facebook)</span>
        <input
          className={INPUT_CLS}
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="เช่น เซนเซอร์วัดอุณหภูมิ RS485 ใช้งานกับ ESP32"
        />
      </label>
      {!tStat.ok && (
        <p className="text-[11px] text-rose-300">
          ชื่อยาวเกินเพดาน {titleCap.toLocaleString('th-TH')} อยู่ {tStat.over.toLocaleString('th-TH')} ตัว —
          แพลตฟอร์มจะตัดให้เอง ควรย่อก่อน
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN_PRIMARY} onClick={pick} disabled={busy}>
          {busy ? 'กำลังเปิดหน้าต่าง…' : videoName ? 'เปลี่ยนไฟล์วิดีโอ' : 'เลือกไฟล์วิดีโอ'}
        </button>
        {videoName && videoPath && (
          <>
            <button type="button" className={BTN_GHOST} onClick={reveal}>เปิดโฟลเดอร์ที่มีไฟล์</button>
            <button type="button" className={BTN_GHOST} onClick={onClearVideo}>เอาออก</button>
          </>
        )}
        <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={onBrowserFile} />
      </div>

      {videoName ? (
        <div className="rounded border border-slate-700 bg-slate-800/50 px-3 py-2 space-y-2">
          <p className="text-sm text-gray-200 break-all">🎬 {videoName}</p>
          <p className="text-[11px] text-gray-500">
            {formatBytes(videoSize)}
            {videoPath ? '' : ' · เปิดจากเว็บ เบราว์เซอร์ไม่ให้พาธไฟล์ (ต้องลากไฟล์เอง)'}
          </p>
          {videoPath && <p className="text-[11px] text-gray-600 break-all">{videoPath}</p>}
          {targets.length > 0 && (
            <ul className="space-y-1 pt-1">
              {targets.map((k) => {
                const spec = platformByKey(k);
                if (!spec) return null;
                const chk = videoCheck(videoName, videoSize, spec);
                return (
                  <li key={k} className="text-[11px] flex gap-1.5">
                    <span aria-hidden>{chk.ok ? '✅' : '⛔'}</span>
                    <span className={chk.ok ? 'text-emerald-300' : 'text-rose-300'}>
                      {spec.label}{chk.ok ? ` · ${formatBytes(videoSize)} ผ่าน` : ` · ${chk.reason}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <Hint>{'ยังไม่ได้เลือกไฟล์ — เลือกได้เลย ระบบจะตรวจให้ก่อนว่าไฟล์นี้ผ่านเพดานของแต่ละแพลตฟอร์มหรือไม่ (คลิปเดียวกันอาจผ่าน YouTube แต่เกินเพดาน TikTok)'}</Hint>
      )}
    </Card>
  );
}
