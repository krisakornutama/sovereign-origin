import fs from 'fs';
import path from 'path';

// ── Application Control (Pillar 2 — DPI/App blocking) ──
// แคตตาล็อกแอป + รายการโดเมนที่ต้องบล็อก เพื่อ block app ทั้งตัว:
//  - ส่งเป็น blacklist ไป Pi-hole (DNS-level) หรือ
//  - export เป็น hosts file สำหรับแจกจ่าย
// สถานะ block/unblock เก็บในไฟล์ JSON (data/app-control.json) — ไม่ต้องผูก schema ใหม่
// หมายเหตุ: DNS blocking ใช้ได้กับแอปที่เชื่อมผ่านชื่อโดเมน (ไม่ใช่ IP ตรง) — DPI ระดับ
// packet (nDPI) เป็นเพิ่มเติมจากเครื่องมือ network ภายนอก (Suricata/nDPI)

export interface AppDef {
  id: string;
  name: string;
  icon: string;
  category: string; // social | video | game | torrent | gambling | chat | streaming | news | adult | security
  description: string;
  domains: string[];
}

export interface AppState {
  [appId: string]: boolean; // true = block
}

export const APP_CATALOG: AppDef[] = [
  { id: 'tiktok', name: 'TikTok', icon: '🎵', category: 'social', description: 'โซเชียลวิดีโอสั้น — ใช้ ddns/analytics หนัก', domains: ['tiktok.com', 'tiktokcdn.com', 'tiktokv.com', 'musical.ly', 'byteoversea.com', 'snssdk.com', 'ibytedtos.com', 'isnssdk.com'] },
  { id: 'facebook', name: 'Facebook', icon: '📘', category: 'social', description: 'โซเชียล + messenger', domains: ['facebook.com', 'fbcdn.net', 'fb.com', 'messenger.com', 'facebook.net', 'tfbnw.net', 'fbsbx.com'] },
  { id: 'instagram', name: 'Instagram', icon: '📸', category: 'social', description: 'แชร์รูป/วิดีโอ', domains: ['instagram.com', 'cdninstagram.com', 'igcdn.com'] },
  { id: 'youtube', name: 'YouTube', icon: '▶️', category: 'video', description: 'วิดีโอ (ต้องใช้ร่วมกับ YouTube block lists เพื่อให้ได้ผล)', domains: ['youtube.com', 'youtube-nocookie.com', 'ytimg.com', 'googlevideo.com', 'youtu.be'] },
  { id: 'netflix', name: 'Netflix', icon: '🎬', category: 'streaming', description: 'สตรีมมิ่ง', domains: ['netflix.com', 'nflxvideo.net', 'nflximg.net', 'nflxso.net'] },
  { id: 'disneyplus', name: 'Disney+', icon: '🏰', category: 'streaming', description: 'สตรีมมิ่ง', domains: ['disneyplus.com', 'disney-plus.net', 'dssott.com', 'bamgrid.com', 'dssedge.com'] },
  { id: 'discord', name: 'Discord', icon: '💬', category: 'chat', description: 'แชทเกมเมอร์', domains: ['discord.com', 'discord.gg', 'discordapp.com', 'discord.media', 'discordapp.net'] },
  { id: 'roblox', name: 'Roblox', icon: '🧱', category: 'game', description: 'เกม Roblox', domains: ['roblox.com', 'rbxcdn.com', 'robloxlabs.com'] },
  { id: 'minecraft', name: 'Minecraft', icon: '⛏️', category: 'game', description: 'เกม Minecraft (รวมเซิร์ฟเวอร์หลัก)', domains: ['minecraft.net', 'minecraftservices.com', 'mojang.com'] },
  { id: 'freefire', name: 'Free Fire', icon: '🔥', category: 'game', description: 'เกมมือถือยอดนิยม', domains: ['ff.garena.com', 'garena.com', 'garenanow.com', 'freefiremobile.com', 'appsflyer.com'] },
  { id: 'rov', name: 'RoV (Rov Mobile)', icon: '⚔️', category: 'game', description: 'เกม MOBA มือถือ', domains: ['rovm.zing.vn', 'rovmobile.com', 'garena.vn'] },
  { id: 'bittorrent', name: 'BitTorrent', icon: '🧲', category: 'torrent', description: 'torrent clients + trackers', domains: ['bittorrent.com', 'utorrent.com', 'qbit.live', 'torrentgalaxy.to', '1337x.to', 'thepiratebay.org', 'yts.mx'] },
  { id: 'scam-site', name: 'เว็บพนัน/สแกม', icon: '🎰', category: 'gambling', description: 'กลุ่มเว็บพนันไทย + สล็อต', domains: ['ufabet.com', 'ufa1688.com', 'pgslot.io', 'm98.co.th', 'lottovip.com', 'huaydee.com', 'gclub88.com', 'pantip909.com', 'sport888.com', 'joker123.com', 'ppslot.com'] },
  { id: 'porn', name: 'เว็บผู้ใหญ่', icon: '🔞', category: 'adult', description: 'เว็บ 18+', domains: ['pornhub.com', 'xnxx.com', 'xvideos.com', 'xhamster.com', 'youporn.com', 'redtube.com'] },
  { id: 'news-ads', name: 'โฆษณา/ติดตาม', icon: '📢', category: 'security', description: 'เครือข่ายโฆษณา + tracker (เดียวกับ Threat DB)', domains: ['doubleclick.net', 'googlesyndication.com', 'adservice.google.com', 'adsrvr.org', 'taboola.com', 'outbrain.com', 'criteo.com', 'scorecardresearch.com', 'quantserve.com', 'moatads.com'] },
];

// เส้นทาง state file — override ผ่าน env (ใช้ในการทดสอบ)
const STATE_FILE =
  process.env.APP_CONTROL_STATE_FILE || path.resolve(process.cwd(), 'data', 'app-control.json');
const CUSTOM_FILE =
  process.env.APP_CONTROL_CUSTOM_FILE || path.resolve(process.cwd(), 'data', 'app-custom-domains.json');

function loadJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function saveJson(file: string, data: any) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

class AppControlService {
  state: AppState = {};
  customDomains: string[] = [];

  init() {
    this.state = loadJson<AppState>(STATE_FILE, {});
    this.customDomains = loadJson<string[]>(CUSTOM_FILE, []);
  }

  allApps(): Array<AppDef & { blocked: boolean }> {
    return APP_CATALOG.map((app) => ({ ...app, blocked: !!this.state[app.id] }));
  }

  setBlocked(appId: string, blocked: boolean): boolean {
    if (!APP_CATALOG.some((a) => a.id === appId)) return false;
    this.state[appId] = blocked;
    saveJson(STATE_FILE, this.state);
    return true;
  }

  setCategoryBlocked(category: string, blocked: boolean): number {
    const apps = APP_CATALOG.filter((a) => a.category === category);
    for (const a of apps) this.state[a.id] = blocked;
    saveJson(STATE_FILE, this.state);
    return apps.length;
  }

  addCustomDomain(domain: string): boolean {
    const d = domain.trim().toLowerCase();
    if (!d || !d.includes('.')) return false;
    if (this.customDomains.includes(d)) return false;
    this.customDomains.push(d);
    saveJson(CUSTOM_FILE, this.customDomains);
    return true;
  }

  removeCustomDomain(domain: string): boolean {
    const i = this.customDomains.indexOf(domain.toLowerCase());
    if (i === -1) return false;
    this.customDomains.splice(i, 1);
    saveJson(CUSTOM_FILE, this.customDomains);
    return true;
  }

  blockedDomains(): string[] {
    const out = new Set<string>();
    for (const app of APP_CATALOG) {
      if (this.state[app.id]) {
        for (const d of app.domains) out.add(d);
      }
    }
    for (const d of this.customDomains) out.add(d);
    return [...out];
  }

  blockedCount(): number {
    return this.blockedDomains().length;
  }

  // hosts file / plain list (สำหรับ export ไปใช้ที่อื่น)
  toHostsFile(): string {
    const lines = this.blockedDomains().map((d) => `0.0.0.0 ${d}`);
    return `# Sovereign OS Next-Gen Security — App Control blocklist\n# generated ${new Date().toISOString()}\n${lines.join('\n')}\n`;
  }
}

export const appControl = new AppControlService();