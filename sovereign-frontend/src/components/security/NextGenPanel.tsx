"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { authFetch } from '../../lib/apiFetch';

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
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
      <div>
        <h3 className="text-base font-bold">{title}</h3>
        {subtitle && <p className="text-[11px] text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Btn({ onClick, children, disabled, tone = 'default' }: any) {
  const tones: Record<string, string> = {
    default: 'bg-gray-800 border-gray-600 hover:bg-gray-700 text-gray-200',
    green: 'bg-green-600 hover:bg-green-500 text-white border-green-700',
    red: 'bg-red-700/80 hover:bg-red-600 text-white border-red-800',
    amber: 'bg-amber-600/80 hover:bg-amber-500 text-white border-amber-700',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition disabled:opacity-50 ${tones[tone] || tones.default}`}
    >
      {children}
    </button>
  );
}

function Chip({ label, value, tone = 'default' }: { label: string; value: any; tone?: 'ok' | 'err' | 'warn' | 'default' }) {
  const tones: Record<string, string> = {
    ok: 'text-green-400', err: 'text-red-400', warn: 'text-amber-400', default: 'text-gray-100',
  };
  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${tones[tone]}`}>{value}</div>
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
    return d.toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '-';
  }
}

export default function NextGenPanel() {
  const { user } = useAuthStore();
  const isSuperadmin = user?.role === 'SUPERADMIN';
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
      if (!form.value.trim()) return notify('err', 'ต้องระบุค่า');
      const res = await authFetch(`${API}/intel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, value: form.value.trim() }),
      });
      if (res.ok) {
        notify('ok', 'เพิ่ม IOC สำเร็จ');
        setForm({ ...form, value: '' });
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        notify('err', e.error || 'เพิ่มไม่สำเร็จ');
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
      if (!confirm('ลบ IOC นี้จากฐานข้อมูล?')) return;
      await authFetch(`${API}/intel/${id}`, { method: 'DELETE' });
      load();
    };

    const runFeed = async () => {
      setBusy(true);
      try {
        const res = await authFetch(`${API}/intel/update-feeds`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        notify('ok', `อัปเดต feed เสร็จ (+${data.added} รายการจากทั้งหมด ${data.total})`);
        loadStatus();
        load();
      } catch {
        notify('err', 'อัปเดต feed ล้มเหลว');
      } finally {
        setBusy(false);
      }
    };

    const checkIntel = async () => {
      const domains = tester.domains.split(',').map((s) => s.trim()).filter(Boolean);
      const ips = tester.ips.split(',').map((s) => s.trim()).filter(Boolean);
      if (!domains.length && !ips.length) return notify('err', 'กรอกโดเมนหรือ IP ก่อน');
      const res = await authFetch(`${API}/intel/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains, ips }),
      });
      if (res.ok) setTestResult(await res.json());
    };

    return (
      <Panel
        title="🧬 Threat Intelligence (ฐานข้อมูลไวรัสและภัยคุกคาม)"
        subtitle={`ฐาน IOC ในเครื่อง ${total} รายการ — ใช้ตรวจ IP/โดเมนจาก connection + DNS + IDS โดยอัตโนมัติ · Feed: ${stats?.lastFeedRun ? `ล่าสุด ${fmtTime(stats.lastFeedRun)}` : 'ยังไม่เคยอัปเดต'}`}
      >
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Chip label="รวม IOC" value={stats.total} />
            <Chip label="IP" value={stats.byType?.IP || 0} />
            <Chip label="โดเมน" value={stats.byType?.DOMAIN || 0} />
            <Chip label="ถูกใช้ตรวจพบ" value={stats.totalHits} tone={stats.totalHits > 0 ? 'warn' : 'default'} />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })} className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs">
            <option value="">ทุกประเภท</option>
            <option value="IP">IP</option>
            <option value="DOMAIN">โดเมน</option>
          </select>
          <select value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })} className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs">
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c] || c}</option>)}
          </select>
          <select value={filter.active} onChange={(e) => setFilter({ ...filter, active: e.target.value })} className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs">
            <option value="true">ใช้งานอยู่</option>
            <option value="false">ปิดอยู่</option>
            <option value="all">ทั้งหมด</option>
          </select>
          <input
            value={filter.q}
            onChange={(e) => setFilter({ ...filter, q: e.target.value })}
            placeholder="ค้นหา..."
            className="flex-1 min-w-40 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs"
          />
          <Btn onClick={runFeed} disabled={busy} tone="amber">{busy ? '⏳ กำลังอัปเดต...' : '🔄 อัปเดต Feed'}</Btn>
          {status?.threatIntel?.lastFeedError && (
            <span className="self-center text-[10px] text-red-400">{status.threatIntel.lastFeedError}</span>
          )}
        </div>

        {isSuperadmin && (
          <div className="flex flex-wrap gap-2 bg-gray-950/50 border border-gray-800 rounded-lg p-2.5">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })} className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs">
              <option value="DOMAIN">โดเมน</option>
              <option value="IP">IP</option>
            </select>
            <input
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              placeholder={form.type === 'IP' ? 'x.x.x.x' : 'example.com'}
              className="flex-1 min-w-40 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs"
            />
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs">
              {CATEGORIES.slice(1).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c] || c}</option>)}
            </select>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="หมายเหตุ" className="w-36 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
            <Btn onClick={addItem} tone="green">+ เพิ่ม IOC</Btn>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-3">
          <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-2.5 md:col-span-2">
            <div className="text-[11px] text-gray-500 mb-1.5">🔍 ทดสอบค่า (โดเมน/IP คั่นด้วย ,)</div>
            <div className="flex gap-2">
              <input value={tester.domains} onChange={(e) => setTester({ ...tester, domains: e.target.value })} placeholder="example.com,ads.net" className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
              <input value={tester.ips} onChange={(e) => setTester({ ...tester, ips: e.target.value })} placeholder="1.2.3.4" className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
              <Btn onClick={checkIntel} tone="green">เช็ค</Btn>
            </div>
            {testResult && (
              <div className="mt-2 text-xs space-y-1">
                {testResult.matchedDomains?.length === 0 && testResult.matchedIps?.length === 0 && (
                  <div className="text-green-400">✅ ไม่พบรายการตรงกับฐานภัยคุกคาม</div>
                )}
                {[...(testResult.matchedDomains || []), ...(testResult.matchedIps || [])].map((m: any) => (
                  <div key={m.value} className="text-red-300 flex items-center gap-2">
                    <span>🚨 {m.value}</span>
                    <span className="text-[10px] px-1.5 rounded bg-red-900/50">{CATEGORY_LABEL[m.category] || m.category}</span>
                    <span className="text-[10px] text-gray-500">{Math.round((m.confidence || 0) * 100)}% · {m.source}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-2.5">
            <div className="text-[11px] text-gray-500 mb-1.5">หมวดหมู่ในฐาน</div>
            <div className="flex flex-wrap gap-1.5">
              {stats && Object.entries(stats.byCategory || {}).map(([cat, n]: any) => (
                <span key={cat} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700">
                  {CATEGORY_LABEL[cat] || cat} <b className="text-green-400">{n}</b>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-800">
                <th className="px-2 py-2">ค่า</th>
                <th className="px-2 py-2">ประเภท</th>
                <th className="px-2 py-2">หมวด</th>
                <th className="px-2 py-2">แหล่ง</th>
                <th className="px-2 py-2">เชื่อมั่น</th>
                <th className="px-2 py-2">พบครั้งล่าสุด</th>
                <th className="px-2 py-2 text-right">เปิด/ปิด</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-gray-500 py-6">ยังไม่มีรายการ — กด "อัปเดต Feed" หรือเพิ่มด้วยมือ</td></tr>
              ) : (
                items.map((it) => (
                  <tr key={it.id} className="border-b border-gray-800/50">
                    <td className="px-2 py-2 font-mono text-cyan-300">{it.value}</td>
                    <td className="px-2 py-2">{it.type}</td>
                    <td className="px-2 py-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700">{CATEGORY_LABEL[it.category] || it.category}</span>
                    </td>
                    <td className="px-2 py-2 text-gray-500">{it.source}</td>
                    <td className="px-2 py-2">{Math.round((it.confidence || 0) * 100)}%</td>
                    <td className="px-2 py-2 text-gray-500">{fmtTime(it.last_seen)} · {it.hits} ครั้ง</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      {isSuperadmin && (
                        <>
                          <button onClick={() => toggle(it.id, it.active)} className={`mr-1 px-2 py-0.5 rounded text-[10px] border ${it.active ? 'bg-green-900/50 text-green-300 border-green-800' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>
                            {it.active ? 'ON' : 'OFF'}
                          </button>
                          <button onClick={() => remove(it.id)} className="px-2 py-0.5 rounded text-[10px] border border-red-800 bg-red-900/40 text-red-300 hover:text-white">🗑</button>
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
      if (t.ok) setTopBlocked(await t.json());
      if (q.ok) setQueries(await q.json());
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
        notify('ok', `${action === 'block' ? '🚫 บล็อก' : '✅ อนุญาต'} ${domain.trim()}${data.dnsError ? ` (Pi-hole: ${data.dnsError})` : ''}`);
        setDomain('');
        load();
        loadStatus();
      } else {
        notify('err', data.dnsError || data.error || 'คำขอล้มเหลว');
      }
    };

    if (summary && !summary.connected) {
      return (
        <Panel title="🌐 Pi-hole (DNS Filter)" subtitle="ตัวกรอง DNS — บล็อกโดเมนทั้งบ้าน">
          <div className="text-sm text-amber-300 bg-amber-950/30 border border-amber-800 rounded-lg p-3">
            ⚠️ ยังเชื่อมต่อ Pi-hole ไม่ได้: {summary.error || 'ไม่ทราบสาเหตุ'}
            <div className="text-[11px] text-gray-400 mt-2">
              ตั้งค่าใน infra/.env: <code className="text-green-400">PIHOLE_URL=http://IP_PIHOLE:8088/admin</code> + <code className="text-green-400">PIHOLE_TOKEN=...</code> แล้ว restart core-api
            </div>
          </div>
        </Panel>
      );
    }

    return (
      <Panel
        title="🌐 Pi-hole (DNS Filter)"
        subtitle={summary?.connected ? `เชื่อมต่อแล้ว (API ${String(summary.mode).toUpperCase()})` : 'กำลังตรวจสอบ...'}
      >
        {summary?.connected && summary.summary && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Chip label="Query วันนี้" value={summary.summary.dnsQueriesToday} />
              <Chip label="โดเมนถูกบล็อก" value={summary.summary.adsBlockedToday} tone={summary.summary.adsBlockedToday > 0 ? 'warn' : 'default'} />
              <Chip label="อัตราบล็อก" value={`${summary.summary.adsPercentageToday}%`} />
              <Chip label="โดเมนในรายการ" value={summary.summary.domainsBeingBlocked} />
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
                  <Btn onClick={() => block('block')} tone="red">🚫 บล็อก (Pi-hole + Threat DB)</Btn>
                  <Btn onClick={() => block('allow')}>✅ ยกเลิกบล็อก</Btn>
                </>
              )}
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] text-gray-500 mb-1.5">🏆 โดเมนที่ถูกบล็อกมากสุด</div>
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {topBlocked.length === 0 && <div className="text-xs text-gray-600">ยังไม่มีข้อมูล</div>}
                  {topBlocked.map((t) => (
                    <div key={t.domain} className="flex items-center gap-2 text-xs bg-gray-800/50 border border-gray-700 rounded px-2 py-1">
                      <span className="flex-1 font-mono truncate text-red-300">{t.domain}</span>
                      <span className="text-gray-400">{t.count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-gray-500 mb-1.5">📋 Query ล่าสุด</div>
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {queries.length === 0 && <div className="text-xs text-gray-600">ยังไม่มีข้อมูล</div>}
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
        title="🛰️ Suricata (IDS/IPS)"
        subtitle={`eve.json: ${stats?.fileExists ? `มีไฟล์ (${(stats.fileSize / 1024).toFixed(0)} KB) · ตรวจใหม่ทุก ${(stats.pollIntervalMs / 1000).toFixed(0)}s` : 'ยังไม่พบไฟล์'}`}
      >
        {!stats?.configured || !stats.fileExists ? (
          <div className="text-sm text-amber-300 bg-amber-950/30 border border-amber-800 rounded-lg p-3">
            ⚠️ ยังไม่ได้ตั้งค่า IDS log — ใส่ path eve.json ใน <code className="text-green-400">IDS_EVE_LOG</code> (เช่น /var/log/suricata/eve.json)
            แล้ว restart · ระบบจะอ่าน alert ล่าสุดและบันทึกเป็นเหตุการณ์ IDS_ALERT อัตโนมัติ
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Chip label="ไฟล์ eve.json" value={stats.fileExists ? 'พร้อมอ่าน' : 'ไม่พบ'} tone={stats.fileExists ? 'ok' : 'err'} />
              <Chip label="offset อ่านแล้ว" value={`${(stats.offset / 1024).toFixed(0)} KB`} />
              <Chip label="Alert ทั้งหมด" value={data?.alerts?.length || 0} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-800">
                    <th className="px-2 py-2">เวลา</th>
                    <th className="px-2 py-2">ระดับ</th>
                    <th className="px-2 py-2">Signature</th>
                    <th className="px-2 py-2">ต้นทาง → ปลายทาง</th>
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
                    <tr><td colSpan={4} className="text-center text-gray-500 py-6">ยังไม่มี alert — โมเดลตรวจจับได้แล้ว</td></tr>
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
      if (!file) return notify('err', 'เลือกไฟล์ก่อน');
      setScanning(true);
      setScanResult(null);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await authFetch(`${API}/av/scan`, { method: 'POST', body: fd });
        setScanResult(await res.json());
      } catch {
        notify('err', 'สแกนไม่สำเร็จ');
      } finally {
        setScanning(false);
      }
    };

    return (
      <Panel title="🦠 ClamAV (Antivirus)" subtitle="สแกนไฟล์ผ่าน clamd (TCP 3310) — เหมาะกับไฟล์จากอุปกรณ์/USB/อีเมล">
        <div className="flex flex-wrap gap-2">
          <Chip label="clamd" value={avStatus?.connected ? 'เชื่อมต่อ' : 'ไม่เชื่อมต่อ'} tone={avStatus?.connected ? 'ok' : 'err'} />
          <Chip label="เวอร์ชัน" value={avStatus?.version || '-'} />
        </div>
        {!avStatus?.connected && (
          <div className="text-sm text-amber-300 bg-amber-950/30 border border-amber-800 rounded-lg p-3">
            ⚠️ ยังเชื่อมต่อ clamd ไม่ได้ — ตั้ง <code className="text-green-400">CLAMD_HOST</code> (เช่น 127.0.0.1) / <code className="text-green-400">CLAMD_PORT</code> (3310)
            และรัน clamd บนเครื่องหรือ NAS ที่พร้อม
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
              <Btn onClick={scan} disabled={scanning || !file} tone={scanning ? 'default' : 'green'}>{scanning ? '⏳ สแกน...' : '🦠 สแกนไวรัส'}</Btn>
            </div>
            {scanResult && (
              <div className={`text-xs p-3 rounded-lg border ${scanResult.ok ? 'bg-green-950/30 border-green-800 text-green-300' : 'bg-red-950/40 border-red-800 text-red-300'}`}>
                {scanResult.ok
                  ? `✅ ${scanResult.fileName} (${(scanResult.size / 1024).toFixed(1)} KB) ปลอดภัย — สแกนใช้เวลา ${scanResult.elapsedMs} ms`
                  : `🚨 ${scanResult.fileName}: ${scanResult.virus || scanResult.error || 'พบสิ่งผิดปกติ'}`}
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
        notify('err', 'โดเมนซ้ำหรือไม่ถูกต้อง');
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
        notify('ok', `ส่ง ${data.okCount}/${data.total} โดเมนไป Pi-hole แล้ว${data.errors?.length ? ` (มี ${data.errors.length} รายการผิดพลาด)` : ''}`);
      } catch {
        notify('err', 'sync ล้มเหลว');
      } finally {
        setSyncing(false);
      }
    };

    const categories = [...new Set(apps.map((a) => a.category))];

    return (
      <Panel
        title="📱 Application Control (DPI)"
        subtitle={`บล็อกทั้งแอปด้วยการ block โดเมนที่แอปใช้ — ตอนนี้กำลังบล็อก ${blockedCount} โดเมนจาก ${apps.length} แอป`}
      >
        {isSuperadmin && (
          <div className="flex flex-wrap gap-2 bg-gray-950/50 border border-gray-800 rounded-lg p-2.5">
            {categories.map((cat) => (
              <Btn key={cat} onClick={() => toggleCategory(cat, true)} tone="red">🔴 บล็อก {cat}</Btn>
            ))}
            <Btn onClick={() => apps.forEach((a) => toggleApp(a.id, false))}>🟢 ปลดบล็อกทั้งหมด</Btn>
            <Btn onClick={exportList}>📄 Export hosts file</Btn>
            <Btn onClick={syncPiHole} disabled={syncing} tone="amber">{syncing ? '⏳...' : '🌐 ส่งเข้า Pi-hole'}</Btn>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {apps.map((app) => (
            <div key={app.id} className={`border rounded-xl p-3 transition ${app.blocked ? 'bg-red-950/30 border-red-800' : 'bg-gray-800/50 border-gray-700'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{app.icon}</span>
                    <span className="font-bold text-sm">{app.name}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{app.category} · {app.domains.length} โดเมน</div>
                  <p className="text-[11px] text-gray-400 mt-1">{app.description}</p>
                </div>
                <button
                  onClick={() => isSuperadmin && toggleApp(app.id, !app.blocked)}
                  disabled={!isSuperadmin}
                  className={`shrink-0 px-2.5 py-1 rounded text-[10px] font-bold border transition ${app.blocked ? 'bg-red-600 border-red-700 text-white' : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'}`}
                >
                  {app.blocked ? 'BLOCKED' : 'อนุญาต'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-800 pt-3 space-y-2">
          <div className="text-xs font-bold text-gray-300">➕ โดเมนที่กำหนดเอง ({custom.length})</div>
          {isSuperadmin && (
            <div className="flex gap-2">
              <input
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="example.com"
                className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs"
              />
              <Btn onClick={addCustom} tone="green">เพิ่ม</Btn>
            </div>
          )}
          {custom.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {custom.map((d) => (
                <span key={d} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-gray-800 border border-gray-700 text-[11px] font-mono">
                  {d}
                  {isSuperadmin && <button onClick={() => removeCustom(d)} className="text-red-400 hover:text-white">✕</button>}
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
        title="📡 Network Visibility"
        subtitle="อุปกรณ์ในเครือข่ายที่เห็นผ่าน DNS + สถานะ ntopng"
      >
        <div className="flex flex-wrap gap-2">
          <Chip label="ntopng" value={!ntopng?.configured ? 'ไม่ตั้งค่า' : ntopng.reachable ? 'เชื่อมต่อ' : 'offline'} tone={ntopng?.reachable ? 'ok' : 'err'} />
          <Chip label="อุปกรณ์ที่เห็น" value={devices.length} />
          {summary && <Chip label="unique clients" value={summary.uniqueClients} />}
        </div>
        {!ntopng?.configured && (
          <div className="text-[11px] text-gray-500">
            ตั้ง <code className="text-green-400">NTOPNG_URL</code> (เช่น http://127.0.0.1:3000) เพื่อให้เห็นการรับส่งรายละเอียด (hosts/talkers) — ถ้าไม่มี ระบบใช้ข้อมูลจาก Pi-hole clients แทน
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-800">
                <th className="px-2 py-2">IP</th>
                <th className="px-2 py-2">ชื่อ</th>
                <th className="px-2 py-2">MAC</th>
                <th className="px-2 py-2 text-right">Query</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-gray-500 py-6">ยังไม่มีข้อมูลอุปกรณ์</td></tr>
              ) : (
                devices.map((d) => (
                  <tr key={d.ip} className="border-b border-gray-800/50">
                    <td className="px-2 py-2 font-mono text-cyan-300">{d.ip}</td>
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
          notify('ok', 'วิเคราะห์เสร็จ');
          loadStatus();
        }
      } catch {
        notify('err', 'วิเคราะห์ล้มเหลว');
      } finally {
        setRunning(false);
      }
    };

    const r = report?.report;
    return (
      <Panel
        title="🤖 AI Security Analyst"
        subtitle={`โมเดล ${process.env.NEXT_PUBLIC_AI_MODEL || 'gemma3:4b'} ผ่าน Ollama · รอบอัตโนมัติ: ${status?.aiAnalyst?.enabled ? 'ทุก 60 นาที' : 'ปิด (AI_ANALYST_ENABLED=false)'}${status?.aiAnalyst?.telegram ? ' · แจ้งเตือน Telegram: ON' : ''}`}
      >
        <div className="flex flex-wrap gap-2">
          <Chip label="Ollama" value={r ? 'พร้อม (เคยวิเคราะห์แล้ว)' : 'ยังไม่เคยวิเคราะห์'} tone={r ? 'ok' : 'err'} />
          <Chip label="เหตุการณ์ 24 ชม." value={r?.stats?.events24h ?? '-'} tone={(r?.stats?.events24h ?? 0) > 0 ? 'warn' : 'default'} />
          <Chip label="IDS alerts" value={r?.stats?.alerts24h ?? '-'} />
          <Chip label="IOC ในฐาน" value={r?.stats?.intelTotal ?? '-'} />
        </div>
        {isSuperadmin && <Btn onClick={analyze} disabled={running} tone="green">{running ? '⏳ กำลังวิเคราะห์ (Ollama)...' : '🔍 วิเคราะห์สถานการณ์ตอนนี้'}</Btn>}
        {r && (
          <div className="bg-gray-950/60 border border-gray-800 rounded-lg p-3 text-xs whitespace-pre-line text-gray-200 max-h-80 overflow-y-auto">
            {r.summary}
          </div>
        )}
        {!r && (
          <div className="text-xs text-gray-500">
            ยังไม่มีรายงาน — กด "วิเคราะห์ตอนนี้" หรือเปิด <code className="text-green-400">AI_ANALYST_ENABLED=true</code> ใน infra/.env เพื่อให้วิเคราะห์ทุกชั่วโมงและแจ้งเตือนผ่าน Telegram (AI_ANALYST_TELEGRAM=true)
          </div>
        )}
      </Panel>
    );
  };

  return (
    <div className="space-y-4">
      {/* Status chips */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Chip label="🧬 Threat DB" value={status ? `${status.threatIntel.total} IOC` : '...'} tone={status?.threatIntel?.total > 0 ? 'ok' : 'err'} />
        <Chip label="🌐 Pi-hole" value={status?.pihole?.connected ? `ON (${status.pihole.mode})` : 'OFF'} tone={status?.pihole?.connected ? 'ok' : 'err'} />
        <Chip label="🛰️ Suricata" value={status?.ids?.fileExists ? 'ON' : 'OFF'} tone={status?.ids?.fileExists ? 'ok' : 'err'} />
        <Chip label="🦠 ClamAV" value={status?.clamav?.connected ? 'ON' : 'OFF'} tone={status?.clamav?.connected ? 'ok' : 'err'} />
        <Chip label="📡 ntopng" value={status?.ntopng?.reachable ? 'ON' : 'OFF'} tone={status?.ntopng?.reachable ? 'ok' : 'err'} />
        <Chip label="📱 App Control" value={status ? `${status.appControl.blockedApps}/${status.appControl.catalog} แอป` : '...'} tone={status?.appControl?.blockedApps > 0 ? 'warn' : 'default'} />
      </div>

      {msg && (
        <div className={`p-3 rounded-lg text-sm border ${msg.type === 'ok' ? 'bg-green-900/30 text-green-400 border-green-800' : 'bg-red-900/30 text-red-400 border-red-800'}`}>
          {msg.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          ['intel', '🧬 Threat Intelligence'],
          ['dns', '🌐 Pi-hole DNS'],
          ['ids', '🛰️ Suricata'],
          ['apps', '📱 App Control'],
          ['av', '🦠 ClamAV'],
          ['net', '📡 Network'],
          ['ai', '🤖 AI Analyst'],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id as any)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${tab === id ? 'bg-green-600 text-white shadow' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
          >
            {label}
          </button>
        ))}
        <button onClick={loadStatus} className="ml-auto px-3 py-1.5 rounded-lg text-xs bg-gray-800 text-gray-400 hover:text-gray-200">🔄 รีเฟรช</button>
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