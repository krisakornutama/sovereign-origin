"use client";
import { fmtLocale } from '../../lib/formatDate';
import { useState, useEffect } from 'react';
import { authFetch } from '../../lib/apiFetch';
import Icon from '../ui/Icon';

interface Alert {
  ruleId: string;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
}

export default function AlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    // ผู้เรียก /api/automation/check เพียงจุดเดียวของแอป — ทุก 60 วิพอ (เดิม 5 วิ = 17,000 ครั้ง/วันต่อแท็บ)
    const fetchAlerts = async () => {
      try {
        const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/dashboard/stats`);
        const data = await res.json();
        
        // Check metrics against rules
        if (data.metrics) {
          const checkRes = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/automation/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ metrics: data.metrics }),
          });
          const checkData = await checkRes.json();
          
          if (checkData.alerts?.length > 0) {
            setAlerts(prev => {
              // Keep last 5 alerts, avoid duplicates
              const newAlerts = [...prev];
              checkData.alerts.forEach((msg: string, i: number) => {
                // Show notification
                if (Notification.permission === 'granted') {
                  new Notification('Sovereign Alert', { body: msg });
                }
              });
              return [...newAlerts.slice(-4), ...checkData.alerts.map((m: string) => ({
                ruleId: '',
                metric: '',
                value: 0,
                threshold: 0,
                message: m,
                severity: 'warning' as const,
                timestamp: new Date().toISOString(),
              }))].slice(-5);
            });
          }
        }
      } catch (err) {
        // Silent fail
      }
    };

    fetchAlerts();
    const interval = setInterval(fetchAlerts, 60_000);
    
    // Request notification permission
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => clearInterval(interval);
  }, []);

  if (alerts.length === 0) return null;

  return (
    <div className="log-stream space-y-2">
      {alerts.map((alert, i) => (
        <div
          key={i}
          className={`p-3 rounded-lg border text-sm animate-slide-in ${
            alert.severity === 'critical'
              ? 'bg-rose-950/40 border-rose-800/60 text-rose-300'
              : alert.severity === 'warning'
              ? 'bg-amber-950/40 border-amber-800/60 text-amber-300'
              : 'bg-sky-950/40 border-sky-800/60 text-sky-300 panel-cyan'
          }`}
        >
          <div className="flex items-center gap-2">
            <Icon
              name={alert.severity === 'info' ? 'info' : 'alert-triangle'}
              size={16}
              className="shrink-0"
            />
            <div>
              <p className="font-semibold">{alert.message}</p>
              <p className="text-xs opacity-75 mt-0.5">
                {new Date(alert.timestamp).toLocaleTimeString(fmtLocale())}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}