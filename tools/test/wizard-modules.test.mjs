#!/usr/bin/env node
/* ── หน้าจอเลือกฟังก์ชั่น + เครื่องแม่ (PACK-MACHINE.cmd) ──────────────────────────
   เจ้าของสั่ง 25/10/69: "ให้เลือกฟังก์ชั่นที่จะติดตั้ง เช่น IOT ระบบเลี้ยงดูลูก
   พอติดตั้งเสร็จ ระบบจะขึ้นข้อมูลในเครื่องเลยว่าเครื่องนี้เป็นลูกของเครื่องไหน"

   เทสต์ชุดนี้ล็อก "คำถาม–คำตอบ" ของหน้าจอ (ไม่ต้องมี terminal จริง):
   1) Enter ที่ช่องฟังก์ชั่น = ชุดที่แนะนำ (ไม่ใช่ไม่มีอะไรเลย)
   2) พิมพ์ผิด = ถามซ้ำ ไม่ใช่ติดตั้งด้วยของที่พิมพ์ผิด
   3) ไม่ระบุเครื่องแม่ = ไม่ผูก และไม่ถามซ้ำ superfluous
   4) ระบุเครื่องแม่ = ถามว่าจะให้คุมได้ทันทีหรือไม่ แล้วส่งค่าต่อครบ
   5) โหมด --yes = ไม่ถามอะไรเลย และไม่เดาเครื่องแม่ให้เอง
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWizard } from '../agent-pack/pack-machine.mjs';
import { recommendedIds } from '../agent-pack/modules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_ROOT = path.join(ROOT, '.freebuff', 'tmp', 'wizard-modules');

function scripted(answers) {
  const queue = [...answers];
  const ask = async () => {
    if (!queue.length) throw new Error('คำถามเกินกว่าที่เตรียมคำตอบไว้');
    return queue.shift();
  };
  ask.left = () => queue.length;
  return ask;
}

function okPack(calls) {
  return async (opts) => {
    calls.push(opts);
    return { exitCode: 0, code: 'ok', report: '', bundleDir: opts.outDir };
  };
}

const wizard = (over = {}) =>
  runWizard({
    hostname: 'HUB-PC',
    hubUrl: 'http://192.168.1.101:3000',
    outRoot: OUT_ROOT,
    presetName: 'เครื่องที่-4',
    withOllama: false,
    pack: okPack([]),
    openFolder: () => {},
    log: () => {},
    ...over,
  });

describe('เลือกฟังก์ชั่น', () => {
  test('Enter = ชุดที่แนะนำ (ไม่ใช่ชุดว่าง)', async () => {
    const calls = [];
    const res = await wizard({ ask: scripted(['', '', 'y']), pack: okPack(calls) });
    assert.equal(res.exitCode, 0);
    assert.deepEqual(calls[0].modules, recommendedIds());
    assert.ok(calls[0].modules.length >= 3);
  });

  test('พิมพ์ชื่อรหัส = ส่งเฉพาะที่เลือก (+ core ที่บังคับ)', async () => {
    const calls = [];
    await wizard({ ask: scripted(['iot,kids', '', 'y']), pack: okPack(calls) });
    assert.deepEqual(calls[0].modules, ['core', 'iot', 'kids']);
  });

  test('พิมพ์ผิด = ถามซ้ำ แล้วใช้ค่าที่ถูก', async () => {
    const calls = [];
    const logs = [];
    await wizard({
      ask: scripted(['ยานอวกาศ', 'iot', '', 'y']),
      pack: okPack(calls),
      log: (m) => logs.push(m),
    });
    assert.deepEqual(calls[0].modules, ['core', 'iot']);
    assert.match(logs.join('\n'), /ไม่รู้จัก/, 'ต้องบอกว่าพิมพ์อะไรผิด');
  });

  test('ตัวเลขก็ได้', async () => {
    const calls = [];
    await wizard({ ask: scripted(['1,2', '', 'y']), pack: okPack(calls) });
    assert.deepEqual(calls[0].modules, ['core', 'iot']);
  });

  test('--modules ที่ผิดรูป = หยุดก่อนแตะ DB (exit 1 + bad_modules)', async () => {
    const calls = [];
    const res = await wizard({ presetModules: 'ไม่มีอันนี้', pack: okPack(calls), assumeYes: true, ask: scripted([]) });
    assert.equal(res.exitCode, 1);
    assert.equal(res.code, 'bad_modules');
    assert.equal(calls.length, 0);
  });
});

describe('เครื่องแม่ (เจ้าของเครื่องนี้)', () => {
  test('ไม่ระบุ (-) = ไม่ผูก และไม่ถามว่าจะคุมทันทีไหม', async () => {
    const calls = [];
    const ask = scripted(['', '-', 'y']);
    const res = await wizard({ ask, pack: okPack(calls) });
    assert.equal(res.exitCode, 0);
    assert.equal(calls[0].owner, '');
    assert.equal(calls[0].confirmLan, false);
    assert.equal(ask.left(), 0, 'ต้องไม่ถามเกิน');
  });

  test('ระบุชื่อ + ตอบใช่ = ผูกและคุมได้ทันที', async () => {
    const calls = [];
    await wizard({ ask: scripted(['', 'krisakorn', 'y', 'y']), pack: okPack(calls) });
    assert.equal(calls[0].owner, 'krisakorn');
    assert.equal(calls[0].confirmLan, true);
  });

  test('ระบุชื่อ + ตอบไม่ = ผูกแต่รอผู้ใช้กดยืนยันบนเครื่องลูก', async () => {
    const calls = [];
    await wizard({ ask: scripted(['', 'krisakorn', 'n', 'y']), pack: okPack(calls) });
    assert.equal(calls[0].owner, 'krisakorn');
    assert.equal(calls[0].confirmLan, false);
  });

  test('หน้าจอยืนยันบอกเครื่องแม่ + ฟังก์ชั่น ก่อนลงมือ', async () => {
    const logs = [];
    await wizard({
      ask: scripted(['iot', 'krisakorn', 'y', 'y']),
      pack: okPack([]),
      log: (m) => logs.push(m),
    });
    const text = logs.join('\n');
    assert.match(text, /krisakorn/);
    assert.match(text, /คุมได้ทันที/);
    assert.match(text, /IoT/);
    assert.match(text, /เลี้ยงดูลูก|ระบบหลัก/, 'ต้องเห็นรายการฟังก์ชั่นที่เลือก');
  });

  test('Enter ที่ช่องเครื่องแม่ = ใช้ SOVEREIGN_OWNER ถ้าตั้งไว้', async () => {
    const before = process.env.SOVEREIGN_OWNER;
    process.env.SOVEREIGN_OWNER = 'krisakorn';
    try {
      const calls = [];
      await wizard({ ask: scripted(['', '', 'y', 'y']), pack: okPack(calls) });
      assert.equal(calls[0].owner, 'krisakorn');
      assert.equal(calls[0].confirmLan, true);
    } finally {
      if (before === undefined) delete process.env.SOVEREIGN_OWNER;
      else process.env.SOVEREIGN_OWNER = before;
    }
  });
});

describe('โหมดไม่ถาม (--yes)', () => {
  test('ไม่ถามอะไรเลย และไม่เดาเครื่องแม่ให้เอง', async () => {
    const calls = [];
    const res = await runWizard({
      ask: async () => {
        throw new Error('โหมด --yes ต้องไม่ถาม');
      },
      presetName: 'เครื่องที่-9',
      assumeYes: true,
      outRoot: OUT_ROOT,
      hubUrl: 'http://192.168.1.101:3000',
      pack: okPack(calls),
      openFolder: () => {},
      log: () => {},
    });
    assert.equal(res.exitCode, 0);
    assert.equal(calls[0].owner, '');
    assert.equal(calls[0].confirmLan, false);
    assert.deepEqual(calls[0].modules, recommendedIds());
  });

  test('--owner + --confirm-lan ผ่านมาแล้ว = ใช้ตามนั้น', async () => {
    const calls = [];
    await runWizard({
      ask: async () => {
        throw new Error('ห้ามถาม');
      },
      presetName: 'เครื่องที่-9',
      presetOwner: 'krisakorn',
      confirmLan: true,
      presetModules: 'iot',
      assumeYes: true,
      outRoot: OUT_ROOT,
      hubUrl: 'http://192.168.1.101:3000',
      pack: okPack(calls),
      openFolder: () => {},
      log: () => {},
    });
    assert.equal(calls[0].owner, 'krisakorn');
    assert.equal(calls[0].confirmLan, true);
    assert.deepEqual(calls[0].modules, ['core', 'iot']);
  });
});
