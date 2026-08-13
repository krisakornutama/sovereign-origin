"use client";
import { useEffect, useState, useCallback } from 'react';
import {
  initOfflineQueue,
  countQueued,
  flushQueue,
  subscribeOfflineQueue,
} from '../lib/offlineQueue';

/**
 * สถานะ offline queue:
 * - initOfflineQueue() ติดตั้ง fetch interceptor (เก็บ request ตอนออฟไลน์)
 * - queuedCount: จำนวน action ที่ค้างอยู่ (อัปเดตสดจาก IndexedDB)
 * - isOnline: สถานะ navigator.onLine
 * - syncNow(): ส่งคิวทั้งหมดทันที (กด badge ได้)
 */
export function useOfflineSync() {
  const [queuedCount, setQueuedCount] = useState(0);
  const [isOnline, setIsOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  useEffect(() => {
    initOfflineQueue();
    countQueued().then(setQueuedCount);

    const unsub = subscribeOfflineQueue(setQueuedCount);
    const onOnline = () => {
      setIsOnline(true);
      flushQueue().catch(console.error);
    };
    const onOffline = () => setIsOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      unsub();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const syncNow = useCallback(async (): Promise<number> => {
    const flushed = await flushQueue();
    setQueuedCount(await countQueued());
    return flushed;
  }, []);

  return { queuedCount, isOnline, syncNow };
}
