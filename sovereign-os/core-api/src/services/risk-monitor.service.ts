import axios from 'axios';
import { prisma } from '../lib/prisma';
import EventEmitter from 'events';
import cron from 'node-cron';

export const riskEmitter = new EventEmitter();

// ── Pure: RSS parsing (RSS 2.0 + Atom) — regex-based, ไม่ต้อง dependency ──

export interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  source: string;
}

function stripCdata(raw: string): string {
  return raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function extractTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? stripCdata(match[1]) : '';
}

/** แยกข่าวจาก XML — รองรับ RSS 2.0 (<item>) และ Atom (<entry>) */
export function parseRss(xml: string): RssItem[] {
  if (!xml || typeof xml !== 'string') return [];
  const items: RssItem[] = [];

  // RSS 2.0
  const itemRe = /<item[\s>][\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[0];
    items.push({
      title: extractTag(block, 'title'),
      link: extractTag(block, 'link'),
      pubDate: extractTag(block, 'pubDate'),
      description: extractTag(block, 'description'),
      source: '',
    });
  }

  // Atom — <entry> อาจมี namespace (เช่น <entry> หรือ <ns:entry>)
  const entryRe = /<(?:[a-z0-9]+:)?entry[\s>][\s\S]*?<\/(?:[a-z0-9]+:)?entry>/gi;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[0];
    const linkMatch = block.match(/<link[^>]*href="([^"]+)"/i);
    items.push({
      title: extractTag(block, 'title'),
      link: linkMatch ? linkMatch[1] : '',
      pubDate: extractTag(block, 'updated') || extractTag(block, 'published'),
      description: extractTag(block, 'summary') || extractTag(block, 'content'),
      source: '',
    });
  }

  return items.filter((i) => i.title);
}

// ── Pure: parse คำตอบ Threat Index จาก Ollama ──

export const THREAT_CATEGORIES = ['war', 'banking', 'energy', 'inflation'] as const;

export interface ThreatResult {
  overall: number; // 0-100
  categories: Record<string, number>;
  summary?: string;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, n));
}

/** ดึง JSON block แรกจากข้อความ (กัน Ollama พ่น markdown/prose ล้อมรอบ) */
function extractJson(raw: string): unknown {
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parseThreatResponse(raw: string): ThreatResult | null {
  const data = extractJson(raw);
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const overall = Number(obj.overall);
  if (!Number.isFinite(overall)) return null;

  const cats = (obj.categories && typeof obj.categories === 'object' ? obj.categories : {}) as Record<string, unknown>;
  const categories: Record<string, number> = {};
  for (const key of THREAT_CATEGORIES) {
    const v = Number(cats[key]);
    categories[key] = Number.isFinite(v) ? clamp(v) : 0;
  }

  return {
    overall: clamp(overall),
    categories,
    summary: typeof obj.summary === 'string' ? obj.summary : undefined,
  };
}

// ── Worker: poll RSS → วิเคราะห์ด้วย Ollama → บันทึก ThreatIndex ──

export interface RiskWorkerConfig {
  enabled: boolean;
  feeds: Array<{ name: string; url: string }>;
  pollCron: string; // node-cron expression
  ollamaUrl: string;
  model: string;
  analyzeTop: number; // วิเคราะห์ข่าวกี่หัวข้อล่าสุด
}

export interface RiskWorkerDeps {
  fetchFeed: (url: string) => Promise<string>;
  headlineExists: (link: string) => Promise<boolean>;
  saveHeadline: (item: RssItem) => Promise<void>;
  loadRecentHeadlines: (limit: number) => Promise<Array<{ title: string; summary: string | null }>>;
  saveThreatIndex: (result: ThreatResult, headlineCount: number, model: string) => Promise<void>;
  analyzeWithOllama: (headlines: Array<{ title: string; summary: string | null }>) => Promise<ThreatResult | null>;
  log: (message: string) => void;
}

export class RiskWorker {
  private task: ReturnType<typeof cron.schedule> | null = null;
  private lastError: string | null = null;
  private lastErrorAt: Date | null = null;

  constructor(
    private deps: RiskWorkerDeps,
    private cfg: RiskWorkerConfig
  ) {}

  /** สถานะ worker — เอาไว้ให้ UI ตรวจว่า AI analysis กำลังล้มเงียบหรือเปล่า */
  getStatus(): { enabled: boolean; lastError: string | null; lastErrorAt: Date | null } {
    return { enabled: this.cfg.enabled, lastError: this.lastError, lastErrorAt: this.lastErrorAt };
  }

  /** รอบเดียว: ดึงทุก feed → เก็บข่าวใหม่ → วิเคราะห์ Threat Index → บันทึก + emit */
  async runOnce(): Promise<{ fetched: number; added: number; threat: ThreatResult | null }> {
    let fetched = 0;
    let added = 0;
    for (const feed of this.cfg.feeds) {
      let xml = '';
      try {
        xml = await this.deps.fetchFeed(feed.url);
      } catch (err) {
        this.deps.log(`📰 Risk: fetch ${feed.name} failed: ${err instanceof Error ? err.message : err}`);
        continue;
      }
      fetched++;
      const items = parseRss(xml).map((i) => ({ ...i, source: feed.name }));
      for (const item of items) {
        if (!item.link) continue; // ไม่มี link → dedupe ไม่ได้
        try {
          if (await this.deps.headlineExists(item.link)) continue;
          await this.deps.saveHeadline(item);
          added++;
        } catch (err) {
          this.deps.log(`📰 Risk: save headline failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    // วิเคราะห์ข่าวล่าสุด (เฉพาะเมื่อมีข่าวใหม่หรือทุกครั้งตามรอบ)
    if (added > 0 || this.cfg.feeds.length > 0) {
      const recent = await this.deps.loadRecentHeadlines(this.cfg.analyzeTop);
      if (recent.length > 0) {
        const threat = await this.deps.analyzeWithOllama(recent);
        if (threat) {
          this.lastError = null;
          this.lastErrorAt = null;
          await this.deps.saveThreatIndex(threat, recent.length, this.cfg.model);
          riskEmitter.emit('threat_update', threat);
          this.deps.log(
            `📰 Risk: threat index ${threat.overall} (${recent.length} headlines analyzed)`
          );
          return { fetched, added, threat };
        }
        // Ollama ล้ม (ปิดอยู่/model ผิด) → บันทึกสถานะ + แจ้ง SSE — กันระบบพังเงียบ ๆ
        this.lastError = `Ollama วิเคราะห์ไม่สำเร็จ (ตรวจ OLLAMA_URL=${this.cfg.ollamaUrl} + โมเดล ${this.cfg.model})`;
        this.lastErrorAt = new Date();
        riskEmitter.emit('risk_error', { lastError: this.lastError, lastErrorAt: this.lastErrorAt });
      }
    }
    return { fetched, added, threat: null };
  }

  start(): void {
    if (!this.cfg.enabled) {
      this.deps.log('📰 Risk monitor disabled (RISK_MONITOR_ENABLED=false)');
      return;
    }
    this.task = cron.schedule(this.cfg.pollCron, () => {
      this.runOnce().catch((err) => this.deps.log(`📰 Risk worker error: ${err instanceof Error ? err.message : err}`));
    });
    this.deps.log(`📰 Risk monitor started (${this.cfg.feeds.length} feeds, cron: ${this.cfg.pollCron})`);
    this.runOnce().catch((err) => this.deps.log(`📰 Risk initial run error: ${err instanceof Error ? err.message : err}`));
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}

// ── Ollama analysis + instance สำหรับ wiring ──

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '2m';

/** ตรวจว่ามีตัวอักษรภาษาไทย (ก-ฮ / เ-ไ / ฯ ๆ ุ ู ึ ื ั ้ ๊ ๋ ็ ์ ํ) อย่างน้อย 2 ตัวหรือไม่ */
function containsThai(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  const thai = text.match(/[\u0E00-\u0E7F]/g);
  return !!thai && thai.length >= 2;
}

function buildThreatPrompt(headlines: Array<{ title: string; summary: string | null }>): string {
  const list = headlines
    .map((h, i) => `${i + 1}. ${h.title}${h.summary ? ` — ${h.summary.slice(0, 200)}` : ''}`)
    .join('\n');
  return `You are the geopolitical risk analyst of an off-grid homestead system.
CRITICAL INSTRUCTION: Your entire answer must be written in Thai (ภาษาไทย).
Do NOT respond in English. English is allowed only for proper nouns (country names, tickers, organisations).
Analyze these news headlines and return ONLY a JSON object (no prose, no markdown):
{
  "overall": <0-100 overall threat level>,
  "categories": { "war": <0-100>, "banking": <0-100>, "energy": <0-100>, "inflation": <0-100> },
  "summary": "<สรุปความเสี่ยง 1 ประโยค เป็นภาษาไทยเท่านั้น>"
}

Headlines:
${list}`;
}

/** ถ้าสรุปไม่ใช่ภาษาไทย → ส่งกลับไปให้ Ollama แปลเป็นไทย (ลอง 1 ครั้ง) */
async function translateSummaryToThai(summary: string, model: string): Promise<string | null> {
  if (containsThai(summary)) return summary;
  try {
    const res = await axios.post(
      `${OLLAMA_URL}/api/generate`,
      {
        model,
        prompt: `Translate the following English text into Thai (ภาษาไทย). Output ONLY the Thai translation, no quotes, no explanation, no markdown.\n\nText: ${summary}`,
        stream: false,
        options: { temperature: 0.1 },
        keep_alive: OLLAMA_KEEP_ALIVE,
      },
      { timeout: 60000 }
    );
    const translated = String(res.data?.response || '').trim().replace(/^["']+|["']+$/g, '');
    return containsThai(translated) ? translated : null;
  } catch (err) {
    console.warn('📰 Risk: Thai translation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function analyzeWithOllama(
  headlines: Array<{ title: string; summary: string | null }>,
  model = process.env.RISK_MODEL || 'gemma3:4b'
): Promise<ThreatResult | null> {
  if (headlines.length === 0) return null;
  try {
    const res = await axios.post(
      `${OLLAMA_URL}/api/generate`,
      {
        model,
        prompt: buildThreatPrompt(headlines),
        stream: false,
        options: { temperature: 0.1 },
        keep_alive: OLLAMA_KEEP_ALIVE,
      },
      { timeout: 120000 }
    );
    const result = parseThreatResponse(res.data?.response || '');
    // self-healing ภาษา: ถ้า model พ่นสรุปเป็นภาษาอังกฤษ → ส่งกลับไปแปลเป็นไทย
    if (result?.summary) {
      const thai = await translateSummaryToThai(result.summary, model);
      if (thai) result.summary = thai;
    }
    return result;
  } catch (err) {
    console.warn('📰 Risk: Ollama analysis failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

export function createRiskWorker(cfg: RiskWorkerConfig): RiskWorker {
  return new RiskWorker(
    {
      fetchFeed: async (url) => {
        const res = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'sovereign-os/1.0' } });
        return res.data as string;
      },
      headlineExists: async (link) => {
        const found = await prisma.riskHeadline.findUnique({ where: { link } });
        return found !== null;
      },
      saveHeadline: async (item) => {
        await prisma.riskHeadline.create({
          data: {
            source: item.source,
            title: item.title,
            link: item.link,
            summary: item.description || null,
            published: item.pubDate ? new Date(item.pubDate) : new Date(),
          },
        });
      },
      loadRecentHeadlines: async (limit) => {
        const rows = await prisma.riskHeadline.findMany({
          orderBy: { published: 'desc' },
          take: limit,
        });
        return rows.map((r) => ({ title: r.title, summary: r.summary }));
      },
      saveThreatIndex: async (result, headlineCount, model) => {
        await prisma.threatIndex.create({
          data: {
            overall: result.overall,
            categories: result.categories,
            summary: result.summary || null,
            model,
            headline_count: headlineCount,
          },
        });
      },
      analyzeWithOllama,
      log: (m) => console.log(m),
    },
    cfg
  );
}
