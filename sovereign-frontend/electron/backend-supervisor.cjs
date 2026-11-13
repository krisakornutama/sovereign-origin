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
const { loadOrCreateJwtSecret } = require('./backend-secret.cjs');

const PREFERRED_PORT = 3001;
const FALLBACK_PORTS = [3011, 3012, 3013, 3014, 3015, 3016, 3017, 3018, 3019, 3020];
const STDERR_TAIL_LINES = 12;
const STDERR_LINE_MAX = 300;

/** เก็บ stderr ของ sidecar ไว้เป็นก้อนสุดท้าย — พอให้เห็นสาเหตุโดยไม่บวม log */
function tailStderr(stream, log) {
  const lines = [];
  let rest = '';
  const push = (line) => {
    const clean = String(line).replace(/\s+$/, '').slice(0, STDERR_LINE_MAX);
    if (!clean) return;
    lines.push(clean);
    if (lines.length > STDERR_TAIL_LINES) lines.shift();
  };
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    rest += chunk;
    const parts = rest.split(/\r?\n/);
    rest = parts.pop();
    for (const part of parts) push(part);
  });
  stream.on('error', () => {});
  return {
    /** sidecar อาจตายก่อน 'data' ถูกส่ง — ต้องกวาดบัฟเฟอร์ที่ค้างอยู่ออกมาก่อน */
    drain() {
      let chunk = null;
      while ((chunk = stream.read()) !== null) {
        rest += String(chunk);
        const parts = rest.split(/\r?\n/);
        rest = parts.pop();
        for (const part of parts) push(part);
      }
      this.flush();
    },
    flush() {
      if (rest) { push(rest); rest = ''; }
      for (const line of lines) log('backend stderr: ' + line);
    },
  };
}

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
  const { app, http, spawn, dlog, onPort, probe, env } = options || {};
  const log = typeof dlog === 'function' ? dlog : () => {};
  const result = { child: null, port: PREFERRED_PORT, verdict: 'unknown', bundledVersion: null, jwtSecret: null };

  const coreApiPath = app.isPackaged
    ? path.join(process.resourcesPath, 'core-api/dist/server.js')
    : path.join(__dirname, '../../sovereign-os/core-api/dist/server.js');

  if (!fs.existsSync(coreApiPath)) {
    log('backend: ไม่มี dist ในตัว → ใช้ระบบหลัก (Docker/autostart)');
    return { ...result, verdict: 'no-sidecar' };
  }

  const bundledVersion = readBundledVersion(coreApiPath);
  const probePort = typeof probe === 'function' ? probe : (port) => probeHealth(http, port);
  const occupant = await probePort(PREFERRED_PORT);
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

  // sidecar ตายทันทีถ้าไม่มี JWT_SECRET ⇒ เตรียมให้ก่อน spawn (ค่าไม่ถูก log)
  const baseEnv = env || process.env;
  const jwt = loadOrCreateJwtSecret({
    dir: app.getPath('userData'),
    envSecret: baseEnv.JWT_SECRET,
  });
  if (jwt.error) log('backend-secret: เก็บ secret ลงดิสก์ไม่ได้ (' + jwt.error + ') — ใช้ค่าในหน่วยความจำรอบนี้');
  else if (jwt.created) log('backend-secret: สร้าง JWT_SECRET ใหม่ให้เครื่องนี้ (' + jwt.source + ')');

  const child = spawn('node', [coreApiPath], {
    env: {
      ...baseEnv,
      JWT_SECRET: jwt.secret,
      PORT: String(port),
      // ถ้าเครื่องแม่มี DATABASE_URL อยู่แล้ว อย่าทับ
      ...(baseEnv.DATABASE_URL ? {} : { DATABASE_URL: 'file:' + path.join(app.getPath('userData'), 'data.db') }),
    },
    // stderr ต้องถูกอ่าน: sidecar ที่ตายเงียบคือปัญหาที่ตามหาไม่เจอ (DESKTOP-002)
    stdio: ['ignore', 'ignore', 'pipe'],
    cwd,
    detached: false,
  });
  child.on('error', (e) => log('backend spawn error ' + e.message));
  if (child.stderr) {
    const tail = tailStderr(child.stderr, log);
    child.on('exit', (code, signal) => {
      log('backend exit code=' + code + ' signal=' + (signal || 'none') + ' port=' + port);
      tail.drain();
    });
  } else {
    child.on('exit', (code, signal) => log('backend exit code=' + code + ' signal=' + (signal || 'none') + ' port=' + port));
  }
  return { child: child, port: port, verdict: verdict, bundledVersion: bundledVersion, jwtSecret: jwt.secret };
}

exports.PREFERRED_PORT = PREFERRED_PORT;
exports.FALLBACK_PORTS = FALLBACK_PORTS;
exports.probeHealth = probeHealth;
exports.isPortFree = isPortFree;
exports.readBundledVersion = readBundledVersion;
exports.superviseBackend = superviseBackend;
