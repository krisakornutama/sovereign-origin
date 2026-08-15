import axios from 'axios';
import { config } from '../config';

// ── Pi-hole client ──
// รองรับทั้ง API v5 (api.php?...) และ v6 (/api/...) — ตรวจอัตโนมัติตอน status()
// ทุกเมธอดเป็น best-effort: คืน null/ว่าง ถ้าเชื่อมต่อไม่ได้ (ไม่ทำให้ระบบหลักล่ม)

export interface PiHoleSummary {
  domainsBeingBlocked: number;
  dnsQueriesToday: number;
  adsBlockedToday: number;
  adsPercentageToday: number;
  uniqueClients: number;
  uniqueDomains: number;
  queriesForwarded: number;
  status: string;
}

export interface PiHoleQuery {
  time: string;
  type: string;
  domain: string;
  client: string;
  status: string;
}

export interface PiHoleClient {
  ip: string;
  count: number;
  hostname?: string;
  mac?: string;
}

// ── parsers (pure — ทดสอบได้) ──
export function parseSummaryV5(data: any): PiHoleSummary {
  return {
    domainsBeingBlocked: Number(data?.domains_being_blocked) || 0,
    dnsQueriesToday: Number(data?.dns_queries_today) || 0,
    adsBlockedToday: Number(data?.ads_blocked_today) || 0,
    adsPercentageToday: Number(data?.ads_percentage_today) || 0,
    uniqueClients: Number(data?.unique_clients) || 0,
    uniqueDomains: Number(data?.unique_domains) || 0,
    queriesForwarded: Number(data?.queries_forwarded) || 0,
    status: String(data?.status || 'unknown'),
  };
}

export function parseSummaryV6(data: any): PiHoleSummary {
  const dq = data?.dns_queries || { type: data?.dns_queries_all_types, blocked: {} };
  const ads = data?.gravity || data?.dns_queries?.blocked || {};
  const clients = data?.clients || {};
  return {
    domainsBeingBlocked: Number(data?.gravity?.domains_being_blocked ?? ads?.domains_being_blocked ?? data?.gravity?.db ?? 0) || 0,
    dnsQueriesToday: Number(dq?.total ?? dq?.all ?? dq) || 0,
    adsBlockedToday: Number(data?.dns_queries?.blocked?.total ?? 0) || 0,
    adsPercentageToday: Number(data?.dns_queries?.blocked?.percent ?? 0) || 0,
    uniqueClients: Number(clients?.active ?? clients?.total ?? 0) || 0,
    uniqueDomains: Number(dq?.unique ?? 0) || 0,
    queriesForwarded: Number(dq?.forwarded ?? 0) || 0,
    status: String(data?.status?.active === true ? 'enabled' : data?.status?.blocked ?? 'unknown'),
  };
}

export function parseTopBlocked(data: any): Array<{ domain: string; count: number }> {
  if (Array.isArray(data)) {
    return data
      .map((r: any) => ({
        domain: String(r?.domain ?? r?.value ?? ''),
        count: Number(r?.count ?? r?.hits ?? 0),
      }))
      .filter((r) => r.domain);
  }
  const obj = data?.top_blocked || data?.blocked || {};
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj)
      .map(([domain, count]) => ({ domain, count: Number(count) || 0 }))
      .sort((a, b) => b.count - a.count);
  }
  return [];
}

export function parseTopClients(data: any): PiHoleClient[] {
  const clients = data?.clients || data?.top_clients || {};
  const clientInfo: Record<string, any> = data?.client_info || data?.clientInfo || {};
  const out: PiHoleClient[] = [];
  const add = (ip: string, count: number) => {
    const info = clientInfo[ip] || {};
    const hostname = String(info?.name || data?.[ip]?.name || '') || undefined;
    const mac = String(info?.MAC || info?.mac || '') || undefined;
    out.push({ ip, count, hostname, mac });
  };
  if (clients && typeof clients === 'object') {
    for (const [ip, count] of Object.entries(clients)) {
      if (ip === 'ip' || Array.isArray(count)) continue;
      if (typeof count === 'number' || (typeof count === 'string' && /^\d+$/.test(count))) {
        add(ip, Number(count));
      }
    }
  } else if (Array.isArray(data)) {
    for (const r of data) {
      add(String(r?.ip || r?.client || ''), Number(r?.count || 0));
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

export function parseQueriesV5(data: any): PiHoleQuery[] {
  if (!data) return [];
  const rows = Array.isArray(data) ? data : data?.queries;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 300).map((r: any) => {
    if (Array.isArray(r)) {
      return { time: String(r[0] || ''), type: String(r[1] || ''), domain: String(r[2] || ''), client: String(r[3] || ''), status: String(r[4] || r[5] || '') };
    }
    return {
      time: String(r?.time ?? r?.timestamp ?? ''),
      type: String(r?.type ?? ''),
      domain: String(r?.domain ?? ''),
      client: String(r?.client ?? r?.client_ip ?? ''),
      status: String(r?.status ?? ''),
    };
  });
}

export function parseListOp(text: string): boolean {
  const t = (text || '').trim();
  return t.toUpperCase() === 'OK' || t === '{}' || /success/i.test(t);
}

// ── client ──
class PiHoleService {
  private mode: 'v5' | 'v6' | null = null;
  private lastError: string | null = null;
  private lastCheckAt: Date | null = null;

  private get base(): string {
    return (config.nextgen.piholeUrl || '').replace(/\/+$/, '');
  }

  private get token(): string {
    return config.nextgen.piholeToken || '';
  }

  // ดึง session id (v6 ต้อง login ก่อน — bridge password)
  private async v6Session(): Promise<string | null> {
    try {
      const resp = await axios.post(
        `${this.base}/api/auth`,
        { password: this.token },
        { timeout: config.nextgen.piholeTimeoutMs }
      );
      return resp?.data?.session?.sid || null;
    } catch {
      return null;
    }
  }

  // v6 GET — พยายาม Bearer sid ก่อน แล้วค่อย token ตรง
  private async v6Get(path: string): Promise<any | null> {
    try {
      const sid = await this.v6Session();
      if (!sid) return null;
      const resp = await axios.get(`${this.base}${path}`, {
        headers: { Authorization: `Bearer ${sid}` },
        timeout: config.nextgen.piholeTimeoutMs,
      });
      return resp.data;
    } catch {
      return null;
    }
  }

  private async v5Get(params: Record<string, string>): Promise<any | null> {
    try {
      const qs = new URLSearchParams({ auth: this.token, ...params });
      const resp = await axios.get(`${this.base}/admin/api.php?${qs.toString()}`, {
        timeout: config.nextgen.piholeTimeoutMs,
        responseType: 'text',
      });
      if (resp.data === '') return null;
      try {
        return JSON.parse(resp.data);
      } catch {
        return resp.data;
      }
    } catch (err: any) {
      this.lastError = err?.message || String(err);
      return null;
    }
  }

  // ตรวจโหมด API ครั้งแรก
  async detect(): Promise<{ connected: boolean; mode: string | null; error: string | null }> {
    if (!this.base) return { connected: false, mode: null, error: 'ไม่ตั้งค่า PIHOLE_URL' };
    if (this.mode) return { connected: true, mode: this.mode, error: null };
    // ลอง v5 ก่อน
    const v5 = await this.v5Get({ summary: '' });
    if (v5 && typeof v5 === 'object' && 'domains_being_blocked' in v5) {
      this.mode = 'v5';
      this.lastError = null;
      return { connected: true, mode: 'v5', error: null };
    }
    // ลอง v6
    const v6 = await this.v6Get('/api/info/summary');
    if (v6 && typeof v6 === 'object') {
      this.mode = 'v6';
      this.lastError = null;
      return { connected: true, mode: 'v6', error: null };
    }
    this.lastError = this.lastError || 'token ไม่ถูกต้องหรือ Pi-hole ไม่เปิด API';
    return { connected: false, mode: null, error: this.lastError };
  }

  async status(): Promise<any> {
    const det = await this.detect();
    if (!det.connected) return { connected: false, mode: this.mode, error: det.error, summary: null };
    const raw = this.mode === 'v6' ? await this.v6Get('/api/info/summary') : await this.v5Get({ summary: '' });
    if (!raw || typeof raw !== 'object') return { connected: false, mode: this.mode, error: 'summaries ไม่ออก', summary: null };
    const summary = this.mode === 'v6' ? parseSummaryV6(raw) : parseSummaryV5(raw);
    this.lastCheckAt = new Date();
    this.lastError = null;
    return { connected: true, mode: this.mode, error: null, summary };
  }

  async getSummary(): Promise<PiHoleSummary | null> {
    const s = await this.status();
    return s.summary;
  }

  async topBlocked(limit = 10): Promise<Array<{ domain: string; count: number }>> {
    const det = await this.detect();
    if (!det.connected) return [];
    const raw = this.mode === 'v6' ? await this.v6Get('/api/dns/blocked/domains') : await this.v5Get({ topBlocked: '' });
    return parseTopBlocked(raw).slice(0, limit);
  }

  async topClients(limit = 10): Promise<PiHoleClient[]> {
    const det = await this.detect();
    if (!det.connected) return [];
    const raw = this.mode === 'v6' ? await this.v6Get('/api/clients') : await this.v5Get({ topClients: '' });
    return parseTopClients(raw).slice(0, limit);
  }

  async recentQueries(limit = 50): Promise<PiHoleQuery[]> {
    const det = await this.detect();
    if (!det.connected) return [];
    const raw =
      this.mode === 'v6'
        ? await this.v6Get(`/api/dns/queries?count=${Math.max(limit, 100)}&direction=backward`)
        : await this.v5Get({ recentQueries: '', limit: '300' });
    const rows = parseQueriesV5(raw);
    return rows.slice(0, limit);
  }

  // เพิ่ม/ลบโดเมนใน blacklist (บันทึกที่ Pi-hole เอง — gravity regen ให้ admin ทำเอง)
  async addBlacklist(domain: string): Promise<{ ok: boolean; error: string | null }> {
    const det = await this.detect();
    if (!det.connected) return { ok: false, error: 'Pi-hole ไม่เชื่อมต่อ' };
    try {
      if (this.mode === 'v6') {
        await axios.post(
          `${this.base}/api/lists/black`,
          { item: domain },
          { headers: { Authorization: `Bearer ${await this.v6Session()}` }, timeout: config.nextgen.piholeTimeoutMs }
        );
      } else {
        const resp = await axios.post(
          `${this.base}/admin/api.php`,
          new URLSearchParams({ list: 'black', add: domain, auth: this.token }),
          { timeout: config.nextgen.piholeTimeoutMs }
        );
        if (!parseListOp(resp.data)) return { ok: false, error: `Pi-hole ตอบ ${resp.data}` };
      }
      return { ok: true, error: null };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async removeBlacklist(domain: string): Promise<{ ok: boolean; error: string | null }> {
    const det = await this.detect();
    if (!det.connected) return { ok: false, error: 'Pi-hole ไม่เชื่อมต่อ' };
    try {
      if (this.mode === 'v6') {
        await axios.delete(`${this.base}/api/lists/black`, {
          data: { item: domain },
          headers: { Authorization: `Bearer ${await this.v6Session()}` },
          timeout: config.nextgen.piholeTimeoutMs,
        });
      } else {
        const resp = await axios.post(
          `${this.base}/admin/api.php`,
          new URLSearchParams({ list: 'black', remove: domain, auth: this.token }),
          { timeout: config.nextgen.piholeTimeoutMs }
        );
        if (!parseListOp(resp.data)) return { ok: false, error: `Pi-hole ตอบ ${resp.data}` };
      }
      return { ok: true, error: null };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  }
}

export const piHole = new PiHoleService();