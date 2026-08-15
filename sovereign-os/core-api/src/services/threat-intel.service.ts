import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';

export const prisma = new PrismaClient();

export type IntelType = 'IP' | 'DOMAIN';
export type IntelCategory =
  | 'malware'
  | 'phishing'
  | 'cnc'
  | 'scam'
  | 'ad'
  | 'tracking'
  | 'gambling'
  | 'piracy'
  | 'violence'
  | 'unknown';

// ── Seed list (ฐาน IOC เริ่มต้น — กลุ่มโฆษณา/ติดตาม/สแกมที่เป็นที่รู้จัก) ──
// โดเมนจาก StevenBlack's hosts / EasyList — ใช้เป็นตัวอย่างก่อน feed จริง
export const SEED_DOMAINS: Array<{ value: string; category: IntelCategory; note?: string }> = [
  { value: 'doubleclick.net', category: 'tracking', note: 'Google ad/tracking' },
  { value: 'googlesyndication.com', category: 'ad' },
  { value: 'googleadservices.com', category: 'ad' },
  { value: 'adservice.google.com', category: 'ad' },
  { value: 'adnxs.com', category: 'ad', note: 'AppNexus ad network' },
  { value: 'adsrvr.org', category: 'ad', note: 'The Trade Desk' },
  { value: 'amazon-adsystem.com', category: 'ad' },
  { value: 'taboola.com', category: 'ad' },
  { value: 'outbrain.com', category: 'ad' },
  { value: 'criteo.com', category: 'ad' },
  { value: 'rubiconproject.com', category: 'ad' },
  { value: 'openx.net', category: 'ad' },
  { value: 'pubmatic.com', category: 'ad' },
  { value: 'moatads.com', category: 'tracking' },
  { value: 'scorecardresearch.com', category: 'tracking', note: 'comScore tracker' },
  { value: 'quantserve.com', category: 'tracking', note: 'Quantcast' },
  { value: 'krxd.net', category: 'tracking', note: 'Salesforce DMP' },
  { value: 'bluekai.com', category: 'tracking' },
  { value: 'addthis.com', category: 'tracking' },
  { value: 'hotjar.com', category: 'tracking' },
  { value: 'mixpanel.com', category: 'tracking' },
  { value: 'segment.io', category: 'tracking' },
  { value: 'amplitude.com', category: 'tracking' },
  { value: 'mathtag.com', category: 'ad' },
  { value: 'yieldmanager.com', category: 'ad' },
  { value: '2mdn.net', category: 'ad', note: 'DoubleClick serving' },
  { value: 'adsafeprotected.com', category: 'ad' },
  { value: 'serving-sys.com', category: 'ad' },
  { value: 'burstnet.com', category: 'ad' },
  { value: 'casalemedia.com', category: 'ad' },
  { value: 'exponential.com', category: 'ad' },
  { value: 'media.net', category: 'ad' },
  { value: 'mopub.com', category: 'ad' },
  { value: 'smaato.net', category: 'ad' },
  { value: 'teads.tv', category: 'ad' },
  { value: 'tidaltv.com', category: 'ad' },
  { value: 'zedo.com', category: 'ad' },
  { value: 'populationc.com', category: 'ad' },
  { value: 'trafficfactory.biz', category: 'ad' },
  { value: 'propellerads.com', category: 'ad' },
  { value: 'popads.net', category: 'ad' },
  { value: 'exoclick.com', category: 'ad' },
  { value: 'juicyads.com', category: 'ad' },
  { value: 'doublepimp.com', category: 'ad' },
  { value: 'brazzers.com', category: 'piracy' },
  { value: 'xnxx.com', category: 'piracy' },
  { value: 'xvideos.com', category: 'piracy' },
  { value: 'pornhub.com', category: 'piracy' },
  { value: 'thepiratebay.org', category: 'piracy' },
  { value: '1337x.to', category: 'piracy' },
  { value: 'rarbg.to', category: 'piracy' },
  { value: 'yts.mx', category: 'piracy' },
  { value: 'utorrent.com', category: 'piracy' },
  { value: 'bitlord.com', category: 'piracy' },
  { value: 'torrentgalaxy.to', category: 'piracy' },
  { value: 'malwarebytes.com', category: 'unknown' },
  { value: 'azscore.com', category: 'gambling' },
  { value: 'ufabet.com', category: 'gambling', note: 'เว็บพนันไทย' },
  { value: 'ufa1688.com', category: 'gambling' },
  { value: 'pgslot.io', category: 'gambling' },
  { value: 'm98.co.th', category: 'gambling' },
  { value: 'lottovip.com', category: 'gambling', note: 'หวยออนไลน์' },
  { value: 'huaydee.com', category: 'gambling' },
  { value: 'pantip909.com', category: 'gambling' },
  { value: 'gclub88.com', category: 'gambling' },
  { value: 'bet365.com', category: 'gambling' },
  { value: '888casino.com', category: 'gambling' },
  { value: 'williamhill.com', category: 'gambling' },
  { value: 'bwin.com', category: 'gambling' },
  { value: 'cryptolocker.example', category: 'malware' },
  { value: 'shodan.io', category: 'unknown' },
];

// ชื่อโดเมนที่รู้จักกันว่าเป็น C2/botnet (ตัวอย่าง — feed จริงจะเพิ่มเอง)
export const SEED_C2_DOMAINS: Array<{ value: string; category: IntelCategory }> = [
  { value: 'mumblehard.example.com', category: 'cnc' },
  { value: 'pandora.example.net', category: 'cnc' },
  { value: 'dpq.example.org', category: 'cnc' },
];

export const SEED_IPS: Array<{ value: string; category: IntelCategory; note?: string }> = [
  { value: '185.220.101.0', category: 'malware', note: 'Tor exit relay block เป็นตัวอย่าง' },
  { value: '91.240.118.0', category: 'malware', note: 'ตัวอย่าง C2 IP ช่วง' },
  { value: '45.155.205.0', category: 'malware' },
];

// เดา category จากคำในโดเมน (ใช้กับ feed ที่ไม่มีป้าย)
const CATEGORY_KEYWORDS: Array<[RegExp, IntelCategory]> = [
  [/\.(cn|ru|su|tk|ml|ga|cf|gq)\b/i, 'scam'],
  [/casino|betting|bet|slot|lotto|lottery|ufa|gclub|baccarat|poker|sport888|pantip888/i, 'gambling'],
  [/porn|xnxx|xvideos|sex|adult|escort/i, 'piracy'],
  [/torrent|1337x|piratebay|rarbg|yts|extratorrent|kickass/i, 'piracy'],
  [/phish|paypa1|secure-login|account-verify|banking-update/i, 'phishing'],
  [/cryptominer|miner|coinhive|monero/i, 'malware'],
  [/doubleclick|googlesyndication|adservice|adsystem|adsrvr|moatads|scorecardresearch|quantserve|\bads\.|adserver|adnetwork|adclick/i, 'ad'],
  [/analytics|tracking|statcounter|mixpanel|segment|hotjar/i, 'tracking'],
];

export function guessCategory(domain: string): IntelCategory {
  for (const [re, cat] of CATEGORY_KEYWORDS) {
    if (re.test(domain)) return cat;
  }
  return 'unknown';
}

// ── Feed parser: รับ text รูปแบบ hosts / adblock / plain โดเมน ──
export function parseHostsFile(text: string): Array<{ value: string; category: IntelCategory }> {
  const out: Array<{ value: string; category: IntelCategory }> = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!') || line.startsWith('[')) continue;
    let domain = '';
    const hostMatch = line.match(/^0\.0\.0\.0\s+(.+)$/i) || line.match(/^127\.0\.0\.1\s+(.+)$/i);
    if (hostMatch) domain = hostMatch[1].trim();
    else if (line.startsWith('||')) domain = line.replace(/^\|\|/, '').replace(/\^(\$[\w,.-]+)?$/, '').trim();
    else if (!/\s/.test(line) && line.includes('.')) domain = line;
    domain = domain.split('#')[0].trim().replace(/^\./, '').toLowerCase();
    if (!domain || !domain.includes('.') || seen.has(domain)) continue;
    seen.add(domain);
    out.push({ value: domain, category: guessCategory(domain) });
  }
  return out;
}

// ── Service ──
class ThreatIntelService {
  private seedDone = false;
  private lastFeedRun: Date | null = null;
  private lastFeedError: string | null = null;
  private feedCount = 0;

  // 1. เริ่มต้น: seed ถ้ายังว่าง
  async seedIfEmpty(): Promise<number> {
    if (this.seedDone) return 0;
    this.seedDone = true;
    const count = await prisma.threatIntelItem.count();
    if (count > 0) return 0;
    const rows = [
      ...SEED_DOMAINS.map((d) => ({ ...d, type: 'DOMAIN' as const, source: 'seed' })),
      ...SEED_C2_DOMAINS.map((d) => ({ ...d, type: 'DOMAIN' as const, source: 'seed' })),
      ...SEED_IPS.map((d) => ({ ...d, type: 'IP' as const, source: 'seed' })),
    ];
    const created = await prisma.threatIntelItem.createMany({ data: rows, skipDuplicates: true });
    return created.count;
  }

  // 2. อัปเดตจาก feed (StevenBlack hosts / adblock list) — best effort
  async updateFromFeeds(): Promise<{ added: number; total: number; source: string }> {
    const urls = config.nextgen.intelFeedUrls;
    const source = urls[0] || '';
    if (!source) {
      this.lastFeedError = 'ไม่มีการตั้งค่า THREAT_INTEL_FEED_URLS';
      return { added: 0, total: 0, source: '' };
    }
    let added = 0;
    let parsed: Array<{ value: string; category: IntelCategory }> = [];
    try {
      const resp = await axios.get(source, {
        timeout: config.nextgen.intelFeedTimeoutMs,
        responseType: 'text',
      });
      parsed = parseHostsFile(typeof resp.data === 'string' ? resp.data : String(resp.data));
      // จำกัดขนาดฐานข้อมูล — เลือกโดเมนที่น่าสนใจที่สุด (category ไม่ใช่ unknown)
      const interesting = parsed.filter((d) => d.category !== 'unknown');
      const rest = parsed.filter((d) => d.category === 'unknown');
      parsed = [...interesting, ...rest].slice(0, config.nextgen.intelMaxItems);
    } catch (err: any) {
      this.lastFeedError = `Feed ดึงไม่ได้: ${err?.message || err}`;
      return { added: 0, total: 0, source };
    }
    // Upsert (ไม่ทับ item ที่มีอยู่แล้ว — update แค่ category/active)
    try {
      const existingRows = await prisma.threatIntelItem.findMany({
        where: { type: 'DOMAIN', value: { in: parsed.map((p) => p.value) } },
        select: { value: true },
      });
      const existingSet = new Set(existingRows.map((r) => r.value));
      const toCreate = parsed.filter((p) => !existingSet.has(p.value));
      if (toCreate.length > 0) {
        await prisma.threatIntelItem.createMany({
          data: toCreate.map((p) => ({
            type: 'DOMAIN',
            value: p.value,
            category: p.category,
            source: 'feed',
            confidence: 0.5,
          })),
          skipDuplicates: true,
        });
      }
      // ยกระดับ category ของ item เดิมที่ยังเป็น unknown (ไม่ทับที่จำแนกไว้แล้ว)
      for (const p of parsed) {
        if (p.category !== 'unknown') {
          await prisma.threatIntelItem.updateMany({
            where: { type: 'DOMAIN', value: p.value, category: 'unknown' },
            data: { category: p.category, active: true },
          });
        }
      }
      added = toCreate.length;
    } catch (err: any) {
      this.lastFeedError = `Feed บันทึกไม่สำเร็จ: ${err?.message || err}`;
      return { added, total: parsed.length, source };
    }
    this.lastFeedRun = new Date();
    this.lastFeedError = null;
    this.feedCount = parsed.length;
    return { added, total: parsed.length, source };
  }

  // 3. Match — เช็คโดเมน/IP ที่ไหลผ่านระบบกับฐาน IOC
  async matchDomains(domains: string[]): Promise<Array<any>> {
    const unique = [...new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
    if (unique.length === 0) return [];
    const items = await prisma.threatIntelItem.findMany({
      where: { type: 'DOMAIN', active: true, value: { in: unique } },
    });
    if (items.length === 0) return [];
    const byValue = new Map(items.map((i) => [i.value, i]));
    const matched: Array<any> = [];
    for (const d of unique) {
      const item = byValue.get(d);
      if (!item) continue;
      matched.push({
        type: item.type,
        value: item.value,
        category: item.category,
        confidence: item.confidence,
        source: item.source,
        note: item.note,
      });
    }
    // bump hits + last_seen (ไม่บล็อก flow หลักถ้าล้ม)
    try {
      await prisma.threatIntelItem.updateMany({
        where: { id: { in: items.map((i) => i.id) } },
        data: { hits: { increment: matched.length > 0 ? 1 : 0 }, last_seen: new Date() },
      });
    } catch {}
    return matched;
  }

  async matchIps(ips: string[]): Promise<Array<any>> {
    const unique = [...new Set(ips.map((s) => s.trim()).filter(Boolean))];
    if (unique.length === 0) return [];
    const items = await prisma.threatIntelItem.findMany({
      where: { type: 'IP', active: true, value: { in: unique } },
    });
    if (items.length === 0) return [];
    const byValue = new Map(items.map((i) => [i.value, i]));
    const matched = unique
      .map((ip) => byValue.get(ip))
      .filter(Boolean)
      .map((item: any) => ({
        type: item.type,
        value: item.value,
        category: item.category,
        confidence: item.confidence,
        source: item.source,
        note: item.note,
      }));
    try {
      await prisma.threatIntelItem.updateMany({
        where: { id: { in: items.map((i) => i.id) } },
        data: { hits: { increment: matched.length > 0 ? 1 : 0 }, last_seen: new Date() },
      });
    } catch {}
    return matched;
  }

  // 4. List / stats
  async list(filter?: { type?: string; category?: string; q?: string; active?: boolean; take?: number }): Promise<any> {
    const where: any = {};
    if (filter?.type) where.type = filter.type;
    if (filter?.category && filter.category !== 'all') where.category = filter.category;
    if (filter?.active !== undefined) where.active = filter.active;
    if (filter?.q) {
      where.OR = [{ value: { contains: filter.q, mode: 'insensitive' } }, { note: { contains: filter.q, mode: 'insensitive' } }];
    }
    const [items, total] = await Promise.all([
      prisma.threatIntelItem.findMany({
        where,
        orderBy: [{ last_seen: 'desc' }, { hits: 'desc' }],
        take: filter?.take || 200,
      }),
      prisma.threatIntelItem.count({ where }),
    ]);
    return { items, total };
  }

  async stats() {
    const [total, byType, byCategory, active, hits] = await Promise.all([
      prisma.threatIntelItem.count(),
      prisma.threatIntelItem.groupBy({ by: ['type'], _count: true }),
      prisma.threatIntelItem.groupBy({ by: ['category'], _count: true }),
      prisma.threatIntelItem.count({ where: { active: true } }),
      prisma.threatIntelItem.aggregate({ _sum: { hits: true } }),
    ]);
    return {
      total,
      active,
      byType: Object.fromEntries(byType.map((r) => [r.type, r._count])),
      byCategory: Object.fromEntries(byCategory.map((r) => [r.category, r._count])),
      totalHits: hits._sum.hits || 0,
      seedCount: SEED_DOMAINS.length,
      lastFeedRun: this.lastFeedRun,
      lastFeedError: this.lastFeedError,
      lastFeedItems: this.feedCount,
    };
  }

  async add(input: { type: IntelType; value: string; category?: IntelCategory; note?: string; source?: string; confidence?: number }) {
    const value = input.value.trim();
    if (!value) throw new Error('ต้องระบุค่า IP หรือโดเมน');
    if (input.type === 'DOMAIN') {
      if (!value.includes('.')) throw new Error('โดเมนไม่ถูกต้อง');
    } else {
      const parts = value.split('.');
      if (parts.length !== 4) throw new Error('IP ต้องเป็น IPv4 x.x.x.x');
      for (const p of parts) if (!/^\d{1,3}$/.test(p) || parseInt(p, 10) > 255) throw new Error('IP ไม่อยู่ในช่วงที่ถูกต้อง');
    }
    const category = input.category || guessCategory(value);
    return prisma.threatIntelItem.upsert({
      where: { type_value: { type: input.type, value: value.toLowerCase() } },
      update: { active: true, category, note: input.note, source: input.source || 'manual', confidence: input.confidence ?? 0.9 },
      create: {
        type: input.type,
        value: value.toLowerCase(),
        category,
        note: input.note,
        source: input.source || 'manual',
        confidence: input.confidence ?? 0.9,
      },
    });
  }

  async setActive(id: string, active: boolean) {
    return prisma.threatIntelItem.update({ where: { id }, data: { active } });
  }

  async remove(id: string) {
    await prisma.threatIntelItem.delete({ where: { id } });
    return { success: true };
  }

  // ใช้ใน cron รายวัน
  shouldRunFeed(): boolean {
    if (!this.lastFeedRun) return true;
    const hours = config.nextgen.intelFeedIntervalHours;
    return Date.now() - this.lastFeedRun.getTime() > hours * 3600 * 1000;
  }
}

export const threatIntel = new ThreatIntelService();