"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import { asArray } from '../lib/fetchJson';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import { useLanguageStore } from '../stores/useLanguageStore';

interface Relay {
  relayId: string;
  label: string;
  state: number; // 0 = ปิด, 1 = เปิด
}

interface RelaySchedule {
  id: string;
  relayId: string;
  relayLabel: string;
  enabled: boolean;
  time: string;
  state: number;
  days: string;
}

const DAY_NAMES = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา']; // index 0 = จันทร์ (วัน 1)

export default function RelayPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);

  const daysToLabel = (days: string): string => {
    if (days === '*') return t('relay.everyDay', 'ทุกวัน');
    return days
      .split(',')
      .map((d) => t(`relay.days.${d}`, DAY_NAMES[parseInt(d, 10) - 1] || d))
      .join(' ');
  };

  const [relays, setRelays] = useState<Relay[]>([]);
  const [schedules, setSchedules] = useState<RelaySchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // ฟอร์มเพิ่มตารางเวลา
  const [formRelay, setFormRelay] = useState('');
  const [formTime, setFormTime] = useState('06:00');
  const [formState, setFormState] = useState(1);
  const [formDays, setFormDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [statusRes, schedRes] = await Promise.all([
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/relay/status`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/relay/schedules`),
      ]);
      if (!statusRes.ok || !schedRes.ok) throw new Error(t('relay.errLoad', 'โหลดข้อมูลไม่สำเร็จ'));
      setRelays(asArray(await statusRes.json()));
      setSchedules(asArray(await schedRes.json()));
    } catch (err: any) {
      setError(`${err.message || t('relay.errLoadData', 'ไม่สามารถโหลดข้อมูลได้')}`);
      setRelays([]);
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    loadData();
  }, [isHydrated, isAuthenticated]);

  // เลือก relay ตัวแรกให้อัตโนมัติเมื่อโหลดเสร็จ
  useEffect(() => {
    if (!formRelay && relays.length > 0) {
      setFormRelay(relays[0].relayId);
    }
  }, [relays, formRelay]);

  const toggleRelay = async (relay: Relay, newState: number) => {
    setSendingId(relay.relayId);
    setMessage('');
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/relay/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relayId: relay.relayId, state: newState }),
      });
      const data = await res.json();
      if (res.ok) {
        setRelays((prev) =>
          prev.map((r) => (r.relayId === relay.relayId ? { ...r, state: newState } : r))
        );
        setMessage(t('relay.toggled', '{label}: {state}แล้ว', { label: relay.label, state: newState === 1 ? t('common.on', 'เปิด') : t('common.off', 'ปิด') }));
      } else {
        setError(`${data.error || t('relay.errCommand', 'คำสั่งล้มเหลว')}`);
      }
    } catch {
      setError(t('relay.errSend', 'ไม่สามารถส่งคำสั่งได้ (ตรวจสอบ MQTT Broker / Core API)'));
    } finally {
      setSendingId(null);
    }
  };

  const toggleDay = (day: number) => {
    setFormDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const addSchedule = async () => {
    if (!formRelay) {
      setError(t('relay.errSelectRelay', 'เลือก relay ก่อน'));
      return;
    }
    if (formDays.length === 0) {
      setError(t('relay.errSelectDay', 'เลือกอย่างน้อย 1 วัน'));
      return;
    }
    setMessage('');
    setError('');
    try {
      const days = formDays.length === 7 ? '*' : [...formDays].sort((a, b) => a - b).join(',');
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/relay/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relayId: formRelay, time: formTime, state: formState, days }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(t('relay.scheduleAdded', 'เพิ่มตารางเวลาแล้ว'));
        loadData();
      } else {
        setError(`${data.error || t('relay.errAddSchedule', 'เพิ่มตารางไม่สำเร็จ')}`);
      }
    } catch {
      setError(t('relay.errAddScheduleFailed', 'ไม่สามารถเพิ่มตารางได้'));
    }
  };

  const toggleSchedule = async (sched: RelaySchedule) => {
    setMessage('');
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/relay/schedules/${sched.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !sched.enabled }),
      });
      if (res.ok) {
        setSchedules((prev) =>
          prev.map((s) => (s.id === sched.id ? { ...s, enabled: !sched.enabled } : s))
        );
        setMessage(sched.enabled ? t('relay.scheduleDisabled', 'ปิดตารางแล้ว') : t('relay.scheduleEnabled', 'เปิดตารางแล้ว'));
      }
    } catch {
      setError(t('relay.errToggleSchedule', 'เปลี่ยนสถานะตารางไม่สำเร็จ'));
    }
  };

  const deleteSchedule = async (sched: RelaySchedule) => {
    if (!confirm(t('relay.confirmDelete', 'ลบตาราง {label} เวลา {time}?', { label: sched.relayLabel, time: sched.time }))) return;
    setMessage('');
    setError('');
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/relay/schedules/${sched.id}`, {
        method: 'DELETE',
      });
      setMessage(t('relay.scheduleDeleted', 'ลบตารางแล้ว'));
      loadData();
    } catch {
      setError(t('relay.errDeleteSchedule', 'ลบตารางไม่สำเร็จ'));
    }
  };

  if (!isHydrated) {
    return <div className="text-white p-8">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">{t('relay.unauthorized', 'Unauthorized')}</div>;
  }

  return (
    <div className="atmo-power min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <PageHeader
          eyebrow={t('relay.eyebrow', 'อุปกรณ์ & พลังงาน')}
          title="SOVEREIGN OS" theme="power" icon={<Icon name="relay" size={18} />}
          subtitle={t('relay.subtitle', 'Relay Control')} actions={<div className="flex gap-3 items-center">
          <Link href="/dashboard" scroll={false} className="text-sm text-sky-400 hover:underline">{t('relay.dashboardLink', 'Dashboard')}</Link>
        </div>}
        />

      <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-4xl mx-auto w-full space-y-8">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('relay.controlTitle', 'ควบคุมอุปกรณ์ไฟฟ้า')}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {t('relay.controlDesc', 'ส่งคำสั่งผ่าน MQTT ไปยัง relay (ต้องมีอุปกรณ์รับคำสั่งจริงในเครือข่าย)')}
            </p>
          </div>
          <button onClick={loadData} className="btn-secondary">
            <Icon name="refresh" size={14} />
            {t('common.refresh', 'รีเฟรช')}
          </button>
        </div>

        {message && <div className="inset p-3 rounded text-sm text-emerald-400">{message}</div>}
        {error && <div className="inset p-3 rounded text-sm text-red-400">{error}</div>}

        {/* Relay cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {relays.map((relay) => {
            const isOn = relay.state === 1;
            const isSending = sendingId === relay.relayId;
            return (
              <div
                key={relay.relayId}
                className={`card card-hover panel-cyan p-5 flex flex-col gap-4 transition ${
                  isOn ? 'border-emerald-600/50' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-lg font-bold text-white glow-text">{relay.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{relay.relayId}</div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                      isOn ? 'bg-emerald-600/20 text-emerald-400' : 'bg-gray-700 text-gray-400'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${isOn ? 'bg-emerald-500 animate-pulse glow-dot' : 'bg-gray-500'}`} />
                    {isOn ? 'ON' : 'OFF'}
                  </span>
                </div>

                <button
                  onClick={() => toggleRelay(relay, isOn ? 0 : 1)}
                  disabled={isSending}
                  className={`w-full ${isOn ? 'btn-danger' : 'btn-primary'}`}
                >
                  {isSending ? t('relay.sending', 'ส่งคำสั่ง...') : isOn ? t('common.off', 'ปิด') : t('common.on', 'เปิด')}
                </button>
              </div>
            );
          })}
        </div>

        {relays.length === 0 && !loading && (
          <div className="card"><div className="flex flex-col items-center justify-center text-center py-12 px-6 gap-3"><div className="w-12 h-12 rounded-xl border border-gray-700 bg-gray-800/40 flex items-center justify-center text-gray-400"><Icon name="relay" size={20} /></div><div className="text-sm font-bold text-gray-100">{t('relay.noRelays', 'ไม่มี relay ในระบบ')}</div></div></div>
        )}
        {loading && <div className="flex items-center justify-center py-12 gap-2 text-gray-500"><span className="w-4 h-4 border-2 border-gray-600 border-t-emerald-500 rounded-full animate-spin" /><span className="text-sm">{t('relay.loadingStatus', 'กำลังโหลดสถานะ...')}</span></div>}

        {/* ⏰ Scheduled Relay */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('relay.scheduleTitle', 'ตารางเวลาอัตโนมัติ')}</h2>

          {/* ฟอร์มเพิ่มตาราง */}
          <div className="card panel-glow p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="label">{t('relay.relay', 'Relay')}</label>
                <select
                  value={formRelay}
                  onChange={(e) => setFormRelay(e.target.value)}
                  className="input w-full"
                >
                  {relays.map((r) => (
                    <option key={r.relayId} value={r.relayId}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t('relay.timeLabel', 'เวลา (HH:mm)')}</label>
                <input
                  type="time"
                  value={formTime}
                  onChange={(e) => setFormTime(e.target.value)}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="label">{t('relay.command', 'คำสั่ง')}</label>
                <select
                  value={formState}
                  onChange={(e) => setFormState(Number(e.target.value))}
                  className="input w-full"
                >
                  <option value={1}>{t('relay.optionOn', 'เปิด (ON)')}</option>
                  <option value={0}>{t('relay.optionOff', 'ปิด (OFF)')}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label">{t('relay.daysOfWeek', 'วันในสัปดาห์')}</label>
              <div className="flex flex-wrap gap-2">
                {DAY_NAMES.map((name, idx) => {
                  const day = idx + 1;
                  const selected = formDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
                        selected
                          ? 'bg-emerald-600 text-white'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      {t(`relay.days.${day}`, name)}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setFormDays([1, 2, 3, 4, 5, 6, 7])}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
                >
                  {t('relay.everyDay', 'ทุกวัน')}
                </button>
              </div>
            </div>

            <button
              onClick={addSchedule}
              disabled={!formRelay || formDays.length === 0}
              className="btn-primary"
            >
              <Icon name="plus" size={14} />
              {t('relay.addSchedule', 'เพิ่มตารางเวลา')}
            </button>
          </div>

          {/* รายการตาราง */}
          <div className="card panel-cyan overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-emerald-500/50 via-cyan-500/30 to-transparent" />
            <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-950/40 backdrop-blur-sm">
                <tr className="text-left text-emerald-400/70 border-b border-gray-800 text-[11px] uppercase tracking-widest">
                  <th className="px-4 py-3 font-semibold">{t('relay.relay', 'Relay')}</th>
                  <th className="px-4 py-3 font-semibold">{t('common.time', 'เวลา')}</th>
                  <th className="px-4 py-3 font-semibold">{t('relay.colDays', 'วัน')}</th>
                  <th className="px-4 py-3 font-semibold">{t('relay.command', 'คำสั่ง')}</th>
                  <th className="px-4 py-3 font-semibold">{t('common.status', 'สถานะ')}</th>
                  <th className="px-4 py-3 font-semibold">{t('common.actions', 'จัดการ')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {schedules.map((sched) => (
                  <tr key={sched.id} className={`hover:bg-gray-800/50 ${sched.enabled ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-2 text-gray-200">{sched.relayLabel}</td>
                    <td className="px-4 py-2 font-bold text-white">{sched.time}</td>
                    <td className="px-4 py-2 text-xs text-gray-400">{daysToLabel(sched.days)}</td>
                    <td className="px-4 py-2">{sched.state === 1 ? t('common.on', 'เปิด') : t('common.off', 'ปิด')}</td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => toggleSchedule(sched)}
                        className={`px-3 py-1 rounded-full text-xs font-bold transition ${
                          sched.enabled
                            ? 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/40'
                            : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                        }`}
                      >
                        {sched.enabled ? t('common.on', 'เปิด') : t('common.off', 'ปิด')}
                      </button>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => deleteSchedule(sched)}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {schedules.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      {t('relay.noSchedules', 'ยังไม่มีตารางเวลา — เพิ่มตารางแรกของคุณ')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </section>
      </main>
    </div>
      </div>
  );
}
