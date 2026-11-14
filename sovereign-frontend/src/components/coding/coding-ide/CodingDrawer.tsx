// ── Coding IDE: drawer ขวา — ไฟล์/งาน&คิว/โน้ต (ย้ายจาก CodingIde.tsx verbatim — FE-007) ──
import { useLanguageStore } from '../../../stores/useLanguageStore';
import { fmtLocale } from '../../../lib/formatDate';
import Icon from '../../ui/Icon';
import SkillQueuePanel from '../SkillQueuePanel';
import { FileEntry } from '../coding-ide-shared';

interface Props {
  drawerTab: 'files' | 'jobs' | 'notes';
  setDrawerTab: (v: 'files' | 'jobs' | 'notes') => void;
  browseError: string;
  projectPath: string;
  setProjectPath: (v: string) => void;
  savePath: () => void;
  savingPath: boolean;
  listDir: (dir: string) => void;
  cwd: string;
  entries: FileEntry[];
  openFile: (path: string) => void;
  codingJobs: any[];
  selectedId: string | null;
  setSelectedId: (v: string | null) => void;
  isSuperadmin: boolean;
  deleteCodingJob: (id: string) => void;
  models: string[];
  noteInput: string;
  setNoteInput: (v: string) => void;
  addNote: () => void;
  notes: any[];
  deleteNote: (id: string) => void;
}

export default function CodingDrawer({
  drawerTab, setDrawerTab, browseError, projectPath, setProjectPath, savePath, savingPath,
  listDir, cwd, entries, openFile, codingJobs, selectedId, setSelectedId, isSuperadmin, deleteCodingJob,
  models, noteInput, setNoteInput, addNote, notes, deleteNote,
}: Props) {
  const t = useLanguageStore((s) => s.t);

  return (
        <aside className="flex-[3] min-w-0 lg:max-w-[400px] card panel-cyan flex flex-col min-h-0">
          <div className="flex flex-none border-b border-gray-800">
            {([
              { key: 'files', emoji: '📁', label: t('aiAgent.coding.ide.tabFiles', 'ไฟล์') },
              { key: 'jobs', emoji: '⚡', label: t('aiAgent.coding.ide.tabJobs', 'งาน & คิว') },
              { key: 'notes', emoji: '📝', label: t('aiAgent.coding.ide.tabNotes', 'โน้ต') },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setDrawerTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold transition ${
                  drawerTab === tab.key ? 'bg-emerald-900/40 text-emerald-300 border-b-2 border-emerald-500' : 'text-gray-400 hover:bg-gray-800/50'
                }`}
              >
                <span>{tab.emoji}</span>
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            {/* ── แท็บ: ไฟล์โปรเจ็ก ── */}
            {drawerTab === 'files' && (
              <div className="space-y-3">
                {browseError && <div className="p-2 rounded text-[11px] bg-red-900/30 text-red-400 border border-red-800">{browseError}</div>}
                <div className="flex gap-2">
                  <input
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    placeholder={t('aiAgent.workspace.phProjectPath', 'เช่น E:/My work/Project Sovereign Origin')}
                    className="input flex-1 font-mono"
                  />
                  <button
                    onClick={savePath}
                    disabled={savingPath || !projectPath.trim()}
                    className="btn-primary"
                  >
                    {savingPath ? t('common.saving', 'กำลังบันทึก...') : (
                      <>
                        <Icon name="save" size={13} />
                        {t('aiAgent.workspace.setPath', 'ตั้ง')}
                      </>
                    )}
                  </button>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-gray-400">
                  <button onClick={() => listDir('')} className="px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded flex items-center gap-1"><Icon name="home" size={11} />root</button>
                  <span className="font-mono text-gray-300 truncate">/{cwd}</span>
                  <button onClick={() => listDir(cwd)} className="ml-auto px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded flex items-center gap-1"><Icon name="refresh" size={11} />{t('aiAgent.workspace.reload', 'โหลดใหม่')}</button>
                </div>
                <div className="inset p-2 max-h-[42vh] overflow-y-auto">
                  {entries.length === 0 && <p className="text-gray-500 text-xs text-center py-4">{t('aiAgent.workspace.emptyFolder', '(โฟลเดอร์ว่าง)')}</p>}
                  <div className="grid grid-cols-1 gap-0.5">
                    {entries.map((e) => (
                      <button
                        key={e.path}
                        onClick={() => (e.type === 'dir' ? listDir(e.path) : openFile(e.path))}
                        title={e.path}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-800 text-left"
                      >
                        <span className="text-gray-400 flex items-center shrink-0">
                          <Icon name={e.type === 'dir' ? 'folder' : 'file'} size={13} />
                        </span>
                        <span className="text-xs font-mono text-gray-200 truncate flex-1">{e.name}</span>
                        <span className="text-[9px] text-gray-500">{e.type === 'file' ? `${(e.size / 1024).toFixed(1)}KB` : ''}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── แท็บ: งาน & คิว ── */}
            {drawerTab === 'jobs' && (
              <div className="space-y-3">
                {codingJobs.length === 0 ? (
                  <div className="text-gray-500 text-xs text-center py-6 border border-dashed border-gray-700 rounded-lg">
                    {t('aiAgent.coding.noJobs', 'ยังไม่มีงานเขียนโค้ด — พิมพ์ภาพรวมด้านบนแล้วกด "ให้ AI เขียนโค้ดเลย"')}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {codingJobs.map((j) => {
                      const jActive = j.status === 'queued' || j.status === 'running';
                      return (
                        <div
                          key={j.id}
                          onClick={() => setSelectedId(j.id)}
                          className={`flex items-center gap-2 px-2.5 py-2 rounded cursor-pointer border transition ${
                            selectedId === j.id ? 'bg-emerald-900/30 border-emerald-700/70' : 'bg-gray-900/50 border-gray-800 hover:bg-gray-800/60'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full shrink-0 ${j.status === 'done' ? 'bg-emerald-500' : j.status === 'error' ? 'bg-rose-500' : 'bg-emerald-400 animate-pulse'}`} />
                          <span className="text-xs font-bold text-gray-200 truncate flex-1">{j.title}</span>
                          <span className="text-[9px] text-gray-500 shrink-0">{new Date(j.created_at).toLocaleString(fmtLocale())}</span>
                          {isSuperadmin && !jActive && (
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteCodingJob(j.id); }}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-600 text-gray-500 shrink-0"
                            >
                              <Icon name="trash" size={11} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="border-t border-gray-800 pt-3">
                  <SkillQueuePanel models={models} compact />
                </div>
              </div>
            )}

            {/* ── แท็บ: โน้ต ── */}
            {drawerTab === 'notes' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addNote()}
                    placeholder={t('aiAgent.workspace.phNote', 'จดอะไรก็ได้ เช่น แนวคิด, งานค้าง, ลิงก์...')}
                    className="input flex-1"
                  />
                  <button onClick={addNote} disabled={!noteInput.trim()} className="btn-primary">
                    <Icon name="plus" size={13} />
                    {t('common.save', 'บันทึก')}
                  </button>
                </div>
                <div className="space-y-1.5">
                  {notes.length === 0 && <p className="text-gray-500 text-xs text-center py-4">{t('aiAgent.workspace.noNotes', 'ยังไม่มีโน้ต')}</p>}
                  {notes.map((n) => (
                    <div key={n.id} className="flex items-start gap-2 inset px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-200 whitespace-pre-wrap break-all">{n.content}</p>
                        <p className="text-[9px] text-gray-500 mt-1">{new Date(n.created_at).toLocaleString(fmtLocale())}</p>
                      </div>
                      <button onClick={() => deleteNote(n.id)} className="text-[10px] px-2 py-0.5 rounded bg-gray-800 border border-gray-600 text-gray-500"><Icon name="trash" size={11} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
  );
}
