"use client";
// components/business/post/PostHub.tsx
// ────────────────────────────────────────────────────────────────────────────
// แท็บ "📣 โพสต์" — คลิปเดียว (ชื่อเดียว + ไฟล์เดียว) → กระจายไป YouTube / Facebook / TikTok
//
// โหมด A (เวอร์ชันนี้): เปิดหน้าเว็บอัปโหลดของแต่ละแพลตฟอร์มด้วยเบราว์เซอร์จริง
//   ข้อดี: ไม่ต้องขอ API key · ไม่มีค่าใช้จ่าย · ไม่มีโควตารายวัน · ทำได้ทุกบัญชีทันที
//   ข้อจำกัดที่หนีไม่ได้: ขั้น "เลือกไฟล์ในหน้าเว็บ" ต้องให้เจ้าของลากไฟล์เอง
//   (เบราว์เซอร์ห้ามเว็บหนึ่งยัดไฟล์ใส่ file input ของอีกเว็บ — เป็นด่านความปลอดภัย ไม่ใช่ข้อบกพร่อง)
//   ⇒ แอปจึงรับผิดชอบทุกอย่างที่ทำแทนได้: ตรวจไฟล์/ความยาวข้อความ, คัดลอกข้อความให้ทีละแพลตฟอร์ม,
//     เปิดหน้าที่ถูกต้อง, และชี้โฟลเดอร์ที่มีไฟล์
//
// ⚠ งานทุกชิ้นถูกบันทึกลง localStorage อัตโนมัติ — ปิดแอปแล้วกลับมาไม่ต้องพิมพ์ใหม่
//   แต่ "ไฟล์วิดีโอไม่ได้ถูกคัดลอก" เก็บแค่พาธ ⇒ ถ้าย้าย/ลบไฟล์ แอปจะเตือนและให้เลือกใหม่
// ────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import PostComposer from './PostComposer';
import PostCaptionEditor from './PostCaptionEditor';
import PostTargets from './PostTargets';
import PostYouTube from './PostYouTube';
import { Alert, BTN_GHOST, Hint } from './ui';
import { DRAFT_KEY, PLATFORMS, PLATFORM_KEYS, emptyDraft, normalizeDraft } from './post-model';
import type { PlatformKey, PostDraft } from './post-model';

const SAVE_FAILED_MSG =
  'บันทึกร่างลงเครื่องไม่สำเร็จ (พื้นที่เก็บข้อมูลเต็มหรือถูกปิด) — งานที่พิมพ์ไว้จะหายเมื่อปิดหน้านี้ กรุณาส่งออกข้อมูลสำรอง';

// เพดานชื่อคลิป = แพลตฟอร์มที่มี "ช่องชื่อคลิป" จริง และเข้มที่สุด
// (TikTok ไม่มีช่องชื่อ — ชื่อไปอยู่ในแคปชัน จึงไม่ต้องเอามาคิด)
const TITLE_CAP = Math.min(...PLATFORMS.filter((p) => p.hasTitleField).map((p) => p.titleMax));

export default function PostHub() {
  const [draft, setDraft] = useState<PostDraft>(() => emptyDraft(PLATFORM_KEYS));
  const [editKey, setEditKey] = useState<PlatformKey>('youtube');
  const [ready, setReady] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'error' | 'warn' } | null>(null);

  // โหลดร่าง — ทำใน effect เท่านั้น เพราะ prerender ฝั่งเซิร์ฟเวอร์ไม่มี localStorage
  useEffect(() => {
    let next = emptyDraft(PLATFORM_KEYS);
    let raw: string | null = null;
    try { raw = window.localStorage.getItem(DRAFT_KEY); } catch { /* โหมดส่วนตัว/ปิด storage */ }

    if (raw) {
      try { next = normalizeDraft(JSON.parse(raw), PLATFORM_KEYS); }
      catch { /* ร่างเสียหาย — เริ่มจากร่างว่างดีกว่าให้ทั้งหน้าพัง */ }
    } else {
      next = { ...next, targets: [...PLATFORM_KEYS] }; // ใช้ครั้งแรก: ติ๊กทุกแพลตฟอร์มให้ก่อน
    }
    setDraft(next);
    setReady(true);
  }, []);

  // บันทึกอัตโนมัติ (หลังโหลดเสร็จเท่านั้น — กันร่างเดิมถูกทับด้วยร่างว่างก่อนโหลดเสร็จ)
  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      setSaveErr('');
    } catch {
      setSaveErr(SAVE_FAILED_MSG);
    }
  }, [draft, ready]);

  const patch = useCallback((p: Partial<PostDraft>) => setDraft((d) => ({ ...d, ...p })), []);
  const onMsg = useCallback((text: string, kind: 'ok' | 'error' | 'warn') => setMsg({ text, kind }), []);

  // ⚠ ติ๊ก/ถอดติ๊กแล้วต้องเรียงตาม PLATFORM_KEYS เสมอ (ไม่ใช่ต่อท้าย)
  //   ไม่งั้นลำดับการ์ดจะสลับไปมาตามลำดับที่ผู้ใช้กด = หาปุ่มไม่เจอ
  const toggleTarget = useCallback((k: PlatformKey) => {
    setDraft((d) => ({
      ...d,
      targets: d.targets.includes(k)
        ? d.targets.filter((x) => x !== k)
        : PLATFORM_KEYS.filter((kk) => d.targets.includes(kk) || kk === k),
    }));
  }, []);

  const onVideo = useCallback((v: { path: string; name: string; size: number }) => {
    setDraft((d) => ({ ...d, videoPath: v.path, videoName: v.name, videoSize: v.size }));
    setMsg(null);
  }, []);

  const clearVideo = useCallback(() => {
    setDraft((d) => ({ ...d, videoPath: '', videoName: '', videoSize: 0 }));
    setMsg(null);
  }, []);

  const reset = () => {
    if (!window.confirm('ล้างร่างทั้งหมด (ชื่อคลิป คำอธิบาย แฮชแท็ก และไฟล์ที่เลือก) แล้วเริ่มใหม่?')) return;
    setDraft({ ...emptyDraft(PLATFORM_KEYS), targets: [...PLATFORM_KEYS] });
    setMsg({ text: 'ล้างร่างแล้ว', kind: 'ok' });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-gray-100">📣 โพสต์คลิปไปหลายแพลตฟอร์ม</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            เตรียมครั้งเดียว แล้วลง YouTube · Facebook · TikTok — เลือกไว้ {draft.targets.length} แพลตฟอร์ม
          </p>
        </div>
        <button type="button" className={BTN_GHOST} onClick={reset}>ล้างร่าง</button>
      </div>

      {saveErr && <Alert kind="error">{saveErr}</Alert>}
      {msg && (
        <Alert kind={msg.kind}>
          <span className="flex items-start gap-2">
            <span className="flex-1">{msg.text}</span>
            <button type="button" className="text-gray-400 hover:text-gray-200" onClick={() => setMsg(null)} aria-label="ปิดข้อความ">✕</button>
          </span>
        </Alert>
      )}

      <PostComposer
        title={draft.title}
        onTitle={(v) => patch({ title: v })}
        titleCap={TITLE_CAP}
        videoPath={draft.videoPath}
        videoName={draft.videoName}
        videoSize={draft.videoSize}
        targets={draft.targets}
        onVideo={onVideo}
        onClearVideo={clearVideo}
        onMsg={onMsg}
      />

      <PostCaptionEditor draft={draft} editKey={editKey} onEditKey={setEditKey} patch={patch} />

      <PostTargets draft={draft} onToggle={toggleTarget} onMsg={onMsg} />

      <PostYouTube
        title={draft.title}
        description={draft.captions.youtube}
        videoPath={draft.videoPath}
        videoName={draft.videoName}
        onMsg={onMsg}
      />

      <Hint>
        ร่างถูกบันทึกอัตโนมัติในเครื่องนี้ (ไม่ส่งขึ้นเซิร์ฟเวอร์) — ปิดแอปแล้วกลับมาพิมพ์ต่อได้เลย
        แต่ไฟล์วิดีโอไม่ได้ถูกคัดลอก แอปจำแค่ตำแหน่ง ถ้าย้ายหรือลบไฟล์ต้องเลือกใหม่
      </Hint>
    </div>
  );
}
