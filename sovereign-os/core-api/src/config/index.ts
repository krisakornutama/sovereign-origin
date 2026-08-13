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
export const AVAILABLE_MODULES = ['inventory', 'farm', 'vision', 'documents'] as const;
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
  corsOrigin: process.env.CORS_ORIGIN || '*',
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
};