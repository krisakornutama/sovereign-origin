// ── Coding Agent: ไฟล์โปรเจ็ก + โน้ต (ย้ายจาก CodingIde.tsx verbatim — FE-007) ──
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../../../lib/apiFetch';
import { useLanguageStore } from '../../../stores/useLanguageStore';
import { API, FileEntry } from '../coding-ide-shared';

export function useCodingWorkspace(params: {
  setPreviewFile: (v: { path: string; content: string } | null) => void;
}) {
  const { setPreviewFile } = params;
  const t = useLanguageStore((s) => s.t);

  // ── สถานะไฟล์โปรเจ็ก ──
  const [projectPath, setProjectPath] = useState('');
  const [savingPath, setSavingPath] = useState(false);
  const [cwd, setCwd] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [browseError, setBrowseError] = useState('');

  // ── โน้ต ──
  const [notes, setNotes] = useState<any[]>([]);
  const [noteInput, setNoteInput] = useState('');

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
    } catch (errr: any) {
      setBrowseError(String(errr.message || errr));
    }
  }, [t]);

  const loadNotes = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/api/notes`);
      const data = await res.json();
      if (res.ok) setNotes(data.notes || []);
    } catch {
      /* เงียบ */
    }
  }, []);

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
    } catch (errr: any) {
      setBrowseError(String(errr.message || errr));
    }
    setSavingPath(false);
  };

  const openFile = async (path: string) => {
    try {
      const res = await authFetch(`${API}/api/coding/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('aiAgent.coding.readFileFailed', 'อ่านไฟล์ไม่สำเร็จ'));
      setPreviewFile({ path, content: data.content });
    } catch (errr: any) {
      setBrowseError(String(errr.message || errr));
    }
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

  // โหลดครั้งแรก: workspace + โฟลเดอร์ + โน้ต (เดิมอยู่ใน effect เดียวกับ poll งาน — แยกโดยพฤติกรรมเดิม)
  useEffect(() => {
    loadSettings();
    listDir('');
    loadNotes();
  }, [loadSettings, listDir, loadNotes]);

  return {
    projectPath, setProjectPath, savingPath, cwd, entries, browseError, notes, noteInput, setNoteInput,
    loadSettings, listDir, savePath, openFile, loadNotes, addNote, deleteNote,
  };
}
