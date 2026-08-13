"use client";
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';

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

function daysToLabel(days: string): string {
  if (days === '*') return 'ทุกวัน';
  return days
    .split(',')
    .map((d) => DAY_NAMES[parseInt(d, 10) - 1] || d)
    .join(' ');
}

export default function RelayPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
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
      if (!statusRes.ok || !schedRes.ok) throw new Error('โหลดข้อมูลไม่สำเร็จ');
      setRelays(await statusRes.json());
      setSchedules(await schedRes.json());
    } catch (err: any) {
      setError(`❌ ${err.message || 'ไม่สามารถโหลดข้อมูลได้'}`);
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
        setMessage(`✅ ${relay.label}: ${newState === 1 ? 'เปิด' : 'ปิด'}แล้ว`);
      } else {
        setError(`❌ ${data.error || 'คำสั่งล้มเหลว'}`);
      }
    } catch {
      setError('❌ ไม่สามารถส่งคำสั่งได้ (ตรวจสอบ MQTT Broker / Core API)');
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
      setError('❌ เลือก relay ก่อน');
      return;
    }
    if (formDays.length === 0) {
      setError('❌ เลือกอย่างน้อย 1 วัน');
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
        setMessage('✅ เพิ่มตารางเวลาแล้ว');
        loadData();
      } else {
        setError(`❌ ${data.error || 'เพิ่มตารางไม่สำเร็จ'}`);
      }
    } catch {
      setError('❌ ไม่สามารถเพิ่มตารางได้');
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
        setMessage(sched.enabled ? '⏸️ ปิดตารางแล้ว' : '▶️ เปิดตารางแล้ว');
      }
    } catch {
      setError('❌ เปลี่ยนสถานะตารางไม่สำเร็จ');
    }
  };

  const deleteSchedule = async (sched: RelaySchedule) => {
    if (!confirm(`ลบตาราง ${sched.relayLabel} เวลา ${sched.time}?`)) return;
    setMessage('');
    setError('');
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/relay/schedules/${sched.id}`, {
        method: 'DELETE',
      });
      setMessage('🗑️ ลบตารางแล้ว');
      loadData();
    } catch {
      setError('❌ ลบตารางไม่สำเร็จ');
    }
  };

  if (!isHydrated) {
    return <div className="text-white p-8">⏳ Loading...</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">Unauthorized</div>;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow="อุปกรณ์ &amp; พลังงาน"
          title="🏰 SOVEREIGN OS"
          subtitle="Relay Control" actions={<div className="flex gap-3 items-center">
          <a href="/dashboard" className="text-sm text-blue-400 hover:underline">📊 Dashboard</a>
        </div>}
        />
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-8">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold">🎛️ ควบคุมอุปกรณ์ไฟฟ้า</h2>
            <p className="text-sm text-gray-500 mt-1">
              ส่งคำสั่งผ่าน MQTT ไปยัง relay (ต้องมีอุปกรณ์รับคำสั่งจริงในเครือข่าย)
            </p>
          </div>
          <button onClick={loadData} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm">
            🔄 รีเฟรช
          </button>
        </div>

        {message && <div className="p-3 rounded text-sm bg-green-900/30 text-green-400">{message}</div>}
        {error && <div className="p-3 rounded text-sm bg-red-900/30 text-red-400">{error}</div>}

        {/* Relay cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {relays.map((relay) => {
            const isOn = relay.state === 1;
            const isSending = sendingId === relay.relayId;
            return (
              <div
                key={relay.relayId}
                className={`bg-gray-900 border rounded-xl p-5 flex flex-col gap-4 transition ${
                  isOn ? 'border-green-600/50 bg-green-900/10' : 'border-gray-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-lg font-bold text-white">{relay.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{relay.relayId}</div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                      isOn ? 'bg-green-600/20 text-green-400' : 'bg-gray-700 text-gray-400'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${isOn ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
                    {isOn ? 'ON' : 'OFF'}
                  </span>
                </div>

                <button
                  onClick={() => toggleRelay(relay, isOn ? 0 : 1)}
                  disabled={isSending}
                  className={`w-full py-2.5 rounded-lg text-sm font-semibold transition active:scale-95 disabled:opacity-50 ${
                    isOn ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-green-600 hover:bg-green-500 text-white'
                  }`}
                >
                  {isSending ? '⏳ ส่งคำสั่ง...' : isOn ? '⏻ ปิด' : '⏻ เปิด'}
                </button>
              </div>
            );
          })}
        </div>

        {relays.length === 0 && !loading && (
          <div className="text-gray-500 text-center py-8">ไม่มี relay ในระบบ</div>
        )}
        {loading && <div className="text-gray-400 text-center py-8">⏳ กำลังโหลดสถานะ...</div>}

        {/* ⏰ Scheduled Relay */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold">⏰ ตารางเวลาอัตโนมัติ</h2>

          {/* ฟอร์มเพิ่มตาราง */}
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Relay</label>
                <select
                  value={formRelay}
                  onChange={(e) => setFormRelay(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white"
                >
                  {relays.map((r) => (
                    <option key={r.relayId} value={r.relayId}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">เวลา (HH:mm)</label>
                <input
                  type="time"
                  value={formTime}
                  onChange={(e) => setFormTime(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">คำสั่ง</label>
                <select
                  value={formState}
                  onChange={(e) => setFormState(Number(e.target.value))}
                  className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white"
                >
                  <option value={1}>เปิด (ON)</option>
                  <option value={0}>ปิด (OFF)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-2">วันในสัปดาห์</label>
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
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      {name}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setFormDays([1, 2, 3, 4, 5, 6, 7])}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
                >
                  ทุกวัน
                </button>
              </div>
            </div>

            <button
              onClick={addSchedule}
              disabled={!formRelay || formDays.length === 0}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-sm font-semibold disabled:opacity-50"
            >
              ➕ เพิ่มตารางเวลา
            </button>
          </div>

          {/* รายการตาราง */}
          <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-800 text-gray-400 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">Relay</th>
                  <th className="px-4 py-3">เวลา</th>
                  <th className="px-4 py-3">วัน</th>
                  <th className="px-4 py-3">คำสั่ง</th>
                  <th className="px-4 py-3">สถานะ</th>
                  <th className="px-4 py-3">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {schedules.map((sched) => (
                  <tr key={sched.id} className={`hover:bg-gray-800/50 ${sched.enabled ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-2 text-gray-200">{sched.relayLabel}</td>
                    <td className="px-4 py-2 font-bold text-white">{sched.time}</td>
                    <td className="px-4 py-2 text-xs text-gray-400">{daysToLabel(sched.days)}</td>
                    <td className="px-4 py-2">{sched.state === 1 ? 'เปิด' : 'ปิด'}</td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => toggleSchedule(sched)}
                        className={`px-3 py-1 rounded-full text-xs font-bold transition ${
                          sched.enabled
                            ? 'bg-green-600/20 text-green-400 hover:bg-green-600/40'
                            : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                        }`}
                      >
                        {sched.enabled ? '🟢 เปิด' : '⚪ ปิด'}
                      </button>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => deleteSchedule(sched)}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
                {schedules.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      ยังไม่มีตารางเวลา — เพิ่มตารางแรกของคุณ
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
      </div>
  );
}
