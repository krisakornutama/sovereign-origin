"use client";
import { useState } from 'react';
import { useIsSuperadmin } from '../lib/roles';
import Link from 'next/link';
import { useAuthStore } from '../stores/useAuthStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';
import { authFetch } from '../lib/apiFetch';
import { AUTONOMY_META, fmtArgs, fmtTime } from '../lib/ai-agent-types';
import type { AutonomyLevel } from '../lib/ai-agent-types';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import EmptyState from '../components/ui/EmptyState';
import { SkeletonGrid } from '../components/ui/SkeletonCard';
import CodingIde from '../components/coding/CodingIde';
import { useAiChat } from '../components/ai-agent/use-ai-chat';
import { useAiTeam } from '../components/ai-agent/use-ai-team';
import { useAiPolicy } from '../components/ai-agent/use-ai-policy';

export default function AiAgentPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const isSuperadmin = useIsSuperadmin();

  // ── ข้อความแจ้งผล/ผิดพลาด — แชท/ทีม/นโยบาย ใช้ร่วมกันผ่าน hook ──
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // แท็บ: policy (เดิม) | team (ทีม Agent) | jobs (งานเบื้องหลัง) | coding (Coding Agent แบบ IDE — อยู่ใน CodingIde)
  const [tab, setTab] = useState<'policy' | 'team' | 'jobs' | 'coding'>('policy');

  // ── state/handlers แยกตาม domain (FE-005: ย้ายจากหน้านี้แบบ verbatim) ──
  const {
    chatMsgs, chatLoaded, chatInput, setChatInput, chatLoading, chatError,
    chatImage, setChatImage, chatEndRef, fileToBase64, sendChat,
  } = useAiChat(isHydrated, isAuthenticated);

  const {
    roles, jobs, roleForm, setRoleForm, runPrompt, setRunPrompt, teamBusy, jobsLoading,
    loadRoles, loadJobs, createRole, updateRole, deleteRole, runRole, cancelJob, deleteJob,
  } = useAiTeam({ isSuperadmin, tab, setTab, setMessage, setError });

  const {
    policy, approvals, loading, status, busyId,
    changeAutonomy, decideApproval,
  } = useAiPolicy({ isSuperadmin, isHydrated, isAuthenticated, setMessage, setError });

  if (!isHydrated) {
    // C6: skeleton หน้า AI Agent แทนข้อความเฉย ๆ
    return (
      <div className="min-h-screen bg-gray-950 p-4 lg:p-6 max-w-7xl mx-auto">
        <SkeletonGrid count={4} className="!grid-cols-1 md:!grid-cols-2" />
        <p className="sr-only">{t('dashboard.aiChat.skeletonPage', 'กำลังโหลดแดชบอร์ด...')}</p>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">{t('aiAgent.unauthorized', 'Unauthorized')}</div>;
  }

  const pending = approvals.filter((a) => a.status === 'pending');
  const history = approvals.filter((a) => a.status !== 'pending');

  return (
    <div className="atmo-power min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <PageHeader
          eyebrow={t('aiAgent.eyebrow', 'ความปลอดภัย')}
          title="AI Agent — ทีมงานอัตโนมัติของบ้าน" theme="power" icon={<Icon name="ai-agent" size={18} />}
          subtitle="ตั้งเป้าหมาย ปล่อยทีม Agent ลงมือเอง แล้วตรวจผลทีเดียว" actions={<Link href="/dashboard" scroll={false} className="text-sm text-sky-400 hover:underline">{t('aiAgent.backDashboard', '← กลับ Dashboard')}</Link>}
        />

      {/* ── แท็บ: นโยบาย / ทีม Agent / งานเบื้องหลัง ── */}
      <div className="max-w-5xl mx-auto px-6 pt-4 flex gap-2 flex-wrap">
        {([
          ['policy', 'นโยบาย + อนุมัติ', 'tabPolicy'],
          ['team', 'ทีม Agent', 'tabTeam'],
          ['coding', 'Coding Agent', 'tabCoding'],
          ['jobs', 'งานเบื้องหลัง', 'tabJobs'],
        ] as const).map(([key, label, tKey]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-t-lg text-sm font-bold border-b-2 transition ${
              tab === key
                ? 'bg-gray-900 border-emerald-500 text-emerald-300 shadow-neon-green'
                : 'bg-gray-800/40 border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {t('aiAgent.' + tKey, label)}
          </button>
        ))}
      </div>

      <main className={`${tab === 'coding' ? 'max-w-[1680px]' : 'max-w-5xl'} mx-auto w-full pt-4 space-y-6`}>
        {message && <div className="card p-3 text-sm text-emerald-400">{message}</div>}
        {error && <div className="card p-3 text-sm text-rose-400">{error}</div>}

        {tab === 'policy' && (
          <>

        {/* ── สถานะ AI: โมเดล + ทรัพยากร ── */}
        <section className="card panel-cyan p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('aiAgent.status.title', 'สถานะ AI Agent')}</h2>
            <span className={`text-xs px-2 py-1 rounded font-bold ${status?.ollamaOnline ? 'bg-emerald-900/50 text-emerald-300' : 'bg-rose-900/50 text-rose-300'}`}>
              {status ? (status.ollamaOnline ? t('aiAgent.status.ollamaOnline', 'Ollama ออนไลน์') : t('aiAgent.status.ollamaOffline', 'Ollama ออฟไลน์')) : t('aiAgent.status.checking', 'กำลังตรวจสอบ...')}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="inset px-3 py-2">
              <div className="text-xs text-gray-500">{t('aiAgent.status.modelInUse', 'โมเดลที่ใช้')}</div>
              <div className="font-bold text-emerald-300 break-all glow-text">{status?.currentModel || '—'}</div>
              <div className="text-[10px] text-gray-600 break-all">{status?.ollamaUrl}</div>
            </div>
            <div className="inset px-3 py-2">
              <div className="text-xs text-gray-500">{t('aiAgent.status.localModels', 'โมเดลในเครื่อง')}</div>
              <div className="font-bold text-white glow-text">{t('aiAgent.status.modelCount', '{n} ตัว', { n: status?.models?.length ?? '—' })}</div>
              <div className="text-[10px] text-gray-600">{(status?.models || []).slice(0, 3).map((m) => m.name).join(', ') || '—'}</div>
            </div>
            <div className="inset px-3 py-2">
              <div className="text-xs text-gray-500">CPU</div>
              <div className="font-bold text-cyan-300 glow-text-cyan">{status?.resources.cpuUsagePercent != null ? `${status.resources.cpuUsagePercent}%` : '—'}</div>
              <div className="text-[10px] text-gray-600">{status?.resources.cpuCores ?? '—'} cores</div>
            </div>
            <div className="inset px-3 py-2">
              <div className="text-xs text-gray-500">RAM</div>
              <div className="font-bold text-amber-300 glow-text">{status?.resources.memoryUsedPercent != null ? `${status.resources.memoryUsedPercent}%` : '—'}</div>
              <div className="text-[10px] text-gray-600">{status ? t('aiAgent.status.ramFree', '{free} / {total} GB ว่าง', { free: status.resources.memoryFreeGb, total: status.resources.memoryTotalGb }) : '—'}</div>
            </div>
          </div>
        </section>

        {/* ── ทำงานกับ AI: แชท ── */}
        <section className="card panel-glow p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('aiAgent.chat.title', 'ทำงานกับ AI')}</h2>
          <p className="text-xs text-gray-500">
            {t('aiAgent.chat.desc', 'ถามได้ทุกเรื่อง — ตรวจข้อมูลเซ็นเซอร์ / หาคู่มือจากคลังความรู้ / สั่ง block IP หรือ kill process (ขึ้นกับระดับ autonomy)')}
          </p>

          <div className="h-72 overflow-y-auto space-y-3 log-stream">
            {chatMsgs.length === 0 && chatLoaded && (
              <div className="text-gray-600 text-sm text-center py-10">
                {t('aiAgent.chat.empty', 'ยังไม่มีข้อความ — พิมพ์ด้านล่างเพื่อเริ่มคุยกับ AI')}
              </div>
            )}
            {chatMsgs.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-xl text-sm whitespace-pre-wrap leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-emerald-900/40 border border-emerald-800 text-emerald-100'
                      : 'bg-gray-800 border border-gray-700 text-gray-200'
                  }`}
                >
                  {m.content}
                  <div className="text-[9px] text-gray-500 mt-1">{new Date(m.created_at).toLocaleTimeString(fmtLocale())}</div>
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="text-gray-500 text-sm">{t('aiAgent.chat.thinking', 'AI กำลังคิด...')}</div>
            )}
            <div ref={chatEndRef} />
          </div>
          {chatError && <p className="card p-2 text-sm text-rose-400">{chatError}</p>}
          <div className="flex flex-wrap gap-1.5">
            {[
              { key: 'battery', q: 'แบตเตอรี่เหลือเท่าไหร่' },
              { key: 'waterLevel', q: 'ระดับน้ำตอนนี้' },
              { key: 'connectivity', q: 'ตรวจสอบการเชื่อมต่อ' },
              { key: 'gardenManual', q: 'หาคู่มือการปลูกผัก' },
            ].map((qq) => (
              <button
                key={qq.q}
                onClick={() => { setChatInput(qq.q); }}
                className="btn-secondary text-[11px] px-2 py-1 rounded-full"
              >
                {t('aiAgent.chat.quick.' + qq.key, qq.q)}
              </button>
            ))}
          </div>
          {chatImage && (
            <div className="flex items-center gap-2">
              <img src={chatImage} alt={t('aiAgent.chat.imageAlt', 'แนบ')} className="h-14 w-14 object-cover rounded border border-gray-700" />
              <span className="text-[10px] text-gray-500">{t('aiAgent.chat.imageNote', 'จะส่งให้ AI ดูด้วย (ต้องใช้โมเดลรองรับภาพ เช่น qwen3-vl)')}</span>
              <button onClick={() => setChatImage(null)} className="text-[10px] px-2 py-1 rounded bg-red-900/40 border border-red-800 text-red-300">{t('aiAgent.chat.removeImage', 'ลบรูป')}</button>
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendChat()}
              placeholder={t('aiAgent.chat.placeholder', 'ถาม เช่น แบตเตอรี่เหลือเท่าไหร่? หรือ block IP 1.2.3.4')}
              className="input flex-1"
            />
            <button
              onClick={() => document.getElementById('chat-image-input')?.click()}
              className="btn-secondary text-sm"
              title={t('aiAgent.chat.attachImage', 'แนบรูปภาพ')}
            >
              <Icon name="image" size={15} />
            </button>
            <input
              id="chat-image-input"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) fileToBase64(f, (b64) => setChatImage(b64));
                e.target.value = '';
              }}
            />
            <button
              onClick={sendChat}
              disabled={chatLoading || (!chatInput.trim() && !chatImage)}
              className="btn-primary"
            >
              {chatLoading ? t('aiAgent.chat.sending', 'กำลังส่ง...') : t('common.send', 'ส่ง')}
            </button>
          </div>
        </section>

        {/* ── ระดับ Autonomy ── */}
        <section className="card panel-glow p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('aiAgent.autonomy.title', 'ระดับ Autonomy')}</h2>
            {!isSuperadmin && (
              <span className="text-xs px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-400">
                {t('aiAgent.autonomy.superadminOnly', 'เปลี่ยนได้เฉพาะ SUPERADMIN')}
              </span>
            )}
          </div>

          {!policy && loading ? (
            <div className="text-gray-500 text-sm">{t('aiAgent.autonomy.loadingPolicy', 'กำลังโหลดนโยบาย...')}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(Object.keys(AUTONOMY_META) as AutonomyLevel[]).map((level) => {
                const meta = AUTONOMY_META[level];
                const active = policy?.autonomy === level;
                return (
                  <button
                    key={level}
                    onClick={() => changeAutonomy(level)}
                    disabled={!isSuperadmin}
                    title={isSuperadmin ? t('aiAgent.autonomy.setTo', 'ตั้งเป็น {label}', { label: t(`aiAgent.autonomy.${level}.label`, meta.label) }) : t('aiAgent.autonomy.superadminOnlyShort', 'เฉพาะ SUPERADMIN เท่านั้น')}
                    className={`text-left p-4 rounded-xl border transition ${
                      active
                        ? `border-2 ${meta.active}`
                        : `bg-gray-800/50 border ${meta.color} opacity-90 hover:opacity-100`
                    } ${!isSuperadmin ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    <div className="font-bold text-sm">{t(`aiAgent.autonomy.${level}.label`, meta.label)}</div>
                    <div className={`text-xs mt-1 leading-relaxed ${active ? 'opacity-90' : 'text-gray-400'}`}>
                      {t(`aiAgent.autonomy.${level}.desc`, meta.desc)}
                    </div>
                    {active && <div className="text-[10px] mt-2 opacity-80">{t('aiAgent.autonomy.inUse', '✓ กำลังใช้งานอยู่')}</div>}
                  </button>
                );
              })}
            </div>
          )}

          {/* ข้อมูล guard */}
          {policy && (
            <div className="space-y-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-gray-400">{t('aiAgent.guard.protectedIps', 'IP ที่ห้าม block:')}</span>
                {policy.protectedIps.length === 0 ? (
                  <span className="text-gray-600">{t('aiAgent.guard.noProtectedIps', '(ไม่มีเพิ่มเติม — ระบบกัน loopback / IP ตัวเองให้อัตโนมัติ)')}</span>
                ) : (
                  policy.protectedIps.map((ip) => (
                    <span key={ip} className="px-2 py-0.5 rounded bg-red-900/40 border border-red-800 text-red-300">{ip}</span>
                  ))
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-gray-400">{t('aiAgent.guard.protectedProcesses', 'Process ที่ห้าม kill:')}</span>
                {policy.protectedProcesses.length === 0 ? (
                  <span className="text-gray-600">{t('aiAgent.guard.noProtectedProcesses', '(ระบบมีรายชื่อ process สำคัญให้อัตโนมัติ)')}</span>
                ) : (
                  policy.protectedProcesses.map((p) => (
                    <span key={p} className="px-2 py-0.5 rounded bg-red-900/40 border border-red-800 text-red-300">{p}</span>
                  ))
                )}
              </div>
              <div className="text-gray-500">
                {t('aiAgent.guard.approvalTtl', 'คำขออนุมัติหมดอายุอัตโนมัติภายใน {n} นาที', { n: (policy.approvalTtlMs / 60000).toFixed(0) })}
              </div>
            </div>
          )}
        </section>

        {/* ── สิทธิ์ของ Tool ── */}
        {policy && (
          <section className="card panel-cyan overflow-x-auto">
            <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan p-4 border-b border-gray-700">{t('aiAgent.tools.title', 'สิทธิ์ของ Tool')}</h2>
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-950/40 backdrop-blur-sm">
                <tr className="text-left text-emerald-400/70 border-b border-gray-800 text-[11px] uppercase tracking-widest">
                  <th className="px-4 py-3 font-semibold">{t('aiAgent.tools.colTool', 'Tool')}</th>
                  <th className="px-4 py-3 font-semibold">{t('aiAgent.tools.colType', 'ประเภท')}</th>
                  <th className="px-4 py-3 font-semibold">{t('aiAgent.tools.colDescription', 'คำอธิบาย')}</th>
                  <th className="px-4 py-3 font-semibold">{t('common.status', 'สถานะ')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {policy.tools.map((item) => (
                  <tr key={item.name} className="hover:bg-gray-800/50">
                    <td className="px-4 py-2 font-bold text-emerald-300">{item.name}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          item.kind === 'action'
                            ? 'bg-amber-900/50 text-amber-300'
                            : 'bg-blue-900/50 text-blue-300'
                        }`}
                      >
                        {item.kind === 'action' ? 'ACTION' : 'READ-ONLY'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-400">{item.description}</td>
                    <td className="px-4 py-2">
                      {item.available ? (
                        <span className="text-xs text-emerald-400">{t('aiAgent.tools.available', '✓ ใช้ได้')}</span>
                      ) : (
                        <span className="text-xs text-red-400">{t('aiAgent.tools.disabledView', '✗ ถูกปิด (โหมด view)')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* ── คำขออนุมัติ ── */}
        {isSuperadmin ? (
          <section className="card panel-cyan p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('aiAgent.approvals.title', 'คำขออนุมัติ Action ({n})', { n: pending.length })}</h2>

            {pending.length === 0 ? (
              <div className="text-gray-500 text-sm text-center py-6 border border-dashed border-gray-700 rounded-lg">
                {t('aiAgent.approvals.noPending', 'ไม่มีคำขอรออนุมัติ — AI จะแจ้งที่นี่เมื่อต้องการ blockIP / unblockIP / killProcess ในโหมด suggest')}
              </div>
            ) : (
              <div className="space-y-3">
                {pending.map((a) => (
                  <div key={a.id} className="card p-4 space-y-2 border-amber-800/60">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300 font-bold">ACTION</span>
                        <span className="font-bold text-amber-300">{a.tool}</span>
                        <span className="text-xs text-gray-500">{fmtTime(a.createdAt)}</span>
                      </div>
                      <span className="text-[10px] text-gray-600 break-all">ID: {a.id}</span>
                    </div>
                    <pre className="text-xs text-gray-300 bg-gray-950/60 border border-gray-800 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                      {fmtArgs(a.args)}
                    </pre>
                    <div className="flex gap-2">
                      <button
                        onClick={() => decideApproval(a.id, 'approve')}
                        disabled={busyId === a.id}
                        className="btn-primary px-4 py-1.5"
                      >
                        {busyId === a.id ? t('aiAgent.approvals.working', 'กำลัง...') : t('common.approve', 'อนุมัติ')}
                      </button>
                      <button
                        onClick={() => decideApproval(a.id, 'reject')}
                        disabled={busyId === a.id}
                        className="btn-danger px-4 py-1.5"
                      >
                        {t('common.reject', 'ปฏิเสธ')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ประวัติ */}
            {history.length > 0 && (
              <div className="pt-2 border-t border-gray-800">
                <h3 className="text-sm font-semibold text-gray-200 mb-2">{t('aiAgent.approvals.historyTitle', 'ประวัติการตัดสินใจ ({n})', { n: history.length })}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-gray-950/40 backdrop-blur-sm">
                      <tr className="text-left text-emerald-400/70 border-b border-gray-800 text-[11px] uppercase tracking-widest">
                        <th className="px-3 py-2 font-semibold">{t('common.time', 'เวลา')}</th>
                        <th className="px-3 py-2 font-semibold">{t('aiAgent.tools.colTool', 'Tool')}</th>
                        <th className="px-3 py-2 font-semibold">{t('aiAgent.approvals.colArgs', 'Args')}</th>
                        <th className="px-3 py-2 font-semibold">{t('aiAgent.approvals.colResult', 'ผล')}</th>
                        <th className="px-3 py-2 font-semibold">{t('common.details', 'รายละเอียด')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {history.slice(0, 20).map((a) => (
                        <tr key={a.id} className="text-gray-400">
                          <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(a.decidedAt)}</td>
                          <td className="py-2 pr-3 text-gray-300">{a.tool}</td>
                          <td className="py-2 pr-3 font-mono text-gray-500">{fmtArgs(a.args).replace(/\s+/g, ' ')}</td>
                          <td className="py-2 pr-3">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                a.status === 'approved'
                                  ? 'bg-emerald-900/50 text-emerald-300'
                                  : 'bg-rose-900/50 text-rose-300'
                              }`}
                            >
                              {a.status === 'approved' ? 'APPROVED' : 'REJECTED'}
                            </span>
                          </td>
                          <td className="py-2 text-gray-500 break-all">{a.result || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        ) : (
          <section className="card panel-cyan p-5">
            <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('aiAgent.approvals.sectionTitle', 'คำขออนุมัติ Action')}</h2>
            <div className="text-sm text-gray-500 mt-2">
              {t('aiAgent.approvals.nonSuperadminNote', 'เฉพาะ SUPERADMIN เท่านั้นที่เห็นและตัดสินใจคำขออนุมัติของ AI agent')}
            </div>
          </section>
        )}
          </>
        )}

        {/* ── แท็บ: ทีม Agent — กำหนดบทบาท กี่คน ทำงานอะไร ── */}
        {tab === 'team' && (
          <section className="card panel-cyan p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('aiAgent.team.title', 'ทีม Agent')}</h2>
                <p className="text-xs text-gray-500 mt-1">
                  {t('aiAgent.team.desc', 'กำหนดบทบาทให้ AI แบ่งเบาภาระ — แต่ละบทบาทอ่านข้อมูลของตัวเองและตอบกลับเป็นภาษาไทย')}
                </p>
              </div>
              {isSuperadmin && (
                <button
                  onClick={async () => {
                    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/agent/roles/seed`, { method: 'POST' });
                    const data = await res.json().catch(() => ({}));
                    if (res.ok) {
                      setMessage(data.seeded > 0 ? t('aiAgent.team.seededCount', 'ใส่บทบาทเริ่มต้น {n} บทบาทแล้ว', { n: data.seeded }) : t('aiAgent.team.seedExists', 'บทบาทเริ่มต้นมีอยู่แล้ว'));
                      await loadRoles();
                    }
                  }}
                  className="btn-secondary px-3 py-1.5 text-xs"
                >
                  {t('aiAgent.team.restoreDefaults', 'คืนค่าเริ่มต้น')}
                </button>
              )}
            </div>

            {/* ฟอร์มเพิ่มบทบาท */}
            {isSuperadmin && (
              <div className="inset p-3 space-y-2">
                <div className="text-xs font-semibold text-gray-200">{t('aiAgent.team.addRoleTitle', 'เพิ่มบทบาทใหม่')}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input value={roleForm.name || ''} onChange={(e) => setRoleForm((p) => ({ ...p, name: e.target.value }))} placeholder={t('aiAgent.team.phRoleName', 'ชื่อบทบาท เช่น ผู้ดูแลระบบน้ำ')} className="input text-sm" />
                  <input value={roleForm.emoji || ''} onChange={(e) => setRoleForm((p) => ({ ...p, emoji: e.target.value }))} placeholder={t('aiAgent.team.phRoleEmoji', 'อีโมจิของบทบาท')} className="input text-sm" />
                  <input value={roleForm.description || ''} onChange={(e) => setRoleForm((p) => ({ ...p, description: e.target.value }))} placeholder={t('aiAgent.team.phRoleDesc', 'ทำงานอะไร เช่น เฝ้าระวังคุณภาพน้ำ')} className="input text-sm md:col-span-2" />
                  <select value={roleForm.capability || 'general'} onChange={(e) => setRoleForm((p) => ({ ...p, capability: e.target.value }))} className="input text-sm">
                    {[['inventory', 'เสบียง'], ['farm', 'ฟาร์ม'], ['risk', 'ความเสี่ยง'], ['health', 'สุขภาพ'], ['water', 'ระบบน้ำ'], ['knowledge', 'คลังความรู้'], ['kids', 'สอนลูก'], ['general', 'ทั่วไป']].map(([v, l]) => (
                      <option key={v} value={v}>{t('aiAgent.team.capability.' + v, l)}</option>
                    ))}
                  </select>
                  <input value={roleForm.count || ''} onChange={(e) => setRoleForm((p) => ({ ...p, count: e.target.value }))} type="number" min={1} placeholder={t('aiAgent.team.phRoleCount', 'จำนวน agent')} className="input text-sm" />
                </div>
                <textarea value={roleForm.system_prompt || ''} onChange={(e) => setRoleForm((p) => ({ ...p, system_prompt: e.target.value }))} placeholder={t('aiAgent.team.phSystemPrompt', 'บุคลิก/วิธีทำงาน (system prompt) เช่น คุณคือผู้ดูแลระบบน้ำ อ่านข้อมูลแล้วสรุปความเสี่ยง')} rows={2} className="input w-full text-sm" />
                <button onClick={createRole} className="btn-primary px-3 py-1.5">{t('common.add', 'เพิ่ม')}</button>
              </div>
            )}

            {/* รายการบทบาท */}
            {roles.length === 0 ? (
              <div className="card"><EmptyState icon={<Icon name="ai-agent" size={20} />} title={t('aiAgent.team.noRoles', 'ยังไม่มีบทบาท')} description={t('aiAgent.team.noRolesDesc', 'กด "คืนค่าเริ่มต้น" หรือเพิ่มด้วยตัวเอง')} /></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {roles.map((r) => (
                  <div key={r.id} className={`border rounded-xl p-3 space-y-2 ${r.enabled ? 'border-gray-700 bg-gray-800/40' : 'border-gray-800 bg-gray-900/40 opacity-60'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xl shrink-0">{r.emoji || '🤖'}</span>
                        <div className="min-w-0">
                          <div className="font-bold text-sm truncate">{r.name}</div>
                          <div className="text-[10px] text-gray-500">{t('aiAgent.team.roleMeta', 'capability: {cap} · {count} คน', { cap: r.capability, count: r.count })}</div>
                        </div>
                      </div>
                      {isSuperadmin && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => updateRole(r.id, { enabled: !r.enabled })}
                            title={r.enabled ? t('aiAgent.team.disableRole', 'ปิดบทบาท') : t('aiAgent.team.enableRole', 'เปิดบทบาท')}
                            className={`text-xs px-2 py-1 rounded border ${r.enabled ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300' : 'bg-gray-800 border-gray-600 text-gray-500'}`}
                          >
                            {r.enabled ? t('common.on', 'เปิด') : t('common.off', 'ปิด')}
                          </button>
                          <button
                            onClick={() => deleteRole(r.id, r.name)}
                            className="text-xs px-2 py-1 rounded bg-red-900/40 border border-red-800 text-red-300"
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">{r.description}</p>
                    {isSuperadmin && (
                      <>
                        <div className="flex items-center gap-2 text-[10px] text-gray-500">
                          <span className="shrink-0">{t('aiAgent.team.countLabel', 'จำนวน:')}</span>
                          <input
                            type="number"
                            min={1}
                            defaultValue={r.count}
                            onBlur={(e) => { const v = Math.max(1, Number(e.target.value) || 1); if (v !== r.count) updateRole(r.id, { count: v }); }}
                            className="input w-16 text-xs py-0.5"
                          />
                          <span className="text-gray-600">{t('aiAgent.team.countSuffix', 'คน (แบ่งเบาภาระ)')}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-gray-500">
                          <label className="flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={r.daily_report !== false}
                              onChange={(e) => updateRole(r.id, { daily_report: e.target.checked })}
                              className="accent-emerald-500"
                            />
                            {t('aiAgent.team.dailyReport', 'สรุปรายวันส่ง Telegram')}
                          </label>
                          <select
                            value={r.report_hour ?? 7}
                            onChange={(e) => updateRole(r.id, { report_hour: Number(e.target.value) })}
                            title={t('aiAgent.team.reportHourTitle', 'เวลาที่ส่งสรุป (ทุกเช้า)')}
                            className="input text-[10px] py-0.5 px-1"
                          >
                            {Array.from({ length: 12 }, (_, i) => 6 + i).map((h) => (
                              <option key={h} value={h}>{h}:00</option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                    {/* รันงานตอนนี้ */}
                    <div className="flex gap-1.5 items-center pt-1">
                      <input
                        value={runPrompt[r.id] || ''}
                        onChange={(e) => setRunPrompt((p) => ({ ...p, [r.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && runRole(r.id)}
                        placeholder={t('aiAgent.team.phMission', 'ภารกิจ เช่น ตรวจเสบียงน้ำวันนี้...')}
                        disabled={!isSuperadmin || !r.enabled}
                        className="input flex-1 min-w-0 text-xs"
                      />
                      <button
                        onClick={() => runRole(r.id)}
                        disabled={!isSuperadmin || !r.enabled || teamBusy === r.id}
                        className="btn-primary shrink-0 px-2.5 py-1.5 text-xs"
                      >
                        {teamBusy === r.id ? t('aiAgent.team.running', 'กำลังรัน...') : t('aiAgent.team.runBackground', 'รันเบื้องหลัง')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

{/* ── แท็บ: Coding Agent — IDE layout เต็ม (toolbar + กลาง 70% + ขวา 30% + เทอร์มินัลล่าง) ── */}
        {tab === 'coding' && (
          <div className="h-[calc(100vh-190px)] min-h-[560px]">
            <CodingIde />
          </div>
        )}

        {/* ── แท็บ: งานเบื้องหลัง — poll สถานะอัตโนมัติ ── */}
        {tab === 'jobs' && (
          <section className="card panel-cyan p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('aiAgent.jobs.title', 'งานเบื้องหลัง')}</h2>
                <p className="text-xs text-gray-500 mt-1">
                  {t('aiAgent.jobs.desc', 'งาน AI รันต่อแม้คุณเปิดหน้าอื่น — อัปเดตอัตโนมัติทุก 3 วินาที และมีป้ายแจ้งเตือนมุมขวาล่างของทุกหน้า')}
                </p>
              </div>
              <button onClick={loadJobs} disabled={jobsLoading} className="btn-secondary px-3 py-1.5 text-xs">
                {jobsLoading ? t('common.loading', 'กำลังโหลด...') : t('common.refresh', 'รีเฟรช')}
              </button>
            </div>

            {jobs.length === 0 ? (
              <div className="card"><EmptyState icon={<Icon name="ai-agent" size={20} />} title={t('aiAgent.jobs.noJobs', 'ยังไม่มีงาน')} description={t('aiAgent.jobs.noJobsDesc', 'ไปแท็บ "ทีม Agent" แล้วสั่งงานบทบาทแรกสิ')} /></div>
            ) : (
              <div className="space-y-3">
                {jobs.map((j) => {
                  const active = j.status === 'queued' || j.status === 'running';
                  return (
                    <div key={j.id} className={`card p-4 space-y-2 ${active ? 'border-emerald-800/60' : j.status === 'error' ? 'border-rose-800/60' : ''}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-lg">{j.emoji || '🤖'}</span>
                          <span className="font-bold text-sm">{j.role_name}</span>
                          <span className="text-[10px] text-gray-500">{new Date(j.created_at).toLocaleString(fmtLocale())}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                            j.status === 'done' ? 'bg-emerald-900/50 text-emerald-300' :
                            j.status === 'error' ? 'bg-rose-900/50 text-rose-300' :
                            j.status === 'cancelled' ? 'bg-gray-700 text-gray-400' :
                            'bg-emerald-900/60 text-emerald-300 animate-pulse'
                          }`}>
                            {j.status === 'queued' ? t('aiAgent.jobs.statusQueued', 'รอคิว') : j.status === 'running' ? t('aiAgent.jobs.statusRunning', 'กำลังทำงาน') : j.status === 'done' ? t('aiAgent.jobs.statusDone', 'เสร็จ') : j.status === 'error' ? t('aiAgent.jobs.statusFailed', 'พลาด') : t('aiAgent.jobs.statusCancelled', 'ยกเลิก')}
                          </span>
                          {isSuperadmin && active && (
                            <button onClick={() => cancelJob(j.id)} className="text-[10px] px-2 py-0.5 rounded bg-red-900/50 border border-red-800 text-red-300">{t('common.cancel', 'ยกเลิก')}</button>
                          )}
                          {isSuperadmin && !active && (
                            <button onClick={() => deleteJob(j.id)} className="btn-secondary text-[10px] px-2 py-0.5"><Icon name="trash" size={12} /></button>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 bg-gray-950/40 border border-gray-800 rounded px-2 py-1.5 whitespace-pre-wrap">
                        {j.prompt}
                      </div>
                      {(j.status === 'queued' || j.status === 'running') && (
                        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.max(5, j.progress)}%` }} />
                        </div>
                      )}
                      {j.status === 'done' && j.result && (
                        <div className="text-xs text-gray-300 bg-gray-950/60 border border-gray-800 rounded px-2 py-1.5 whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {j.result}
                        </div>
                      )}
                      {j.status === 'error' && (
                        <div className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded px-2 py-1.5">
                          {j.error}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
      </div>
  );
}
