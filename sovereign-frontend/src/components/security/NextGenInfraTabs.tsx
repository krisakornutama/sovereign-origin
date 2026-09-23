import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../../lib/apiFetch';
import Icon from '../ui/Icon';
import { API, Panel, Btn, Chip, SEV_COLORS, fmtTime, NextGenCtx } from './NextGenShared';

// ── แท็บ Suricata IDS + ClamAV + App Control DPI (แยกจาก NextGenPanel — phase 4) ──
  // ── IDS (Suricata) ──
export function IdsTab({ ctx }: { ctx: NextGenCtx }) {
  const { t } = ctx;
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
export function AvTab({ ctx }: { ctx: NextGenCtx }) {
  const { t, notify, isSuperadmin } = ctx;
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
export function AppsTab({ ctx }: { ctx: NextGenCtx }) {
  const { t, notify, loadStatus, isSuperadmin } = ctx;
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

