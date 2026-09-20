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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    const url = (req.url || '').split('?')[0];
    // nextgen/kill-switch · first-responder · reality → 404 (หน้ามี guard แสดงสถานะว่างให้อยู่แล้ว)
    if (url.startsWith('/api/security/nextgen/')) {
      res.writeHead(404, { 'Content-Type': 'application/json', ...CORS });
      return res.end(JSON.stringify({ error: 'not available in theme preview' }));
    }
    let body = {};
    if (url === '/api/energy/summary') body = energySummary;
    else if (url.startsWith('/api/timescale/history')) body = [];
    else if (url === '/api/health/overview') body = healthOverview;
    else if (url.startsWith('/api/health/readings')) body = healthReadings;
    else if (url === '/api/security/connections') body = securityConnections;
    else if (url === '/api/security/events') body = securityEvents;
    else if (url === '/api/security/firewall') body = securityFirewall;
    else if (url.startsWith('/api/security/firewall/blocks')) body = securityBlocks;
    else if (url.startsWith('/api/treasury/overview')) body = treasuryData;
    else if (url.startsWith('/api/treasury/transfers')) body = treasuryTransfers;
    else if (url === '/api/restaurant/menus') body = menus;
    else if (url.startsWith('/api/restaurant/orders')) body = restaurantOrders;
    // endpoint อื่น ๆ → {} (หน้าส่วนใหญ่มี guard asArray/asObject รองรับ)
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify(body));
  })
  .listen(PORT, '127.0.0.1', () => console.log(`[mock-api] listening on http://127.0.0.1:${PORT}`));
