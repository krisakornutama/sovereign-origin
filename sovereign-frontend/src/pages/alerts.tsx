"use client";
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';

interface Alert {
  ruleId: string;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  severity: string;
  timestamp: string;
}

export default function AlertsPage() {
  const { user, isAuthenticated, token, isHydrated } = useAuthStore();
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    if (!isHydrated || !isAuthenticated || !token) return;
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 10000);
    return () => clearInterval(interval);
  }, [isHydrated, isAuthenticated, token]);

  const fetchAlerts = async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/automation/alerts`);
      const data = await res.json();
      setAlerts(data);
    } catch (err) {
      console.error('Failed to fetch alerts:', err);
    }
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">⏳ Loading...</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">Unauthorized</div>;
  }

  const severityColor = (s: string) =>
    s === 'critical' ? 'text-red-400 bg-red-900/20' :
    s === 'warning' ? 'text-amber-400 bg-amber-900/20' : 'text-blue-400 bg-blue-900/20';

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow="ความปลอดภัย"
          title="🚨 SOVEREIGN OS"
          subtitle="Alert History" actions={<a href="/dashboard" className="text-sm text-blue-400 hover:underline">← กลับ Dashboard</a>}
        />
      </header>
      <main className="max-w-4xl mx-auto p-6 space-y-4">
        <h2 className="text-xl font-bold">ประวัติการแจ้งเตือน</h2>
        {alerts.length === 0 ? (
          <div className="text-gray-500 text-center py-8">ไม่มีประวัติการแจ้งเตือน</div>
        ) : (
          alerts.map((alert, i) => (
            <div
              key={i}
              className={`p-4 rounded-xl border ${
                alert.severity === 'critical' ? 'border-red-500/50 bg-red-900/10' :
                alert.severity === 'warning' ? 'border-amber-500/50 bg-amber-900/10' : 'border-blue-500/50 bg-blue-900/10'
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${severityColor(alert.severity)}`}>
                    {alert.severity.toUpperCase()}
                  </span>
                  <span className="ml-2 text-sm">{alert.message}</span>
                </div>
                <span className="text-xs text-gray-500">{new Date(alert.timestamp).toLocaleString('th-TH')}</span>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                {alert.metric} {alert.value} → threshold: {alert.threshold}
              </div>
            </div>
          ))
        )}
      </main>
    </div>
      </div>
  );
}