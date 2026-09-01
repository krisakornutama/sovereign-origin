import { authFetch } from './apiFetch';
import { fetchJsonArray, fetchJsonObject, asArray, asObject } from './fetchJson';
import { getApiUrl } from './config';

// ── Centralized typed API client — deprecates raw `${process.env.NEXT_PUBLIC_API_URL}/api/...` ──
// Usage: `api.getArray<MenuItem>('/restaurant/menus?restaurantId=xxx')` guarantees array, never throws into render

type Query = Record<string, string | number | boolean | undefined>;

function toQuery(q?: Query): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

function abs(path: string): string { const base = getApiUrl().replace(/\/$/, ''); return `${base}${path.startsWith('/') ? path : '/' + path}`; }
export const api = {
  getArray: <T>(path: string, query?: Query) => fetchJsonArray<T>(`${abs(path)}${toQuery(query)}`),
  getObject: <T>(path: string, query?: Query) => fetchJsonObject<T>(`${abs(path)}${toQuery(query)}`),
  post: <T>(path: string, body?: unknown) =>
    authFetch(abs(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as any).error || `HTTP ${r.status}`);
      return data as T;
    }),
  put: <T>(path: string, body?: unknown) =>
    authFetch(abs(path), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as any).error || `HTTP ${r.status}`);
      return data as T;
    }),
  del: <T>(path: string) =>
    authFetch(abs(path), { method: 'DELETE' }).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as any).error || `HTTP ${r.status}`);
      return data as T;
    }),
};

export { asArray, asObject };
