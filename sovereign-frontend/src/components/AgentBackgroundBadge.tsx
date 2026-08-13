"use client";
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';

/**
 * ป้ายแจ้งเตือนทั่วทั้งแอป: เมื่อมีงาน AI ทำงานเบื้องหลัง จะแสดง badge มุมขวาล่าง
 * (ทุกหน้า) พร้อม Browser Notification ตอนเริ่ม/เสร็จ — คลิกไปหน้า AI Agent
 */
export default function AgentBackgroundBadge() {
  const { isAuthenticated, isHydrated, token } = useAuthStore();
  const [activeCount, setActiveCount] = useState(0);
  const [show, setShow] = useState(false);
  const prevActive = useRef(0);
  const notifiedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isHydrated || !isAuthenticated || !token) return;

    let cancelled = false;
    const check = async () => {
      try {
        const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/agent/jobs`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const jobs: any[] = data.jobs || [];
        const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
        const activeIds = active.map((j) => j.id);
        const finishedIds = jobs
          .filter((j) => (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') && notifiedIds.current.has(j.id))
          .map((j) => j.id);

        if (prevActive.current === 0 && activeIds.length > 0) {
          // เริ่มทำงานใหม่ → แจ้งเตือน
          try {
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('🤖 AI ทำงานเบื้องหลัง', {
                body: `${activeIds.length} งานกำลังรัน — ไปหน้าอื่นต่อได้เลย`,
              });
            }
          } catch {
            /* ignore */
          }
        } else if (prevActive.current > 0 && activeIds.length === 0 && finishedIds.length > 0) {
          // เสร็จหมด → แจ้งเตือน
          try {
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('✅ AI ทำงานเบื้องหลังเสร็จ', {
                body: `เสร็จ ${finishedIds.length} งาน — ดูผลได้ที่หน้า AI Agent`,
              });
            }
          } catch {
            /* ignore */
          }
        }

        // จำ id งานที่เคย active ไว้ (เพื่อรู้ว่างานไหนเพิ่งเสร็จ)
        activeIds.forEach((id) => notifiedIds.current.add(id));
        if (activeIds.length === 0 && prevActive.current > 0) {
          notifiedIds.current.clear();
        }

        prevActive.current = activeIds.length;
        setActiveCount(activeIds.length);
        setShow(activeIds.length > 0);
      } catch {
        /* ออฟไลน์ — เงียบ */
      }
    };

    // ขอสิทธิ์ notification ครั้งแรกเมื่อมีงาน (ไม่รบกวนตอนยังไม่มี)
    if ('Notification' in window && Notification.permission === 'default') {
      // รอจนกว่าจะมีงานจริง ๆ — ตรวจผ่าน timeout ครั้งแรก
      const t = setTimeout(() => {
        const req = async () => {
          try {
            const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/agent/jobs`);
            const data = await res.json().catch(() => ({}));
            const hasActive = ((data.jobs || []) as any[]).some((j) => j.status === 'queued' || j.status === 'running');
            if (hasActive && 'Notification' in window && Notification.permission === 'default') {
              await Notification.requestPermission();
            }
          } catch {
            /* ignore */
          }
        };
        req();
      }, 2000);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }

    check();
    const interval = setInterval(check, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isHydrated, isAuthenticated, token]);

  if (!show) return null;

  return (
    <button
      onClick={() => {
        window.location.href = '/ai-agent';
      }}
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg shadow-emerald-900/40 border border-emerald-400/50 animate-pulse"
      title="AI กำลังทำงานเบื้องหลัง — คลิกเพื่อดูสถานะ"
    >
      <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
      🤖 AI ทำงานเบื้องหลัง ({activeCount})
    </button>
  );
}
