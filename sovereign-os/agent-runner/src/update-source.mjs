// src/update-source.mjs — เลือกแหล่งอัปเดต: HUB (ในวง) หรือ GitHub (ข้ามเมือง)
//
// เจ้าของเลือก 11/10/69: เครื่องที่ติดตั้งอยู่เน็ตเดียวกัน แต่ต้องพัฒนาจากระยะไกลได้
// ⇒ ต้องมีทางเลือก "ค" = GitHub Release คู่กับ HUB เดิม
//
// ลำดับการเลือก (เครื่องเดียวเลือกเองได้):
//   1) ถ้ามี HUB และตั้ง GITHUB_OTA=false → ใช้ HUB (เร็ว ไม่กินเน็ตนอก)
//   2) ถ้าตั้ง GITHUB_OTA=true → ลอง GitHub ก่อน ถ้าไม่สำเร็จค่อยตกไป HUB
//   3) ไม่มี HUB เลย → ใช้ GitHub อย่างเดียว
//
// ข้อสำคัญ: การ "มีอัปเดต" ของสองทางอาจไม่ตรงกัน (คนละเวอร์ชันกัน)
// ⇒ คืนผลของทางที่เลือกใช้จริง พร้อมบอกว่ามาจากไหน เพื่อให้คนอ่านรู้เรื่อง

import { selfUpdateOnce } from './selfUpdate.mjs';
import { checkRunnerUpdate } from './github-ota.mjs';

/** อ่านค่าตั้งจาก env (ไฟล์ .env ของเครื่องลูก) */
export function readOtaConfig(env = process.env) {
  return {
    // ทางเลือกค: true = ลอง GitHub ก่อน · false/undefined = ใช้ HUB เดิม
    githubOta: String(env.GITHUB_OTA ?? '').toLowerCase() === 'true',
    repo: env.GITHUB_OTA_REPO || 'krisakornutama/sovereign-origin',
    hubUrl: env.HUB_URL || '',
    token: env.MACHINE_TOKEN || '',
  };
}

/**
 * เช็คว่ามีอัปเดตไหม — ไม่แตะไฟล์ใด ๆ
 * @returns {{status, source, localVersion, remoteVersion, reason?}}
 */
export async function checkUpdate(opts = {}) {
  const cfg = { ...readOtaConfig(), ...opts };
  const { localVersion } = opts;
  const current = localVersion || opts.current || '0.0.0';

  // 1) GitHub ก่อน (เมื่อเปิดทางเลือกค หรือไม่มี HUB)
  if (cfg.githubOta || !cfg.hubUrl) {
    const r = await checkRunnerUpdate({ current, repo: cfg.repo, fetchImpl: opts.fetchImpl });
    if (r.ok) {
      return {
        status: r.hasUpdate ? 'update-available' : 'up-to-date',
        source: 'github',
        localVersion: current,
        remoteVersion: r.latest,
        assetUrl: r.assetUrl,
        expectedSha: r.expectedSha,
      };
    }
    // GitHub ใช้ไม่ได้ (ยังไม่มี release / เน็ตล่ม) → ถ้ามี HUB ลองต่อ
    if (cfg.hubUrl) {
      const hub = await checkViaHub(opts);
      return { ...hub, note: r.error ? `GitHub ใช้ไม่ได้ (${r.error}) — ใช้ HUB แทน` : undefined };
    }
    return { status: 'error', source: 'github', localVersion: current, remoteVersion: null, reason: r.error };
  }

  return checkViaHub(opts);
}

// เรียก HUB — คืนผลเป็น {status, reason} เสมอ ห้าม throw ออกไป
// (เคสจริง: HUB ดับ/เน็ตหลุด → ถ้า throw ตรงนี้ ตัวตั้งเวลาใน main.mjs จะพังทั้งรอบ
//  และเครื่องที่ควรอัปเดตจาก GitHub จะอัปเดตไม่ได้ด้วย)
async function checkViaHub(opts) {
  const cfg = { ...readOtaConfig(), ...opts };
  try {
    const r = await selfUpdateOnce({ ...opts, apply: false, restart: false, hubUrl: cfg.hubUrl, token: cfg.token });
    return { ...r, source: 'hub' };
  } catch (e) {
    return {
      status: 'error',
      source: 'hub',
      localVersion: null,
      remoteVersion: null,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * อัปเดตจริง
 * - ทาง HUB : ใช้ของเดิม (สลับไฟล์ทีละไฟล์ + rollback เมื่อสุขภาพไม่ผ่าน)
 * - ทาง GitHub: ดึง .zip มาแล้วตรวจ SHA-256 ก่อนแตกไฟล์ (fail-closed)
 *
 * @param onProgress รายงานความคืบหน้า (ไม่บังคับ)
 */
export async function performUpdate(opts = {}) {
  const cfg = { ...readOtaConfig(), ...opts };
  if (cfg.githubOta || !cfg.hubUrl) {
    const check = await checkUpdate({ ...opts, hubUrl: cfg.hubUrl, token: cfg.token });
    if (check.source !== 'github' || check.status !== 'update-available') {
      return { status: check.status, source: check.source, reason: check.reason || 'ไม่มีอัปเดตจาก GitHub' };
    }
    if (!opts.unpack) {
      // ยังไม่ได้ต่อตัวแตก .zip — บอกตรงๆ แทนที่จะทำอะไรเงียบๆ
      return {
        status: 'needs-unpack',
        source: 'github',
        remoteVersion: check.remoteVersion,
        assetUrl: check.assetUrl,
        expectedSha: check.expectedSha,
        reason: 'ต้องแตกไฟล์ .zip ก่อน — เรียก performUpdate({ unpack })',
      };
    }
    return opts.unpack({ ...check, cfg });
  }
  const r = await selfUpdateOnce({ ...opts, apply: true, restart: true, hubUrl: cfg.hubUrl, token: cfg.token });
  return { ...r, source: 'hub' };
}

export { checkRunnerUpdate };