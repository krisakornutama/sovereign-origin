// ── Coding IDE: กลาง — สั่งงาน + ดูงาน/โค้ด (ย้ายจาก CodingIde.tsx verbatim — FE-007) ──
import { useLanguageStore } from '../../../stores/useLanguageStore';
import Icon from '../../ui/Icon';
import { CodeView } from '../coding-ide-shared';

interface Props {
  msg: string;
  setMsg: (v: string) => void;
  err: string;
  setErr: (v: string) => void;
  codingBusy: boolean;
  isSuperadmin: boolean;
  startCoding: () => void;
  codingTask: string;
  setCodingTask: (v: string) => void;
  codingJobs: any[];
  codingSuggestions: string[];
  setCodingSuggestions: (v: string[]) => void;
  previewFile: { path: string; content: string } | null;
  setPreviewFile: (v: { path: string; content: string } | null) => void;
  selectedJob: any;
  active: boolean;
  plan: any;
  files: Array<{ path: string; content: string }>;
  review: Array<{ severity: string; message: string }>;
  currentFile: string | null;
  setActiveFile: (v: string | null) => void;
  fetchSuggestions: (job: any) => void;
  applyCodingJob: (id: string) => void;
  deleteCodingJob: (id: string) => void;
  applyBusy: string | null;
  codingDoneTask: string;
}

export default function CodingMainPane({
  msg, setMsg, err, setErr, codingBusy, isSuperadmin, startCoding,
  codingTask, setCodingTask, codingJobs, codingSuggestions, setCodingSuggestions,
  previewFile, setPreviewFile, selectedJob, active, plan, files, review, currentFile, setActiveFile,
  fetchSuggestions, applyCodingJob, deleteCodingJob, applyBusy, codingDoneTask,
}: Props) {
  const t = useLanguageStore((s) => s.t);

  return (
        <main className="flex-[7] min-w-0 flex flex-col gap-3 min-h-0">
          {msg && (
            <div className="flex items-center gap-2 px-3 py-2 rounded bg-emerald-900/30 text-emerald-300 border border-emerald-800 text-xs flex-none">
              <span className="flex-1">{msg}</span>
              <button onClick={() => setMsg('')} className="text-gray-500"><Icon name="x" size={12} /></button>
            </div>
          )}
          {err && (
            <div className="flex items-center gap-2 px-3 py-2 rounded bg-red-900/30 text-red-400 border border-red-800 text-xs flex-none">
              <span className="flex-1">{err}</span>
              <button onClick={() => setErr('')} className="text-gray-500"><Icon name="x" size={12} /></button>
            </div>
          )}

          {/* hero prompt */}
          <section className="card panel-glow p-4 space-y-3 flex-none">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('aiAgent.coding.title', 'สั่งงานเขียนโค้ด')}</h2>
              <button
                onClick={startCoding}
                disabled={codingBusy || !isSuperadmin}
                className="btn-primary"
              >
                <Icon name="sparkles" size={13} />
                {codingBusy ? t('aiAgent.coding.working', 'กำลังทำงาน...') : t('aiAgent.coding.writeCode', 'ให้ AI เขียนโค้ดเลย')}
              </button>
            </div>
            <p className="text-[11px] text-gray-500">{t('aiAgent.coding.desc', 'ภาพรวมครั้งเดียว — AI วางแผน → เขียนโค้ดทุกไฟล์ → ตรวจงาน → เสนอทางต่อ (ทำงานเบื้องหลัง)')}</p>
            <textarea
              value={codingTask}
              onChange={(e) => setCodingTask(e.target.value)}
              rows={5}
              placeholder={t('aiAgent.coding.phTask', 'เช่น สร้าง REST API จัดการงานบ้านของลูกเป็นภาษา TypeScript พร้อม auth และทดสอบครบ ใช้ Express + Prisma')}
              className="input w-full font-mono"
            />
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[11px] text-gray-500">{t('aiAgent.coding.specHint', 'ระบุภาษา/เฟรมเวิร์ก/ไฟล์ที่ต้องการ')}</p>
              {codingJobs.length > 0 && (
                <span className="text-[10px] text-gray-600">{t('aiAgent.coding.ide.jobCount', '{n} งานในรายการ', { n: codingJobs.length })}</span>
              )}
            </div>
            {codingSuggestions.length > 0 && (
              <div className="space-y-2 border-t border-gray-800 pt-3">
                <p className="text-sm font-semibold text-emerald-300 glow-text">{t('aiAgent.coding.suggestionsTitle', 'อยากทำอะไรต่อ? (AI คิดให้แล้ว)')}</p>
                <div className="flex flex-wrap gap-2">
                  {codingSuggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => { setCodingTask(s); setCodingSuggestions([]); }}
                      className="px-3 py-1.5 bg-gray-900 border border-emerald-700 text-emerald-200 hover:bg-emerald-900/40 rounded-lg text-xs transition-all"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* job detail / file viewer */}
          <section className="card panel-cyan flex-1 min-h-0 flex flex-col">
            <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between gap-2 flex-none">
              {previewFile ? (
                <>
                  <span className="text-xs font-mono text-emerald-300 truncate flex items-center gap-1.5">
                    <Icon name="file" size={13} />
                    {previewFile.path}
                  </span>
                  <button onClick={() => setPreviewFile(null)} className="text-[10px] px-2 py-1 rounded bg-gray-800 border border-gray-600 text-gray-300">{t('common.close', 'ปิด')}</button>
                </>
              ) : selectedJob ? (
                <>
                  <span className="text-sm font-bold text-gray-200 truncate flex items-center gap-2">
                    <Icon name="code" size={15} className="text-gray-500 shrink-0" />
                    {selectedJob.title}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                      selectedJob.status === 'done' ? 'bg-emerald-900/50 text-emerald-300' :
                      selectedJob.status === 'error' ? 'bg-rose-900/50 text-rose-300' :
                      'bg-emerald-900/60 text-emerald-300 animate-pulse'
                    }`}>
                      {selectedJob.status === 'queued' ? t('aiAgent.coding.statusQueued', 'วางแผน...') : selectedJob.status === 'running' ? t('aiAgent.coding.statusRunning', 'กำลังเขียนโค้ด ({n}%)', { n: selectedJob.progress }) : selectedJob.status === 'done' ? t('aiAgent.coding.statusDone', 'เสร็จ') : t('aiAgent.coding.statusFailed', 'พลาด')}
                    </span>
                  </div>
                </>
              ) : (
                <span className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('aiAgent.coding.jobsTitle', 'งานเขียนโค้ด')}</span>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              {previewFile ? (
                <CodeView content={previewFile.content} />
              ) : selectedJob ? (
                <>
                  <div className="text-xs text-gray-400 bg-gray-950/40 border border-gray-800 rounded px-2 py-1.5">{selectedJob.task}</div>
                  {(selectedJob.model || selectedJob.reasoning_effort || selectedJob.autonomy) && (
                    <div className="text-[10px] text-gray-500">
                      {selectedJob.model || t('aiAgent.coding.defaultLabel', 'ค่าเริ่มต้น')} · {selectedJob.reasoning_effort ? t(`aiAgent.effort.${selectedJob.reasoning_effort}`, selectedJob.reasoning_effort) : t('aiAgent.coding.defaultLabel', 'ค่าเริ่มต้น')} · {selectedJob.autonomy ? t(`aiAgent.autonomyLevel.${selectedJob.autonomy}`, selectedJob.autonomy) : t('aiAgent.coding.defaultLabel', 'ค่าเริ่มต้น')}
                    </div>
                  )}
                  {active && (
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${Math.max(5, selectedJob.progress)}%` }} />
                    </div>
                  )}
                  {selectedJob.status === 'done' && plan && (
                    <div className="text-xs text-gray-300 bg-gray-950/60 border border-gray-800 rounded px-2 py-1.5">
                      <span className="font-bold">{plan.title}</span>{t('aiAgent.coding.planFiles', ' — {n} ไฟล์', { n: plan.files?.length ?? 0 })}
                    </div>
                  )}
                  {selectedJob.status === 'done' && files.length > 0 && (
                    <>
                      <div className="flex gap-1.5 flex-wrap">
                        {files.map((f) => (
                          <button
                            key={f.path}
                            onClick={() => setActiveFile(f.path)}
                            title={f.path}
                            className={`px-2.5 py-1 text-[10px] font-mono rounded border transition ${
                              currentFile === f.path ? 'bg-emerald-800/50 border-emerald-600 text-emerald-200' : 'bg-gray-900 border-gray-700 text-gray-400 hover:bg-gray-800'
                            }`}
                          >
                            {f.path.split('/').pop()}
                          </button>
                        ))}
                      </div>
                      <CodeView content={files.find((f) => f.path === currentFile)?.content || ''} />
                    </>
                  )}
                  {selectedJob.status === 'done' && review.length > 0 && (
                    <div className="bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2 space-y-1">
                      <p className="text-xs font-bold text-gray-300">{t('aiAgent.coding.reviewSummary', 'ผลตรวจงาน ({n} รายการ)', { n: review.length })}</p>
                      {review.map((r, i) => (
                        <p key={i} className={`text-[10px] ${r.severity === 'error' ? 'text-red-400' : r.severity === 'warning' ? 'text-amber-300' : 'text-gray-400'}`}>
                          {r.message}
                        </p>
                      ))}
                    </div>
                  )}
                  {selectedJob.status === 'done' && (
                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      <button
                        onClick={() => fetchSuggestions(selectedJob)}
                        disabled={codingBusy}
                        className="px-3 py-1.5 bg-emerald-800/60 hover:bg-emerald-700/60 border border-emerald-700 rounded-lg text-xs font-semibold transition-all"
                      >
                        {codingBusy && codingDoneTask === selectedJob.id ? t('aiAgent.coding.thinking', 'กำลังคิดอยู่...') : t('aiAgent.coding.aiSuggest', 'AI คิดต่อให้ (2-4 ตัวเลือก)')}
                      </button>
                      <button
                        onClick={() => applyCodingJob(selectedJob.id)}
                        disabled={applyBusy === selectedJob.id}
                        className="px-3 py-1.5 bg-green-700/60 hover:bg-green-600/60 border border-green-700 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                      >
                        {applyBusy === selectedJob.id ? t('aiAgent.coding.applying', 'กำลังเขียนลงโปรเจ็ก...') : t('aiAgent.coding.applyToProject', 'Apply Diff — เขียนลงโปรเจ็ก')}
                      </button>
                      <button
                        onClick={() => { if (window.confirm(t('aiAgent.coding.ide.discardConfirm', 'Discard งานนี้? (ลบออกจากรายการ)'))) deleteCodingJob(selectedJob.id); }}
                        disabled={applyBusy === selectedJob.id}
                        className="px-3 py-1.5 bg-red-900/40 hover:bg-red-800/50 border border-red-800 rounded-lg text-xs font-semibold transition-all"
                      >
                        {t('aiAgent.coding.ide.discardJob', 'Discard')}
                      </button>
                    </div>
                  )}
                  {selectedJob.status === 'error' && (
                    <div className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded px-2 py-1.5">{selectedJob.error}</div>
                  )}
                </>
              ) : (
                <div className="text-gray-500 text-sm text-center py-10 border border-dashed border-gray-700 rounded-lg">
                  {t('aiAgent.coding.ide.viewHint', 'ยังไม่มีงานเขียนโค้ด — พิมพ์ภาพรวมด้านบนเพื่อให้ AI เขียนโค้ด, หรือเลือกงานจากแท็บ ⚡ ด้านขวา')}
                </div>
              )}
            </div>
          </section>
        </main>
  );
}
