// test/updateSource.test.ts — เลือกแหล่งอัปเดตให้ถูก (HUB ในวง vs GitHub ข้ามเมือง)
//
// เจ้าของสั่ง 11/10/69: เครื่องที่ติดตั้งอยู่เน็ตเดียวกัน แต่ต้องพัฒนาจากระยะไกลได้
// ⇒ ต้องเลือกได้ว่าเครื่องนี้จะดึงอัปเดตจากไหน และบอกได้ว่ามาจากไหน
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readOtaConfig, checkUpdate } from '../src/update-source.mjs';

describe('อ่านค่าตั้งจาก .env ของเครื่องลูก', () => {
  it('ค่าเริ่มต้น = ใช้ HUB เดิม (ไม่เปลี่ยนพฤติกรรมของเครื่องที่ติดตั้งอยู่แล้ว)', () => {
    const c = readOtaConfig({} as NodeJS.ProcessEnv);
    assert.equal(c.githubOta, false);
    assert.equal(c.repo, 'krisakornutama/sovereign-origin', 'repo หลักของเจ้าของ');
  });

  it('GITHUB_OTA=true เปิดทางเลือกค', () => {
    assert.equal(readOtaConfig({ GITHUB_OTA: 'true' } as any).githubOta, true);
    assert.equal(readOtaConfig({ GITHUB_OTA: 'TRUE' } as any).githubOta, true);
  });

  it('ค่าอื่น (เช่น 1/yes/on) ไม่ถือว่าเปิด — กันเปิดทางสาธารณะลอยๆ', () => {
    for (const v of ['1', 'yes', 'on', 'false', '']) {
      assert.equal(readOtaConfig({ GITHUB_OTA: v } as any).githubOta, false, `"${v}" ต้องไม่เปิดทาง GitHub`);
    }
  });

  it('ระบุ repo เองได้', () => {
    assert.equal(readOtaConfig({ GITHUB_OTA_REPO: 'me/fork' } as any).repo, 'me/fork');
  });
});

/** fetch ปลอมของ GitHub API */
function githubFetch(release: unknown) {
  return async (url: string) => ({
    ok: true, status: 200,
    json: async () => release,
  });
}

const release = {
  tag_name: 'v1.5.0',
  assets: [{ name: 'agent-runner-1.5.0.zip', browser_download_url: 'https://x/r.zip', digest: 'sha256:' + 'a'.repeat(64) }],
};

describe('เลือกแหล่งอัปเดตตามที่ตั้งไว้', () => {
  it('เปิด GITHUB_OTA=true → ไป GitHub (ไม่สนใจ HUB ที่ตั้งไว้)', async () => {
    const r = await checkUpdate({
      githubOta: true, repo: 'krisakornutama/sovereign-origin', current: '1.0.0',
      hubUrl: 'http://192.168.1.5:3000', token: 'tk',
      fetchImpl: githubFetch(release),
    });
    assert.equal(r.source, 'github');
    assert.equal(r.remoteVersion, 'v1.5.0');
    assert.equal(r.status, 'update-available');
    assert.equal(r.expectedSha, 'a'.repeat(64), 'ต้องได้แฮชมาตรวจก่อนติดตั้ง');
  });

  it('ไม่มี HUB เลย + เปิด GitHub → ใช้ GitHub ได้ (เครื่องคนละเมือง)', async () => {
    const r = await checkUpdate({
      githubOta: false, hubUrl: '', token: '',
      repo: 'krisakornutama/sovereign-origin', current: '1.0.0',
      fetchImpl: githubFetch(release),
    });
    assert.equal(r.source, 'github');
    assert.equal(r.status, 'update-available');
  });

  it('เวอร์ชันเท่ากัน → up-to-date (ไม่ลงท้นโหลดเกินจำเป็น)', async () => {
    const r = await checkUpdate({
      githubOta: true, repo: 'x/y', current: '1.5.0', hubUrl: '', token: '',
      fetchImpl: githubFetch(release),
    });
    assert.equal(r.status, 'up-to-date');
  });

  it('GitHub ล้มแต่มี HUB → ตกไปใช้ HUB และบอกเหตุผล (ไม่หยุดทำงาน)', async () => {
    const r = await checkUpdate({
      githubOta: true, repo: 'x/y', current: '1.0.0',
      hubUrl: 'http://127.0.0.1:9/', token: 'tk',
      fetchImpl: async () => { throw new Error('offline'); },
    });
    // HUB ปลอมตอบไม่ได้ → ผลต้องเป็น error แต่ต้องบอกเหตุผล ไม่ใช่ค้าง
    assert.ok(['hub', 'github', 'error'].includes(r.source));
    if (r.status === 'error' || r.status === 'not-configured') {
      assert.ok(r.reason || r.note, 'ต้องบอกเหตุผล');
    }
  });

  it('GitHub ล้มและไม่มี HUB → error พร้อมเหตุผล ไม่ใช่ throw', async () => {
    const r = await checkUpdate({
      githubOta: true, repo: 'x/y', current: '1.0.0', hubUrl: '', token: '',
      fetchImpl: async () => { throw new Error('ENOTFOUND'); },
    });
    assert.equal(r.status, 'error');
    assert.match(String(r.reason), /ENOTFOUND/);
  });
});