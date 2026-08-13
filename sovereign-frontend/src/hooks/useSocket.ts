import { useEffect, useRef } from 'react';
import io, { Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/useAuthStore';
import { useTelemetryStore } from '../stores/useTelemetryStore';
import { useRiskStore, ThreatUpdate, DefconUpdate } from '../stores/useRiskStore';
import { useWealthStore } from '../stores/useWealthStore';
import { showCriticalNotification } from '../utils/notifications';
import { TelemetryUpdate } from '../types';
import { getWsUrl } from '../lib/config';

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const token = useAuthStore((s) => s.token);
  const addTelemetry = useTelemetryStore((s) => s.addTelemetry);
  const setOnlineStatus = useTelemetryStore((s) => s.setOnlineStatus);
  const setThreat = useRiskStore((s) => s.setThreat);
  const setDefcon = useRiskStore((s) => s.setDefcon);
  const setWealth = useWealthStore((s) => s.setWealth);

  useEffect(() => {
    if (!token) return;

    const socket = io(getWsUrl(), {
      auth: { token },
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      console.log('WebSocket connected');
    });

    socket.on('telemetry_update', (data: TelemetryUpdate) => {
      addTelemetry(data);

      // Critical alerts
      if (data.status === 'OFFLINE' || data.battery_soc < 20) {
        showCriticalNotification(
          `Critical: Node ${data.node_id} ${data.status === 'OFFLINE' ? 'offline' : 'low battery'}`
        );
      }

      // Update online status map
      setOnlineStatus(data.node_id, data.status === 'ONLINE');
    });

    // Risk Monitor (Phase 4): Threat Index ใหม่จาก Ollama + ระดับ DEFCON ที่เปลี่ยน
    socket.on('threat_update', (data: ThreatUpdate) => {
      setThreat(data);
    });

    socket.on('defcon_update', (data: DefconUpdate) => {
      setDefcon(data);
      if (data.direction === 'up' && data.level > 0) {
        const label = ['', 'DEFCON 1 — CRITICAL', 'DEFCON 2 — SEVERE', 'DEFCON 3 — ELEVATED'][data.level] || '';
        showCriticalNotification(`🛡️ ${label} — ระดับความเสี่ยงสูงขึ้น (Threat Index ${data.overall ?? '?'})`);
      }
    });

    // Wealth (Phase 4): มูลค่าพอร์ต/เสบียง/runway อัปเดตจาก cron job ของ WealthWorker
    socket.on('wealth_update', (data) => {
      setWealth(data);
    });

    socket.on('disconnect', () => {
      console.warn('WebSocket disconnected');
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [token]);

  return socketRef.current;
}