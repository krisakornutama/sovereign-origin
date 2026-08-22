"use client";
// ── Sovereign Curriculum — หลักสูตรสร้างยอดคน (โฮมสคูล) — ย้าย JSX มาจาก src/pages/knowledge.tsx verbatim ──
import { Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { fmtLocale } from '../../lib/formatDate';
import Icon from '../ui/Icon';
import { CurriculumOverview } from './knowledge-types';

interface CurriculumPanelProps {
  curriculum: CurriculumOverview | null;
  activeKidId: string | null;
  setActiveKidId: Dispatch<SetStateAction<string | null>>;
  curTrackFilter: string | null;
  setCurTrackFilter: Dispatch<SetStateAction<string | null>>;
  recordForm: { itemId: string; title: string; score: string; total: string } | null;
  setRecordForm: Dispatch<SetStateAction<{ itemId: string; title: string; score: string; total: string } | null>>;
  recordCurriculum: () => void;
  curBusy: boolean;
  setTeachTopic: Dispatch<SetStateAction<string>>;
  setTeachError: Dispatch<SetStateAction<string>>;
}

export default function CurriculumPanel({ curriculum, activeKidId, setActiveKidId, curTrackFilter, setCurTrackFilter, recordForm, setRecordForm, recordCurriculum, curBusy, setTeachTopic, setTeachError }: CurriculumPanelProps) {
  const t = useLanguageStore((s) => s.t);

  const startLessonFromCurriculum = (title: string) => {
    setTeachTopic(title);
    setTeachError('');
    document.getElementById('teach-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="card panel-cyan p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-gray-200 glow-text-cyan flex items-center gap-1.5"><Icon name="graduation-cap" size={14} className="text-gray-400" />{t('knowledge.curriculum.fullTitle', 'หลักสูตรสร้างยอดคน (โฮมสคูล)')}</h3>
          <div className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">{t('knowledge.curriculum.subtitle', 'สาขาวิชาที่เรียนได้จริงที่บ้าน — เรียนจบครบทุกบทของสาขา ได้เกียรติบัตรจบสาขาอัตโนมัติ')}</div>
        </div>
      </div>

      {!curriculum ? (
        <div className="text-xs text-gray-400 py-6 text-center">{t('common.loading', 'กำลังโหลด...')}</div>
      ) : curriculum.kids.length === 0 ? (
        <div className="text-xs text-gray-500 py-3 text-center">{t('knowledge.curriculum.noKids', 'เพิ่มโปรไฟล์เด็กก่อน — กด "เพิ่ม" หน้า AI สอนลูก แล้วเลือกลูก')}</div>
      ) : (
        <>
          {/* สรุปต่อคน — จำนวนสาขาที่จบแล้ว */}
          <div className="flex flex-wrap gap-2">
            {curriculum.kids.map((k) => {
              const active = activeKidId === k.id;
              const doneCount = k.completed_tracks.length;
              return (
                <div
                  key={k.id}
                  onClick={() => setActiveKidId(k.id)}
                  className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[11px] ${active ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-300 shadow-neon-green' : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'}`}
                >
                  <span>{k.emoji || '🧒'} {k.name}</span>
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${doneCount > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-gray-900 text-gray-500'}`}>
                    🎓 {doneCount}/{curriculum.tracks.length}
                  </span>
                </div>
              );
            })}
          </div>

          {!activeKidId ? (
            <div className="text-xs text-amber-400 py-3 text-center">{t('knowledge.curriculum.selectKid', 'เลือกลูกเพื่อดู/บันทึกความคืบหน้าหลักสูตร')}</div>
          ) : (
            <>
              {/* เลือกสาขา */}
              <div className="flex flex-wrap gap-1.5">
                {curriculum.tracks.map((tr) => {
                  const kid = curriculum.kids.find((k) => k.id === activeKidId);
                  const prog = kid?.per_track?.[tr.id];
                  const pct = prog ? Math.round((prog.done.length / Math.max(1, prog.total)) * 100) : 0;
                  const selected = curTrackFilter === tr.id;
                  return (
                    <button
                      key={tr.id}
                      onClick={() => setCurTrackFilter(selected ? null : tr.id)}
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 ${selected ? 'bg-cyan-600 border-cyan-500 text-white shadow-neon-cyan' : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'}`}
                      style={selected ? { borderColor: tr.color } : undefined}
                    >
                      <span>{tr.emoji}</span>
                      <span>{tr.code.replace(/_/g, ' ')}</span>
                      {prog && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${prog.completed ? 'bg-amber-500/20 text-amber-300' : 'bg-gray-900 text-gray-400'}`}>
                          {prog.done.length}/{prog.total}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* รายการบทเรียนของสาขาที่เลือก */}
              {curTrackFilter && (
                <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                  {(() => {
                    const tr = curriculum.tracks.find((t) => t.id === curTrackFilter);
                    if (!tr) return null;
                    const kid = curriculum.kids.find((k) => k.id === activeKidId);
                    const done = kid?.per_track?.[tr.id]?.done || [];
                    const allDone = kid?.per_track?.[tr.id]?.completed || false;
                    return (
                      <div className="inset p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <h4 className="text-sm font-bold text-gray-200">
                            <span style={{ color: tr.color }}>{tr.emoji}</span> {tr.title}
                          </h4>
                          {allDone && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold">🎓 {t('knowledge.curriculum.completed', 'จบสาขาแล้ว')}</span>
                          )}
                        </div>
                        {tr.description && <div className="text-[10px] text-gray-500 leading-relaxed">{tr.description}</div>}
                        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(4, (done.length / Math.max(1, tr.items.length)) * 100)}%`, background: tr.color }} />
                        </div>
                        <div className="space-y-1.5 pt-1">
                          {tr.items.map((it) => {
                            const isDone = done.includes(it.id);
                            const editing = recordForm?.itemId === it.id;
                            return (
                              <div key={it.id} className={`rounded-lg border px-2.5 py-2 space-y-1.5 ${isDone ? 'border-emerald-600/40 bg-emerald-500/5' : 'border-gray-700 bg-gray-900/40'}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${isDone ? 'bg-emerald-500 text-black' : 'bg-gray-800 text-gray-600 border border-gray-700'}`}>{isDone ? '✓' : it.sequence}</span>
                                    <div className="min-w-0">
                                      <div className="text-[11px] font-semibold text-gray-200 truncate">{it.title}</div>
                                      {it.description && <div className="text-[10px] text-gray-500 leading-snug">{it.description}</div>}
                                    </div>
                                  </div>
                                  {!isDone && (
                                    <div className="flex shrink-0 gap-1">
                                      <button
                                        onClick={() => startLessonFromCurriculum(it.title)}
                                        title={t('knowledge.curriculum.buildLesson', 'สร้างบทเรียนจากหัวข้อนี้')}
                                        className="px-2 py-1 rounded bg-cyan-700 hover:bg-cyan-600 text-[10px] font-semibold inline-flex items-center gap-1"
                                      >
                                        <Icon name="sparkles" size={10} />{t('knowledge.curriculum.buildLesson', 'สร้างบทเรียน')}
                                      </button>
                                      <button
                                        onClick={() => { setRecordForm(editing ? null : { itemId: it.id, title: it.title, score: '', total: '5' }); }}
                                        className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-[10px] font-semibold"
                                      >
                                        {t('knowledge.curriculum.record', 'บันทึกจบ')}
                                      </button>
                                    </div>
                                  )}
                                </div>
                                {editing && (
                                  <div className="flex items-end gap-2 pt-1">
                                    <div className="flex-1">
                                      <div className="text-[9px] text-gray-500 mb-0.5">{t('knowledge.curriculum.score', 'คะแนนถูก')}</div>
                                      <input
                                        type="number" min={0} value={recordForm.score}
                                        onChange={(e) => setRecordForm({ ...recordForm, score: e.target.value })}
                                        className="w-16 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs"
                                      />
                                    </div>
                                    <div className="flex-1">
                                      <div className="text-[9px] text-gray-500 mb-0.5">{t('knowledge.curriculum.total', 'จำนวนข้อ')}</div>
                                      <input
                                        type="number" min={1} value={recordForm.total}
                                        onChange={(e) => setRecordForm({ ...recordForm, total: e.target.value })}
                                        className="w-16 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs"
                                      />
                                    </div>
                                    <button
                                      onClick={recordCurriculum}
                                      disabled={curBusy}
                                      className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-[11px] font-bold disabled:opacity-50"
                                    >
                                      {curBusy ? t('common.saving', 'กำลังบันทึก...') : t('common.save', 'บันทึก')}
                                    </button>
                                    <button onClick={() => setRecordForm(null)} className="px-2 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-[11px]">✕</button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* เกียรติบัตรจบสาขา */}
              {curriculum.certificates.filter((c) => c.kid_id === activeKidId).length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-bold text-gray-400">{t('knowledge.curriculum.certificatesTitle', 'เกียรติบัตรจบสาขา')}</div>
                  {curriculum.certificates
                    .filter((c) => c.kid_id === activeKidId)
                    .slice(0, 5)
                    .map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-[11px] bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
                        <span className="text-amber-400">🎓</span>
                        <span className="flex-1 truncate text-gray-200 font-semibold">{c.title}</span>
                        <span className="shrink-0 text-gray-500">{new Date(c.created_at).toLocaleDateString(fmtLocale())}</span>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
