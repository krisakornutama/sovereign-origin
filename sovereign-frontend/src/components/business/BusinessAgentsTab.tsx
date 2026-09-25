import EmptyState from '../ui/EmptyState';

// ── แท็บผู้ช่วย AI (แยกจาก BusinessWorkspace — phase 3 ลดหนี้ไฟล์ยักษ์) ──
export function AgentsTab({ agents, agentPrompt, setAgentPrompt, runAgent, runningAgent }: any) {
  return (
    <div className="grid md:grid-cols-2 gap-3">
      {agents.length === 0 && <EmptyState title="ยังไม่มีผู้ช่วย AI" description="เจ้าของธุรกิจกด seed ได้จากแท็บทีม" />}
      {agents.map((a) => (
        <div key={a.id} className={`card p-3 space-y-2 ${a.enabled ? '' : 'opacity-50'}`}>
          <div className="flex items-center gap-2">
            <span className="text-xl">{a.emoji}</span>
            <span className="font-semibold">{a.name}</span>
            <span className="ml-auto text-[10px] text-slate-500">{a.enabled ? 'พร้อมทำงาน' : 'ปิดอยู่'}</span>
          </div>
          <div className="flex gap-1">
            <input value={agentPrompt[a.key] ?? ''} onChange={(e) => setAgentPrompt((s) => ({ ...s, [a.key]: e.target.value }))}
              placeholder={`สั่งงาน ${a.name}…`} className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label={`ภารกิจของ ${a.name}`} />
            <button onClick={() => runAgent(a)} disabled={runningAgent === a.id}
              className="px-3 py-1.5 rounded bg-cyan-600/80 hover:bg-cyan-500 text-sm disabled:opacity-40">▶</button>
          </div>
          {a.latestJob && (
            <div className="text-xs text-slate-400 border-t border-slate-800 pt-2">
              <div>งานล่าสุด: {a.latestJob.status === 'done' ? '✅ เสร็จ' : a.latestJob.status === 'running' ? '⏳ กำลังทำ' : a.latestJob.status === 'error' ? `❌ ${a.latestJob.error ?? 'ผิดพลาด'}` : '… รอคิว'}</div>
              {a.latestJob.result && <div className="mt-1 whitespace-pre-wrap text-slate-300 max-h-40 overflow-auto">{a.latestJob.result}</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
