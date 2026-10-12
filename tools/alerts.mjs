#!/usr/bin/env node
/* ── สวิตช์เปิด/ปิดการแจ้งเตือน Telegram ──────────────────────────────────
   เจ้าของสั่ง 12/10/69:
     "alert ใน telegram ก็อย่าพึ่งให้ทำงานพื้นหลังก็ได้ มีปุ่มเปิด-ปิดด้วยมั้ย
      ผมรู้ว่ามันทำงานได้ แต่การส่งข้อมูลหลาย ๆ อย่างโดยที่ยังไม่ได้จริง บางทีมันก็รก"

   ค่าเริ่มต้น = ปิด แต่ "ยังตรวจสุขภาพอยู่เหมือนเดิม" และยังจดประวัติไว้ครบ
   เปิดกลับเมื่อไหร่ก็ได้ด้วยคำสั่งเดียว ไม่ต้องแก้โค้ด

   ใช้:
     node tools/alerts.mjs            ดูสถานะ
     node tools/alerts.mjs on         เปิด
     node tools/alerts.mjs off        ปิด
     node tools/alerts.mjs critical   เปิด + ส่งเฉพาะวิกฤต (ค่าแนะนำ)
     node tools/alerts.mjs warn       เปิด + ส่งทั้งวิกฤตและเตือน
     node tools/alerts.mjs cooldown 30  เปลี่ยนเวลาส่งซ้ำ (นาที)
*/
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readConfig, writeConfig, describe, LEVELS, DEFAULTS, CONFIG_PATH,
} from './machine-alert.config.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function say(...m) { console.log(...m); }

function showHelp() {
  say('');
  say('  การแจ้งเตือน Telegram');
  say('  ------------------------------------------------');
  say('  node tools/alerts.mjs             ดูสถานะ');
  say('  node tools/alerts.mjs now         สั่งตรวจ+ส่ง 1 ครั้งเดี๋ยวนี้  ← ใช้ปกติ');
  say('  node tools/alerts.mjs on          เปิดให้งานตั้งเวลาส่งเอง');
  say('  node tools/alerts.mjs off         ปิดการส่งอัตโนมัติ');
  say(`  node tools/alerts.mjs critical    เปิด + ส่งเฉพาะวิกฤต (${LEVELS.slice(1).join(', ')} ไม่ส่ง)`);
  say('  node tools/alerts.mjs warn        เปิด + ส่งวิกฤตและเตือน');
  say('  node tools/alerts.mjs cooldown 30 เปลี่ยนเวลาส่งซ้ำ (นาที, 0 = ไม่ส่งซ้ำ)');
  say('');
  say('  หมายเหตุ: งานตั้งเวลาทุก 10 นาทียัง "ตรวจ" สุขภาพอยู่ (หน้า /system-health ใช้)');
  say('          แต่จะไม่ "ส่ง" จนกว่าจะสั่ง now หรือเปิดสวิตช์');
  say('');
}

async function test() {
  say('  กำลังลองส่งข้อความทดสอบ ...');
  const r = await import('./machine-alert.mjs').catch(() => null);
  void r;
  const { spawnSync } = await import('node:child_process');
  const res = spawnSync('node', [path.join(ROOT, 'tools', 'machine-alert.mjs'), '--dry'], {
    encoding: 'utf8', windowsHide: true, cwd: ROOT, timeout: 120_000,
  });
  say((res.stdout || res.stderr || '').trim().split('\n').slice(-12).join('\n'));
  say('');
  say('  หมายเหตุ: --dry จะไม่ส่งจริง ถ้าต้องการส่งจริงให้เปิดสวิตช์ก่อน');
}

export async function main(argv = process.argv.slice(2)) {
  const cmd = (argv[0] ?? '').toLowerCase();

  if (!cmd || cmd === 'status') {
    say('');
    say('  การแจ้งเตือน Telegram');
    say('  ------------------------------------------------');
    say('  ' + describe().split('\n').join('\n  '));
    say('');
    return 0;
  }
  if (cmd === 'help' || cmd === '-h' || cmd === '--help') { showHelp(); return 0; }
  if (cmd === 'test') { await test(); return 0; }

  if (cmd === 'now') {
    // สั่งส่งจริง 1 ครั้ง — ไม่ต้องเปิดสวิตช์ถาวร ไม่งั้นงานตั้งเวลาจะเริ่มยิงเองอีก
    say('  สั่งตรวจ + ส่ง Telegram 1 ครั้ง (ไม่เปิดสวิตช์ถาวร) ...');
    say('');
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync('node', [path.join(ROOT, 'tools', 'machine-alert.mjs'), '--send', ...argv.slice(1)], {
      encoding: 'utf8', windowsHide: true, cwd: ROOT, timeout: 300_000,
    });
    say((res.stdout || res.stderr || '').trim());
    say('');
    say(`  จบ (exit ${res.status ?? 1}) · สถานะสวิตช์ไม่เปลี่ยน: ${readConfig().enabled ? 'เปิด' : 'ปิด'}`);
    return res.status ?? 1;
  }

  const cur = readConfig();
  const next = { ...cur };

  if (cmd === 'on') {
    next.enabled = true;
  } else if (cmd === 'off') {
    next.enabled = false;
  } else if (cmd === 'critical' || cmd === 'warn' || cmd === 'info') {
    next.enabled = true;
    next.minLevel = cmd;
  } else if (cmd === 'cooldown') {
    const v = Number(argv[1]);
    if (!Number.isFinite(v) || v < 0) {
      say(`  X ต้องเป็นเลข 0 ขึ้นไป (ได้ "${argv[1] ?? ''}")`);
      return 1;
    }
    next.cooldownMin = Math.round(v);
  } else {
    say(`  X ไม่รู้จักคำสั่ง "${cmd}"`);
    showHelp();
    return 1;
  }

  const saved = writeConfig(next);
  say('');
  say(`  ✔ บันทึกแล้ว → ${CONFIG_PATH}`);
  say('  ' + describe(saved).split('\n').join('\n  '));
  say('');
  if (saved.enabled) {
    say('  ⚠ เปิดแล้ว = งานตั้งเวลาจะส่งเองทุก 10 นาที');
    say('    ถ้าไม่ต้องการ ให้: node tools/alerts.mjs off');
  } else {
    say('  ระบบยังตรวจสุขภาพอยู่ตามปกติ (หน้า /system-health) — แค่ไม่ส่ง');
    say('  ต้องการส่งเองเมื่อไหร่: node tools/alerts.mjs now');
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

export { DEFAULTS };
