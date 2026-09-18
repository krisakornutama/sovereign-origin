// ─────────────────────────────────────────────────────────────
//  verify-asset — ด่านตรวจตัวติดตั้งที่ดาวน์โหลด ก่อนเปิดให้รัน
//  หลักการ fail-closed: ไม่มีลายเซ็นอ้างอิง / เทียบไม่ตรง / อ่านไฟล์ไม่ได้ = ไม่อนุมัติ
//  ลายเซ็นอ้างอิง 2 ทาง (ใช้ทางแรกที่หาได้):
//    1) digest จาก GitHub API ของ asset เอง (sha256:… — เซิร์ฟเวอร์คำนวณจากไฟล์ที่อัปโหลด)
//    2) ไฟล์ SHA256SUMS.txt ที่อัปโหลดคู่ release (มาตรฐาน "เช็คลิสต์ release" ใน runbook)
//  แกนตรวจ (verifyAssetWith) รับ fetcher/hash แทนของจริงได้ — เทสได้โดยไม่แตะเน็ต
// ─────────────────────────────────────────────────────────────
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('data', (d) => h.update(d));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

/** github.com/<owner>/<repo>/releases/download/<tag>/<name> → องค์ประกอบ (ไม่ตรง = null) */
function parseAssetUrl(assetUrl) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/.exec(String(assetUrl || ''));
  return m ? { owner: m[1], repo: m[2], tag: m[3], name: decodeURIComponent(m[4]) } : null;
}

function httpsText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('redirect ลึกเกินไป'));
    https.get(url, { headers: { 'User-Agent': 'SovereignOS-Desktop' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(httpsText(res.headers.location, redirects + 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('error', reject);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function httpsJson(url) { return httpsText(url).then((t) => JSON.parse(t)); }

/** บรรทัดมาตรฐาน `<64hex>  <ชื่อไฟล์>` (ยอมรับเครื่องหมาย binary `*` ด้วย) → hash ของชื่อนั้น หรือ null */
function expectedFromSums(text, name) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim());
    if (m && m[2] === name) return m[1].toLowerCase();
  }
  return null;
}

/** แกนตรวจ — คืน {ok, reason?, source?, expected?, actual?} และห้าม ok เมื่อสงสัย */
async function verifyAssetWith({ assetUrl, dest, getDigest, getSums, hashFile }) {
  const parsed = parseAssetUrl(assetUrl);
  if (!parsed) return { ok: false, reason: 'bad-asset-url' };
  const actual = (await hashFile(dest)).toLowerCase();
  const viaDigest = await getDigest(parsed);
  let source = null, expected = null;
  if (viaDigest) { source = 'github-digest'; expected = viaDigest; }
  else {
    const viaSums = await getSums(parsed);
    if (viaSums) { source = 'sha256sums'; expected = viaSums; }
  }
  if (!expected) return { ok: false, reason: 'no-reference', actual };
  if (!/^[0-9a-f]{64}$/.test(expected)) return { ok: false, reason: 'bad-reference', expected, actual };
  if (expected !== actual) return { ok: false, reason: 'mismatch', expected, actual };
  return { ok: true, source, expected, actual };
}

/** ของจริง — ดึงลายเซ็นอ้างอิงจาก GitHub (API digest ก่อน, SHA256SUMS.txt สำรอง) */
async function verifyAsset({ assetUrl, dest }) {
  const parsed = parseAssetUrl(assetUrl);
  if (!parsed) return { ok: false, reason: 'bad-asset-url' };
  const releaseApi = 'https://api.github.com/repos/' + parsed.owner + '/' + parsed.repo + '/releases/tags/' + parsed.tag;
  const releaseAssets = async () => {
    const rel = await httpsJson(releaseApi);
    return rel.assets || [];
  };
  const getDigest = async ({ name }) => {
    const a = (await releaseAssets()).find((x) => x.name === name);
    const d = a && a.digest ? String(a.digest).replace(/^sha256:/, '').toLowerCase() : null;
    return d && /^[0-9a-f]{64}$/.test(d) ? d : null;
  };
  const getSums = async ({ name }) => {
    const s = (await releaseAssets()).find((x) => /^SHA256SUMS(\.txt)?$/i.test(x.name));
    if (!s || !s.browser_download_url) return null;
    return expectedFromSums(await httpsText(s.browser_download_url), name);
  };
  return verifyAssetWith({ assetUrl, dest, getDigest, getSums, hashFile: sha256File });
}

module.exports = { verifyAsset, verifyAssetWith, sha256File, parseAssetUrl, expectedFromSums };
