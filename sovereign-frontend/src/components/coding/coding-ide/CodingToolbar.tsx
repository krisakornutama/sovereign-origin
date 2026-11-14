// ── Coding IDE: toolbar — โมเดล/เหตุผล/อัตโนมัติ/รูปภาพ (ย้ายจาก CodingIde.tsx verbatim — FE-007) ──
import { useLanguageStore } from '../../../stores/useLanguageStore';
import Icon from '../../ui/Icon';
import { EFFORT_LEVELS, AUTONOMY_LEVELS } from '../coding-ide-shared';

interface Props {
  models: string[];
  codingModel: string;
  setCodingModel: (v: string) => void;
  codingEffort: string;
  setCodingEffort: (v: string) => void;
  codingAutonomy: string;
  setCodingAutonomy: (v: string) => void;
  codingImage: string | null;
  setCodingImage: (v: string | null) => void;
  fileToBase64: (file: File, cb: (b64: string) => void) => void;
}

export default function CodingToolbar({
  models, codingModel, setCodingModel, codingEffort, setCodingEffort,
  codingAutonomy, setCodingAutonomy, codingImage, setCodingImage, fileToBase64,
}: Props) {
  const t = useLanguageStore((s) => s.t);

  return (
      <section className="card panel-glow px-4 py-2.5 flex-none">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <label htmlFor="coding-model" className="text-gray-400">{t('aiAgent.coding.modelLabel', 'โมเดล')}</label>
          <select id="coding-model"
            value={codingModel}
            onChange={(e) => setCodingModel(e.target.value)}
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
          >
            <option value="">{t('aiAgent.coding.defaultEnv', 'ค่าเริ่มต้น (env)')}</option>
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <div className="text-gray-400 ml-1">{t('aiAgent.coding.effortLabel', 'เหตุผล')}</div>
          <div className="flex gap-1">
            {EFFORT_LEVELS.map((e) => (
              <button
                key={e.key}
                onClick={() => setCodingEffort(e.key)}
                title={e.key ? t('aiAgent.coding.effortTitle', 'ระดับการให้เหตุผล: {label}', { label: t(`aiAgent.effort.${e.key}`, e.label) }) : t('aiAgent.coding.defaultEffortTitle', 'ใช้ค่าของโมเดลเอง')}
                className={`px-2.5 py-1.5 rounded text-xs font-bold transition ${
                  codingEffort === e.key ? 'bg-emerald-600 text-white' : 'bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-300'
                }`}
              >
                {e.key ? t(`aiAgent.effort.${e.key}`, e.label) : t('aiAgent.effort.auto', e.label)}
              </button>
            ))}
          </div>
          <label htmlFor="coding-autonomy" className="text-gray-400 ml-1">{t('aiAgent.coding.autonomyLabel', 'อัตโนมัติ')}</label>
          <select id="coding-autonomy"
            value={codingAutonomy}
            onChange={(e) => setCodingAutonomy(e.target.value)}
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
          >
            {AUTONOMY_LEVELS.map((a) => (
              <option key={a.key} value={a.key}>{t(a.key ? `aiAgent.autonomyLevel.${a.key}` : 'aiAgent.autonomyLevel.default', a.label)}</option>
            ))}
          </select>
          <label htmlFor="coding-ide-image-input" className="text-gray-400 ml-1">{t('aiAgent.coding.imageLabel', 'รูปภาพ')}</label>
          <button
            onClick={() => document.getElementById('coding-ide-image-input')?.click()}
            className={`px-2.5 py-1.5 rounded text-xs font-bold transition ${
              codingImage ? 'bg-emerald-600 text-white' : 'bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-300'
            }`}
          >
            {codingImage ? t('aiAgent.coding.hasImage', 'มีรูปแล้ว') : t('aiAgent.coding.attachImage', 'แนบรูป')}
          </button>
          <input
            id="coding-ide-image-input"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) fileToBase64(f, (b64) => setCodingImage(b64));
              e.target.value = '';
            }}
          />
          {codingImage && (
            <button onClick={() => setCodingImage(null)} className="text-[10px] px-2 py-1 rounded bg-red-900/40 border border-red-800 text-red-300">{t('aiAgent.chat.removeImage', 'ลบรูป')}</button>
          )}
        </div>
        {codingImage && (
          <div className="flex items-center gap-2 mt-2">
            <img src={codingImage} alt={t('aiAgent.chat.imageAlt', 'แนบ')} className="h-12 w-12 object-cover rounded border border-gray-700" />
            <span className="text-[10px] text-gray-500">{t('aiAgent.coding.imagePlanNote', 'รูปนี้จะส่งให้ AI ดูตอนวางแผน (ต้องใช้โมเดลที่รองรับภาพ)')}</span>
          </div>
        )}
      </section>
  );
}
