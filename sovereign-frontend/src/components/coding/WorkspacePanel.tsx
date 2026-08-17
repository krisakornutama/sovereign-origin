// components/coding/WorkspacePanel.tsx
// ไฟล์โปรเจ็ก (ตำแหน่ง + preview) + เทอร์มินัล + ปุ่มโน้ต
import { useEffect, useState, useCallback, useRef } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { fmtLocale } from '../../lib/formatDate';
import Icon from '../ui/Icon';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  mtime: string;
}

export default function WorkspacePanel({ compact }: { compact?: boolean }) {
  const t = useLanguageStore((s) => s.t);
  const [projectPath, setProjectPath] = useState('');
  const [savingPath, setSavingPath] = useState(false);
  const [cwd, setCwd] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [browseError, setBrowseError] = useState('');
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);

  const [termCmd, setTermCmd] = useState('');
  const [termOut, setTermOut] = useState<string[]>([]);
  const [termBusy, setTermBusy] = useState(false);
  const termEndRef = useRef<HTMLDivElement>(null);

  const [notes, setNotes] = useState<any[]>([]);
  const [noteInput, setNoteInput] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/api/coding/workspace`);
      const data = await res.json();
      if (res.ok) setProjectPath(data.projectPath || '');
    } catch {
      /* เงียบ */
    }
  }, []);

  const listDir = useCallback(async (dir: string) => {
    setBrowseError('');
    try {
      const res = await authFetch(`${API}/api/coding/files?path=${encodeURIComponent(dir)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('aiAgent.coding.openDirFailed', 'เปิดโฟลเดอร์ไม่สำเร็จ'));
      setEntries(data.entries || []);
      setCwd(dir);
    } catch (err: any) {
      setBrowseError(String(err.message || err));
    }
  }, []);

  const loadNotes = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/api/notes`);
      const data = await res.json();
      if (res.ok) setNotes(data.notes || []);
    } catch {
      /* เงียบ */
    }
  }, []);

  useEffect(() => {
    loadSettings();
    listDir('');
    loadNotes();
  }, [loadSettings, listDir, loadNotes]);

  useEffect(() => {
    termEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [termOut]);

  const savePath = async () => {
    setSavingPath(true);
    try {
      const res = await authFetch(`${API}/api/coding/workspace`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('aiAgent.coding.changeFailed', 'เปลี่ยนไม่สำเร็จ'));
      await listDir('');
    } catch (err: any) {
      setBrowseError(String(err.message || err));
    }
    setSavingPath(false);
  };

  const openFile = async (path: string) => {
    try {
      const res = await authFetch(`${API}/api/coding/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('aiAgent.coding.readFileFailed', 'อ่านไฟล์ไม่สำเร็จ'));
      setPreview({ path, content: data.content });
    } catch (err: any) {
      setBrowseError(String(err.message || err));
    }
  };

  const runTerm = async () => {
    const cmd = termCmd.trim();
    if (!cmd || termBusy) return;
    setTermBusy(true);
    setTermOut((p) => [...p, `> ${cmd}`]);
    try {
      const res = await authFetch(`${API}/api/coding/terminal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('aiAgent.coding.termFailed', 'รันคำสั่งไม่สำเร็จ'));
      setTermOut((p) => [...p, data.output]);
    } catch (err: any) {
      setTermOut((p) => [...p, String(err.message || err)]);
    }
    setTermBusy(false);
    setTermCmd('');
  };

  const addNote = async () => {
    const text = noteInput.trim();
    if (!text) return;
    try {
      const res = await authFetch(`${API}/api/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) {
        setNoteInput('');
        await loadNotes();
      }
    } catch {
      /* เงียบ */
    }
  };

  const deleteNote = async (id: string) => {
    if (!window.confirm(t('aiAgent.coding.deleteNoteConfirm', 'ลบโน้ตนี้?'))) return;
    try {
      await authFetch(`${API}/api/notes/${id}`, { method: 'DELETE' });
      await loadNotes();
    } catch {
      /* เงียบ */
    }
  };

  return (
    <div className={compact ? 'h-full min-h-0 overflow-y-auto space-y-3 pr-1' : 'space-y-4'}>
      {browseError && <div className="p-3 rounded text-sm bg-red-900/30 text-red-400 border border-red-800">{browseError}</div>}

      {/* ── 📁 ไฟล์โปรเจ็ก ── */}
      <section className={`card panel-cyan space-y-3 ${compact ? 'p-3' : 'p-5'}`}>
        <h3 className="text-sm font-semibold text-gray-200 glow-text-cyan flex items-center gap-2">
          <Icon name="folder" size={14} className="text-gray-400" />
          {t('aiAgent.workspace.filesTitle', 'ไฟล์โปรเจ็ก (ตำแหน่งที่ Coding Agent จัดการได้)')}
        </h3>
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
        <div className="inset p-2 max-h-40 overflow-y-auto">
          {entries.length === 0 && <p className="text-gray-500 text-xs text-center py-4">{t('aiAgent.workspace.emptyFolder', '(โฟลเดอร์ว่าง)')}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-0.5">
            {entries.map((e) => (
              <button
                key={e.path}
                onClick={() => (e.type === 'dir' ? listDir(e.path) : openFile(e.path))}
                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-800 text-left"
              >
                <span className="text-gray-400 flex items-center">
                  <Icon name={e.type === 'dir' ? 'folder' : 'file'} size={13} />
                </span>
                <span className="text-xs font-mono text-gray-200 truncate flex-1">{e.name}</span>
                <span className="text-[9px] text-gray-500">{e.type === 'file' ? `${(e.size / 1024).toFixed(1)}KB` : ''}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── เทอร์มินัล ── */}
      <section className={`card panel-cyan space-y-3 ${compact ? 'p-3' : 'p-5'}`}>
        <h3 className="text-sm font-semibold text-gray-200 glow-text-cyan flex items-center gap-2">
          <Icon name="terminal" size={14} className="text-gray-400" />
          {t('aiAgent.workspace.terminalTitle', 'เทอร์มินัล (รันคำสั่งในเครื่อง — cwd = โปรเจ็ก, กันคำสั่งอันตราย)')}
        </h3>
        <div className="flex gap-2">
          <input
            value={termCmd}
            onChange={(e) => setTermCmd(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runTerm()}
            placeholder={t('aiAgent.workspace.phCommand', 'เช่น git status หรือ dir')}
            className="input flex-1 font-mono"
          />
          <button
            onClick={runTerm}
            disabled={termBusy || !termCmd.trim()}
            className="btn-secondary"
          >
            {termBusy ? t('aiAgent.workspace.running', 'กำลังรัน...') : (
              <>
                <Icon name="play" size={13} />
                {t('common.run', 'รัน')}
              </>
            )}
          </button>
        </div>
        <div className="bg-black border border-gray-800 rounded-lg p-3 h-36 overflow-y-auto font-mono text-[11px] text-emerald-300 space-y-1 log-stream">
          {termOut.length === 0 && <p className="text-gray-600">{t('aiAgent.workspace.terminalHint', '— พิมพ์คำสั่งด้านบน (PowerShell) —')}</p>}
          {termOut.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
          ))}
          <div ref={termEndRef} />
        </div>
      </section>

      {/* ── โน้ต ── */}
      <section className={`card panel-cyan space-y-3 ${compact ? 'p-3' : 'p-5'}`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200 glow-text-cyan flex items-center gap-2">
            <Icon name="note" size={14} className="text-gray-400" />
            {t('aiAgent.workspace.notesTitle', 'โน้ตส่วนตัว ({n})', { n: notes.length })}
          </h3>
          <button onClick={() => setNotesOpen(!notesOpen)} className="text-[11px] px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-gray-300 flex items-center gap-1">
            {notesOpen ? t('common.hide', 'ซ่อน') : t('common.open', 'เปิด')}
            <Icon name="chevron-down" size={11} className={`transition-transform ${notesOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {notesOpen && (
          <>
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
          </>
        )}
      </section>

      {/* ── ปุ่มโน้ตลอย ── */}
      <button
        onClick={() => setNotesOpen(true)}
        className="fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center"
        title={t('aiAgent.workspace.openNotes', 'เปิดโน้ต')}
      >
        <Icon name="note" size={20} />
      </button>

      {/* ── Preview modal ── */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="panel panel-cyan w-full max-w-4xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
              <span className="text-sm font-mono text-emerald-300 truncate flex items-center gap-1.5"><Icon name="file" size={13} />{preview.path}</span>
              <button onClick={() => setPreview(null)} className="px-3 py-1 text-xs rounded bg-gray-800 border border-gray-600 text-gray-300 flex items-center gap-1"><Icon name="x" size={11} />{t('common.close', 'ปิด')}</button>
            </div>
            <div className="p-4 overflow-auto flex-1">
              <pre className="text-xs text-gray-200 font-mono whitespace-pre-wrap break-all">{preview.content}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}