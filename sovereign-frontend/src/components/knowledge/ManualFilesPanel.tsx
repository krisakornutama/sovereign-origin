"use client";
// ── แผงไฟล์คู่มือ (legacy) — ย้าย JSX มาจาก src/pages/knowledge.tsx verbatim ──
import { Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import Icon from '../ui/Icon';

interface ManualFilesPanelProps {
  manualFiles: string[];
  manualFile: string;
  openManual: (file: string) => void;
  manualContent: string;
  setManualContent: Dispatch<SetStateAction<string>>;
  saveManual: () => void;
}

export default function ManualFilesPanel({ manualFiles, manualFile, openManual, manualContent, setManualContent, saveManual }: ManualFilesPanelProps) {
  const t = useLanguageStore((s) => s.t);
  return (
    <div className="card panel-cyan p-4 space-y-2">
      <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5"><Icon name="book" size={14} className="text-gray-400" />{t('knowledge.manual.title', 'คู่มือระบบ ({n})', { n: manualFiles.length })}</h3>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {manualFiles.map((f) => (
          <button
            key={f}
            onClick={() => openManual(f)}
            className={`block w-full text-left px-2 py-1 rounded text-xs ${manualFile === f ? 'bg-gray-800 text-emerald-400' : 'text-gray-400 hover:bg-gray-800'}`}
          >
            {f}
          </button>
        ))}
        {manualFiles.length === 0 && <div className="text-gray-600 text-xs">{t('knowledge.manual.empty', 'ไม่มีไฟล์คู่มือ')}</div>}
      </div>
      {manualFile && (
        <div className="space-y-2">
          <textarea value={manualContent} onChange={(e) => setManualContent(e.target.value)} rows={5} className="w-full bg-gray-800 text-emerald-400 text-xs p-2 rounded border border-gray-600 font-mono" />
          <button onClick={saveManual} className="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs">{t('knowledge.manual.save', 'บันทึกคู่มือ')}</button>
        </div>
      )}
    </div>
  );
}
