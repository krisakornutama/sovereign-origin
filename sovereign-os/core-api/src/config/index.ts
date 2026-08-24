import dotenv from 'dotenv';
dotenv.config();

// Known weak secrets that must never be accepted as the signing key.
// If any of these end up in a deployment, tokens can be forged by anyone.
const WEAK_SECRETS = new Set([
  'change-me',
  'changeme',
  'replace-me-with-strong-secret',
  'my-super-secret-change-me',
  'secret',
  'password',
  'jwt-secret',
  'jwtsecret',
]);

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET is not set. Generate a strong secret (e.g. `openssl rand -hex 32`) and set it in the environment before starting the server.'
    );
  }
  if (secret.length < 16 || WEAK_SECRETS.has(secret.toLowerCase())) {
    throw new Error(
      'JWT_SECRET is too weak. Use a random value of at least 16 characters (e.g. `openssl rand -hex 32`).'
    );
  }
  return secret;
}

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Set it in the environment (see .env.example) before starting the server.'
    );
  }
  return url;
}

function splitList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Feature Modules (ENABLED_MODULES) ──
// แต่ละโมดูล = กลุ่ม API / หน้าเว็บที่เปิด-ปิดได้อิสระผ่าน infra/.env
// ค่าว่าง = เปิดทุกโมดูล (เข้ากันได้กับ config เก่า) — ระบุแค่โมดูลที่อยากเปิดถ้าต้องการปิดตัวอื่น
export const AVAILABLE_MODULES = ['inventory', 'farm', 'vision', 'documents', 'restaurant'] as const;
export type ModuleName = (typeof AVAILABLE_MODULES)[number];

function parseEnabledModules(): Set<ModuleName> {
  const requested = splitList(process.env.ENABLED_MODULES);
  const enabled = new Set<ModuleName>();
  for (const name of requested) {
    if ((AVAILABLE_MODULES as readonly string[]).includes(name)) {
      enabled.add(name as ModuleName);
    } else {
      console.warn(`[config] ENABLED_MODULES มีค่าไม่รู้จัก "${name}" — ข้ามไป (ตัวเลือก: ${AVAILABLE_MODULES.join(', ')})`);
    }
  }
  return enabled;
}

// RISK_FEEDS รูปแบบ: name=url;name2=url2;... (ใช้ ; แยก เพราะ URL มี comma ได้)
function parseRiskFeeds(value: string | undefined): Array<{ name: string; url: string }> {
  return (value || '')
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq <= 0) return { name: pair, url: pair };
      return { name: pair.slice(0, eq).trim(), url: pair.slice(eq + 1).trim() };
    })
    .filter((f) => /^https?:\/\//i.test(f.url));
}

// AI agent autonomy level: view (read-only) / suggest (approval required) / autonomous
function getAgentAutonomy(): 'view' | 'suggest' | 'autonomous' {
  const value = process.env.AGENT_AUTONOMY || 'suggest';
  if (value !== 'view' && value !== 'suggest' && value !== 'autonomous') {
    throw new Error(
      `Invalid AGENT_AUTONOMY "${value}" — must be one of: view, suggest, autonomous`
    );
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: (process.env.NODE_ENV || 'development') === 'production',
  jwtSecret: getJwtSecret(),
  // โมดูล API ที่เปิดใช้งาน — enabled ว่าง = เปิดทั้งหมด, ถ้าตั้งค่าไว้ = เปิดตามรายการ
  modules: {
    available: AVAILABLE_MODULES,
    enabled: parseEnabledModules(),
    isEnabled(module: ModuleName): boolean {
      return this.enabled.size === 0 || this.enabled.has(module);
    },
  },
  mqtt: {
    host: process.env.MQTT_HOST || 'localhost',
    port: parseInt(process.env.MQTT_PORT || '1883', 10),
    user: process.env.MQTT_USER,
    pass: process.env.MQTT_PASS,
  },
  database: {
    url: getDatabaseUrl(),
  },
  // HTTPS — ตั้ง TLS_CERT / TLS_KEY (path ไฟล์ PEM) เพื่อรันผ่าน TLS แทน HTTP
  tls: {
    certPath: process.env.TLS_CERT || '',
    keyPath: process.env.TLS_KEY || '',
  },
  // จำกัด origin ที่เชื่อม API ได้ (production ควรตั้งเป็นโดเมนหน้าเว็บ ไม่ใช่ *)
  corsOrigin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? 'http://localhost:3000' : 'http://localhost:3000,http://127.0.0.1:3000'),
  // AI agent policy — autonomy level + protected targets for action tools
  agent: {
    autonomy: getAgentAutonomy(),
    protectedIps: splitList(process.env.AGENT_PROTECTED_IPS),
    protectedProcesses: splitList(process.env.AGENT_PROTECTED_PROCESSES),
    approvalTtlMs: parseInt(process.env.AGENT_APPROVAL_TTL_MS || '900000', 10),
  },
  // Power guard — เฝ้าดูแบตเตอรี่ แล้วแจ้งเตือน / สั่ง graceful shutdown
  // (POWER_SHUTDOWN_CMD ว่าง = แจ้งเตือนอย่างเดียว ไม่ปิดเครื่อง)
  power: {
    capacityKwh: parseFloat(process.env.ENERGY_CAPACITY_KWH || '5'),
    warningMinutes: parseInt(process.env.POWER_WARNING_MINUTES || '30', 10),
    criticalMinutes: parseInt(process.env.POWER_CRITICAL_MINUTES || '5', 10),
    checkIntervalMs: parseInt(process.env.POWER_CHECK_INTERVAL_MS || '60000', 10),
    shutdownCommand: process.env.POWER_SHUTDOWN_CMD || '',
  },
  // UPS monitor — อ่านค่า UPS ผ่าน NUT (TCP 3493) แล้ว push เข้า telemetry
  // (UPS_ENABLED=false = ปิด — ต้องมี NUT server เช่น upsd/usbhid-ups รันอยู่ก่อน)
  ups: {
    enabled: (process.env.UPS_ENABLED || 'false') === 'true',
    host: process.env.UPS_HOST || 'localhost',
    port: parseInt(process.env.UPS_PORT || '3493', 10),
    upsName: process.env.UPS_NAME || 'ups',
    nodeId: process.env.UPS_NODE_ID || '11111111-1111-1111-1111-111111111111',
    checkIntervalMs: parseInt(process.env.UPS_CHECK_INTERVAL_MS || '30000', 10),
    lowBatteryThreshold: parseInt(process.env.UPS_LOW_BATTERY_THRESHOLD || '20', 10),
    lowBatteryCooldownMs: parseInt(process.env.UPS_LOW_BATTERY_COOLDOWN_MS || '600000', 10),
    // UPS Graceful Shutdown — trigger เมื่อแบตเตอรี่ถึงขีด (หรือเหลือเวลาไม่ถึง) แล้วทำ
    // CHECKPOINT → drain telemetry → emergency bundle → audit → สั่งปิดเครื่อง
    shutdownBatteryPct: parseInt(process.env.UPS_SHUTDOWN_BATTERY_PCT || '15', 10),
    shutdownRuntimeSec: parseInt(process.env.UPS_SHUTDOWN_RUNTIME_SEC || '180', 10),
    shutdownCheckIntervalMs: parseInt(process.env.UPS_SHUTDOWN_CHECK_INTERVAL_MS || '15000', 10),
    shutdownCommand: process.env.UPS_SHUTDOWN_CMD || process.env.POWER_SHUTDOWN_CMD || 'shutdown -h now',
    dryRun: (process.env.UPS_DRY_RUN || 'false') === 'true',
  },
  // Telegram Remote Alerts — dispatcher เกรด production (ชุด 🟡 ข้อ 3)
  // กรองตาม severity → dedup 5 นาที → rate-limit (critical 5/min) → HTML + dashboard link
  telegramAlert: {
    minSeverity: (process.env.TELEGRAM_MIN_SEVERITY || 'warn') as 'critical' | 'warn' | 'info',
    dedupWindowMs: parseInt(process.env.TELEGRAM_DEDUP_WINDOW_MS || '300000', 10), // 5 นาที
    criticalRatePerMin: parseInt(process.env.TELEGRAM_CRITICAL_RATE_PER_MIN || '5', 10),
    globalRatePerMin: parseInt(process.env.TELEGRAM_GLOBAL_RATE_PER_MIN || '60', 10),
    dashboardUrl: process.env.TELEGRAM_DASHBOARD_URL || '',
  },
  // ── Phase 4: Risk & Wealth Infrastructure ──
  // Module 13: Wealth & Asset Tracker
  portfolio: {
    enabled: (process.env.PORTFOLIO_ENABLED || 'false') === 'true',
    fetchCron: process.env.PORTFOLIO_FETCH_CRON || '0 */4 * * *', // ทุก 4 ชม.
    priceCacheTtlMs: parseInt(process.env.PORTFOLIO_PRICE_CACHE_TTL_MS || '3600000', 10), // 1 ชม. กัน rate limit
    cashUsd: parseFloat(process.env.PORTFOLIO_CASH_USD || '0'),
    monthlyExpensesUsd: parseFloat(process.env.PORTFOLIO_MONTHLY_EXPENSES_USD || '0'),
    electricityPricePerKwh: parseFloat(process.env.ELECTRICITY_PRICE_USD_PER_KWH || '0.12'),
  },
  // Module 14: Geopolitical RSS & Ollama Risk Scraper
  risk: {
    enabled: (process.env.RISK_MONITOR_ENABLED || 'false') === 'true',
    feeds: parseRiskFeeds(process.env.RISK_FEEDS),
    pollCron: process.env.RISK_POLL_CRON || '0 */30 * * * *', // ทุก 30 นาที
    ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
    model: process.env.RISK_MODEL || 'gemma3:4b',
    analyzeTop: parseInt(process.env.RISK_ANALYZE_TOP || '15', 10),
  },
  // Module 15: Macro-to-Physical Automation Bridge (DEFCON Engine)
  defcon: {
    enabled: (process.env.DEFCON_ENABLED || 'false') === 'true',
    hysteresis: parseInt(process.env.DEFCON_HYSTERESIS || '10', 10),
  },
  // ── Next-Gen Security (Pillar 1-6) ──
  // Threat Intelligence / Pi-hole / Suricata / ntopng / ClamAV / App Control / AI Analyst
  // ทุกจุดเป็น best-effort: ถ้าเครื่องมือไม่ configure ไว้ ระบบทำงานต่อและแสดงสถานะ "ไม่เชื่อมต่อ"
  nextgen: {
    // 1) Threat Intelligence — ฐาน IOC + feed อัปเดต
    intelFeedUrls: splitList(process.env.THREAT_INTEL_FEED_URLS).length
      ? splitList(process.env.THREAT_INTEL_FEED_URLS)
      : ['https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts'],
    intelMaxItems: parseInt(process.env.THREAT_INTEL_MAX_ITEMS || '5000', 10),
    intelFeedIntervalHours: parseInt(process.env.THREAT_INTEL_FEED_INTERVAL_HOURS || '24', 10),
    intelFeedTimeoutMs: parseInt(process.env.THREAT_INTEL_FEED_TIMEOUT_MS || '30000', 10),
    // 2) Pi-hole DNS — URL แบบ http://host:port/admin (v5) หรือ root (v6)
    piholeUrl: process.env.PIHOLE_URL || '',
    piholeToken: process.env.PIHOLE_TOKEN || '',
    piholeTimeoutMs: parseInt(process.env.PIHOLE_TIMEOUT_MS || '5000', 10),
    // 3) Suricata IDS — ตำแหน่ง eve.json (ว่าง = ปิด)
    idsEveLog: process.env.IDS_EVE_LOG || '',
    idsPollIntervalMs: parseInt(process.env.IDS_POLL_INTERVAL_MS || '10000', 10),
    idsTailBytes: parseInt(process.env.IDS_TAIL_BYTES || '4194304', 10),
    // 4) (ลบ ClamAV daemon แล้ว — ใช้ SHA-256 hash engine แทน: src/services/hash-engine.service.ts)
    // 5) ntopng — ใช้ตรวจว่า reachable (แสดงสถานะใน UI เท่านั้น)
    ntopngUrl: process.env.NTOPNG_URL || '',
    ntopngTimeoutMs: parseInt(process.env.NTOPNG_TIMEOUT_MS || '5000', 10),
    // 6) AI Analyst — วิเคราะห์เหตุการณ์รวมด้วย Ollama + แจ้งเตือน Telegram
    aiAnalystEnabled: (process.env.AI_ANALYST_ENABLED || 'false') === 'true',
    aiAnalystModel: process.env.AI_ANALYST_MODEL || 'gemma3:4b',
    aiAnalystIntervalMin: parseInt(process.env.AI_ANALYST_INTERVAL_MIN || '60', 10),
    aiAnalystTelegram: (process.env.AI_ANALYST_TELEGRAM || 'false') === 'true',
    aiAnalystMaxEvents: parseInt(process.env.AI_ANALYST_MAX_EVENTS || '25', 10),
    // 7) First-Responder Mode — โหมดรับมือเหตุฉุกเฉิน (ปลดล็อกประตู/หยุด stranger-alert) — หมดอายุอัตโนมัติ
    firstResponderDurationMs: parseInt(process.env.FIRST_RESPONDER_DURATION_MS || '7200000', 10), // default 2 ชม.
  },
  // ── Phase 6 — The Final Hardening (Epistemic Isolation) ──
  storage: {
    // อายุ SSD/NVMe โดยประมาณ (TBW) — ใช้คำนวณ write-budget ใน Chaos Drill
    ssdTbw: parseInt(process.env.SSD_TBW || '150', 10),
  },
  // 17) Lifestyle / Phase 5 "Embracing Chaos" — ออกแบบให้ระบบยอมรับความผันผวนของธรรมชาติ
  lifestyle: {
    enabled: (process.env.LIFESTYLE_ENABLED || 'true') === 'true',
    // ภัย 1 (Hygiene Hypothesis): เป้าเปิดรับอากาศธรรมชาติต่อวัน (นาที) + AQI สูงสุดที่ยอมเปิดหน้าต่าง
    targetExposureMin: parseInt(process.env.TARGET_EXPOSURE_MIN || '60', 10),
    minExposureMin: parseInt(process.env.MIN_EXPOSURE_MIN || '30', 10),
    aqiCap: parseInt(process.env.EXPOSURE_AQI_CAP || '50', 10),
    // ภัย 3 (Circadian): ตำแหน่งบ้านสำหรับคำนวณพระอาทิตย์ขึ้น/ตก + ขนาดอุณหภูมิ drift ที่ "ควรปล่อยให้ธรรมชาติทำ"
    latitude: parseFloat(process.env.HOME_LATITUDE || '15.0'),
    longitude: parseFloat(process.env.HOME_LONGITUDE || '100.0'),
    // +UTC นาที (ไทย = 420) — container รัน TZ=UTC จึงต้องคำนวณเวลาแสดงเอง
    utcOffsetMin: parseInt(process.env.HOME_UTC_OFFSET_MIN || '420', 10),
    tempDriftC: parseInt(process.env.NATURAL_TEMP_DRIFT_C || '3', 10),
    // ภัย 5 (Generational): วันไร้ระบบอัตโนมัติเริ่มต้น 24 ชม.
    manualDayHours: parseInt(process.env.MANUAL_DAY_HOURS || '24', 10),
  },
  // ── Series 🔴 — External Dead-Man Switch (DMS) ──
  // ตัวดักคอยแยกวงจร: รับ heartbeat จากอุปกรณ์ DMS (4G OOB) ด้วย HMAC-SHA256 rolling key
  // (DMS_ENABLED=true แต่ไม่มี DMS_MASTER_SECRET = ไม่เปิด — blueprint §7.2)
  // ดูสเปกเต็ม: docs/SERIES_RED_DMS_BLUEPRINT.md
  dms: {
    enabled: (process.env.DMS_ENABLED || 'false') === 'true' && !!process.env.DMS_MASTER_SECRET,
    masterSecret: process.env.DMS_MASTER_SECRET || '',
    // บันไดวิกฤต: >MISSED_MS = "สงสัยตาย" (ระดับ 1) → >FAILOVER_MS = "ยืนยัน SPOF" (ระดับ 2)
    missedMs: parseInt(process.env.DMS_MISSED_MS || '90000', 10), // 90s = 3 missed
    failoverMs: parseInt(process.env.DMS_FAILOVER_MS || '180000', 10), // 180s = 6 missed
    autoFailover: (process.env.DMS_AUTO_FAILOVER || 'false') === 'true', // false = แจ้งเตือนอย่างเดียว
    wolMac: process.env.DMS_WOL_MAC || '', // MAC Cold Standby (ว่าง = ไม่ปลุก)
    wolBroadcast: process.env.DMS_WOL_BROADCAST || '192.168.1.255',
    failoverCooldownMs: parseInt(process.env.DMS_FAILOVER_COOLDOWN_MS || '300000', 10), // กันยิงซ้ำ
    // device_id ที่ยอมรับ (`,` คั่น) — default ตาม blueprint: dms-esp32s3-01
    allowedDevices: splitList(process.env.DMS_ALLOWED_DEVICES).length
      ? splitList(process.env.DMS_ALLOWED_DEVICES)
      : ['dms-esp32s3-01'],
    dryRun: (process.env.DMS_DRY_RUN || 'false') === 'true', // จำลองลาดเดอร์ ไม่ยิงจริง (เหมือน UPS_DRY_RUN)
    checkIntervalMs: parseInt(process.env.DMS_CHECK_INTERVAL_MS || '10000', 10),
    // ความคลาดเคลื่อนนาฬิกาที่ยอมรับ (blueprint §8: tolerance 60s + accept ±1 key window)
    clockToleranceMs: parseInt(process.env.DMS_CLOCK_TOLERANCE_MS || '60000', 10),
  },
  // ── ค่า default กลาง (เดิมฝังตายตัวอยู่ในโค้ดหลายไฟล์) ──
  defaults: {
    // node_id เครื่องหลัก — ใช้เมื่อ telemetry/request ไม่ระบุ node มาเอง
    // (ตรงกับ node ที่ scripts/seed.ts สร้างไว้ตอนติดตั้ง)
    telemetryNodeId: process.env.TELEMETRY_NODE_ID || '11111111-1111-1111-1111-111111111111',
  },
  // ── Restaurant Empire — POS + Kitchen IoT ──
  restaurant: {
    // อัตราแลกเปลี่ยน THB→USD ตอนบันทึก TreasuryEvent ประเภท SALE
    // (เดิมฝัง /35 ตายตัว — ปรับได้ผ่าน env ไม่ต้องแก้โค้ด)
    thbPerUsd: parseFloat(process.env.THB_PER_USD || '35'),
  },
  // ── AI Model Manager (Ollama Control System) ──
  // จุดต่อ engine หลัก — ใน docker-compose ตั้งเป็น http://sovereign-ollama:11434
  // บน host ใช้ default http://127.0.0.1:11434 (เดิม env OLLAMA_URL ใช้อยู่แล้วทั่วระบบ)
  ollama: {
    url: (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    // timeout ต่อ request ปกติ (pull/create ใช้ stream ไม่่วน timeout นี้)
    timeoutMs: parseInt(process.env.OLLAMA_TIMEOUT_MS || '10000', 10),
    // โฟลเดอร์เก็บ .gguf ที่ดาวน์โหลดจาก HuggingFace ก่อน register เข้า Ollama
    ggufDir: process.env.OLLAMA_GGUF_DIR || 'data/gguf',
    // งาน import/pull ค้างนานสุดกี่ ms ถึงตัดสถานะ error (กัน job แขวน)
    jobTimeoutMs: parseInt(process.env.OLLAMA_JOB_TIMEOUT_MS || '3600000', 10),
  },
};