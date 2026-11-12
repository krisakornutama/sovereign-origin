"use client";
// ยิงคำขอลบข้อมูลเทเลเมตรี + แปลผลจาก server ให้เป็นข้อความที่ตรงกับความจริง
//
// แยกออกจาก SensorsHub เพราะ (1) component ชนเพดาน 400 บรรทัด (2) ตรรกะนี้ต้องมีที่เดียว
// ไม่ให้ handler หนึ่งลืมดู res.ok แล้วขึ้น "ลบแล้ว" ทั้งที่ server ตอบ 403/500
import { useCallback } from 'react';
import { authFetch } from '../apiFetch';
import { deleteRejection, deleteFailureMessage } from './delete-outcome';

type TFunc = (key: string, fallback?: string, vars?: Record<string, string | number>) => string;

interface Options {
  t: TFunc;
  setMessage: (message: string) => void;
  /** เรียกหลังลบสำเร็จจริงเท่านั้น (ล้มเหลว = ไม่ต้องโหลดใหม่) */
  reload: () => void;
}

export function useTelemetryDelete({ t, setMessage, reload }: Options) {
  const run = useCallback(
    async (url: string, okText: string) => {
      try {
        const res = await authFetch(url, { method: 'DELETE' });
        const data = await res.json().catch(() => ({} as any));
        const rejection = deleteRejection(res.status, data);
        if (rejection) {
          setMessage(deleteFailureMessage(rejection, res.status, data, t));
          return;
        }
        setMessage(okText);
        reload();
      } catch {
        setMessage(t('sensorsHub.deleteFailed', '❌ ลบไม่สำเร็จ'));
      }
    },
    [t, setMessage, reload]
  );

  return {
    deleteByUrl: (url: string, okText: string) => run(url, okText),
  };
}
