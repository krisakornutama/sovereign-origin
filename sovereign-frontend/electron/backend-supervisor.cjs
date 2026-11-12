// sovereign-frontend/electron/backend-supervisor.cjs
// ─────────────────────────────────────────────────────────────────────────────
// ดูแล sidecar API ของแอปเดสก์ท็อป: "พอร์ตนี้เป็นของใคร" ก่อนจะ spawn
//
// เดิม: spawn PORT=3001 ตายตัว + stdio:'ignore' ⇒ ถ้าพอร์ตถูกยึด sidecar ตายเงียบ
// และแอปคุยกับเซิร์ฟเวอร์ของคนอื่น (เคสจริง: คอนเทนเนอร์ image เก่า ⇒ endpoint ใหม่ 404)
//
// ตอนนี้: probe /api/health ของพอร์ตเป้าหมาย → เทียบ build.version กับ package.json
// ที่ฝังมากับแอป · ว่าง = spawn · เป็นของเรา = ใช้ตัวที่รันอยู่ · ของคนอื่น = log ชัด ๆ
// แล้ว spawn บนพอร์ตว่างถัดไป (ไม่แย่งพอร์ตและไม่ใช้ API ที่ไม่ได้ควบคุม)
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const net = require('net');
const path = require('path');

const { evaluatePortOccupant, findFreePort, parseHealthVersion } = require('./backend-port.cjs');

const PREFERRED_PORT = 3001;
const FALLBACK_PORTS = [3011, 3012, 3013, 3014, 3015, 3016, 3017, 3018, 3019, 3020];

function probeHealth(http, port, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: port, path: '/api/health', timeout: timeoutMs || 800 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (body.length < 4096) body += chunk; });
      res.on('end', () => resolve({ listening: true, version: parseHealthVersion(body) }));
      res.on('error', () => resolve({ listening: true, version: null }));
    });
    // timeout = มีอะไรบางอย่างถือพอร์ตอยู่ แต่ตอบช้า → ห้ามถือว่า "ว่าง"
    req.on('timeout', () => { req.destroy(); resolve({ listening: true, version: null }); });
    req.on('error', () => resolve({ listening: false, version: null }));
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

function readBundledVersion(coreApiPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(coreApiPath)), 'package.json'), 'utf8'));
    const version = typeof pkg.version === 'string' ? pkg.version.trim() : '';
    return version || null;
  } catch {
    return null;
  }
}

async function superviseBackend(options) {
  const { app, http, spawn, dlog, onPort } = options || {};
  const log = typeof dlog === 'function' ? dlog : () => {};
  const result = { child: null, port: PREFERRED_PORT, verdict: 'unknown', bundledVersion: null };

  const coreApiPath = app.isPackaged
    ? path.join(process.resourcesPath, 'core-api/dist/server.js')
    : path.join(__dirname, '../../sovereign-os/core-api/dist/server.js');

  if (!fs.existsSync(coreApiPath)) {
    log('backend: ไม่มี dist ในตัว → ใช้ระบบหลัก (Docker/autostart)');
    return { ...result, verdict: 'no-sidecar' };
  }

  const bundledVersion = readBundledVersion(coreApiPath);
  const occupant = await probeHealth(http, PREFERRED_PORT);
  const verdict = evaluatePortOccupant({
    listening: occupant.listening,
    healthVersion: occupant.version,
    bundledVersion: bundledVersion,
  });
  log('backend: port=' + PREFERRED_PORT + ' verdict=' + verdict + ' occupant=' + (occupant.version || 'unknown') + ' bundled=' + (bundledVersion || 'unknown'));

  if (verdict === 'own-api') {
    log('backend: ใช้ API ที่รันอยู่แล้ว v' + occupant.version);
    return { ...result, port: PREFERRED_PORT, verdict: verdict, bundledVersion: bundledVersion };
  }

  let port = PREFERRED_PORT;
  if (verdict === 'foreign-api') {
    log('backend-port-conflict: :' + PREFERRED_PORT + ' ไม่ใช่ของแอปนี้ (occupant v' + (occupant.version || 'unknown') + ', แอป v' + (bundledVersion || 'unknown') + ')');
    port = await findFreePort({ candidates: FALLBACK_PORTS, isFree: isPortFree });
    if (!port) {
      log('backend-port-conflict: ไม่มีพอร์ตว่างใน ' + FALLBACK_PORTS[0] + '-' + FALLBACK_PORTS[FALLBACK_PORTS.length - 1] + ' → ไม่ spawn');
      return { ...result, verdict: verdict, bundledVersion: bundledVersion };
    }
    log('backend: spawn บนพอร์ตสำรอง ' + port);
  }

  if (typeof onPort === 'function') { try { onPort(port); } catch { /* ไม่ให้ log พังการ spawn */ } }
  const cwd = path.dirname(path.dirname(coreApiPath));
  const child = spawn('node', [coreApiPath], {
    env: {
      ...process.env,
      PORT: String(port),
      // ถ้าเครื่องแม่มี DATABASE_URL อยู่แล้ว อย่าทับ
      ...(process.env.DATABASE_URL ? {} : { DATABASE_URL: 'file:' + path.join(app.getPath('userData'), 'data.db') }),
    },
    stdio: 'ignore',
    cwd,
    detached: false,
  });
  child.on('error', (e) => log('backend spawn error ' + e.message));
  return { child: child, port: port, verdict: verdict, bundledVersion: bundledVersion };
}

exports.PREFERRED_PORT = PREFERRED_PORT;
exports.FALLBACK_PORTS = FALLBACK_PORTS;
exports.probeHealth = probeHealth;
exports.isPortFree = isPortFree;
exports.readBundledVersion = readBundledVersion;
exports.superviseBackend = superviseBackend;
