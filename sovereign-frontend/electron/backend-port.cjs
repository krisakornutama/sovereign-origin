// sovereign-frontend/electron/backend-port.cjs
// ─────────────────────────────────────────────────────────────────────────────
// ตัดสินว่า "พอร์ตที่ sidecar จะใช้" ว่าง / เป็น API ของแอปเรา / เป็นของคนอื่น
//
// เคสจริง 12/11/69: sidecar spawn ด้วย PORT=3001 ตายตัว + stdio:'ignore'
// คอนเทนเนอร์ Docker (image เก่า, up 24 ชม.) ยึด 3001 อยู่ ⇒ sidecar ตายเงียบ
// และแอป v1.3.2 คุยกับ API รุ่นเก่า (/api/ota/legacy-clients = 404) โดยไม่มีสัญญาณ
//
// กติกา: "พิสูจน์ไม่ได้ว่าเป็นของเรา" = ถือว่าเป็นของคนอื่น (ห้ามเดา) เพราะการเดาผิด
// หมายถึงผู้ใช้เห็นข้อมูล/พฤติกรรมจากเซิร์ฟเวอร์ที่เราไม่ได้ควบคุม
// ─────────────────────────────────────────────────────────────────────────────

/** อ่าน version จาก payload ของ GET /api/health — เพี้ยน/ไม่มี = null (ไม่โยน) */
function parseHealthVersion(input) {
  if (input === null || input === undefined) return null;
  var payload = input;
  if (typeof input === 'string') {
    var text = input.trim();
    if (!text) return null;
    try {
      payload = JSON.parse(text);
    } catch {
      return null;
    }
  }
  var version = payload && payload.build ? payload.build.version : undefined;
  if (typeof version !== 'string') return null;
  var trimmed = version.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 'free' | 'own-api' | 'foreign-api' */
function evaluatePortOccupant(options) {
  var listening = Boolean(options && options.listening);
  if (!listening) return 'free';

  var bundled = typeof (options && options.bundledVersion) === 'string' ? options.bundledVersion.trim() : '';
  var health = typeof (options && options.healthVersion) === 'string' ? options.healthVersion.trim() : '';

  if (bundled && health && bundled === health) return 'own-api';
  return 'foreign-api';
}

/** เลือกพอร์ตว่างตัวแรกตามลำดับ — คืน null ถ้าเต็มช่วง */
async function findFreePort(options) {
  var candidates = (options && options.candidates) || [];
  var isFree = options && options.isFree;
  if (typeof isFree !== 'function') throw new TypeError('findFreePort ต้องมี isFree(port)');
  for (var i = 0; i < candidates.length; i++) {
    if (await isFree(candidates[i])) return candidates[i];
  }
  return null;
}

exports.parseHealthVersion = parseHealthVersion;
exports.evaluatePortOccupant = evaluatePortOccupant;
exports.findFreePort = findFreePort;

/**
 * URL ของ API ที่ renderer ควรใช้ — 3001 คือค่าเริ่มต้น ⇒ null (ต้อง "ล้าง" key ทิ้ง)
 *
 * ปัญหาที่กัน: key `sovereign-api-url` ถูกเขียนครั้งเดียวตอนแอปหันไปพอร์ตสำรองแล้ว
 * ไม่มีใครล้าง ⇒ รอบถัดไปที่แอปกลับไปใช้ 3001 (หรือไม่ spawn sidecar เลย)
 * renderer ยังชี้ไปที่ http://localhost:3011 ที่ไม่มีอะไรฟังอยู่
 */
function apiUrlFor(port) {
  if (!Number.isInteger(port) || port === 3001) return null;
  return 'http://localhost:' + port;
}

/** เขียน/ล้าง key ให้ตรงกับพอร์ตที่ใช้จริง (target = win.webContents) */
function applyApiUrl(target, port) {
  if (!target || typeof target.executeJavaScript !== 'function') return Promise.resolve();
  var url = apiUrlFor(port);
  var js = url
    ? "localStorage.setItem('sovereign-api-url','" + url + "')"
    : "localStorage.removeItem('sovereign-api-url')";
  try {
    return Promise.resolve(target.executeJavaScript(js)).catch(function () {});
  } catch (e) {
    return Promise.resolve();
  }
}

exports.apiUrlFor = apiUrlFor;
exports.applyApiUrl = applyApiUrl;
