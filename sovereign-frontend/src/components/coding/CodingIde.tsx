"use client";
// components/coding/CodingIde.tsx
// Coding Agent ในแบบ IDE: toolbar บน → กลาง 70% (สั่งงาน + ดูงาน/โค้ด) → ขวา 30% (แท็บ ไฟล์/งาน&คิว/โน้ต) → เทอร์มินัลล่าง (ย่อได้)
// FE-007: state/handlers → hook 3 ตัว, JSX → component 4 ตัว (ย้าย verbatim) — shell เหลือแค่ประกอบ
import { useState } from 'react';
import { useIsSuperadmin } from '../../lib/roles';
import { useCodingJobs } from './coding-ide/use-coding-jobs';
import { useCodingWorkspace } from './coding-ide/use-coding-workspace';
import { useCodingTerminal } from './coding-ide/use-coding-terminal';
import CodingToolbar from './coding-ide/CodingToolbar';
import CodingMainPane from './coding-ide/CodingMainPane';
import CodingDrawer from './coding-ide/CodingDrawer';
import CodingTerminal from './coding-ide/CodingTerminal';

export default function CodingIde() {
  const isSuperadmin = useIsSuperadmin();

  // ── สถานะแท็บขวา (ใช้ร่วมระหว่าง hook งานกับ drawer) ──
  const [drawerTab, setDrawerTab] = useState<'files' | 'jobs' | 'notes'>('files');

  const {
    models, codingJobs, selectedId, setSelectedId, activeFile, setActiveFile, previewFile, setPreviewFile,
    codingTask, setCodingTask, codingModel, setCodingModel, codingEffort, setCodingEffort,
    codingAutonomy, setCodingAutonomy, codingImage, setCodingImage, codingBusy, codingSuggestions,
    setCodingSuggestions, codingDoneTask, applyBusy, msg, setMsg, err, setErr,
    startCoding, applyCodingJob, deleteCodingJob, fetchSuggestions, fileToBase64,
  } = useCodingJobs({ isSuperadmin, setDrawerTab });

  const {
    projectPath, setProjectPath, savingPath, cwd, entries, browseError, notes, noteInput, setNoteInput,
    listDir, savePath, openFile, addNote, deleteNote,
  } = useCodingWorkspace({ setPreviewFile });

  const { termOpen, setTermOpen, termCmd, setTermCmd, termOut, termBusy, termEndRef, runTerm } = useCodingTerminal();

  const selectedJob = codingJobs.find((j) => j.id === selectedId) || null;
  let plan: any = null;
  let files: Array<{ path: string; content: string }> = [];
  let review: Array<{ severity: string; message: string }> = [];
  if (selectedJob) {
    try { plan = typeof selectedJob.plan_json === 'string' ? JSON.parse(selectedJob.plan_json) : selectedJob.plan_json; } catch { /* noop */ }
    try {
      const parsed = typeof selectedJob.files_json === 'string' ? JSON.parse(selectedJob.files_json) : selectedJob.files_json;
      if (Array.isArray(parsed)) files = parsed;
    } catch { /* noop */ }
    try {
      const res = typeof selectedJob.result === 'string' ? JSON.parse(selectedJob.result) : selectedJob.result;
      if (res?.review) review = res.review;
    } catch { /* noop */ }
  }
  const active = selectedJob ? selectedJob.status === 'queued' || selectedJob.status === 'running' : false;
  const currentFile = activeFile && files.some((f) => f.path === activeFile) ? activeFile : files[0]?.path || null;

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      {/* ── 1. Toolbar: โมเดล + เหตุผล + อัตโนมัติ + รูปภาพ ── */}
      <CodingToolbar
        models={models}
        codingModel={codingModel}
        setCodingModel={setCodingModel}
        codingEffort={codingEffort}
        setCodingEffort={setCodingEffort}
        codingAutonomy={codingAutonomy}
        setCodingAutonomy={setCodingAutonomy}
        codingImage={codingImage}
        setCodingImage={setCodingImage}
        fileToBase64={fileToBase64}
      />

      {/* ── 2. กลาง: main 70% + drawer 30% ── */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0 gap-3">
        <CodingMainPane
          msg={msg}
          setMsg={setMsg}
          err={err}
          setErr={setErr}
          codingBusy={codingBusy}
          isSuperadmin={isSuperadmin}
          startCoding={startCoding}
          codingTask={codingTask}
          setCodingTask={setCodingTask}
          codingJobs={codingJobs}
          codingSuggestions={codingSuggestions}
          setCodingSuggestions={setCodingSuggestions}
          previewFile={previewFile}
          setPreviewFile={setPreviewFile}
          selectedJob={selectedJob}
          active={active}
          plan={plan}
          files={files}
          review={review}
          currentFile={currentFile}
          setActiveFile={setActiveFile}
          fetchSuggestions={fetchSuggestions}
          applyCodingJob={applyCodingJob}
          deleteCodingJob={deleteCodingJob}
          applyBusy={applyBusy}
          codingDoneTask={codingDoneTask}
        />

        <CodingDrawer
          drawerTab={drawerTab}
          setDrawerTab={setDrawerTab}
          browseError={browseError}
          projectPath={projectPath}
          setProjectPath={setProjectPath}
          savePath={savePath}
          savingPath={savingPath}
          listDir={listDir}
          cwd={cwd}
          entries={entries}
          openFile={openFile}
          codingJobs={codingJobs}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          isSuperadmin={isSuperadmin}
          deleteCodingJob={deleteCodingJob}
          models={models}
          noteInput={noteInput}
          setNoteInput={setNoteInput}
          addNote={addNote}
          notes={notes}
          deleteNote={deleteNote}
        />
      </div>

      {/* ── 3. เทอร์มินัลล่าง (ย่อ/ขยาย) ── */}
      <CodingTerminal
        termOpen={termOpen}
        setTermOpen={setTermOpen}
        termOut={termOut}
        termCmd={termCmd}
        setTermCmd={setTermCmd}
        runTerm={runTerm}
        termBusy={termBusy}
        termEndRef={termEndRef}
      />
    </div>
  );
}
