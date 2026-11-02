"use client";
// components/ecosystem/studio/ClipStudio.tsx
// ────────────────────────────────────────────────────────────────────────────
// งานที่ 2 ของ Social Studio: "ลงคลิปวิดีโอ" → YouTube · Instagram · TikTok · Facebook
//
// เตรียมครั้งเดียว (ชื่อ + ไฟล์ + คำอธิบาย) แล้วกระจายไปทุกแพลตฟอร์มที่ติ๊ก
//   · YouTube = อัปโหลดอัตโนมัติผ่าน OAuth ในแอป (PostYouTube)
//   · อีกสามแพลตฟอร์ม = เปิดหน้าอัปโหลด + คัดลอกข้อความให้ (เบราว์เซอร์ห้ามยัดไฟล์ข้ามเว็บ)
//
// ⚠ บัญชีที่แสดงในแต่ละการ์ดคืออีเมลที่ผูกไว้ใน Ecosystem — ไม่ต้องล็อกอินซ้ำ
// ⚠ งานทุกชิ้นบันทึกลง localStorage อัตโนมัติ — ปิดแอปแล้วกลับมาพิมพ์ต่อได้
// ────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useLanguageStore } from '../../../stores/useLanguageStore';
import type { EcosystemAccount } from '../types';
import PostCaptionEditor from './PostCaptionEditor';
import PostComposer from './PostComposer';
import PostTargets from './PostTargets';
import PostYouTube from './PostYouTube';
import { Alert, BTN_GHOST, BTN_GOOD, Hint } from './ui';
import { DRAFT_KEY, PLATFORMS, PLATFORM_KEYS, buildCaption, emptyDraft, normalizeDraft, platformByKey } from './post-model';
import type { PlatformKey, PostDraft } from './post-model';
import { createSocialPost } from './social-history-client';
import { accountsForPlatform } from './studio-model';
import type { StudioAccountOption } from './studio-model';

const SAVE_FAILED_MSG =
  'บันทึกร่างลงเครื่องไม่สำเร็จ (พื้นที่เก็บข้อมูลเต็มหรือถูกปิด) — งานที่พิมพ์ไว้จะหายเมื่อปิดหน้านี้ กรุณาส่งออกข้อมูลสำรอง';

// เพดานชื่อคลิป = แพลตฟอร์มที่มี "ช่องชื่อคลิป" จริง และเข้มที่สุด
const TITLE_CAP = Math.min(...PLATFORMS.filter((p) => p.hasTitleField).map((p) => p.titleMax));

export interface ClipStudioProps {
  accounts: EcosystemAccount[];
  onAddAccount: (platform: string) => void;
}

export default function ClipStudio({ accounts, onAddAccount }: ClipStudioProps) {
  const [draft, setDraft] = useState<PostDraft>(() => emptyDraft(PLATFORM_KEYS));
  const [editKey, setEditKey] = useState<PlatformKey>('youtube');
  const [ready, setReady] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'error' | 'warn' } | null>(null);
  const t = useLanguageStore((s) => s.t);

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

  // บัญชีที่ผูกไว้ แยกตามแพลตฟอร์ม — ส่งให้การ์ดปลายทางแสดง "โพสต์ในนาม"
  const accountsByPlatform = useMemo(() => {
    const out: Partial<Record<PlatformKey, StudioAccountOption[]>> = {};
    for (const key of PLATFORM_KEYS) out[key] = accountsForPlatform(accounts, key);
    return out;
  }, [accounts]);

  const patch = useCallback((p: Partial<PostDraft>) => setDraft((d) => ({ ...d, ...p })), []);
  const onMsg = useCallback((text: string, kind: 'ok' | 'error' | 'warn') => setMsg({ text, kind }), []);

  // ⚠ ติ๊ก/ถอดติ๊กแล้วต้องเรียงตาม PLATFORM_KEYS เสมอ (ไม่ใช่ต่อท้าย)
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

  const saveHistory = useCallback(async () => {
    const captions = draft.targets
      .map((key) => ({ key, text: buildCaption(draft, key).trim() }))
      .filter((c) => c.text);
    const unique = new Set(captions.map((c) => c.text));
    // คำอธิบายต่างกันต่อแพลตฟอร์ม (TikTok ใส่แฮชแท็กมากกว่า) — เก็บให้ครบพร้อมชื่อแพลตฟอร์ม
    // ดีกว่าตัดเหลืออันเดียวแล้วจำผิดว่าโพสต์อะไรไปบ้าง
    const body =
      unique.size <= 1
        ? captions[0]?.text || ''
        : captions.map((c) => `[${platformByKey(c.key)?.label || c.key}]\n${c.text}`).join('\n\n');

    setSaving(true);
    setMsg(null);
    try {
      await createSocialPost({
        kind: 'clip',
        title: draft.title.trim().slice(0, 120) || 'งานลงคลิป',
        body,
        videoName: draft.videoName || undefined,
        videoSize: draft.videoSize > 0 ? draft.videoSize : undefined,
        targets: draft.targets.map((key) => ({
          platform: key,
          accountId: accountsByPlatform[key]?.[0]?.id || null,
        })),
      });
      setMsg({ text: t('ecosystem.clipStudio.saved', 'บันทึกงานนี้ลงประวัติแล้ว — ดูได้ในแท็บ “ประวัติการโพสต์”'), kind: 'ok' });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'บันทึกประวัติไม่สำเร็จ', kind: 'error' });
    } finally {
      setSaving(false);
    }
  }, [accountsByPlatform, draft]);

  const reset = () => {
    if (!window.confirm('ล้างร่างทั้งหมด (ชื่อคลิป คำอธิบาย แฮชแท็ก และไฟล์ที่เลือก) แล้วเริ่มใหม่?')) return;
    setDraft({ ...emptyDraft(PLATFORM_KEYS), targets: [...PLATFORM_KEYS] });
    setMsg({ text: 'ล้างร่างแล้ว', kind: 'ok' });
  };

  const canSave =
    draft.targets.length > 0 &&
    Boolean(draft.title.trim() || draft.videoName || draft.targets.some((k) => buildCaption(draft, k).trim()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-gray-100">🎬 ลงคลิปวิดีโอ</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            เตรียมครั้งเดียว แล้วลง YouTube · Instagram · TikTok · Facebook — เลือกไว้ {draft.targets.length} แพลตฟอร์ม
          </p>
        </div>
        <button type="button" className={BTN_GOOD} onClick={() => void saveHistory()} disabled={!canSave || saving}>
          {saving ? t('ecosystem.clipStudio.saving', 'กำลังบันทึก…') : t('ecosystem.clipStudio.saveHistory', 'บันทึกงานนี้ลงประวัติ')}
        </button>
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

      <PostTargets
        draft={draft}
        onToggle={toggleTarget}
        onMsg={onMsg}
        accountsByPlatform={accountsByPlatform}
        onAddAccount={onAddAccount}
      />

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
