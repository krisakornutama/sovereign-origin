import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../../lib/apiFetch';
import Icon from '../ui/Icon';
import { API, Panel, Btn, Chip, NextGenCtx } from './NextGenShared';

// ── แท็บ Network Visibility + AI Analyst (แยกจาก NextGenPanel — phase 4) ──
  // ── Network Visibility ──
export function NetTab({ ctx }: { ctx: NextGenCtx }) {
  const { t, status } = ctx;
    const [devices, setDevices] = useState<any[]>([]);
    const [summary, setSummary] = useState<any>(null);

    useEffect(() => {
      (async () => {
        const res = await authFetch(`${API}/network/devices`);
        if (res.ok) {
          const data = await res.json();
          setDevices(data.devices || []);
          setSummary(data.summary);
        }
      })();
    }, []);

    const ntopng = status?.ntopng;

    return (
      <Panel
        title="Network Visibility"
        subtitle={t('securityComponents.nextgen.netSubtitle', 'อุปกรณ์ในเครือข่ายที่เห็นผ่าน DNS + สถานะ ntopng')}
      >
        <div className="flex flex-wrap gap-2">
          <Chip label="ntopng" value={!ntopng?.configured ? t('securityComponents.nextgen.chipNotConfigured', 'ไม่ตั้งค่า') : ntopng.reachable ? t('securityComponents.nextgen.chipConnected', 'เชื่อมต่อ') : 'offline'} tone={ntopng?.reachable ? 'ok' : 'err'} />
          <Chip label={t('securityComponents.nextgen.chipDevicesSeen', 'อุปกรณ์ที่เห็น')} value={devices.length} />
          {summary && <Chip label="unique clients" value={summary.uniqueClients} />}
        </div>
        {!ntopng?.configured && (
          <div className="text-[11px] text-gray-500">
            {t('securityComponents.nextgen.netSetupBefore', 'ตั้ง ')}<code className="text-emerald-400">NTOPNG_URL</code>{t('securityComponents.nextgen.netSetupAfter', ' (เช่น http://127.0.0.1:3000) เพื่อให้เห็นการรับส่งรายละเอียด (hosts/talkers) — ถ้าไม่มี ระบบใช้ข้อมูลจาก Pi-hole clients แทน')}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 border-b border-cyan-800/50">
                <th className="px-2 py-2">IP</th>
                <th className="px-2 py-2">{t('common.name', 'ชื่อ')}</th>
                <th className="px-2 py-2">MAC</th>
                <th className="px-2 py-2 text-right">Query</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-gray-500 py-6">{t('securityComponents.nextgen.netEmpty', 'ยังไม่มีข้อมูลอุปกรณ์')}</td></tr>
              ) : (
                devices.map((d) => (
                  <tr key={d.ip} className="border-b border-gray-800/50">
                    <td className="px-2 py-2 font-mono text-cyan-300 glow-text-cyan">{d.ip}</td>
                    <td className="px-2 py-2">{d.hostname || <span className="text-gray-600">-</span>}</td>
                    <td className="px-2 py-2 font-mono text-gray-500">{d.mac || '-'}</td>
                    <td className="px-2 py-2 text-right">{d.count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    );
  };

  // ── AI Analyst ──
export function AiTab({ ctx }: { ctx: NextGenCtx }) {
  const { t, notify, status, loadStatus, isSuperadmin } = ctx;
    const [report, setReport] = useState<any>(null);
    const [running, setRunning] = useState(false);

    const load = useCallback(async () => {
      const res = await authFetch(`${API}/ai/last`);
      if (res.ok) setReport(await res.json());
    }, []);

    useEffect(() => { load(); }, [load]);

    const analyze = async () => {
      setRunning(true);
      try {
        const res = await authFetch(`${API}/ai/analyze`, { method: 'POST' });
        if (res.ok) {
          setReport(await res.json());
          notify('ok', t('securityComponents.nextgen.aiAnalyzeDone', 'วิเคราะห์เสร็จ'));
          loadStatus();
        }
      } catch {
        notify('err', t('securityComponents.nextgen.aiAnalyzeFailed', 'วิเคราะห์ล้มเหลว'));
      } finally {
        setRunning(false);
      }
    };

    const r = report?.report;
    return (
      <Panel
        title="AI Security Analyst"
        subtitle={t('securityComponents.nextgen.aiSubtitle', 'โมเดล {model} ผ่าน Ollama · รอบอัตโนมัติ: {cycle}{telegram}', {
          model: process.env.NEXT_PUBLIC_AI_MODEL || 'gemma3:4b',
          cycle: status?.aiAnalyst?.enabled ? t('securityComponents.nextgen.aiCycleEvery', 'ทุก 60 นาที') : t('securityComponents.nextgen.aiCycleOff', 'ปิด (AI_ANALYST_ENABLED=false)'),
          telegram: status?.aiAnalyst?.telegram ? t('securityComponents.nextgen.aiTelegram', ' · แจ้งเตือน Telegram: ON') : '',
        })}
      >
        <div className="flex flex-wrap gap-2">
          <Chip label="Ollama" value={r ? t('securityComponents.nextgen.chipReady', 'พร้อม (เคยวิเคราะห์แล้ว)') : t('securityComponents.nextgen.chipNever', 'ยังไม่เคยวิเคราะห์')} tone={r ? 'ok' : 'err'} />
          <Chip label={t('securityComponents.nextgen.chipEvents24h', 'เหตุการณ์ 24 ชม.')} value={r?.stats?.events24h ?? '-'} tone={(r?.stats?.events24h ?? 0) > 0 ? 'warn' : 'default'} />
          <Chip label="IDS alerts" value={r?.stats?.alerts24h ?? '-'} />
          <Chip label={t('securityComponents.nextgen.chipIocInDb', 'IOC ในฐาน')} value={r?.stats?.intelTotal ?? '-'} />
        </div>
        {isSuperadmin && <Btn onClick={analyze} disabled={running} tone="green">{running ? t('securityComponents.nextgen.analyzingNow', 'กำลังวิเคราะห์ (Ollama)...') : <><Icon name="search" size={12} /> {t('securityComponents.nextgen.analyzeNow', 'วิเคราะห์สถานการณ์ตอนนี้')}</>}</Btn>}
        {r && (
          <div className="inset p-3 text-xs whitespace-pre-line text-gray-200 max-h-80 overflow-y-auto">
            {r.summary}
          </div>
        )}
        {!r && (
          <div className="text-xs text-gray-500">
            {t('securityComponents.nextgen.aiEmptyBefore', 'ยังไม่มีรายงาน — กด "วิเคราะห์ตอนนี้" หรือเปิด ')}<code className="text-emerald-400">AI_ANALYST_ENABLED=true</code>{t('securityComponents.nextgen.aiEmptyAfter', ' ใน infra/.env เพื่อให้วิเคราะห์ทุกชั่วโมงและแจ้งเตือนผ่าน Telegram (AI_ANALYST_TELEGRAM=true)')}
          </div>
        )}
      </Panel>
    );
  };
