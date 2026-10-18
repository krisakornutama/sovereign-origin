"use client";
// components/business/post/PostCaptionEditor.tsx
// ส่วนที่ 2 ของแท็บ "📣 โพสต์" — คำอธิบาย + แฮชแท็ก + หน้าปลายทาง "แยกต่อแพลตฟอร์ม"
//
// ⚠ เหตุผลที่แยกต่อแพลตฟอร์ม (เจ้าของสั่งเอง 18/10/69):
//   TikTok ใช้แฮชแท็กเยอะกว่ามาก · YouTube เอาแฮชแท็ก 3 อันแรกไปโชว์เหนือชื่อคลิป
//   ถ้าใช้ข้อความชุดเดียวทุกที่ ผู้ใช้จะต้องมานั่งลบ/เติมเองทีละแพลตฟอร์ม = เสียเวลาตรงจุดที่ควรประหยัด
import { Counter, Hint, INPUT_CLS, Card } from './ui';
import { PLATFORMS, buildCaption, effectiveUploadUrl, platformByKey, textStatus } from './post-model';
import type { PlatformKey, PostDraft } from './post-model';

export interface PostCaptionEditorProps {
  draft: PostDraft;
  editKey: PlatformKey;
  onEditKey: (k: PlatformKey) => void;
  patch: (p: Partial<PostDraft>) => void;
}

export default function PostCaptionEditor({ draft, editKey, onEditKey, patch }: PostCaptionEditorProps) {
  const spec = platformByKey(editKey);
  if (!spec) return null;

  const caption = draft.captions[editKey] ?? '';
  const hashtags = draft.hashtags[editKey] ?? '';
  const urlRaw = draft.uploadUrls[editKey] ?? '';
  const preview = buildCaption(draft, editKey);
  const pStat = textStatus(preview, spec.descMax);
  const urlOk = effectiveUploadUrl(editKey, urlRaw) !== null;

  return (
    <Card
      title="2) คำอธิบายต่อแพลตฟอร์ม"
      sub="แก้แยกกันได้ — เลือกแท็บแพลตฟอร์มด้านล่างแล้วพิมพ์ของแพลตฟอร์มนั้น"
      right={<span className="text-[11px] text-gray-500">รวมกับแฮชแท็ก: <Counter len={pStat.len} max={spec.descMax} /></span>}
    >
      <div className="flex flex-wrap gap-1.5">
        {PLATFORMS.map((p) => {
          const active = p.key === editKey;
          const has = (draft.captions[p.key] ?? '').trim().length > 0 || (draft.hashtags[p.key] ?? '').trim().length > 0;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onEditKey(p.key)}
              aria-pressed={active}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                active ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-slate-800 border-slate-600 text-gray-300 hover:bg-slate-700'
              }`}
            >
              {p.emoji} {p.label}{has ? ' •' : ''}
            </button>
          );
        })}
      </div>

      <Hint>{spec.hint}</Hint>

      <label className="block space-y-1">
        <span className="text-xs text-gray-400">คำอธิบายสำหรับ {spec.label}</span>
        <textarea
          className={`${INPUT_CLS} min-h-[120px] resize-y`}
          value={caption}
          onChange={(e) => patch({ captions: { ...draft.captions, [editKey]: e.target.value } })}
          placeholder={editKey === 'tiktok' ? 'เล่าเรื่องสั้น ๆ ให้คนดูต่อ (TikTok ใช้แคปชันนี้เป็นชื่อคลิปด้วย)' : 'อธิบายสินค้า/คลิปนี้'}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-gray-400">แฮชแท็กของ {spec.label} (เว้นวรรคหรือลูกน้ำคั่น ไม่ต้องพิมพ์ # ก็ได้)</span>
        <input
          className={INPUT_CLS}
          value={hashtags}
          onChange={(e) => patch({ hashtags: { ...draft.hashtags, [editKey]: e.target.value } })}
          placeholder={editKey === 'tiktok' ? 'iot esp32 smartfarm เกษตรอัจฉริยะ เซนเซอร์' : 'iot esp32'}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-gray-400">หน้าปลายทางของ {spec.label} (เว้นว่าง = ใช้หน้าอัปโหลดมาตรฐาน)</span>
        <input
          className={INPUT_CLS}
          value={urlRaw}
          onChange={(e) => patch({ uploadUrls: { ...draft.uploadUrls, [editKey]: e.target.value } })}
          placeholder={spec.uploadUrl}
          aria-invalid={!urlOk}
        />
      </label>
      {!urlOk && (
        <p className="text-[11px] text-rose-300">
          ลิงก์นี้ไม่ผ่าน — ต้องขึ้นต้นด้วย https:// และเป็นโดเมนของ {spec.label} เท่านั้น ({spec.hosts.join(' · ')})
        </p>
      )}

      <div className="space-y-1">
        <span className="text-xs text-gray-400">ตัวอย่างข้อความที่จะคัดลอกไปวาง</span>
        <pre className="whitespace-pre-wrap break-words rounded border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-gray-300 max-h-48 overflow-auto">
          {preview || '(ยังว่าง — พิมพ์คำอธิบายหรือแฮชแท็กก่อน)'}
        </pre>
      </div>

      {!pStat.ok && (
        <p className="text-[11px] text-rose-300">
          ยาวเกินเพดาน {spec.label} ({spec.descMax.toLocaleString('th-TH')}) อยู่ {pStat.over.toLocaleString('th-TH')} ตัว —
          ตัดแฮชแท็กท้ายออกก่อนกดโพสต์
        </p>
      )}
    </Card>
  );
}
