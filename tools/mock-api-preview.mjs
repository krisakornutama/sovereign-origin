// tools/mock-api-preview.mjs
// Mock API สำหรับ "โหมดชมธีม" — รัน frontend dev โดยไม่ต้องต่อ backend จริง
// ใช้: node tools/mock-api-preview.mjs   (ฟัง 127.0.0.1:3101)
// แล้วรัน dev ด้วย NEXT_PUBLIC_API_URL=http://localhost:3101
// หน้าไหนมีข้อมูลจำลองจะแสดงตัวเลขสวย ๆ หน้าอื่นแสดงโครงธีมพร้อมสถานะว่าง
import http from 'node:http';

const PORT = 3101;

// ข้อมูลจำลองหน้าพลังงาน — ให้เห็นการ์ด/กราฟในบรรยากาศ atmo-power ครบ
const energySummary = {
  battery_soc: 76,
  power_kw_avg_24h: 0.42,
  power_kw_latest: -0.31,
  kwh_net_24h: -3.2,
  hours_remaining: 9.5,
  capacity_kwh: 5,
  status: 'discharging',
};

// หน้าสุขภาพ — โครงว่างแต่ไม่พัง (เห็นธีม atmo-wellness ครบ)
const healthOverview = {
  counts: [],
  observations: [],
  flags: [],
  consents: [],
  profile: { conditions: [], medications: [] },
};
const healthReadings = { rows: [], analysis: {} };

// หน้าความปลอดภัย (atmo-guard) — ตัวอย่างให้ตาราง/แถบสถานะมีของดู
const securityConnections = [
  { protocol: 'TCP', foreign_address: '203.0.113.7:443', state: 'ESTABLISHED', process: 'chrome' },
  { protocol: 'UDP', foreign_address: '192.168.1.1:53', state: 'LISTEN', process: 'dns' },
  { protocol: 'TCP', foreign_address: '198.51.100.23:80', state: 'TIME_WAIT', process: 'node' },
];
const securityEvents = [
  { id: 'e1', type: 'FIREWALL_BLOCK', message: 'บล็อก IP แปลกปลอม 203.0.113.99', created_at: new Date().toISOString() },
  { id: 'e2', type: 'LOGIN_OK', message: 'เข้าสู่ระบบสำเร็จ (superadmin)', created_at: new Date().toISOString() },
];
const securityFirewall = { status: 'active' };
const securityBlocks = { blockedIps: ['203.0.113.99'], pendingApprovals: 1 };

// หน้าคลัง & ลงทุน (atmo-wealth) — ตัวเลขให้ Stat + Alluvial + ตารางทำงานครบ
const treasuryData = {
  generatedAt: new Date().toISOString(),
  dime: null,
  netWorth: { usd: 128450.5, assetsUsd: 141200, inventoryUsd: 8750, liquidCashUsd: 62800.5, liabilitiesUsd: 21500 },
  cashflow: { monthlyBurnUsd: 1850, coreBurnUsd: 1420, energyCostUsd: 96, monthlyIncomeUsd: 640, annualizedDividendUsd: 3100 },
  runway: { months: 33.9, formula: { liquidCashUsd: 62800.5, annualizedDividendUsd: 3100, monthlyBurnUsd: 1850 } },
  strategies: {
    families: ['DIVIDEND', 'GROWTH', 'SAFETY'],
    allocation: [
      { family: 'DIVIDEND', valueUsd: 42000, pct: 55, positions: 3, dividendYieldPct: 5.2 },
      { family: 'GROWTH', valueUsd: 22000, pct: 29, positions: 2, dividendYieldPct: 0.8 },
      { family: 'SAFETY', valueUsd: 12000, pct: 16, positions: 2, dividendYieldPct: 2.1 },
    ],
    totalUsd: 76000,
  },
  catalysts: [
    { id: 'c1', symbol: 'SCB', note: 'ปันผลไตรมาสหน้า', family: 'DIVIDEND', valueUsd: 18000 },
    { id: 'c2', symbol: 'VN30', note: 'รอผลประกอบการ', family: 'GROWTH', valueUsd: 14000 },
  ],
  income: {
    dividendStreams: [
      { id: 'd1', symbol: 'SCB', family: 'DIVIDEND', quantity: 2000, yieldPct: 5.2, annualEstimateUsd: 1900, lastDividendUsd: 470, lastDividendAt: new Date().toISOString() },
    ],
    events: [
      { id: 'ev1', type: 'DIVIDEND', symbol: 'SCB', amount_usd: 470, note: null, created_at: new Date().toISOString() },
      { id: 'ev2', type: 'CASH_ADJUST', symbol: null, amount_usd: 120, note: 'ดอกเบี้ยเงินฝาก', created_at: new Date().toISOString() },
    ],
    totalRealizedGainUsd: 1450,
  },
  positions: [
    { id: 'p1', symbol: 'SCB', type: 'stock', quantity: 2000, wallet_address: null, notes: null, strategyFamily: 'DIVIDEND', avgCostUsd: 18.4, expectedDividendYieldPct: 5.2, catalystNote: 'ปันผลไตรมาสหน้า', lastDividendUsd: 470, lastDividendAt: new Date().toISOString(), realizedGainUsd: 620, soldQty: 0, companyName: 'ไทยพาณิชย์', allocationPct: 55, totalReturnPct: 8.4, totalReturnUsd: 1520, priceUsd: 19.95, valueUsd: 39900 },
    { id: 'p2', symbol: 'VN30', type: 'etf', quantity: 150, wallet_address: null, notes: null, strategyFamily: 'GROWTH', avgCostUsd: 92, expectedDividendYieldPct: 0.8, catalystNote: null, lastDividendUsd: null, lastDividendAt: null, realizedGainUsd: 830, soldQty: 0, companyName: null, allocationPct: 29, totalReturnPct: 5.1, totalReturnUsd: 830, priceUsd: 96.7, valueUsd: 14505 },
  ],
};
const treasuryTransfers = { transfers: [] };

// หน้าร้านอาหาร (atmo-kitchen) — เมนู/ออเดอร์ให้ POS วาดได้
const menus = [
  { id: 'm1', name: 'ข้าวผัดกะเพราหมูสับ', price: 55, category: 'จานเดียว', active: true },
  { id: 'm2', name: 'ผัดไทยกุ้งสด', price: 70, category: 'จานเดียว', active: true },
  { id: 'm3', name: 'ต้มยำกุ้งน้ำข้น', price: 120, category: 'ซุป', active: true },
  { id: 'm4', name: 'ชาเย็น', price: 25, category: 'เครื่องดื่ม', active: true },
];
const restaurantOrders = [];

// หน้าฟาร์ม (atmo-nature) — แปลงตัวอย่างให้การ์ดมีของดู
const farmPlots = {
  plots: [
    { id: 'fp1', name: 'แปลงทุเรียนหน้าบ้าน', crop: 'ทุเรียน', location: 'รั้วด้านตะวันออก', area_sqm: 320, status: 'growing', planted_at: '2026-06-01' },
    { id: 'fp2', name: 'สวนสมุนไพร', crop: 'ขมิ้นชัน', location: 'หลังครัว', area_sqm: 48, status: 'active', planted_at: '2026-08-15' },
    { id: 'fp3', name: 'แปลงข้าวหอมมะลิ', crop: 'ข้าวหอมมะลิ', location: 'ทุ่งเหนือ', area_sqm: 1600, status: 'harvested', planted_at: '2026-05-10' },
    { id: 'fp4', name: 'แปลงพักดิน', crop: null, location: 'ทุ่งใต้', area_sqm: 700, status: 'fallow', planted_at: null },
  ],
};

// หน้าห้องเยียวยา (atmo-lotus) — คำสอน/สมุนไพร/สมาธิให้เทียนไฟมีของเผา
const healingTeachings = {
  teachings: [
    { id: 't1', title: 'สติปัฏฐาน 4', category: 'สติ', category_tags: ['สติ', 'ปัญญา'], content: 'พิจารณากาย ความรู้สึก จิต ธรรม — เห็นตามจริง ไม่ยึด', application: 'ใช้เวลาเจ็บป่วยเป็นโอกาสฝึกเห็นเวทนา', source: 'มหาสติปัฏฐานสูตร' },
    { id: 't2', title: 'อริยสัจ 4', category: 'ปัญญา', category_tags: ['เหตุผล'], content: 'รูปทุกข์ · ละสมุทัย · ทำนิโรธ · ปฏิบัติมรรค', application: 'ไล่หาเหตุของอาการ แล้วแก้ที่เหตุ ไม่ใช่แก้ที่ปลาย', source: 'ธัมมจักกัปปวัตนสูตร' },
    { id: 't3', title: 'อนัตตา — ปล่อยวาง', category: 'สติ', category_tags: ['วาง'], content: 'กายใจไม่ใช่เรา จึงไม่ทุกข์กับสิ่งที่เปลี่ยน', application: 'วางความกังวลเรื่องผลลัพธ์ ทำหน้าที่แล้วปล่อย', source: 'อนัตตลักขณสูตร' },
  ],
};
const healingHerbs = {
  herbs: [
    { name: 'ขมิ้นชัน', uses: ['ลดการอักเสบ', 'ช่วยย่อยอาหาร'], warnings: ['โรคนิ่วในถุงน้ำดี ควรปรึกษาแพทย์'], interactions: [] },
    { name: 'ฟ้าทะลายโจร', uses: ['บรรเทาเจ็บคอ', 'ต้านไวรัส'], warnings: ['ไม่ควรใช้ต่อเนื่องเกิน 8 สัปดาห์'], interactions: [{ med: 'ยาละลายลิ่มเลือด', severity: 'สูง', note: 'เพิ่มความเสี่ยงเลือดออก' }] },
    { name: 'ขิง', uses: ['แก้คลื่นไส้', 'ขับลม'], warnings: ['ความดันสูงบางราย'], interactions: [] },
  ],
};
const healingProgress = (days) => days > 1
  ? {
      progress: [
        { metric: 'stress', before: 6.4, after: 3.1, delta: -3.3, improving: true, samples: 42 },
        { metric: 'pain', before: 5.0, after: 2.8, delta: -2.2, improving: true, samples: 38 },
        { metric: 'meditation_min', before: 5, after: 28, delta: 23, improving: true, samples: 90 },
        { metric: 'sleep_hours', before: 5.2, after: 6.8, delta: 1.6, improving: true, samples: 60 },
      ],
      meditation: { total_min: 2520, sessions: 84 },
    }
  : { progress: [], meditation: { total_min: 25, sessions: 1 } };

// หน้าระบบอัตโนมัติ (atmo-power) — กฎตัวอย่าง + stateful เพื่อไล่ lifecycle จริง (toggle/สร้าง/ลบ)
const automationRules = [
  { id: 'r1', metric: 'battery_soc', condition: 'lt', threshold: 20, message: 'แบตเตอรี่ต่ำกว่า 20% — กรุณาตรวจสอบแผงโซลาร์', severity: 'critical', enabled: true, is_default: true },
  { id: 'r2', metric: 'power_kw_latest', condition: 'gt', threshold: 3, message: 'ใช้พลังงานสูงผิดปกติ (เกิน 3 kW)', severity: 'warning', enabled: true, is_default: false },
  { id: 'r3', metric: 'temp_c', condition: 'gt', threshold: 38, message: 'อุณหภูมิห้องเครื่องสูง', severity: 'warning', enabled: false, is_default: false },
];

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

// หน้าบันทึกตรวจสอบ (atmo-system) — log ตาม schema จริง {id,timestamp,action_type,payload,user}
const auditLogs = [
  { id: 'a1', timestamp: new Date().toISOString(), action_type: 'LOGIN', user: { username: 'preview' }, payload: { method: 'POST', path: '/api/login', statusCode: 200, ip: '192.168.1.10' } },
  { id: 'a2', timestamp: new Date().toISOString(), action_type: 'API_ACCESS', user: { username: 'preview' }, payload: { method: 'GET', path: '/api/energy/summary', statusCode: 200, ip: '192.168.1.10' } },
  { id: 'a3', timestamp: new Date().toISOString(), action_type: 'API_ACCESS', user: { username: 'preview' }, payload: { method: 'POST', path: '/api/automation/rules', statusCode: 201, ip: '192.168.1.10' } },
  { id: 'a4', timestamp: new Date().toISOString(), action_type: 'PASSWORD_CHANGE_ATTEMPT', user: { username: 'preview' }, payload: { method: 'DELETE', path: '/api/reports/x', statusCode: 403, ip: '203.0.113.7' } },
];

// หน้าสุขภาพระบบ (atmo-system) — health/processes/wan/sim ตาม schema จริง
const systemHealth = { uptime: '11 วัน 4 ชม.', cpuUsage: '23%', memory: '61%', disk: '48%' };
const systemProcesses = [
  { pid: 101, name: 'core-api (node)', mem: '182 MB' },
  { pid: 102, name: 'ollama (qwen3:8b)', mem: '6.1 GB' },
  { pid: 103, name: 'frontend (next)', mem: '310 MB' },
  { pid: 104, name: 'timescaledb', mem: '240 MB' },
  { pid: 105, name: 'mqtt-broker', mem: '48 MB' },
];
const systemWan = {
  up: true, latencyMs: 23, host: '1.1.1.1', lastCheck: new Date().toISOString(),
  router: { up: true, latencyMs: 3, since: new Date().toISOString() },
  lanDevices: [{ ip: '192.168.1.10', latencyMs: 2 }, { ip: '192.168.1.23', latencyMs: 9 }],
  lastSpeedtest: { mbps: 42.6, at: new Date().toISOString() },
  subnet: '192.168.1.0/24', routerHost: '192.168.1.1',
};
const systemSim = { loggedIn: true, signal: { rsrp: -92, sinr: 13, bars: 4 } };
// Client Health — โครงตาม ClientHealthSummary (arrays ว่าง = สถานะว่างที่สวย ไม่ crash)
const clientHealth = {
  days: 7, total: 0, webviewCount: 0,
  byBrowser: [], byPage: [], byKind: [], topErrors: [], daily: [],
};

const aiStatus = {
  ollamaOnline: true,
  ollamaUrl: 'http://127.0.0.1:11434',
  currentModel: 'qwen3:8b',
  models: [{ name: 'qwen3:8b', size: '5.2 GB' }, { name: 'llama3.2:3b', size: '2.0 GB' }],
  resources: { cpuCores: 8, cpuUsagePercent: 23, memoryTotalGb: 16, memoryFreeGb: 6.2, memoryUsedPercent: 61 },
};

// หน้า AI Agent — policy ตาม schema จริง (หน้าอ่าน .length ตรง ๆ ไม่มี guard)
const aiPolicy = {
  autonomy: 'suggest',
  approvalTtlMs: 300000,
  protectedIps: ['192.168.1.1'],
  protectedProcesses: ['core-api', 'timescaledb'],
  tools: [
    { name: 'getSystemStatus', kind: 'read', description: 'อ่านสถานะระบบและอุปกรณ์ทั่วบ้าน', available: true },
    { name: 'readAuditLog', kind: 'read', description: 'อ่านบันทึกการตรวจสอบย้อนหลัง', available: true },
    { name: 'blockIP', kind: 'action', description: 'บล็อก IP ที่มีพฤติกรรมน่าสงสัย', available: true },
    { name: 'killProcess', kind: 'action', description: 'หยุด process ที่กินทรัพยากรผิดปกติ', available: false },
  ],
};

// หน้าผู้ใช้ — ตาม schema {id,username,role,assigned_node_id}
const systemUsers = [
  { id: 'u1', username: 'preview', role: 'SUPERADMIN', assigned_node_id: null },
  { id: 'u2', username: 'member01', role: 'USER', assigned_node_id: null },
];

// ประวัติแชทจำลอง (ในหน่วยความจำ) — เก็บทั้งข้อความเข้า/ตอบ เพื่อพิสูจน์ Conversational Memory บน preview
const chatHistory = [];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

http
  .createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    const url = (req.url || '').split('?')[0];
    // ai/history — ประวัติสนทนาในหน่วยความจำ (GET = list, DELETE = ล้าง) — AiChatPanel โหลดตอนเปิดหน้า
    if (url === '/api/ai/history') {
      if (req.method === 'DELETE') {
        chatHistory.length = 0;
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        return res.end(JSON.stringify({ ok: true }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      return res.end(JSON.stringify({ history: chatHistory }));
    }
    // healing/companion + ai/chat — ตอบโทนตาม mbti ที่ client ส่ง (พิสูจน์ว่า backend ใช้ค่านี้จริง)
    if ((url === '/api/healing/companion' || url === '/api/ai/chat') && req.method === 'POST') {
      const b = await readJsonBody(req);
      const code = typeof b.mbti === 'string' && /^[IE][NS][TF][JP]$/i.test(b.mbti) ? b.mbti.toUpperCase() : null;
      const reply = code
        ? `[mock] ผมเห็นโค้ด "${code}" จาก request ของคุณ — โทนนี้คือโทนของ ${code} โดยเฉพาะ (ถ้าเปลี่ยนโค้ด ข้อความนี้จะเปลี่ยนตาม)`
        : '[mock] ไม่พบโค้ด MBTI ใน request — นี่คือการตอบแบบกลาง (ไม่มีการปรับโทน)';
      chatHistory.unshift(
        { id: `u${Date.now()}`, role: 'user', content: typeof b.message === 'string' ? b.message : '' },
        { id: `a${Date.now()}`, role: 'assistant', content: reply }
      );
      if (chatHistory.length > 100) chatHistory.length = 100;
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      return res.end(JSON.stringify(url === '/api/healing/companion' ? { reply, teaching: null } : { reply }));
    }
    // automation/rules — stateful: POST toggle/สร้าง, DELETE ลบ (พิสูจน์ lifecycle บนหน้าจริง)
    if (url === '/api/automation/rules') {
      if (req.method === 'POST') {
        const b = await readJsonBody(req);
        const rule = {
          id: `r${Date.now()}`,
          metric: b.metric || 'battery_soc',
          condition: b.condition || 'gt',
          threshold: Number(b.threshold) || 0,
          message: b.message || 'กฎใหม่',
          severity: b.severity || 'warning',
          enabled: b.enabled !== false,
          is_default: false,
        };
        automationRules.unshift(rule);
        res.writeHead(201, { 'Content-Type': 'application/json', ...CORS });
        return res.end(JSON.stringify(rule));
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      return res.end(JSON.stringify(automationRules));
    }
    if (url.startsWith('/api/audit')) {
      const q = (req.url || '').split('?')[1] || '';
      const params = new URLSearchParams(q);
      let rows = [...auditLogs];
      const qStr = params.get('q');
      if (qStr) rows = rows.filter((r) => `${r.action_type} ${r.payload?.path ?? ''}`.toLowerCase().includes(qStr.toLowerCase()));
      const pfx = params.get('actionPrefix');
      if (pfx) rows = rows.filter((r) => r.action_type.startsWith(pfx));
      const limit = Number(params.get('limit')) || 50;
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      return res.end(JSON.stringify(rows.slice(0, limit)));
    }
    const mToggle = url.match(/^\/api\/automation\/rules\/([^/]+)\/toggle$/);
    if (mToggle && req.method === 'POST') {
      const rule = automationRules.find((r) => r.id === mToggle[1]);
      if (rule) {
        const b = await readJsonBody(req);
        rule.enabled = typeof b.enabled === 'boolean' ? b.enabled : !rule.enabled;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      return res.end(JSON.stringify(rule ?? { ok: true }));
    }
    const mRule = url.match(/^\/api\/automation\/rules\/([^/]+)$/);
    if (mRule && req.method === 'PUT') {
      const rule = automationRules.find((r) => r.id === mRule[1]);
      if (rule) {
        const b = await readJsonBody(req);
        Object.assign(rule, {
          metric: b.metric ?? rule.metric,
          condition: b.condition ?? rule.condition,
          threshold: b.threshold !== undefined ? Number(b.threshold) : rule.threshold,
          message: b.message ?? rule.message,
          severity: b.severity ?? rule.severity,
          enabled: typeof b.enabled === 'boolean' ? b.enabled : rule.enabled,
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      return res.end(JSON.stringify(rule ?? { ok: true }));
    }
    if (mRule && req.method === 'DELETE') {
      const i = automationRules.findIndex((r) => r.id === mRule[1]);
      if (i >= 0) automationRules.splice(i, 1);
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      return res.end(JSON.stringify({ ok: true }));
    }
    // nextgen/kill-switch · first-responder · reality → 404 (หน้ามี guard แสดงสถานะว่างให้อยู่แล้ว)
    if (url.startsWith('/api/security/nextgen/')) {
      res.writeHead(404, { 'Content-Type': 'application/json', ...CORS });
      return res.end(JSON.stringify({ error: 'not available in theme preview' }));
    }
    let body = {};
    if (url === '/api/energy/summary') body = energySummary;
    else if (url === '/api/automation/rules') body = automationRules;
    else if (url.startsWith('/api/timescale/history')) body = [];
    else if (url === '/api/health/overview') body = healthOverview;
    else if (url.startsWith('/api/health/readings')) body = healthReadings;
    else if (url === '/api/security/connections') body = securityConnections;
    else if (url === '/api/security/events') body = securityEvents;
    else if (url === '/api/security/firewall') body = securityFirewall;
    else if (url.startsWith('/api/security/firewall/blocks')) body = securityBlocks;
    else if (url.startsWith('/api/treasury/overview')) body = treasuryData;
    else if (url.startsWith('/api/treasury/transfers')) body = treasuryTransfers;
    else if (url === '/api/system/health') body = systemHealth;
    else if (url === '/api/system/processes') body = systemProcesses;
    else if (url === '/api/system/wan/sim') body = systemSim;
    else if (url === '/api/system/wan') body = systemWan;
    else if (url.startsWith('/api/system/client-health')) body = clientHealth;
    else if (url === '/api/users') body = systemUsers;
    else if (url === '/api/ai/policy') body = aiPolicy;
    else if (url === '/api/ai/status') body = aiStatus;
    else if (url === '/api/restaurant/menus') body = menus;
    else if (url.startsWith('/api/restaurant/orders')) body = restaurantOrders;
    else if (url === '/api/farm/plots') body = farmPlots;
    else if (url.startsWith('/api/healing/teachings')) body = healingTeachings;
    else if (url.startsWith('/api/healing/herbs')) body = healingHerbs;
    else if (url.startsWith('/api/healing/progress')) {
      const days = Number((req.url || '').match(/days=(\d+)/)?.[1] ?? 90);
      body = healingProgress(days);
    }
    // endpoint อื่น ๆ → {} (หน้าส่วนใหญ่มี guard asArray/asObject รองรับ)
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify(body));
  })
  .listen(PORT, '127.0.0.1', () => console.log(`[mock-api] listening on http://127.0.0.1:${PORT}`));
