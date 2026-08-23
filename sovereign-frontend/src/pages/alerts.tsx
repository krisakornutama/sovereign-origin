"use client";
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import EmptyState from '../components/ui/EmptyState';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';

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
  const t = useLanguageStore((s) => s.t);
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
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">{t('alerts.unauthorized', 'Unauthorized')}</div>;
  }

  const severityColor = (s: string) =>
    s === 'critical' ? 'text-rose-400 bg-rose-900/20' :
    s === 'warning' ? 'text-amber-400 bg-amber-900/20' : 'text-blue-400 bg-blue-900/20';

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-4xl mx-auto w-full">
          <PageHeader
            eyebrow={t('alerts.eyebrow', 'ความปลอดภัย')}
            title={t('alerts.title', 'ประวัติการแจ้งเตือน')}
            subtitle={t('alerts.subtitle', 'บันทึกการแจ้งเตือนจาก Automation Engine')}
            icon={<Icon name="alerts" size={18} />}
          />
          {alerts.length === 0 ? (
            <div className="card"><EmptyState icon={<Icon name="alerts" size={20} />} title={t('alerts.empty', 'ไม่มีประวัติการแจ้งเตือน')} description={t('alerts.emptyDesc', 'เมื่อระบบตรวจจับเหตุการณ์จะบันทึกไว้ที่นี่')} /></div>
          ) : (
          alerts.map((alert, i) => (
            <div
              key={i}
              className={`card card-hover p-4 ${
                alert.severity === 'critical' ? 'border-rose-800/60' :
                alert.severity === 'warning' ? 'border-amber-800/60' : 'border-blue-800/60 panel-cyan'
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${severityColor(alert.severity)}`}>
                    {alert.severity.toUpperCase()}
                  </span>
                  <span className="ml-2 text-sm">{alert.message}</span>
                </div>
                <span className="text-xs text-gray-500">{new Date(alert.timestamp).toLocaleString(fmtLocale())}</span>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                {alert.metric} {alert.value} {t('alerts.threshold', ' → threshold: ')}{alert.threshold}
              </div>
            </div>
          ))
        )}
      </main>
    </div>
      </div>
  );
}