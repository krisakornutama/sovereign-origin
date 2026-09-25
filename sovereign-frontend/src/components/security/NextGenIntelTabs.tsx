import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { asArray } from '../../lib/fetchJson';
import Icon from '../ui/Icon';
import { API, CATEGORIES, Panel, Btn, Chip, fmtTime, NextGenCtx } from './NextGenShared';

// ── แท็บ Threat Intelligence + Pi-hole DNS (แยกจาก NextGenPanel — phase 4) ──
  // ── Threat Intelligence ──
export function IntelTab({ ctx }: { ctx: NextGenCtx }) {
  const { t, notify, busy, setBusy, status, loadStatus, isSuperadmin, catLabel } = ctx;
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
export function DnsTab({ ctx }: { ctx: NextGenCtx }) {
  const { t, notify, loadStatus, isSuperadmin } = ctx;
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

