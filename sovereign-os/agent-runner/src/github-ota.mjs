// src/github-ota.mjs — OTA ทางเลือก "ค": เครื่องลูกดึงชุดอัปเดตจาก GitHub Release
//
// ทำไมต้องมีทางเลือกนี้ (เจ้าของเลือก 11/10/69):
//   เดิมเครื่องลูกดึงจาก HUB ผ่าน http://192.168.x.x:3000 ⇒ ใช้ได้เฉพาะในวงเดียวกัน
//   แต่เครื่องที่จะเอาไปติดตั้งที่อื่นอยู่คนละเมือง ⇒ ต้องดึงผ่านอินเทอร์เน็ต
//   GitHub Release = สาธารณะ ถาวร ไม่ต้องเปิดพอร์ต HUB และไม่ต้องมี IP คงที่
//
// หลักการความปลอดภัย (เหมือนทุกเส้นทาง OTA อื่นของโปรเจกต์):
//   - ไม่เชื่อไฟล์ที่ดาวน์โหลดมาจนกว่าจะตรวจ SHA-256 ตรงกับที่ประกาศไว้
//   - ไม่มีลายเซ็นอ้างอิง = ไม่ติดตั้ง (fail-closed) — ไม่ใช่ "เดาไปก่อน"
//   - ไม่เขียนไฟล์ใด ๆ ในโมดูลนี้: คืนผลให้ชั้นบนตัดสินใจ (แยกหน้าที่ให้ทดสอบได้จริง)
//
// ทำไมเป็น .mjs ไม่ใช่ .ts: ไฟล์นี้ถูกใช้ทั้งจาก runner ฝั่งเครื่องลูก (Node ตรง ๆ)
// และฝั่ง HUB ที่ต้อง probe ได้ — ไม่ต้องผ่าน build

import { createHash } from 'node:crypto';

const DEFAULT_REPO = 'krisakornutama/sovereign-origin';
const RELEASE_API = 'https://api.github.com';

function headers(extra = {}) {
  return {
    'User-Agent': 'SovereignOS-OTA',
    Accept: 'application/vnd.github+json',
    ...extra,
  };
}

/** ตัวช่วยเรียก API — คืน null เมื่อ 404 (ยังไม่มี release = ยังไม่มีอะไรให้อัปเดต) */
async function apiGet(fetchImpl, url, { allow404 = true } = {}) {
  const res = await fetchImpl(url, { headers: headers() });
  if (res.status === 404 && allow404) return null;
  if (!res.ok) throw new Error(`GitHub API -> HTTP ${res.status} (${url})`);
  return await res.json();
}

/**
 * ถามว่ามีชุดอัปเดตใหม่ไหม
 * @returns {{ok, source:'github', latest, current, assetUrl, assetName, expectedSha, hasUpdate}}
 *          หรือ {ok:false, error} เมื่อติดต่อไม่ได้
 */
export async function checkGitHubUpdate({ current, repo = DEFAULT_REPO, fetchImpl = fetch }) {
  const out = {
    ok: false, source: 'github', latest: null, current,
    assetUrl: null, assetName: null, expectedSha: null, hasUpdate: false, error: null,
  };
  try {
    const rel = await apiGet(fetchImpl, `${RELEASE_API}/repos/${repo}/releases/latest`);
    if (!rel) {
      out.error = 'ยังไม่มี release ที่ประกาศไว้';
      return out;
    }
    out.ok = true;
    out.latest = String(rel.tag_name || '');
    const asset = (rel.assets || []).find((a) => /portable\.exe$/i.test(a.name)) || null;
    if (asset) {
      out.assetUrl = asset.browser_download_url;
      out.assetName = asset.name;
      // digest ของ GitHub = sha256 ที่เซอร์เวอร์คำนวณจากไฟล์ที่อัปโหลด (ไม่ใช่ผู้อัปโหลดกรอกเอง)
      const d = asset.digest ? String(asset.digest).replace(/^sha256:/, '').toLowerCase() : null;
      out.expectedSha = d && /^[0-9a-f]{64}$/.test(d) ? d : null;
    }
    out.hasUpdate = !!out.ok && !!out.latest && compareVersions(out.latest, current) > 0;
    return out;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    return out;
  }
}

/** เทียบเวอร์ชันแบบเชิงตัวเลข (1.10 > 1.9 — ห้ามเทียบเป็นสตริง) */
export function compareVersions(a, b) {
  const p = (s) => String(s ?? '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pa = p(a), pb = p(b);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

/**
 * ดึงไฟล์ตัวติดตั้ง + ตรวจแฮชก่อนคืน
 * @returns {ok:true, path, sha256} หรือ {ok:false, reason, error}
 *   reason: 'no-asset' | 'no-reference' | 'mismatch' | 'download-failed'
 */
export async function downloadAndVerify({
  assetUrl, expectedSha, destDir, fileName, repo = DEFAULT_REPO, fetchImpl = fetch, writeFile,
}) {
  if (!assetUrl) return { ok: false, reason: 'no-asset', error: 'ยังไม่มีไฟล์ติดตั้งใน release' };
  // ไม่มีลายเซ็นอ้างอิง = ไม่ติดตั้ง (fail-closed) — เหมือนทุกเส้นทาง OTA ของโปรเจกต์
  if (!expectedSha || !/^[0-9a-f]{64}$/.test(expectedSha)) {
    return { ok: false, reason: 'no-reference', error: 'release นี้ยังไม่มีแฮชอ้างอิง (digest) — ไม่ติดตั้งเพื่อความปลอดภัย' };
  }
  const path = `${destDir}/${fileName}`;
  try {
    const res = await fetchImpl(assetUrl, { headers: headers() });
    if (!res.ok) return { ok: false, reason: 'download-failed', error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    // กันบั๊กจริงที่เจอตอนเขียนเทสต์: ถ้าแฮชจาก ArrayBuffer ดิบ จะได้ขนาดเต็มของ
    // pooled buffer (ไฟล์ 3 ไบต์ → 8192) ⇒ แฮชไม่ตรงทั้งที่ไฟล์ถูกต้อง
    // แฮชจาก Buffer โดยตรง = นับเฉพาะไบต์ที่ใช้จริงเสมอ
    const actual = createHash('sha256').update(buf).digest('hex');
    if (actual !== expectedSha) {
      return { ok: false, reason: 'mismatch', error: 'แฮชไม่ตรงกับที่ release ประกาศไว้ — ยกเลิกการติดตั้ง' };
    }
    await writeFile(path, buf);
    return { ok: true, path, sha256: actual };
  } catch (e) {
    return { ok: false, reason: 'download-failed', error: e instanceof Error ? e.message : String(e) };
  }
}

/** ชุดติดตั้งชุดเล็กของเครื่องลูก (โค้ด agent-runner) — ไม่ใช่แอปเดสก์ท็อป */
export async function checkRunnerUpdate({ current, repo = DEFAULT_REPO, fetchImpl = fetch }) {
  const r = await checkGitHubUpdate({ current, repo, fetchImpl });
  // ชุดเล็กใช้ไฟล์ .tar.gz/.zip ไม่ใช่ portable.exe — เลือก asset ที่ตรงกับจริง
  if (r.ok) {
    const rel = await apiGet(fetchImpl, `${RELEASE_API}/repos/${repo}/releases/latest`);
    const pick = (rel?.assets || []).find((a) => /agent-runner.*\.(zip|tar\.gz)$/i.test(a.name));
    if (pick) {
      r.assetUrl = pick.browser_download_url;
      r.assetName = pick.name;
      const d = pick.digest ? String(pick.digest).replace(/^sha256:/, '').toLowerCase() : null;
      r.expectedSha = d && /^[0-9a-f]{64}$/.test(d) ? d : null;
    } else {
      r.ok = false;
      r.error = 'release นี้ยังไม่มีชุด agent-runner';
    }
  }
  return r;
}

export { DEFAULT_REPO, RELEASE_API };