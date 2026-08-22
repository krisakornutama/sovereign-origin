"use client";
// ── การ์ด "AI สอนลูก" (สร้างบทเรียน + โปรไฟล์เด็ก + ปุ่มเปิดแผงต่างๆ) — ย้าย JSX มาจาก src/pages/knowledge.tsx verbatim ──
import { Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import Icon from '../ui/Icon';
import {
  AGE_OPTIONS, KID_EMOJIS,
  AllowanceHistoryKid, CurriculumOverview, KidHome, KidProfile, KidProgressRow, KidStats, KnowledgeItem,
} from './knowledge-types';

interface TeachCardProps {
  teachTopic: string;
  setTeachTopic: Dispatch<SetStateAction<string>>;
  teachAge: string;
  setTeachAge: Dispatch<SetStateAction<string>>;
  teachQuizCount: number;
  setTeachQuizCount: Dispatch<SetStateAction<number>>;
  teachModel: string;
  setTeachModel: Dispatch<SetStateAction<string>>;
  ollamaModels: string[];
  teaching: boolean;
  teachError: string;
  setTeachError: Dispatch<SetStateAction<string>>;
  runTeachGenerate: () => void;
  items: KnowledgeItem[];
  showAddKid: boolean;
  setShowAddKid: Dispatch<SetStateAction<boolean>>;
  kidForm: { name: string; age: string; emoji: string };
  setKidForm: Dispatch<SetStateAction<{ name: string; age: string; emoji: string }>>;
  createKidUI: () => void;
  kids: KidProfile[];
  kidStats: Record<string, KidStats>;
  activeKidId: string | null;
  setActiveKidId: Dispatch<SetStateAction<string | null>>;
  deleteKidUI: (kid: KidProfile) => void;
  showKidHome: boolean;
  setShowKidHome: Dispatch<SetStateAction<boolean>>;
  kidHome: KidHome | null;
  loadKidHome: (kidId: string) => void;
  showProgress: boolean;
  setShowProgress: Dispatch<SetStateAction<boolean>>;
  allProgress: Record<string, KidProgressRow[]>;
  loadAllProgress: () => void;
  showAllowanceHistory: boolean;
  setShowAllowanceHistory: Dispatch<SetStateAction<boolean>>;
  allowanceHistory: AllowanceHistoryKid[] | null;
  loadAllowanceHistory: () => void;
  showCurriculum: boolean;
  setShowCurriculum: Dispatch<SetStateAction<boolean>>;
  curriculum: CurriculumOverview | null;
  loadCurriculum: () => void;
  kidProgress: KidProgressRow[];
  savedLessons: KnowledgeItem[];
  openSavedLesson: (item: KnowledgeItem) => void;
}

export default function TeachCard({
  teachTopic, setTeachTopic, teachAge, setTeachAge, teachQuizCount, setTeachQuizCount, teachModel, setTeachModel,
  ollamaModels, teaching, teachError, setTeachError, runTeachGenerate, items,
  showAddKid, setShowAddKid, kidForm, setKidForm, createKidUI, kids, kidStats, activeKidId, setActiveKidId, deleteKidUI,
  showKidHome, setShowKidHome, kidHome, loadKidHome,
  showProgress, setShowProgress, allProgress, loadAllProgress,
  showAllowanceHistory, setShowAllowanceHistory, allowanceHistory, loadAllowanceHistory,
  showCurriculum, setShowCurriculum, curriculum, loadCurriculum,
  kidProgress, savedLessons, openSavedLesson,
}: TeachCardProps) {
  const t = useLanguageStore((s) => s.t);
  return (
    <div className="card p-4 space-y-3" id="teach-card">
      <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5"><Icon name="ai-agent" size={14} className="text-gray-400" />{t('knowledge.teach.title', 'AI สอนลูก')}</h3>
      <div className="text-[10px] text-gray-500 leading-relaxed">
        {t('knowledge.teach.desc', 'เลือกหัวข้อ + ระดับอายุ แล้ว AI สร้างบทเรียนและแบบทดสอบจากข้อมูลในคลังความรู้ (Ollama ทำงานในเครื่อง)')}
      </div>
      <input
        value={teachTopic}
        onChange={(e) => setTeachTopic(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && runTeachGenerate()}
        placeholder={t('knowledge.teach.topicPh', 'หัวข้อ เช่น ระบบสุริยะ, การประหยัดน้ำ...')}
        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
      />
      <select
        value={teachAge}
        onChange={(e) => setTeachAge(e.target.value)}
        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
      >
        {AGE_OPTIONS.map((a) => <option key={a.id} value={a.id}>{t(`knowledge.age.${a.id}`, a.label)}</option>)}
      </select>
      <div className="flex gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-gray-500 mb-0.5">{t('knowledge.teach.quizCount', 'จำนวนข้อแบบทดสอบ')}</div>
          <select
            value={teachQuizCount}
            onChange={(e) => setTeachQuizCount(Number(e.target.value))}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
          >
            {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{t('knowledge.teach.quizCountOption', '{n} ข้อ', { n })}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-gray-500 mb-0.5">{t('knowledge.teach.model', 'โมเดล AI')}</div>
          <select
            value={teachModel}
            onChange={(e) => setTeachModel(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
          >
            <option value="">{t('knowledge.teach.defaultModel', 'เริ่มต้นของระบบ')}</option>
            {ollamaModels.map((m) => (
              <option key={m} value={m}>{m.replace(/:latest$/, '')}</option>
            ))}
          </select>
        </div>
      </div>
      <button
        onClick={runTeachGenerate}
        disabled={teaching}
        className="w-full btn-primary"
      >
        {teaching ? t('knowledge.teach.generating', 'AI กำลังสร้างบทเรียน...') : <><Icon name="sparkles" size={14} /> {t('knowledge.teach.generate', 'สร้างบทเรียน + แบบทดสอบ')}</>}
      </button>
      {teachError && <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/40 rounded p-2 leading-relaxed">{teachError}</div>}

      {/* หัวข้อแนะนำจากรายการที่มีอยู่ในคลัง */}
      {items.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-gray-500">{t('knowledge.teach.topics', 'หัวข้อจากคลังความรู้:')}</div>
          <div className="flex flex-wrap gap-1">
            {items.slice(0, 6).map((it) => (
              <button
                key={it.id}
                onClick={() => { setTeachTopic(it.title); setTeachError(''); }}
                className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400 hover:border-emerald-600 hover:text-emerald-400"
              >
                {it.title.length > 24 ? it.title.slice(0, 24) + '…' : it.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* โปรไฟล์เด็ก — เลือกคนที่เรียน แล้วคะแนนจะบันทึกให้อัตโนมัติ */}
      <div className="border-t border-gray-800 pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-gray-500">{t('knowledge.teach.kidProfile', 'โปรไฟล์เด็ก (บันทึกคะแนนให้คนที่เลือก):')}</div>
          <button onClick={() => { setShowAddKid(!showAddKid); setTeachError(''); }} className="text-[10px] px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-600">
            {showAddKid ? t('common.close', 'ปิด') : t('common.add', 'เพิ่ม')}
          </button>
        </div>

        {showAddKid && (
          <div className="space-y-2 inset p-2">
            <div className="flex gap-2">
              <input
                value={kidForm.name}
                onChange={(e) => setKidForm({ ...kidForm, name: e.target.value })}
                placeholder={t('knowledge.teach.kidNamePh', 'ชื่อเล่น เช่น น้องน้ำ')}
                className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              />
              <input
                value={kidForm.age}
                onChange={(e) => setKidForm({ ...kidForm, age: e.target.value })}
                placeholder={t('knowledge.teach.agePh', 'อายุ')}
                type="number"
                min={0}
                max={18}
                className="w-14 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {KID_EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => setKidForm({ ...kidForm, emoji: e })}
                  className={`text-base w-7 h-7 rounded flex items-center justify-center ${kidForm.emoji === e ? 'bg-emerald-600' : 'bg-gray-800 hover:bg-gray-700'}`}
                >{e}</button>
              ))}
            </div>
            <button onClick={createKidUI} className="w-full bg-emerald-600 hover:bg-emerald-500 py-1 rounded text-xs font-semibold">{t('knowledge.teach.addProfile', 'เพิ่มโปรไฟล์')}</button>
          </div>
        )}

        {kids.length === 0 ? (
          <div className="text-[10px] text-gray-600">{t('knowledge.teach.noKids', 'ยังไม่มีโปรไฟล์ — กด "เพิ่ม" เพื่อบันทึกคะแนนและบทเรียนที่เรียนจบของแต่ละคน')}</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {kids.map((k) => {
              const st = kidStats[k.id];
              const active = activeKidId === k.id;
              return (
                <div key={k.id} className={`relative rounded-lg border px-2 py-1 text-[11px] ${active ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-300 shadow-neon-green' : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'}`}>
                  <button onClick={() => setActiveKidId(active ? null : k.id)} className="flex items-center gap-1">
                    <span>{k.emoji || '🧒'}</span>
                    <span className="font-semibold">{k.name}</span>
                    <span className="text-[9px] text-gray-500">
                      {st ? t('knowledge.teach.kidStats', '{n} บทเรียน · เฉลี่ย {avg}%', { n: st.attempts, avg: st.avg ?? 0 }) : t('knowledge.teach.notStarted', 'ยังไม่เริ่ม')}
                    </span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteKidUI(k); }}
                    title={t('knowledge.teach.deleteKidTitle', 'ลบ {name}', { name: k.name })}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-700 text-[9px] text-white leading-none"
                  >✕</button>
                </div>
              );
            })}
          </div>
        )}

        {/* หน้าที่ของลูก + สรุปความคืบหน้า + ประวัติค่าขนม */}
        {kids.length > 0 && (
          <div className="flex gap-1.5 pt-0.5">
            <button
              onClick={() => { setShowKidHome(!showKidHome); setShowProgress(false); setShowAllowanceHistory(false); if (!kidHome && !showKidHome && activeKidId) loadKidHome(activeKidId); }}
              disabled={!activeKidId}
              className={`flex-1 text-[10px] px-2 py-1.5 rounded border ${showKidHome ? 'bg-emerald-600 border-emerald-600 text-white shadow-neon-green' : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {showKidHome ? t('knowledge.teach.closeHome', 'ปิดหน้าบ้าน') : t('knowledge.teach.kidHome', 'หน้าที่ของลูก')}
            </button>
            <button
              onClick={() => { setShowProgress(!showProgress); setShowKidHome(false); setShowAllowanceHistory(false); if (!showProgress && Object.keys(allProgress).length === 0) loadAllProgress(); }}
              className={`flex-1 text-[10px] px-2 py-1.5 rounded border ${showProgress ? 'bg-emerald-600 border-emerald-600 text-white shadow-neon-green' : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'}`}
            >
              {showProgress ? t('knowledge.teach.closeProgress', 'ปิดสรุป') : t('knowledge.teach.allProgress', 'ความคืบหน้าทุกคน')}
            </button>
<button
              onClick={() => { setShowAllowanceHistory(!showAllowanceHistory); setShowKidHome(false); setShowProgress(false); if (!showAllowanceHistory && !allowanceHistory) loadAllowanceHistory(); }}
              className={`text-[10px] px-2 py-1.5 rounded border ${showAllowanceHistory ? 'bg-emerald-600 border-emerald-600 text-white shadow-neon-green' : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'}`}
            >
              {showAllowanceHistory ? '✕' : t('knowledge.teach.allowance', 'ค่าขนม')}
            </button>
            <button
              onClick={() => { setShowCurriculum(!showCurriculum); setShowKidHome(false); setShowProgress(false); setShowAllowanceHistory(false); if (!showCurriculum && !curriculum) loadCurriculum(); }}
              className={`text-[10px] px-2 py-1.5 rounded border ${showCurriculum ? 'bg-emerald-600 border-emerald-600 text-white shadow-neon-green' : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'}`}
            >
              {showCurriculum ? '✕' : t('knowledge.curriculum.title', 'หลักสูตร')}
            </button>
          </div>
        )}

        {/* บทเรียนที่เรียนจบของเด็กที่เลือก */}
        {activeKidId && kidProgress.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-gray-500">{t('knowledge.teach.completed', 'เรียนจบแล้ว ({n}):', { n: kidProgress.length })}</div>
            <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
              {kidProgress.slice(0, 6).map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 text-[10px] bg-gray-950/40 border border-gray-800 rounded px-2 py-1">
                  <span className="truncate text-gray-400">{p.lesson_title}</span>
                  <span className={`shrink-0 font-bold ${p.score === p.total ? 'text-emerald-400' : 'text-amber-400'}`}>{p.score}/{p.total}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* บทเรียนที่เก็บไว้แล้ว */}
      {savedLessons.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-gray-500">{t('knowledge.teach.savedLessons', 'บทเรียนที่เก็บไว้ ({n}):', { n: savedLessons.length })}</div>
          <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
            {savedLessons.map((it) => (
              <button
                key={it.id}
                onClick={() => openSavedLesson(it)}
                className="block w-full text-left px-2 py-1 rounded text-[11px] bg-gray-800/60 hover:bg-gray-800 text-gray-300 border border-gray-700"
              >
                {it.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
