"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { authFetch } from '../../lib/apiFetch';
import { asArray } from '../../lib/fetchJson';
import Icon from '../ui/Icon';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { fmtLocale } from '../../lib/formatDate';

// ── Next-Gen Security Panel ──
// Pillar 1: Threat Intelligence DB · Pillar 2: App Control (DPI) · Pillar 3: Network Visibility
// + integrations: Pi-hole (DNS filter) · Suricata (IDS/IPS) · ntopng · ClamAV · AI Analyst (Ollama)

const API = `${process.env.NEXT_PUBLIC_API_URL}/api/security/nextgen`;

const CATEGORIES = ['all', 'malware', 'phishing', 'cnc', 'scam', 'ad', 'tracking', 'gambling', 'piracy', 'violence', 'unknown'];
const CATEGORY_LABEL: Record<string, string> = {
  malware: 'มัลแวร์', phishing: 'ฟิชชิ่ง', cnc: 'C2/Botnet', scam: 'สแกม', ad: 'โฆษณา',
  tracking: 'ติดตาม', gambling: 'พนัน', piracy: 'ละเมิดลิขสิทธิ์', violence: 'รุนแรง', unknown: 'ไม่ทราบ',
};

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="panel panel-cyan p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-200 glow-text-cyan">{title}</h3>
        {subtitle && <p className="text-[11px] text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Btn({ onClick, children, disabled, tone = 'default' }: any) {
  const tones: Record<string, string> = {
    default: 'btn-secondary',
    green: 'btn-primary',
    red: 'btn-danger',
    amber: 'btn-secondary',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 text-xs font-bold ${tones[tone] || tones.default}`}
    >
      {children}
    </button>
  );
}

function Chip({ label, value, tone = 'default' }: { label: string; value: any; tone?: 'ok' | 'err' | 'warn' | 'default' }) {
  const tones: Record<string, string> = {
    ok: 'text-emerald-400', err: 'text-red-400', warn: 'text-amber-400', default: 'text-gray-100',
  };
  return (
    <div className="inset px-3 py-2">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${tones[tone]} glow-text`}>{value}</div>
    </div>
  );
}

const SEV_COLORS: Record<string, string> = {
  critical: 'bg-red-900/60 text-red-300 border-red-800',
  warning: 'bg-amber-900/50 text-amber-300 border-amber-800',
  info: 'bg-blue-900/40 text-blue-300 border-blue-800',
};

function fmtTime(ts?: string): string {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    return d.toLocaleString(fmtLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '-';
  }
}

export default function NextGenPanel() {
  const { user } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const isSuperadmin = user?.role === 'SUPERADMIN';
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

  // ── Threat Intelligence ──
  const IntelTab = () => {
    const [items, setItems] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [stats, setStats] = useState<any>(null);
    const [filter, setFilter] = useState({ type: '', category: 'all', q: '', active: 'true' });
    const [form, setForm] = useState({ type: 'DOMAIN', value: '', category: 'unknown', note: '' });
    const [tester, setTester] = useState({ domains: '', ips: '' });
    const [testResult, setTestResult] = useState<any>(null);

    const load = useCallback(async () => {
      try {
        const qs = new URLSearchParams();
        if (filter.type) qs.set('type', filter.type);
        if (filter.category && filter.category !== 'all') qs.set('category', filter.category);
        if (filter.q) qs.set('q', filter.q);
        if (filter.active) qs.set('active', filter.active);
        const [listRes, statsRes] = await Promise.all([
          authFetch(`${API}/intel?${qs.toString()}`),
          authFetch(`${API}/intel/stats`),
        ]);
        if (listRes.ok) {
          const data = await listRes.json();
          setItems(data.items || []);
          setTotal(data.total || 0);
        }
        if (statsRes.ok) setStats(await statsRes.json());
      } catch {}
    }, [filter]);

    useEffect(() => { load(); }, [load]);

    const addItem = async () => {
      if (!form.value.trim()) return notify('err', t('securityComponents.nextgen.intelValueRequired', 'ต้องระบุค่า'));
      const res = await authFetch(`${API}/intel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, value: form.value.trim() }),
      });
      if (res.ok) {
        notify('ok', t('securityComponents.nextgen.intelAdded', 'เพิ่ม IOC สำเร็จ'));
        setForm({ ...form, value: '' });
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        notify('err', e.error || t('securityComponents.nextgen.intelAddFailed', 'เพิ่มไม่สำเร็จ'));
      }
    };

    const toggle = async (id: string, active: boolean) => {
      await authFetch(`${API}/intel/${id}/toggle`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !active }),
      });
      load();
    };

    const remove = async (id: string) => {
      if (!confirm(t('securityComponents.nextgen.intelDeleteConfirm', 'ลบ IOC นี้จากฐานข้อมูล?'))) return;
      await authFetch(`${API}/intel/${id}`, { method: 'DELETE' });
      load();
    };

    const runFeed = async () => {
      setBusy(true);
      try {
        const res = await authFetch(`${API}/intel/update-feeds`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        notify('ok', t('securityComponents.nextgen.feedUpdated', 'อัปเดต feed เสร็จ (+{added} รายการจากทั้งหมด {total})', { added: data.added, total: data.total }));
        loadStatus();
        load();
      } catch {
        notify('err', t('securityComponents.nextgen.feedUpdateFailed', 'อัปเดต feed ล้มเหลว'));
      } finally {
        setBusy(false);
      }
    };

    const checkIntel = async () => {
      const domains = tester.domains.split(',').map((s) => s.trim()).filter(Boolean);
      const ips = tester.ips.split(',').map((s) => s.trim()).filter(Boolean);
      if (!domains.length && !ips.length) return notify('err', t('securityComponents.nextgen.checkInputRequired', 'กรอกโดเมนหรือ IP ก่อน'));
      const res = await authFetch(`${API}/intel/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains, ips }),
      });
      if (res.ok) setTestResult(await res.json());
    };

    return (
      <Panel
        title={t('securityComponents.nextgen.intelTitle', 'Threat Intelligence (ฐานข้อมูลไวรัสและภัยคุกคาม)')}
        subtitle={t('securityComponents.nextgen.intelSubtitle', 'ฐาน IOC ในเครื่อง {total} รายการ — ใช้ตรวจ IP/โดเมนจาก connection + DNS + IDS โดยอัตโนมัติ · Feed: {feed}', {
          total,
          feed: stats?.lastFeedRun
            ? t('securityComponents.nextgen.feedLast', 'ล่าสุด {time}', { time: fmtTime(stats.lastFeedRun) })
            : t('securityComponents.nextgen.feedNever', 'ยังไม่เคยอัปเดต'),
        })}
      >
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Chip label={t('securityComponents.nextgen.chipTotalIoc', 'รวม IOC')} value={stats.total} />
            <Chip label="IP" value={stats.byType?.IP || 0} />
            <Chip label={t('securityComponents.nextgen.chipDomain', 'โดเมน')} value={stats.byType?.DOMAIN || 0} />
            <Chip label={t('securityComponents.nextgen.chipHits', 'ถูกใช้ตรวจพบ')} value={stats.totalHits} tone={stats.totalHits > 0 ? 'warn' : 'default'} />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })} className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs">
            <option value="">{t('securityComponents.nextgen.filterAllTypes', 'ทุกประเภท')}</option>
            <option value="IP">IP</option>
            <option value="DOMAIN">{t('securityComponents.nextgen.domainOpt', 'โดเมน')}</option>
          </select>
          <select value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })} className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs">
            {CATEGORIES.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
          </select>
          <select value={filter.active} onChange={(e) => setFilter({ ...filter, active: e.target.value })} className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs">
            <option value="true">{t('securityComponents.nextgen.filterActiveOpt', 'ใช้งานอยู่')}</option>
            <option value="false">{t('securityComponents.nextgen.filterInactiveOpt', 'ปิดอยู่')}</option>
            <option value="all">{t('common.all', 'ทั้งหมด')}</option>
          </select>
          <input
            value={filter.q}
            onChange={(e) => setFilter({ ...filter, q: e.target.value })}
            placeholder={t('securityComponents.nextgen.searchPlaceholder', 'ค้นหา...')}
            className="flex-1 min-w-40 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs"
          />
          <Btn onClick={runFeed} disabled={busy} tone="amber">{busy ? t('securityComponents.nextgen.updatingFeed', 'กำลังอัปเดต...') : <><Icon name="refresh" size={12} /> {t('securityComponents.nextgen.updateFeed', 'อัปเดต Feed')}</>}</Btn>
          {status?.threatIntel?.lastFeedError && (
            <span className="self-center text-[10px] text-red-400">{status.threatIntel.lastFeedError}</span>
          )}
        </div>

        {isSuperadmin && (
          <div className="flex flex-wrap gap-2 bg-gray-950/50 border border-cyan-800/50 rounded-lg p-2.5">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })} className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs">
              <option value="DOMAIN">{t('securityComponents.nextgen.domainOpt', 'โดเมน')}</option>
              <option value="IP">IP</option>
            </select>
            <input
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              placeholder={form.type === 'IP' ? 'x.x.x.x' : 'example.com'}
              className="flex-1 min-w-40 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs"
            />
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs">
              {CATEGORIES.slice(1).map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
            </select>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={t('securityComponents.nextgen.notePlaceholder', 'หมายเหตุ')} className="w-36 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
            <Btn onClick={addItem} tone="green"><Icon name="plus" size={12} /> {t('securityComponents.nextgen.addIoc', 'เพิ่ม IOC')}</Btn>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-3">
          <div className="bg-gray-950/50 border border-cyan-800/50 rounded-lg p-2.5 md:col-span-2">
            <div className="text-[11px] text-gray-500 mb-1.5">{t('securityComponents.nextgen.testHint', 'ทดสอบค่า (โดเมน/IP คั่นด้วย ,)')}</div>
            <div className="flex gap-2">
              <input value={tester.domains} onChange={(e) => setTester({ ...tester, domains: e.target.value })} placeholder="example.com,ads.net" className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
              <input value={tester.ips} onChange={(e) => setTester({ ...tester, ips: e.target.value })} placeholder="1.2.3.4" className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
              <Btn onClick={checkIntel} tone="green">{t('securityComponents.nextgen.checkBtn', 'เช็ค')}</Btn>
            </div>
            {testResult && (
              <div className="mt-2 text-xs space-y-1">
                {testResult.matchedDomains?.length === 0 && testResult.matchedIps?.length === 0 && (
                  <div className="text-emerald-400">{t('securityComponents.nextgen.noMatch', 'ไม่พบรายการตรงกับฐานภัยคุกคาม')}</div>
                )}
                {[...(testResult.matchedDomains || []), ...(testResult.matchedIps || [])].map((m: any) => (
                  <div key={m.value} className="text-red-300 flex items-center gap-2">
                    <span className="flex items-center gap-1"><Icon name="alert-triangle" size={12} /> {m.value}</span>
                    <span className="text-[10px] px-1.5 rounded bg-red-900/50">{catLabel(m.category)}</span>
                    <span className="text-[10px] text-gray-500">{Math.round((m.confidence || 0) * 100)}% · {m.source}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-gray-950/50 border border-cyan-800/50 rounded-lg p-2.5">
            <div className="text-[11px] text-gray-500 mb-1.5">{t('securityComponents.nextgen.categoriesInDb', 'หมวดหมู่ในฐาน')}</div>
            <div className="flex flex-wrap gap-1.5">
              {stats && Object.entries(stats.byCategory || {}).map(([cat, n]: any) => (
                <span key={cat} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700">
                  {catLabel(cat)} <b className="text-emerald-400">{n}</b>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 border-b border-cyan-800/50">
                <th className="px-2 py-2">{t('securityComponents.nextgen.colValue', 'ค่า')}</th>
                <th className="px-2 py-2">{t('securityComponents.nextgen.colType', 'ประเภท')}</th>
                <th className="px-2 py-2">{t('securityComponents.nextgen.colCategory', 'หมวด')}</th>
                <th className="px-2 py-2">{t('securityComponents.nextgen.colSource', 'แหล่ง')}</th>
                <th className="px-2 py-2">{t('securityComponents.nextgen.colConfidence', 'เชื่อมั่น')}</th>
                <th className="px-2 py-2">{t('securityComponents.nextgen.colLastSeen', 'พบครั้งล่าสุด')}</th>
                <th className="px-2 py-2 text-right">{t('securityComponents.nextgen.colOnOff', 'เปิด/ปิด')}</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-gray-500 py-6">{t('securityComponents.nextgen.emptyIntel', 'ยังไม่มีรายการ — กด "อัปเดต Feed" หรือเพิ่มด้วยมือ')}</td></tr>
              ) : (
                items.map((it) => (
                  <tr key={it.id} className="border-b border-gray-800/50">
                    <td className="px-2 py-2 font-mono text-cyan-300 glow-text-cyan">{it.value}</td>
                    <td className="px-2 py-2">{it.type}</td>
                    <td className="px-2 py-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700">{catLabel(it.category)}</span>
                    </td>
                    <td className="px-2 py-2 text-gray-500">{it.source}</td>
                    <td className="px-2 py-2">{Math.round((it.confidence || 0) * 100)}%</td>
                    <td className="px-2 py-2 text-gray-500">{fmtTime(it.last_seen)} · {t('securityComponents.nextgen.hitsTimes', '{n} ครั้ง', { n: it.hits })}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      {isSuperadmin && (
                        <>
                          <button onClick={() => toggle(it.id, it.active)} className={`mr-1 px-2 py-0.5 rounded text-[10px] border ${it.active ? 'bg-emerald-900/50 text-emerald-300 border-emerald-800' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>
                            {it.active ? 'ON' : 'OFF'}
                          </button>
                          <button onClick={() => remove(it.id)} className="px-2 py-0.5 rounded text-[10px] border border-red-800 bg-red-900/40 text-red-300 hover:text-white"><Icon name="trash" size={11} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    );
  };

  // ── Pi-hole (DNS Filter) ──
  const DnsTab = () => {
    const [summary, setSummary] = useState<any>(null);
    const [topBlocked, setTopBlocked] = useState<any[]>([]);
    const [queries, setQueries] = useState<any[]>([]);
    const [domain, setDomain] = useState('');

    const load = useCallback(async () => {
      const [s, t, q] = await Promise.all([
        authFetch(`${API}/dns/stats`),
        authFetch(`${API}/dns/top-blocked`),
        authFetch(`${API}/dns/queries?limit=20`),
      ]);
      if (s.ok) setSummary(await s.json());
      if (t.ok) setTopBlocked(asArray(await t.json()));
      if (q.ok) setQueries(asArray(await q.json()));
    }, []);

    useEffect(() => { load(); }, [load]);

    const block = async (action: 'block' | 'allow') => {
      if (!domain.trim()) return;
      const res = await authFetch(`${API}/dns/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domain.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.ok || !data.dnsError)) {
        notify('ok', t('securityComponents.nextgen.dnsActionResult', '{action} {domain}{dnsError}', {
          action: action === 'block' ? t('securityComponents.nextgen.dnsActionBlock', 'บล็อก') : t('securityComponents.nextgen.dnsActionAllow', 'อนุญาต'),
          domain: domain.trim(),
          dnsError: data.dnsError ? ` (Pi-hole: ${data.dnsError})` : '',
        }));
        setDomain('');
        load();
        loadStatus();
      } else {
        notify('err', data.dnsError || data.error || t('securityComponents.nextgen.dnsReqFailed', 'คำขอล้มเหลว'));
      }
    };

    if (summary && !summary.connected) {
      return (
        <Panel title="Pi-hole (DNS Filter)" subtitle={t('securityComponents.nextgen.dnsSubtitle', 'ตัวกรอง DNS — บล็อกโดเมนทั้งบ้าน')}>
          <div className="text-sm text-amber-300 bg-amber-950/30 border border-amber-800 rounded-lg p-3">
            <Icon name="alert-triangle" size={14} className="inline-block mr-1 align-[-2px]" />{t('securityComponents.nextgen.dnsConnectError', 'ยังเชื่อมต่อ Pi-hole ไม่ได้: {error}', { error: summary.error || t('securityComponents.nextgen.unknownCause', 'ไม่ทราบสาเหตุ') })}
            <div className="text-[11px] text-gray-400 mt-2">
              {t('securityComponents.nextgen.dnsSetupHint', 'ตั้งค่าใน infra/.env: ')}<code className="text-emerald-400">PIHOLE_URL=http://IP_PIHOLE:8088/admin</code> + <code className="text-emerald-400">PIHOLE_TOKEN=...</code>{t('securityComponents.nextgen.dnsSetupHintAfter', ' แล้ว restart core-api')}
            </div>
          </div>
        </Panel>
      );
    }

    return (
      <Panel
        title="Pi-hole (DNS Filter)"
        subtitle={summary?.connected ? t('securityComponents.nextgen.dnsConnected', 'เชื่อมต่อแล้ว (API {mode})', { mode: String(summary.mode).toUpperCase() }) : t('securityComponents.nextgen.dnsChecking', 'กำลังตรวจสอบ...')}
      >
        {summary?.connected && summary.summary && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Chip label={t('securityComponents.nextgen.chipQueriesToday', 'Query วันนี้')} value={summary.summary.dnsQueriesToday} />
              <Chip label={t('securityComponents.nextgen.chipBlockedDomains', 'โดเมนถูกบล็อก')} value={summary.summary.adsBlockedToday} tone={summary.summary.adsBlockedToday > 0 ? 'warn' : 'default'} />
              <Chip label={t('securityComponents.nextgen.chipBlockRate', 'อัตราบล็อก')} value={`${summary.summary.adsPercentageToday}%`} />
              <Chip label={t('securityComponents.nextgen.chipDomainsInList', 'โดเมนในรายการ')} value={summary.summary.domainsBeingBlocked} />
            </div>
            <div className="flex gap-2">
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
                className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs"
              />
              {isSuperadmin && (
                <>
                  <Btn onClick={() => block('block')} tone="red"><Icon name="x-circle" size={12} /> {t('securityComponents.nextgen.blockDns', 'บล็อก (Pi-hole + Threat DB)')}</Btn>
                  <Btn onClick={() => block('allow')}><Icon name="check-circle" size={12} /> {t('securityComponents.nextgen.unblockDns', 'ยกเลิกบล็อก')}</Btn>
                </>
              )}
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] text-gray-500 mb-1.5">{t('securityComponents.nextgen.topBlockedTitle', 'โดเมนที่ถูกบล็อกมากสุด')}</div>
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {topBlocked.length === 0 && <div className="text-xs text-gray-600">{t('common.noData', 'ไม่มีข้อมูล')}</div>}
                  {topBlocked.map((item) => (
                    <div key={item.domain} className="flex items-center gap-2 text-xs bg-gray-800/50 border border-gray-700 rounded px-2 py-1">
                      <span className="flex-1 font-mono truncate text-red-300 glow-text-red">{item.domain}</span>
                      <span className="text-gray-400">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-gray-500 mb-1.5">{t('securityComponents.nextgen.recentQueries', 'Query ล่าสุด')}</div>
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {queries.length === 0 && <div className="text-xs text-gray-600">{t('common.noData', 'ไม่มีข้อมูล')}</div>}
                  {queries.map((q, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px] bg-gray-800/50 border border-gray-700 rounded px-2 py-1">
                      <span className={`shrink-0 ${q.status.includes('BLOCK') ? 'text-red-400' : 'text-gray-500'}`}>{q.type || '?'}</span>
                      <span className="flex-1 font-mono truncate">{q.domain || q.client}</span>
                      <span className="text-gray-600">{q.client}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </Panel>
    );
  };

  // ── IDS (Suricata) ──
  const IdsTab = () => {
    const [data, setData] = useState<any>(null);

    const load = useCallback(async () => {
      const res = await authFetch(`${API}/ids/alerts`);
      if (res.ok) setData(await res.json());
    }, []);

    useEffect(() => { load(); }, [load]);

    const stats = data?.stats;
    return (
      <Panel
        title="Suricata (IDS/IPS)"
        subtitle={`eve.json: ${stats?.fileExists ? t('securityComponents.nextgen.idsFileExists', 'มีไฟล์ ({size} KB) · ตรวจใหม่ทุก {sec}s', { size: (stats.fileSize / 1024).toFixed(0), sec: (stats.pollIntervalMs / 1000).toFixed(0) }) : t('securityComponents.nextgen.idsNotFound', 'ยังไม่พบไฟล์')}`}
      >
        {!stats?.configured || !stats.fileExists ? (
          <div className="text-sm text-amber-300 bg-amber-950/30 border border-amber-800 rounded-lg p-3">
            <Icon name="alert-triangle" size={14} className="inline-block mr-1 align-[-2px]" />{t('securityComponents.nextgen.idsSetupBefore', 'ยังไม่ได้ตั้งค่า IDS log — ใส่ path eve.json ใน ')}<code className="text-emerald-400">IDS_EVE_LOG</code>{t('securityComponents.nextgen.idsSetupAfter', ' (เช่น /var/log/suricata/eve.json) แล้ว restart · ระบบจะอ่าน alert ล่าสุดและบันทึกเป็นเหตุการณ์ IDS_ALERT อัตโนมัติ')}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Chip label={t('securityComponents.nextgen.chipEveFile', 'ไฟล์ eve.json')} value={stats.fileExists ? t('securityComponents.nextgen.chipReadyToRead', 'พร้อมอ่าน') : t('securityComponents.nextgen.chipNotFound', 'ไม่พบ')} tone={stats.fileExists ? 'ok' : 'err'} />
              <Chip label={t('securityComponents.nextgen.chipOffsetRead', 'offset อ่านแล้ว')} value={`${(stats.offset / 1024).toFixed(0)} KB`} />
              <Chip label={t('securityComponents.nextgen.chipAlerts', 'Alert ทั้งหมด')} value={data?.alerts?.length || 0} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-cyan-800/50">
                    <th className="px-2 py-2">{t('securityComponents.nextgen.colTime', 'เวลา')}</th>
                    <th className="px-2 py-2">{t('securityComponents.nextgen.colLevel', 'ระดับ')}</th>
                    <th className="px-2 py-2">Signature</th>
                    <th className="px-2 py-2">{t('securityComponents.nextgen.colSrcDst', 'ต้นทาง → ปลายทาง')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.alerts || []).slice(0, 25).map((a: any) => (
                    <tr key={a.id} className="border-b border-gray-800/50">
                      <td className="px-2 py-2 text-gray-500 whitespace-nowrap">{fmtTime(a.timestamp)}</td>
                      <td className="px-2 py-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${SEV_COLORS[a.severity] || SEV_COLORS.info}`}>{a.severity}</span>
                      </td>
                      <td className="px-2 py-2 text-gray-200">{a.description}</td>
                      <td className="px-2 py-2 font-mono text-gray-500">{a.source_ip || '-'} → {a.dest_ip || '-'}</td>
                    </tr>
                  ))}
                  {(data?.alerts || []).length === 0 && (
                    <tr><td colSpan={4} className="text-center text-gray-500 py-6">{t('securityComponents.nextgen.idsEmpty', 'ยังไม่มี alert — โมเดลตรวจจับได้แล้ว')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
    );
  };

  // ── ClamAV ──
  const AvTab = () => {
    const [avStatus, setAvStatus] = useState<any>(null);
    const [file, setFile] = useState<File | null>(null);
    const [scanResult, setScanResult] = useState<any>(null);
    const [scanning, setScanning] = useState(false);

    const load = useCallback(async () => {
      const res = await authFetch(`${API}/av/status`);
      if (res.ok) setAvStatus(await res.json());
    }, []);

    useEffect(() => { load(); }, [load]);

    const scan = async () => {
      if (!file) return notify('err', t('securityComponents.nextgen.avSelectFile', 'เลือกไฟล์ก่อน'));
      setScanning(true);
      setScanResult(null);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await authFetch(`${API}/av/scan`, { method: 'POST', body: fd });
        setScanResult(await res.json());
      } catch {
        notify('err', t('securityComponents.nextgen.avScanFailed', 'สแกนไม่สำเร็จ'));
      } finally {
        setScanning(false);
      }
    };

    return (
      <Panel title="ClamAV (Antivirus)" subtitle={t('securityComponents.nextgen.avSubtitle', 'สแกนไฟล์ผ่าน clamd (TCP 3310) — เหมาะกับไฟล์จากอุปกรณ์/USB/อีเมล')}>
        <div className="flex flex-wrap gap-2">
          <Chip label="clamd" value={avStatus?.connected ? t('securityComponents.nextgen.chipConnected', 'เชื่อมต่อ') : t('securityComponents.nextgen.chipNotConnected', 'ไม่เชื่อมต่อ')} tone={avStatus?.connected ? 'ok' : 'err'} />
          <Chip label={t('securityComponents.nextgen.chipVersion', 'เวอร์ชัน')} value={avStatus?.version || '-'} />
        </div>
        {!avStatus?.connected && (
          <div className="text-sm text-amber-300 bg-amber-950/30 border border-amber-800 rounded-lg p-3">
            <Icon name="alert-triangle" size={14} className="inline-block mr-1 align-[-2px]" />{t('securityComponents.nextgen.avSetupBefore', 'ยังเชื่อมต่อ clamd ไม่ได้ — ตั้ง ')}<code className="text-emerald-400">CLAMD_HOST</code>{t('securityComponents.nextgen.avSetupBetween', ' (เช่น 127.0.0.1) / ')}<code className="text-emerald-400">CLAMD_PORT</code>{t('securityComponents.nextgen.avSetupAfter', ' (3310) และรัน clamd บนเครื่องหรือ NAS ที่พร้อม')}
          </div>
        )}
        {isSuperadmin && (
          <div className="space-y-2">
            <div className="flex gap-2 items-center">
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="flex-1 text-xs bg-gray-800 border border-gray-600 rounded px-2 py-1.5 file:mr-2 file:bg-gray-700 file:border-0 file:px-2 file:py-1 file:rounded file:text-xs"
              />
              <Btn onClick={scan} disabled={scanning || !file} tone={scanning ? 'default' : 'green'}>{scanning ? t('securityComponents.nextgen.scanningNow', 'กำลังสแกน...') : t('securityComponents.nextgen.scanVirus', 'สแกนไวรัส')}</Btn>
            </div>
            {scanResult && (
              <div className={`text-xs p-3 rounded-lg border ${scanResult.ok ? 'bg-emerald-950/30 border-emerald-800 text-emerald-300' : 'bg-red-950/40 border-red-800 text-red-300'}`}>
                {scanResult.ok
                  ? t('securityComponents.nextgen.avScanOk', '{file} ({size} KB) ปลอดภัย — สแกนใช้เวลา {time} ms', { file: scanResult.fileName, size: (scanResult.size / 1024).toFixed(1), time: scanResult.elapsedMs })
                  : t('securityComponents.nextgen.avScanBad', '{file}: {detail}', { file: scanResult.fileName, detail: scanResult.virus || scanResult.error || t('securityComponents.nextgen.avSomethingFound', 'พบสิ่งผิดปกติ') })}
              </div>
            )}
          </div>
        )}
      </Panel>
    );
  };

  // ── App Control (DPI) ──
  const AppsTab = () => {
    const [apps, setApps] = useState<any[]>([]);
    const [custom, setCustom] = useState<string[]>([]);
    const [customInput, setCustomInput] = useState('');
    const [blockedCount, setBlockedCount] = useState(0);
    const [syncing, setSyncing] = useState(false);

    const load = useCallback(async () => {
      const res = await authFetch(`${API}/apps`);
      if (res.ok) {
        const data = await res.json();
        setApps(data.apps || []);
        setCustom(data.customDomains || []);
        setBlockedCount(data.blockedCount || 0);
      }
    }, []);

    useEffect(() => { load(); }, [load]);

    const toggleApp = async (id: string, blocked: boolean) => {
      await authFetch(`${API}/apps/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked }),
      });
      load();
      loadStatus();
    };

    const toggleCategory = async (cat: string, blocked: boolean) => {
      await authFetch(`${API}/apps/category/${cat}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked }),
      });
      load();
      loadStatus();
    };

    const addCustom = async () => {
      if (!customInput.trim()) return;
      const res = await authFetch(`${API}/apps/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: customInput.trim() }),
      });
      if (res.ok) {
        setCustomInput('');
        load();
      } else {
        notify('err', t('securityComponents.nextgen.customDomainInvalid', 'โดเมนซ้ำหรือไม่ถูกต้อง'));
      }
    };

    const removeCustom = async (domain: string) => {
      await authFetch(`${API}/apps/custom`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      load();
    };

    const exportList = async () => {
      const res = await authFetch(`${API}/apps/blocklist`);
      if (res.ok) {
        const text = await res.text();
        const blob = new Blob([text], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'sovereign-app-blocklist.txt';
        a.click();
      }
    };

    const syncPiHole = async () => {
      setSyncing(true);
      try {
        const res = await authFetch(`${API}/apps/sync-pihole`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        notify('ok', t('securityComponents.nextgen.syncPiHoleDone', 'ส่ง {ok}/{total} โดเมนไป Pi-hole แล้ว{errors}', {
          ok: data.okCount,
          total: data.total,
          errors: data.errors?.length ? t('securityComponents.nextgen.syncErrorsSuffix', ' (มี {n} รายการผิดพลาด)', { n: data.errors.length }) : '',
        }));
      } catch {
        notify('err', t('securityComponents.nextgen.syncFailed', 'sync ล้มเหลว'));
      } finally {
        setSyncing(false);
      }
    };

    const categories = [...new Set(apps.map((a) => a.category))];

    return (
      <Panel
        title="Application Control (DPI)"
        subtitle={t('securityComponents.nextgen.appsSubtitle', 'บล็อกทั้งแอปด้วยการ block โดเมนที่แอปใช้ — ตอนนี้กำลังบล็อก {blocked} โดเมนจาก {apps} แอป', { blocked: blockedCount, apps: apps.length })}
      >
        {isSuperadmin && (
          <div className="flex flex-wrap gap-2 bg-gray-950/50 border border-cyan-800/50 rounded-lg p-2.5">
            {categories.map((cat) => (
              <Btn key={cat} onClick={() => toggleCategory(cat, true)} tone="red">{t('securityComponents.nextgen.blockCat', 'บล็อก {cat}', { cat })}</Btn>
            ))}
            <Btn onClick={() => apps.forEach((a) => toggleApp(a.id, false))}>{t('securityComponents.nextgen.unblockAll', 'ปลดบล็อกทั้งหมด')}</Btn>
            <Btn onClick={exportList}><Icon name="download" size={12} /> Export hosts file</Btn>
            <Btn onClick={syncPiHole} disabled={syncing} tone="amber">{syncing ? t('common.loading', 'กำลังโหลด...') : <><Icon name="globe" size={12} /> {t('securityComponents.nextgen.syncPiHole', 'ส่งเข้า Pi-hole')}</>}</Btn>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {apps.map((app) => (
            <div key={app.id} className={`card p-3 transition ${app.blocked ? 'border-red-800/70' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{app.icon}</span>
                    <span className="font-bold text-sm">{app.name}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{app.category} · {t('securityComponents.nextgen.domainCount', '{n} โดเมน', { n: app.domains.length })}</div>
                  <p className="text-[11px] text-gray-400 mt-1">{app.description}</p>
                </div>
                <button
                  onClick={() => isSuperadmin && toggleApp(app.id, !app.blocked)}
                  disabled={!isSuperadmin}
                  className={`shrink-0 px-2.5 py-1 rounded text-[10px] font-bold border transition ${app.blocked ? 'bg-red-600 border-red-700 text-white' : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'}`}
                >
                  {app.blocked ? 'BLOCKED' : t('securityComponents.nextgen.allowed', 'อนุญาต')}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-800 pt-3 space-y-2">
          <div className="text-xs font-semibold text-gray-300">{t('securityComponents.nextgen.customTitle', 'โดเมนที่กำหนดเอง ({n})', { n: custom.length })}</div>
          {isSuperadmin && (
            <div className="flex gap-2">
              <input
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="example.com"
                className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs"
              />
              <Btn onClick={addCustom} tone="green">{t('common.add', 'เพิ่ม')}</Btn>
            </div>
          )}
          {custom.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {custom.map((d) => (
                <span key={d} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-gray-800 border border-gray-700 text-[11px] font-mono">
                  {d}
                  {isSuperadmin && <button onClick={() => removeCustom(d)} className="text-red-400 hover:text-white"><Icon name="x" size={11} /></button>}
                </span>
              ))}
            </div>
          )}
        </div>
      </Panel>
    );
  };

  // ── Network Visibility ──
  const NetTab = () => {
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
  const AiTab = () => {
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

      {tab === 'intel' && <IntelTab />}
      {tab === 'dns' && <DnsTab />}
      {tab === 'ids' && <IdsTab />}
      {tab === 'apps' && <AppsTab />}
      {tab === 'av' && <AvTab />}
      {tab === 'net' && <NetTab />}
      {tab === 'ai' && <AiTab />}
    </div>
  );
}