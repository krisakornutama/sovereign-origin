"use client";
import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../../lib/apiFetch';
import Icon from '../ui/Icon';
import { useLanguageStore } from '../../stores/useLanguageStore';

export interface FwRule {
  id: string; name: string; action: string; direction: string; protocol: string;
  remote_ip: string | null; remote_port: string | null; local_port: string | null;
  priority: number; description?: string | null; enabled: boolean;
}

export default function FirewallEnginePanel() {
  const t = useLanguageStore((s) => s.t);
  const [rules, setRules] = useState<FwRule[]>([]);
  const [defaultPolicy, setDefaultPolicy] = useState('ALLOW');
  const [conns, setConns] = useState<any[]>([]);
  const [ruleForm, setRuleForm] = useState({ name: '', action: 'DENY', direction: 'IN', protocol: 'TCP', remote_ip: '', remote_port: '', local_port: '', priority: '10', description: '' });
  const [testIp, setTestIp] = useState('');
  const [testPort, setTestPort] = useState('80');
  const [evalResult, setEvalResult] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/rules`);
      const d = await r.json();
      if (r.ok) { setRules(d.rules || []); setDefaultPolicy(d.defaultPolicy || 'ALLOW'); }
    } catch { /* เงียบ */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveRule = async (patch: Partial<FwRule>, id?: string) => {
    setErr(''); setMsg('');
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/rules${id ? '/' + id : ''}`, {
        method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t('securityComponents.firewall.saveFailed', 'บันทึกกฎไม่สำเร็จ'));
      setMsg(id ? t('securityComponents.firewall.saveUpdated', 'อัปเดตกฎแล้ว') : t('securityComponents.firewall.saveAdded', 'เพิ่มกฎ "{name}" แล้ว', { name: patch.name ?? '' }));
      if (!id) setRuleForm({ name: '', action: 'DENY', direction: 'IN', protocol: 'TCP', remote_ip: '', remote_port: '', local_port: '', priority: '10', description: '' });
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const deleteRule = async (r: FwRule) => {
    if (!window.confirm(t('securityComponents.firewall.deleteConfirm', 'ลบกฎ "{name}"?', { name: r.name }))) return;
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/rules/${r.id}`, { method: 'DELETE' });
    load();
  };

  const setPolicy = async (p: string) => {
    const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/policy`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ default_policy: p }),
    });
    if (r.ok) { setDefaultPolicy(p); setMsg(t('securityComponents.firewall.policySet', 'นโยบายเริ่มต้น = {policy}', { policy: p === 'DENY' ? t('securityComponents.firewall.denyPolicy', 'บล็อกทั้งหมด') : t('securityComponents.firewall.allowPolicy', 'อนุญาต') })); }
  };

  const scan = async () => {
    setScanning(true); setErr('');
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/scan`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t('securityComponents.firewall.scanFailed', 'สแกนไม่สำเร็จ'));
      setConns(d.connections || []);
      setMsg(t('securityComponents.firewall.scanFound', 'สแกนพบ {n} การเชื่อมต่อ', { n: d.total ?? 0 }));
    } catch (e: any) { setErr(e.message); } finally { setScanning(false); }
  };

  const evaluate = async () => {
    if (!testIp.trim()) { setErr(t('securityComponents.firewall.ipRequired', 'ใส่ IP ที่ต้องการทดสอบ')); return; }
    setErr('');
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/evaluate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocol: 'TCP', remote: `${testIp.trim()}:${testPort || '80'}`, local: '192.168.1.100:3001' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || t('securityComponents.firewall.evaluateFailed', 'evaluate ไม่สำเร็จ'));
      setEvalResult(t('securityComponents.firewall.evalResult', 'การเชื่อมต่อไปยัง {target} → {action} ({via})', {
        target: `${testIp.trim()}:${testPort}`,
        action: d.action,
        via: d.rule ? t('securityComponents.firewall.evalViaRule', 'กฎ: {name}', { name: d.rule.name }) : t('securityComponents.firewall.evalViaPolicy', 'ไม่ตรงกฎ → นโยบายเริ่มต้น {policy}', { policy: d.defaultPolicy || 'ALLOW' }),
      }));
    } catch (e: any) { setErr(e.message); }
  };

  const downloadScript = async () => {
    const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/host-script`);
    const text = await r.text();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sovereign-firewall.bat';
    a.click();
    setMsg(t('securityComponents.firewall.scriptDownloaded', 'ดาวน์โหลดสคริปต์แล้ว — รันบนเครื่องจริงด้วยสิทธิ์ Administrator เพื่อบังคับใช้กับ Windows Firewall'));
  };

  return (
    <div className="panel panel-cyan p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gray-200 glow-text">Firewall Engine <span className="text-[10px] text-gray-500 font-normal">{t('securityComponents.firewall.headerSub', '— จำแนก unknown + กฎ allow/deny + บังคับใช้จริงผ่าน Windows Firewall (สคริปต์ netsh)')}</span></h2>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-400">{t('securityComponents.firewall.defaultPolicy', 'นโยบายเริ่มต้น:')}</span>
          <button onClick={() => setPolicy('ALLOW')} className={`px-2 py-1 rounded border bg-gray-800 ${defaultPolicy === 'ALLOW' ? 'border-emerald-600 text-emerald-300' : 'border-gray-700 text-gray-400'}`}>{t('securityComponents.firewall.allowPolicy', 'อนุญาต')}</button>
          <button onClick={() => setPolicy('DENY')} className={`px-2 py-1 rounded border bg-gray-800 ${defaultPolicy === 'DENY' ? 'border-red-600 text-red-300' : 'border-gray-700 text-gray-400'}`}>{t('securityComponents.firewall.denyPolicy', 'บล็อกทั้งหมด')}</button>
          <button onClick={scan} disabled={scanning} className="btn-primary text-xs px-3 py-1.5">{scanning ? t('common.loading', 'กำลังโหลด...') : <><Icon name="search" size={12} /> {t('securityComponents.firewall.scanBtn', 'สแกนการเชื่อมต่อ')}</>}</button>
          <button onClick={downloadScript} className="btn-secondary text-xs px-3 py-1.5"><Icon name="download" size={12} /> {t('securityComponents.firewall.scriptBtn', 'สคริปต์ Windows Firewall')}</button>
        </div>
      </div>
      {msg && <div className="text-xs text-emerald-400">{msg}</div>}
      {err && <div className="text-xs text-red-400">{err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* กฎ */}
        <div className="space-y-2">
          <div className="text-sm font-semibold text-gray-300 glow-text-cyan">{t('securityComponents.firewall.rulesTitle', 'กฎไฟร์วอลล์ ({n}) — เลข priority สูงตรวจก่อน', { n: rules.length })}</div>
          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {rules.length === 0 && <div className="text-xs text-gray-600">{t('securityComponents.firewall.noRules', 'ยังไม่มีกฎ — เพิ่มกฎด้านล่าง (เช่น block IP ที่ไม่รู้จัก, allow เฉพาะ Telegram)')}</div>}
            {rules.map((r) => (
              <div key={r.id} className={`inset flex items-center gap-2 text-xs px-2 py-1.5 ${r.enabled ? '' : 'opacity-50'}`}>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${r.action === 'DENY' ? 'bg-red-900/60 text-red-300' : 'bg-emerald-900/60 text-emerald-300'}`}>{r.action}</span>
                <span className="font-bold flex-1 truncate">{r.name}</span>
                <span className="text-gray-500">{r.protocol} {r.direction} {r.remote_ip || ''} {r.remote_port ? ':' + r.remote_port : ''}{r.local_port ? ' ←:' + r.local_port : ''}</span>
                <button onClick={() => saveRule({ enabled: !r.enabled }, r.id)} title={t('securityComponents.firewall.toggleTitle', 'เปิด/ปิด')} className={r.enabled ? 'text-emerald-400' : 'text-gray-500'}>{r.enabled ? <Icon name="check" size={12} /> : <Icon name="x" size={12} />}</button>
                <button onClick={() => deleteRule(r)} className="text-red-400 hover:text-red-300"><Icon name="trash" size={12} /></button>
              </div>
            ))}
          </div>
          <div className="space-y-1.5 border-t border-gray-800 pt-2">
            <div className="flex gap-1.5">
              <input value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder={t('securityComponents.firewall.namePlaceholder', 'ชื่อกฎ เช่น block-unknown-scanner')} className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
              <select value={ruleForm.action} onChange={(e) => setRuleForm({ ...ruleForm, action: e.target.value })} className="bg-gray-800 border border-gray-600 rounded px-1.5 py-1.5 text-xs">
                <option value="ALLOW">{t('securityComponents.firewall.allowOpt', 'อนุญาต')}</option><option value="DENY">{t('securityComponents.firewall.denyOpt', 'บล็อก')}</option>
              </select>
              <select value={ruleForm.direction} onChange={(e) => setRuleForm({ ...ruleForm, direction: e.target.value })} className="bg-gray-800 border border-gray-600 rounded px-1.5 py-1.5 text-xs">
                <option value="IN">IN</option><option value="OUT">OUT</option><option value="BOTH">BOTH</option>
              </select>
              <select value={ruleForm.protocol} onChange={(e) => setRuleForm({ ...ruleForm, protocol: e.target.value })} className="bg-gray-800 border border-gray-600 rounded px-1.5 py-1.5 text-xs">
                <option value="ANY">ANY</option><option value="TCP">TCP</option><option value="UDP">UDP</option><option value="ICMP">ICMP</option>
              </select>
            </div>
            <div className="flex gap-1.5">
              <input value={ruleForm.remote_ip} onChange={(e) => setRuleForm({ ...ruleForm, remote_ip: e.target.value })} placeholder={t('securityComponents.firewall.ipPlaceholder', 'IP/CIDR เช่น 10.12.55.0/24 (เว้น = ทั้งหมด)')} className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
              <input value={ruleForm.remote_port} onChange={(e) => setRuleForm({ ...ruleForm, remote_port: e.target.value })} placeholder={t('securityComponents.firewall.portPlaceholder', 'พอร์ต (เช่น 443, 8000-8100)')} className="w-28 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
              <input value={ruleForm.priority} onChange={(e) => setRuleForm({ ...ruleForm, priority: e.target.value })} placeholder={t('securityComponents.firewall.priPlaceholder', 'pri')} className="w-14 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
            </div>
            <button onClick={() => saveRule({ name: ruleForm.name, action: ruleForm.action, direction: ruleForm.direction, protocol: ruleForm.protocol, remote_ip: ruleForm.remote_ip || null, remote_port: ruleForm.remote_port || null, local_port: ruleForm.local_port || null, priority: Number(ruleForm.priority) || 10, description: ruleForm.description })} className="w-full btn-primary text-xs py-1.5"><Icon name="plus" size={12} /> {t('securityComponents.firewall.addRuleBtn', 'เพิ่มกฎ')}</button>
          </div>
        </div>

        {/* สแกน + ทดสอบ */}
        <div className="space-y-3">
          <div className="text-sm font-semibold text-gray-300 glow-text-cyan">{t('securityComponents.firewall.scannedTitle', 'การเชื่อมต่อที่สแกน ({n})', { n: conns.length })}</div>
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {conns.length === 0 && <div className="text-xs text-gray-600">{t('securityComponents.firewall.scanHint', 'กด "สแกนการเชื่อมต่อ" เพื่อจำแนก known/unknown ตามกฎ')}</div>}
            {conns.map((c, i) => (
              <div key={i} className={`flex items-center gap-2 text-[11px] rounded px-2 py-1 border ${c.label === 'BLOCKED' ? 'bg-red-950/40 border-red-800 text-red-200' : c.label === 'UNKNOWN' ? 'bg-amber-950/30 border-amber-800 text-amber-200' : 'bg-emerald-950/30 border-emerald-800 text-emerald-200'}`}>
                <span className="shrink-0">
                  {c.label === 'BLOCKED' ? <Icon name="x-circle" size={12} /> : c.label === 'UNKNOWN' ? <Icon name="alert-triangle" size={12} /> : <Icon name="check-circle" size={12} />}
                </span>
                <span className="flex-1 truncate">{c.protocol} {c.local} → {c.remote}</span>
                <span className="text-gray-500">PID {c.pid}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-800 pt-2 space-y-1.5">
            <div className="text-xs font-semibold text-gray-300">{t('securityComponents.firewall.testTitle', 'ทดสอบกฎกับ IP ใด ๆ')}</div>
            <div className="flex gap-1.5">
              <input value={testIp} onChange={(e) => setTestIp(e.target.value)} placeholder={t('securityComponents.firewall.ipTestPlaceholder', 'IP เช่น 45.33.1.2')} className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
              <input value={testPort} onChange={(e) => setTestPort(e.target.value)} placeholder={t('securityComponents.firewall.portTestPlaceholder', 'พอร์ต')} className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
              <button onClick={evaluate} className="btn-secondary text-xs px-3 py-1.5">{t('securityComponents.firewall.testBtn', 'ทดสอบ')}</button>
            </div>
            {evalResult && <div className="text-xs text-gray-200 bg-gray-950/60 border border-cyan-800/50 rounded px-2 py-1.5">{evalResult}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}