"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiUrl } from '../lib/config';

/**
 * สถานะการเชื่อมต่อ API — self-healing:
 * - poll GET /api/health (ไม่ต้อง auth) ทุกไม่กี่วินาที
 * - ถ้า API ตาย → status = 'connecting' (กำลังเชื่อมต่อใหม่) พร้อมนับ attempt
 * - ถ้ากลับมาได้ → status = 'online' + ปล่อย event 'sovereign:api-reconnected'
 *   ให้หน้าเพจที่ฟังอยู่โหลดข้อมูลใหม่ทันที (ไม่ต้องรอ interval รอบถัดไป)
 */
export type ApiStatus = 'online' | 'connecting';

export const API_RECONNECTED_EVENT = 'sovereign:api-reconnected';

const HEALTH_TIMEOUT_MS = 4000;
const POLL_MS = 5000;
const POLL_MS_WHEN_DOWN = 10000;

export function useApiConnection() {
  const [status, setStatus] = useState<ApiStatus>('online');
  const [attempt, setAttempt] = useState(0); // ครั้งที่พยายามเชื่อมต่อใหม่
  const statusRef = useRef<ApiStatus>('online');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const check = useCallback(async () => {
    const url = `${getApiUrl()}/api/health`;
    let ok = false;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
      clearTimeout(t);
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (cancelledRef.current) return;

    if (ok) {
      const wasDown = statusRef.current !== 'online';
      statusRef.current = 'online';
      setStatus('online');
      setAttempt(0);
      // กลับมาแล้ว → ให้หน้าเพจที่เปิดค้างอยู่โหลดข้อมูลใหม่ทันที
      if (wasDown) {
        window.dispatchEvent(new CustomEvent(API_RECONNECTED_EVENT));
      }
      timerRef.current = setTimeout(check, POLL_MS);
    } else {
      statusRef.current = 'connecting';
      setStatus('connecting');
      setAttempt((n) => n + 1);
      timerRef.current = setTimeout(check, POLL_MS_WHEN_DOWN);
    }
  }, []);

  useEffect(() => {
    check();
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [check]);

  const retryNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    check();
  }, [check]);

  return { status, attempt, retryNow };
}
