"use client";
// useOfflineRead — hook อ่านข้อมูลแบบ offline-first (user-namespaced)
//
// พฤติกรรม:
//   - mount → อ่านแคชก่อน; ถ้าแคชสดได้ผลทันที (source='cache')
//   - network ล่มแต่มีแคช → แสดงข้อมูลเดิมพร้อม stale=true ไม่ crash
//   - network ล่มและไม่มีแคช → offline=true, data=null (ให้หน้าแสดง empty state เอง)
//   - SWR → เมื่อ refresh เบื้องหลังเสร็จ จะอัปเดต state ให้อัตโนมัติ
//   - cache instance ผูกกับ userId (ได้จาก auth store) — logout จะล้าง namespace นั้นทิ้ง
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import {
  OfflineReadUnavailableError,
  type CacheDomain,
  type CachedReadResult,
} from './read-cache';
import { getOfflineReadCache } from './cache';

export interface OfflineReadState<T> {
  data: T | null;
  loading: boolean;
  source: 'network' | 'cache' | null;
  stale: boolean;
  savedAt: number | null;
  /** true = ไม่มีทั้ง network และแคช (ไม่ใช่ error ที่ต้อง crash) */
  offline: boolean;
  error: Error | null;
}

export interface UseOfflineReadOptions {
  ttlMs?: number;
  staleWhileRevalidate?: boolean;
  enabled?: boolean;
}

export type UseOfflineReadResult<T> = OfflineReadState<T> & {
  refresh: () => Promise<void>;
};

export function useOfflineRead<T>(
  domain: CacheDomain,
  resource: string,
  fetcher: () => Promise<T>,
  options: UseOfflineReadOptions = {}
): UseOfflineReadResult<T> {
  const { ttlMs, staleWhileRevalidate, enabled = true } = options;
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [state, setState] = useState<OfflineReadState<T>>({
    data: null as T | null,
    loading: true,
    source: null,
    stale: false,
    savedAt: null,
    offline: false,
    error: null,
  });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applyResult = useCallback((result: CachedReadResult<T>) => {
    if (!mounted.current) return;
    setState({
      data: result.data,
      loading: false,
      source: result.source,
      stale: result.stale,
      savedAt: result.savedAt,
      offline: false,
      error: null,
    });
  }, []);

  const load = useCallback(
    async (forceRefresh: boolean) => {
      if (!enabled) {
        if (mounted.current) setState((prev) => ({ ...prev, loading: false }));
        return;
      }
      if (mounted.current) setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        // ใช้ cache ต่อ userId
        const cache = getOfflineReadCache(userId);
        const result = await cache.read<T>(domain, resource, () => fetcherRef.current(), {
          ttlMs,
          staleWhileRevalidate,
          forceRefresh,
        });
        applyResult(result);

        // SWR: refresh เบื้องหลังเสร็จแล้วอัปเดต state (ล้ม = เงียบ)
        if (result.revalidated) {
          const updated = await result.revalidated.catch(() => null);
          if (updated) applyResult(updated);
        }
      } catch (err) {
        if (!mounted.current) return;
        const isOffline = err instanceof OfflineReadUnavailableError;
        setState((prev) => ({
          ...prev,
          loading: false,
          offline: isOffline,
          error: isOffline ? null : (err as Error),
        }));
      }
    },
    [domain, resource, enabled, ttlMs, staleWhileRevalidate, applyResult, userId]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return { ...state, refresh };
}
