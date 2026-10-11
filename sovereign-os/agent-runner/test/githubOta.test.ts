// test/githubOta.test.ts — OTA ทางเลือก "ค" (GitHub Release) เจ้าของเลือก 11/10/69
//
// จุดที่ต้องพิสูจน์:
//   - เครื่องที่อยู่คนละเมือง (ไม่มี IP ของ HUB) ดึงอัปเดตได้ ⇒ ต้องผ่านอินเทอร์เน็ต
//   - fail-closed: ไม่มีแฮชอ้างอิง = ไม่ติดตั้ง (ห้าม "เดาไปก่อน")
//   - แฮชไม่ตรง = ลบทิ้ง ไม่เขียนไฟล์
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  checkGitHubUpdate,
  checkRunnerUpdate,
  compareVersions,
  downloadAndVerify,
} from '../src/github-ota.mjs';

const SHA = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** fetch ปลอม — ตอบตาม URL ที่ขอ
 *  หมายเหตุ: arrayBuffer ต้องคืนเฉพาะไบต์ของข้อมูล (fetch ของจริงทำแบบนี้)
 *  ถ้าคืน .buffer ดิบจะได้ ArrayBuffer ขนาดเต็ม → แฮชไม่ตรง (เคสที่เจอตอนเขียน) */
function fakeFetch(routes: Record<string, { status?: number; json?: unknown; body?: Buffer }>) {
  return async (url: string) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    const r = routes[key];
    const body = r.body ?? Buffer.from('');
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.json ?? {},
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  };
}

const release = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v1.2.0',
  assets: [
    { name: 'Sovereign-OS-1.2.0-portable.exe', browser_download_url: 'https://x/1.2.0.exe', digest: `sha256:${SHA('app')}` },
  ],
  ...over,
});

describe('ตรวจอัปเดตจาก GitHub Release (ทำงานข้ามเมืองผ่านอินเทอร์เน็ต)', () => {
  it('เจอชุดใหม่ → บอกเวอร์ชัน + url + แฮชที่จะใช้ตรวจ', async () => {
    const r = await checkGitHubUpdate({ current: '1.1.1', fetchImpl: fakeFetch({ 'releases/latest': { json: release() } }) });
    assert.equal(r.ok, true);
    assert.equal(r.source, 'github');
    assert.equal(r.latest, 'v1.2.0');
    assert.equal(r.hasUpdate, true);
    assert.equal(r.expectedSha, SHA('app'), 'ต้องได้แฮชจาก digest ของ GitHub');
    assert.match(r.assetUrl, /1\.2\.0\.exe$/);
  });

  it('เวอร์ชันเท่ากัน → ไม่มีอัปเดต (ไม่ลงท้นดาวน์โหลดเกินจำเป็น)', async () => {
    const r = await checkGitHubUpdate({ current: '1.2.0', fetchImpl: fakeFetch({ 'releases/latest': { json: release() } }) });
    assert.equal(r.hasUpdate, false);
  });

  it('ยังไม่มี release → ok=false พร้อมบอกเหตุผล (ไม่ใช่ค้าง/ไม่ใช่ throw)', async () => {
    const r = await checkGitHubUpdate({ current: '1.0.0', fetchImpl: fakeFetch({}) });
    assert.equal(r.ok, false);
    assert.ok(r.error, 'ต้องบอกเหตุผล');
  });

  it('เครือข่ายล่ม → คืน error ไม่ throw (เครื่องลูกต้องรอรอบหน้า ไม่พัง)', async () => {
    const boom = async () => { throw new Error('ENOTFOUND'); };
    const r = await checkGitHubUpdate({ current: '1.0.0', fetchImpl: boom });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /ENOTFOUND/);
  });
});

describe('เทียบเวอร์ชัน', () => {
  it('เชิงตัวเลข ไม่ใช่สตริง', () => {
    assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
    assert.equal(compareVersions('1.1.1', '1.1.1'), 0);
    assert.equal(compareVersions('v2.0.0', '10.0.0'), -1);
  });
});

describe('ดาวน์โหลด + ตรวจแฮช (fail-closed)', () => {
  it('แฮชตรง → เขียนไฟล์และคืน path', async () => {
    const written: Record<string, Buffer> = {};
    const r = await downloadAndVerify({
      assetUrl: 'https://x/app.exe', expectedSha: SHA('app'), destDir: '/tmp', fileName: 'app.exe',
      fetchImpl: fakeFetch({ 'app.exe': { body: Buffer.from('app') } }),
      writeFile: async (p: string, b: Buffer) => { written[p] = b; },
    });
    assert.equal(r.ok, true);
    assert.equal(r.sha256, SHA('app'));
    assert.ok(written['/tmp/app.exe'], 'ต้องเขียนไฟล์จริง');
  });

  it('แฮชไม่ตรง → ไม่เขียนไฟล์เลย (กันติดตั้งของเสีย)', async () => {
    let wrote = false;
    const r = await downloadAndVerify({
      assetUrl: 'https://x/app.exe', expectedSha: SHA('ของอื่น'), destDir: '/tmp', fileName: 'app.exe',
      fetchImpl: fakeFetch({ 'app.exe': { body: Buffer.from('app') } }),
      writeFile: async () => { wrote = true; },
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'mismatch');
    assert.equal(wrote, false, 'ห้ามเขียนไฟล์ที่แฮชไม่ตรง');
  });

  it('ไม่มีแฮชอ้างอิง = ไม่ติดตั้ง แม้ไฟล์ดาวน์โหลดได้', async () => {
    let called = false;
    const r = await downloadAndVerify({
      assetUrl: 'https://x/app.exe', expectedSha: null, destDir: '/tmp', fileName: 'app.exe',
      fetchImpl: async () => { called = true; return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }; },
      writeFile: async () => { throw new Error('ไม่ควรถูกเรียก'); },
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no-reference');
    assert.equal(called, false, 'ต้องไม่ดาวน์โหลดด้วยซ้ำ เพราะจะไม่ผ่านอยู่ดี');
  });

  it('ไม่มีไฟล์ติดตั้งใน release → no-asset', async () => {
    const r = await downloadAndVerify({
      assetUrl: null, expectedSha: SHA('x'), destDir: '/tmp', fileName: 'a.exe',
      writeFile: async () => {},
    });
    assert.equal(r.reason, 'no-asset');
  });
});

describe('ชุดติดตั้งเครื่องลูก (agent-runner) ต่างจากแอปเดสก์ท็อป', () => {
  it('เลือกไฟล์ .zip ของ runner ไม่ใช่ .exe ของแอป', async () => {
    const r = await checkRunnerUpdate({
      current: '1.0.0',
      fetchImpl: fakeFetch({
        'releases/latest': {
          json: {
            tag_name: 'v1.3.0',
            assets: [
              { name: 'Sovereign-OS-1.3.0-portable.exe', browser_download_url: 'https://x/app.exe', digest: `sha256:${SHA('app')}` },
              { name: 'agent-runner-1.3.0.zip', browser_download_url: 'https://x/runner.zip', digest: `sha256:${SHA('runner')}` },
            ],
          },
        },
      }),
    });
    assert.equal(r.ok, true);
    assert.match(r.assetName, /agent-runner.*\.zip$/);
    assert.equal(r.expectedSha, SHA('runner'));
  });

  it('release ที่ยังไม่มีชุด runner → ok=false พร้อมเหตุผล', async () => {
    const r = await checkRunnerUpdate({ current: '1.0.0', fetchImpl: fakeFetch({ 'releases/latest': { json: release() } }) });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /agent-runner/);
  });
});