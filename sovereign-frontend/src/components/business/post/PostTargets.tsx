"use client";
// components/business/post/PostTargets.tsx
// ส่วนที่ 3 ของแท็บ "📣 โพสต์" — การ์ดปลายทาง + ขั้นตอนที่ต้องทำบนแต่ละแพลตฟอร์ม
//
// ⚠ ความจริงที่ต้องยอมรับ (โหมด A ไม่ใช้ API):
//   แอป "กดโพสต์แทน" ให้ไม่ได้ — เพราะเบราว์เซอร์ห้ามเว็บหนึ่งยัดไฟล์ใส่ file input ของอีกเว็บ
//   สิ่งที่แอปทำได้และทำอยู่: เตรียมข้อความให้คัดลอกทีเดียว, เปิดหน้าที่ถูกต้อง,
//   ตรวจให้เสร็จว่าไฟล์/ข้อความผ่านเพดานไหม, และชี้ไฟล์ให้ลากไปวาง
//   ⇒ ก่อนกด "เปิดหน้า" จึงต้องบอกให้ชัดว่าเหลืออะไรให้ทำอีก (ไม่งั้นเจ้าของจะนึกว่าโพสต์แล้ว)
import { BTN_GHOST, BTN_GOOD, BTN_PRIMARY, Card, Hint } from './ui';
import { PLATFORMS, buildCaption, effectiveUploadUrl, platformByKey, textStatus } from './post-model';
import type { PlatformKey, PostDraft } from './post-model';
import { videoCheck } from './post-validate';
import { copyVia } from './post-clipboard';
import { postBridge } from './bridge';

export interface PostTargetsProps {
  draft: PostDraft;
  onToggle: (k: PlatformKey) => void;
  onMsg: (text: string, kind: 'ok' | 'error' | 'warn') => void;
}

/** สิ่งที่ยังขาดสำหรับแพลตฟอร์มนี้ — เรียงตามลำดับที่เจ้าของต้องทำจริง */
function missing(draft: PostDraft, key: PlatformKey): string[] {
  const spec = platformByKey(key);
  if (!spec) return ['ไม่รู้จักแพลตฟอร์มนี้'];
  const out: string[] = [];

  if (!draft.title.trim()) out.push('ยังไม่ได้ใส่ชื่อคลิป');
  if (!draft.videoName) {
    out.push('ยังไม่ได้เลือกไฟล์วิดีโอ');
  } else {
    const chk = videoCheck(draft.videoName, draft.videoSize, spec);
    if (!chk.ok && chk.reason) out.push(chk.reason);
  }

  const caption = buildCaption(draft, key);
  if (!caption) out.push('ยังไม่มีคำอธิบายหรือแฮชแท็ก');
  const st = textStatus(caption, spec.descMax);
  if (!st.ok) out.push(`ข้อความยาวเกินเพดาน ${spec.descMax.toLocaleString('th-TH')} อยู่ ${st.over.toLocaleString('th-TH')} ตัว`);

  if (!effectiveUploadUrl(key, draft.uploadUrls[key])) out.push('ลิงก์หน้าปลายทางไม่ถูกต้อง');

  return out;
}

export default function PostTargets({ draft, onToggle, onMsg }: PostTargetsProps) {
  const say = (ok: boolean, good: string, bad: string) => onMsg(ok ? good : bad, ok ? 'ok' : 'warn');

  const copy = async (text: string, label: string) => {
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    const ok = await copyVia(nav, text);
    say(ok, `คัดลอก${label}แล้ว — ไปวางในหน้าเว็บได้เลย`, `คัดลอกอัตโนมัติไม่ได้ — กรุณาเลือกข้อความในตัวอย่างแล้วกด Ctrl+C`);
  };

  const open = async (key: PlatformKey) => {
    const spec = platformByKey(key);
    if (!spec) return;
    const url = effectiveUploadUrl(key, draft.uploadUrls[key]);
    if (!url) { onMsg('ลิงก์หน้าปลายทางไม่ถูกต้อง — ต้องเป็นโดเมนของแพลตฟอร์มนั้น', 'error'); return; }

    const b = postBridge(typeof window === 'undefined' ? undefined : window);
    if (b) {
      const r = await b.openExternal(url);
      if (!r.ok) onMsg(r.message || 'เปิดลิงก์ไม่สำเร็จ', 'error');
      return;
    }
    // เปิดจากเว็บเพลน ๆ — popup blocker อาจสกัด ให้ถือว่าเป็นคำเตือนไม่ใช่ error
    const w = typeof window === 'undefined' ? null : window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) onMsg('เบราว์เซอร์บล็อกป๊อปอัป — กรุณาอนุญาตแล้วกดอีกครั้ง', 'warn');
  };

  const reveal = async () => {
    const b = postBridge(typeof window === 'undefined' ? undefined : window);
    const r = await b?.showItemInFolder(draft.videoPath);
    if (!r || !r.ok) onMsg(r?.message || 'เปิดโฟลเดอร์ไม่ได้', 'warn');
  };

  return (
    <Card
      title="3) ปลายทางที่จะโพสต์"
      sub="ติ๊กแพลตฟอร์มที่จะลง แล้วทำตามลำดับ 1 → 2 → 3 ในแต่ละการ์ด"
    >
      {draft.targets.length === 0 && (
        <Hint>ยังไม่ได้ติ๊กแพลตฟอร์มใด — ติ๊กอย่างน้อยหนึ่งช่องด้านล่าง</Hint>
      )}

      <div className="space-y-3">
        {PLATFORMS.map((spec) => {
          const on = draft.targets.includes(spec.key);
          const lacks = missing(draft, spec.key);
          const ready = lacks.length === 0;
          const caption = buildCaption(draft, spec.key);

          return (
            <div
              key={spec.key}
              className={`rounded-lg border p-3 space-y-2 ${on ? 'border-cyan-500/50 bg-cyan-500/5' : 'border-slate-700 bg-slate-800/30'}`}
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={on} onChange={() => onToggle(spec.key)} className="accent-cyan-500 w-4 h-4" />
                <span className="font-medium text-gray-100">{spec.emoji} {spec.label}</span>
                <span className={`ml-auto text-[11px] px-2 py-0.5 rounded-full border ${
                  ready
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                }`}>
                  {ready ? 'พร้อมโพสต์' : `เหลือ ${lacks.length} ขั้นตอน`}
                </span>
              </label>

              {lacks.length > 0 && (
                <ul className="space-y-0.5 pl-6">
                  {lacks.map((m) => (
                    <li key={m} className="text-[11px] text-amber-300">• {m}</li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" className={BTN_PRIMARY} onClick={() => open(spec.key)}>1) เปิดหน้า {spec.label}</button>
                {spec.hasTitleField && (
                  <button
                    type="button"
                    className={BTN_GOOD}
                    onClick={() => copy(draft.title.trim(), 'ชื่อคลิป')}
                    disabled={!draft.title.trim()}
                  >
                    2) คัดลอกชื่อคลิป
                  </button>
                )}
                <button
                  type="button"
                  className={BTN_GOOD}
                  onClick={() => copy(caption, spec.hasTitleField ? 'คำอธิบาย' : 'แคปชัน')}
                  disabled={!caption}
                >
                  {spec.hasTitleField ? '3) คัดลอกคำอธิบาย' : '2) คัดลอกแคปชัน'}
                </button>
                {draft.videoPath && (
                  <button type="button" className={BTN_GHOST} onClick={reveal}>
                    {spec.hasTitleField ? '4)' : '3)'} เปิดโฟลเดอร์ไฟล์วิดีโอ
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Hint>
        ขั้นสุดท้ายที่แอปทำให้แทนไม่ได้: ในหน้าเว็บของแพลตฟอร์ม ให้ลากไฟล์วิดีโอจากโฟลเดอร์ไปวางในช่องอัปโหลด
        แล้ววางข้อความที่คัดลอกไว้ — ทั้งสามแพลตฟอร์มทำเหมือนกัน
      </Hint>
    </Card>
  );
}
