"use client";
// ── Tab 3: Climate & Fail-Safe ──
// ย้ายจาก pages/livestock.tsx ตามเดิมทุกบรรทัด (FE-003)
import { useState } from 'react';
import Icon from '../ui/Icon';

export default function ClimateTab({ api, setMsg, setErr, t }: any) {
  const [form, setForm] = useState({ tempC: '', rhPct: '', houseCode: '' });
  const [util, setUtil] = useState({ houseCode: '', gridPowerState: 'NORMAL', generatorState: 'OFF' });
  const [latest, setLatest] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [result, setResult] = useState<any>(null);
  const [utilResult, setUtilResult] = useState<any>(null);

  const sendClimate = async () => {
    setErr(''); setMsg('');
    try {
      const body: Record<string, unknown> = { tempC: Number(form.tempC), rhPct: Number(form.rhPct) };
      if (form.houseCode) body.houseCode = form.houseCode;
      const r = await api('/climate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'send failed');
      setResult(d);
      setLatest(d.sample);
      setHistory((await (await api('/climate')).json()).history || []);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const sendUtility = async () => {
    setErr(''); setMsg('');
    try {
      const r = await api('/utility', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(util) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'send failed');
      setUtilResult(d);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const thiColor = (thi: number) => thi > 84 ? 'text-red-400' : thi > 74 ? 'text-amber-400' : 'text-emerald-300';

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="card panel-glow p-4 space-y-3">
        <div className="text-sm font-semibold text-gray-200 flex items-center gap-1.5"><Icon name="thermometer" size={14} className="text-gray-400" />{t('livestock.climate.title', 'Microclimate & Ventilation Fail-Safe')}</div>
        <div className="grid grid-cols-3 gap-2">
          <input value={form.tempC} onChange={(e) => setForm({ ...form, tempC: e.target.value })} type="number" step="0.1" placeholder={t('livestock.climate.tempPlaceholder', 'อุณหภูมิ (°C)')} className="input" />
          <input value={form.rhPct} onChange={(e) => setForm({ ...form, rhPct: e.target.value })} type="number" step="0.1" placeholder={t('livestock.climate.rhPlaceholder', 'ความชื้น (%)')} className="input" />
          <input value={form.houseCode} onChange={(e) => setForm({ ...form, houseCode: e.target.value })} placeholder={t('livestock.climate.housePlaceholder', 'เล้า/คอก')} className="input" />
        </div>
        <button onClick={sendClimate} className="btn-primary">{t('livestock.climate.send', 'ส่งค่า → คำนวณ THI')}</button>

        {result && (
          <div className={`rounded-lg border p-3 text-sm ${result.level === 'critical' ? 'bg-red-950/40 border-red-700 text-red-200' : result.level === 'warn' ? 'bg-amber-950/40 border-amber-700 text-amber-200' : 'bg-emerald-950/40 border-emerald-700 text-emerald-200'}`}>
            <div className="flex items-center gap-2 font-bold">{t('livestock.climate.thi', 'THI')}: <span className={`text-xl glow-text ${thiColor(result.thi)}`}>{result.thi.toFixed(1)}</span></div>
            <div className="text-xs mt-1">
              {result.level === 'critical' ? t('livestock.climate.critical', 'วิกฤต! (THI > 84) — ระบายอากาศด่วน')
                : result.level === 'warn' ? t('livestock.climate.warn', 'เริ่มร้อน — เปิดพัดลม/พ่นหมอก')
                : t('livestock.climate.comfort', 'สบาย (COMFORT)')}
            </div>
            {result.actions?.length > 0 && <div className="text-[11px] mt-1 opacity-80">→ {result.actions.join(', ')}</div>}
          </div>
        )}

        {history.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-sky-300 font-bold">{t('livestock.climate.history', 'ประวัติ THI (48 ตัวอย่างล่าสุด)')}</summary>
            <div className="flex flex-wrap gap-1.5 mt-2 max-h-40 overflow-y-auto">
              {history.map((h, i) => (
                <div key={i} className={`text-[10px] px-1.5 py-0.5 rounded border ${h.thi > 84 ? 'bg-red-950/50 border-red-700 text-red-300' : h.thi > 74 ? 'bg-amber-950/50 border-amber-700 text-amber-300' : 'bg-gray-900 border-gray-700 text-gray-400'}`} title={`${h.tempC}°C ${h.rhPct}% ${h.at}`}>{h.thi.toFixed(1)}</div>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <div className="text-sm font-semibold text-gray-200 flex items-center gap-1.5"><Icon name="zap" size={14} className="text-gray-400" />{t('livestock.climate.utilityTitle', 'Utility Fail-Safe (ไฟ/เครื่องปั่น/ATS)')}</div>
        <div className="grid grid-cols-3 gap-2">
          <input value={util.houseCode} onChange={(e) => setUtil({ ...util, houseCode: e.target.value })} placeholder={t('livestock.climate.housePlaceholder', 'เล้า/คอก')} className="input" />
          <select value={util.gridPowerState} onChange={(e) => setUtil({ ...util, gridPowerState: e.target.value })} className="input">
            <option value="NORMAL">{t('livestock.climate.gridNormal', 'ปกติ (NORMAL)')}</option>
            <option value="BLACKOUT">{t('livestock.climate.gridBlackout', 'ไฟดับ (BLACKOUT)')}</option>
          </select>
          <select value={util.generatorState} onChange={(e) => setUtil({ ...util, generatorState: e.target.value })} className="input">
            <option value="OFF">{t('livestock.climate.genOff', 'ปิด (OFF)')}</option>
            <option value="RUNNING">{t('livestock.climate.genRunning', 'ทำงาน (RUNNING)')}</option>
            <option value="FAIL">{t('livestock.climate.genFail', 'เสีย (FAIL)')}</option>
          </select>
        </div>
        <button onClick={sendUtility} className="btn-primary">{t('livestock.climate.sendUtility', 'ส่งสถานะ')}</button>
        {utilResult && (
          <div className={`rounded-lg border p-3 text-sm ${utilResult.anomaly === 'CRITICAL' ? 'bg-red-950/40 border-red-700 text-red-200' : utilResult.anomaly === 'WARN' ? 'bg-amber-950/40 border-amber-700 text-amber-200' : 'bg-emerald-950/40 border-emerald-700 text-emerald-200'}`}>
            {utilResult.anomaly === 'CRITICAL' ? t('livestock.climate.anomalyCritical', 'วิกฤต! ไฟดับ + เครื่องปั่นไม่ทำงาน')
              : utilResult.anomaly === 'WARN' ? t('livestock.climate.anomalyWarn', 'ไฟดับ — เครื่องปั่นทำงาน')
              : t('livestock.climate.anomalyNone', 'ทุกอย่างปกติ')}
          </div>
        )}
      </div>
    </div>
  );
}
