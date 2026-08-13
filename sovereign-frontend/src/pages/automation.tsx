"use client";
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';

interface Rule {
  id: string;
  metric: string;
  condition: 'gt' | 'lt' | 'eq';
  threshold: number;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  enabled: boolean;
  is_default: boolean;
}

const conditionLabels: Record<string, string> = {
  gt: '> (มากกว่า)',
  lt: '< (น้อยกว่า)',
  eq: '= (เท่ากับ)',
};

const severityColors: Record<string, string> = {
  info: 'bg-blue-600',
  warning: 'bg-amber-600',
  critical: 'bg-red-600',
};

const METRIC_SUGGESTIONS = [
  'temperature', 'humidity', 'battery_soc', 'water_level_cm', 'rainfall', 'rain_detect',
  'soil_moisture', 'power_kw', 'voltage', 'current', 'smoke', 'flame', 'gas_leak',
  'door_state', 'pir_motion', 'pressure', 'wind_speed', 'ec_value', 'ph',
];

const emptyForm = { metric: '', condition: 'gt', threshold: 30, severity: 'warning', message: '' };

export default function AutomationPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ ...emptyForm });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadRules = async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/automation/rules`);
      const data = await res.json();
      setRules(data);
    } catch (err) {
      console.error('Failed to load rules:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    loadRules();
  }, [isHydrated, isAuthenticated]);

  const toggleRule = async (id: string, enabled: boolean) => {
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/automation/rules/${id}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    loadRules();
  };

  const createRule = async () => {
    setMessage('');
    setError('');
    if (!form.metric.trim() || !form.message.trim()) {
      setError('กรอก metric และข้อความแจ้งเตือนก่อน');
      return;
    }
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/automation/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, threshold: Number(form.threshold) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setMessage('✅ สร้างกฎใหม่แล้ว');
      setForm({ ...emptyForm });
      setShowForm(false);
      await loadRules();
    } catch (err) {
      console.error(err);
      setError('สร้างกฎไม่สำเร็จ: ' + ((err as Error).message || 'unknown'));
    }
  };

  const startEdit = (rule: Rule) => {
    setEditingId(rule.id);
    setEditForm({
      metric: rule.metric,
      condition: rule.condition,
      threshold: rule.threshold,
      severity: rule.severity,
      message: rule.message,
    });
  };

  const saveEdit = async (id: string) => {
    setMessage('');
    setError('');
    if (!editForm.metric.trim() || !editForm.message.trim()) {
      setError('กรอก metric และข้อความแจ้งเตือนก่อน');
      return;
    }
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/automation/rules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editForm, threshold: Number(editForm.threshold) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setMessage('✅ บันทึกการแก้ไขแล้ว');
      setEditingId(null);
      await loadRules();
    } catch (err) {
      console.error(err);
      setError('แก้ไขไม่สำเร็จ: ' + ((err as Error).message || 'unknown'));
    }
  };

  const deleteRule = async (id: string) => {
    if (!window.confirm('ลบกฎนี้? (กฎสำเร็จรูปลบไม่ได้)')) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/automation/rules/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await loadRules();
    } catch (err) {
      console.error(err);
      setError('ลบกฎไม่สำเร็จ: ' + ((err as Error).message || 'unknown'));
    }
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">⏳ Loading...</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">Unauthorized</div>;
  }

  const ruleForm = (isEdit: boolean) => (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
      <input
        list="metric-suggestions"
        placeholder="metric เช่น temperature"
        value={isEdit ? editForm.metric : form.metric}
        onChange={(e) => (isEdit ? setEditForm({ ...editForm, metric: e.target.value }) : setForm({ ...form, metric: e.target.value }))}
        className="col-span-2 md:col-span-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white"
      />
      <datalist id="metric-suggestions">
        {METRIC_SUGGESTIONS.map((m) => <option key={m} value={m} />)}
      </datalist>
      <select
        value={isEdit ? editForm.condition : form.condition}
        onChange={(e) => (isEdit ? setEditForm({ ...editForm, condition: e.target.value as any }) : setForm({ ...form, condition: e.target.value as any }))}
        className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white"
      >
        <option value="gt">&gt; มากกว่า</option>
        <option value="lt">&lt; น้อยกว่า</option>
        <option value="eq">= เท่ากับ</option>
      </select>
      <input
        type="number"
        step="any"
        placeholder="ค่า threshold"
        value={isEdit ? editForm.threshold : form.threshold}
        onChange={(e) => (isEdit ? setEditForm({ ...editForm, threshold: Number(e.target.value) }) : setForm({ ...form, threshold: Number(e.target.value) }))}
        className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white"
      />
      <select
        value={isEdit ? editForm.severity : form.severity}
        onChange={(e) => (isEdit ? setEditForm({ ...editForm, severity: e.target.value as any }) : setForm({ ...form, severity: e.target.value as any }))}
        className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white"
      >
        <option value="info">ℹ️ info</option>
        <option value="warning">⚠️ warning</option>
        <option value="critical">🚨 critical</option>
      </select>
      <input
        placeholder="ข้อความแจ้งเตือน เช่น แบตเตอรี่ต่ำ!"
        value={isEdit ? editForm.message : form.message}
        onChange={(e) => (isEdit ? setEditForm({ ...editForm, message: e.target.value }) : setForm({ ...form, message: e.target.value }))}
        className="col-span-2 md:col-span-3 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white"
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow="อุปกรณ์ &amp; พลังงาน"
          title="🏰 SOVEREIGN OS"
          subtitle="Automation Rules" actions={<div className="flex gap-3">
          <a href="/dashboard" className="text-sm text-blue-400 hover:underline">📊 Dashboard</a>
          <a href="/sensors" className="text-sm text-green-400 hover:underline">➕ เซ็นเซอร์</a>
        </div>}
        />
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex justify-between items-start gap-4">
          <div>
            <h2 className="text-xl font-bold text-white mb-2">⚙️ กฎอัตโนมัติ</h2>
            <p className="text-sm text-gray-400">
              เมื่อเซ็นเซอร์ถึงเงื่อนไขที่กำหนด ระบบจะส่งการแจ้งเตือนอัตโนมัติ
            </p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-semibold whitespace-nowrap"
          >
            {showForm ? '✖️ ปิด' : '➕ สร้างกฎใหม่'}
          </button>
        </div>

        {message && <div className="text-sm text-green-400 bg-green-900/30 border border-green-700 rounded-lg px-4 py-3">{message}</div>}
        {error && <div className="text-sm text-red-400 bg-red-900/30 border border-red-700 rounded-lg px-4 py-3">{error}</div>}

        {showForm && (
          <div className="bg-gray-900 border border-green-700 rounded-xl p-4">
            <h3 className="text-sm font-bold text-green-400 mb-3">🛠️ สร้างกฎใหม่ (IF-THEN)</h3>
            {ruleForm(false)}
            <div className="flex gap-3">
              <button onClick={createRule} className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-semibold">
                💾 บันทึกกฎ
              </button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-800 border border-gray-600 hover:bg-gray-700 rounded-lg text-sm">
                ยกเลิก
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-gray-400">⏳ กำลังโหลด...</div>
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className={`bg-gray-900 border rounded-xl p-4 transition ${
                  rule.enabled ? 'border-gray-700' : 'border-gray-800 opacity-60'
                }`}
              >
                {editingId === rule.id ? (
                  <div>
                    {ruleForm(true)}
                    <div className="flex gap-3">
                      <button onClick={() => saveEdit(rule.id)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold">
                        💾 บันทึก
                      </button>
                      <button onClick={() => setEditingId(null)} className="px-4 py-2 bg-gray-800 border border-gray-600 hover:bg-gray-700 rounded-lg text-sm">
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${severityColors[rule.severity]}`}>
                          {rule.severity.toUpperCase()}
                        </span>
                        {rule.is_default && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 border border-gray-600 text-gray-400">
                            ค่าเริ่มต้น
                          </span>
                        )}
                        <span className="text-sm text-gray-300">
                          📡 <span className="text-green-400">{rule.metric}</span>
                          {' '}
                          <span className="text-white font-bold">{conditionLabels[rule.condition]}</span>
                          {' '}
                          <span className="text-white font-bold">{rule.threshold}</span>
                        </span>
                      </div>
                      <p className="text-sm text-gray-400">{rule.message}</p>
                      <p className="text-xs text-gray-600 mt-1">ID: {rule.id}</p>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <button
                        onClick={() => toggleRule(rule.id, !rule.enabled)}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                          rule.enabled
                            ? 'bg-green-600 hover:bg-green-500 text-white'
                            : 'bg-gray-700 hover:bg-gray-600 text-gray-400'
                        }`}
                      >
                        {rule.enabled ? '🟢 ON' : '🔴 OFF'}
                      </button>
                      <div className="flex gap-2">
                        <button
                          onClick={() => startEdit(rule)}
                          className="text-xs px-2.5 py-1 bg-gray-800 border border-gray-600 hover:bg-gray-700 rounded"
                        >
                          ✏️ แก้ไข
                        </button>
                        {!rule.is_default && (
                          <button
                            onClick={() => deleteRule(rule.id)}
                            className="text-xs px-2.5 py-1 bg-red-900/50 border border-red-700 hover:bg-red-900 rounded"
                          >
                            🗑️ ลบ
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {rules.length === 0 && (
              <div className="text-gray-500 text-center py-8">
                ไม่มีกฎอัตโนมัติ — กด "➕ สร้างกฎใหม่" เพื่อเพิ่ม
              </div>
            )}
          </div>
        )}
      </main>
    </div>
      </div>
  );
}
