"use client";
import { useState, useEffect, useCallback } from 'react';
import { useIsSuperadmin } from '../../lib/roles';
import { useAuthStore } from '../../stores/useAuthStore';
import { authFetch } from '../../lib/apiFetch';
import { asArray } from '../../lib/fetchJson';
import Icon from '../ui/Icon';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { fmtLocale } from '../../lib/formatDate';

// ── Next-Gen Security Panel ──
// Pillar 1: Threat Intelligence DB · Pillar 2: App Control (DPI) · Pillar 3: Network Visibility
// + integrations: Pi-hole (DNS filter) · Suricata (IDS/IPS) · ntopng · ClamAV · AI Analyst (Ollama)

import { API, CATEGORIES, CATEGORY_LABEL, Panel, Btn, Chip, fmtTime, NextGenCtx } from './NextGenShared';
import { IntelTab, DnsTab } from './NextGenIntelTabs';
import { IdsTab, AvTab, AppsTab } from './NextGenInfraTabs';
import { NetTab, AiTab } from './NextGenNetTabs';

export default function NextGenPanel() {
  const { user } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const isSuperadmin = useIsSuperadmin();
  const catLabel = (c: string) => t(`securityComponents.nextgen.category.${c}`, CATEGORY_LABEL[c] || c);
  const [tab, setTab] = useState<'intel' | 'dns' | 'ids' | 'apps' | 'av' | 'net' | 'ai'>('intel');
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const notify = (type: 'ok' | 'err', text: string) => setMsg({ type, text });

  const loadStatus = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/status`);
      if (res.ok) setStatus(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // context รวมส่งให้แท็บ (เดิมเป็น closure — แยกไฟล์แล้วส่งผ่าน props)
  const ctx: NextGenCtx = { t, notify, busy, setBusy, status, loadStatus, isSuperadmin, catLabel };

  return (
    <div className="space-y-4">
      {/* Status chips */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Chip label="Threat DB" value={status ? `${status.threatIntel.total} IOC` : '...'} tone={status?.threatIntel?.total > 0 ? 'ok' : 'err'} />
        <Chip label="Pi-hole" value={status?.pihole?.connected ? `ON (${status.pihole.mode})` : 'OFF'} tone={status?.pihole?.connected ? 'ok' : 'err'} />
        <Chip label="Suricata" value={status?.ids?.fileExists ? 'ON' : 'OFF'} tone={status?.ids?.fileExists ? 'ok' : 'err'} />
        <Chip label="ClamAV" value={status?.clamav?.connected ? 'ON' : 'OFF'} tone={status?.clamav?.connected ? 'ok' : 'err'} />
        <Chip label="ntopng" value={status?.ntopng?.reachable ? 'ON' : 'OFF'} tone={status?.ntopng?.reachable ? 'ok' : 'err'} />
        <Chip label="App Control" value={status ? t('securityComponents.nextgen.chipBlockedAppsValue', '{n}/{total} แอป', { n: status.appControl.blockedApps, total: status.appControl.catalog }) : '...'} tone={status?.appControl?.blockedApps > 0 ? 'warn' : 'default'} />
      </div>

      {msg && (
        <div className={`p-3 rounded-lg text-sm border ${msg.type === 'ok' ? 'bg-emerald-900/30 text-emerald-400 border-emerald-800' : 'bg-red-900/30 text-red-400 border-red-800'}`}>
          {msg.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          ['intel', 'Threat Intelligence'],
          ['dns', 'Pi-hole DNS'],
          ['ids', 'Suricata'],
          ['apps', 'App Control'],
          ['av', 'ClamAV'],
          ['net', 'Network'],
          ['ai', 'AI Analyst'],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id as any)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${tab === id ? 'bg-emerald-600 text-white shadow-neon-green' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
          >
            {label}
          </button>
        ))}
        <button onClick={loadStatus} className="ml-auto px-3 py-1.5 rounded-lg text-xs bg-gray-800 text-gray-400 hover:text-gray-200 flex items-center gap-1"><Icon name="refresh" size={12} /> {t('common.refresh', 'รีเฟรช')}</button>
      </div>

      {tab === 'intel' && <IntelTab ctx={ctx} />}
      {tab === 'dns' && <DnsTab ctx={ctx} />}
      {tab === 'ids' && <IdsTab ctx={ctx} />}
      {tab === 'apps' && <AppsTab ctx={ctx} />}
      {tab === 'av' && <AvTab ctx={ctx} />}
      {tab === 'net' && <NetTab ctx={ctx} />}
      {tab === 'ai' && <AiTab ctx={ctx} />}
    </div>
  );
}