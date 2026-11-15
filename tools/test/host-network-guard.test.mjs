#!/usr/bin/env node
/* ── ด่านกัน "โปรเจ็กแก้เน็ต/พร็อกซีระดับเครื่อง" ────────────────────────────────
   เหตุจริง 2026-11-15: หลังรีบูตเครื่องหลักใช้งานอินเทอร์เน็ตไม่ได้ เพราะ
   HKCU\...\Internet Settings -> ProxyEnable/ProxyServer ชี้ไปพอร์ตที่ตายแล้ว
   (มีผลกับทุกแอปบนเครื่อง ไม่ใช่แค่โปรเจ็ก)

   เทสต์นี้ล็อกสองเรื่อง:
     1) ตัวสแกนจับรูปแบบอันตรายได้จริง (พิสูจน์ด้วยไฟล์ตัวอย่างใน sandbox)
     2) ทั้ง repo ไม่มีไฟล์ไหนแตะเน็ต/พร็อกซี/autorun ระดับเครื่อง
   ─────────────────────────────────────────────────────────────────────────── */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText, scanRepo, ALLOWED_PATHS } from '../security/host-network-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP_ROOT = path.join(ROOT, '.freebuff', 'tmp'); // ที่พักชั่วคราวอยู่บนไดรฟ์โปรเจ็ก (AGENTS ข้อ 7)

let sandbox;
beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  sandbox = fs.mkdtempSync(path.join(TMP_ROOT, 'netguard-'));
});
afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const write = (name, text) => {
  const p = path.join(sandbox, name);
  fs.writeFileSync(p, text);
  return p;
};

describe('ตัวสแกนจับการแก้เน็ตระดับเครื่อง', () => {
  test('จับ reg add ... Internet Settings ... ProxyEnable', () => {
    const cmd = write(
      'bad.cmd',
      'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f\r\n'
    );
    const hits = scanText(fs.readFileSync(cmd, 'utf8'), 'bad.cmd');
    assert.ok(hits.some((h) => h.rule === 'internet-settings'), 'ต้องจับ Internet Settings');
    assert.ok(hits.some((h) => h.rule === 'proxy-values'), 'ต้องจับ ProxyEnable');
  });

  test('จับ Set-ItemProperty ที่เขียน ProxyServer', () => {
    const ps1 = write(
      'bad.ps1',
      "$k = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'\n" +
        "Set-ItemProperty -Path $k -Name ProxyServer -Value '127.0.0.1:54939'\n"
    );
    const hits = scanText(fs.readFileSync(ps1, 'utf8'), 'bad.ps1');
    assert.ok(hits.some((h) => h.rule === 'internet-settings'));
    assert.ok(hits.some((h) => h.rule === 'proxy-values'));
  });

  test('จับ netsh winhttp set proxy', () => {
    const hits = scanText('netsh winhttp set proxy 127.0.0.1:8080\n', 'x.cmd');
    assert.ok(hits.some((h) => h.rule === 'winhttp-proxy'));
  });

  test('จับการเปลี่ยนนโยบายไฟร์วอลล์/ofubound ทั้งเครื่อง', () => {
    const a = scanText('netsh advfirewall set allprofiles firewallpolicy blockinbound,blockoutbound\n', 'x.cmd');
    assert.ok(a.some((h) => h.rule === 'firewall-global-policy'));
    const b = scanText("Set-NetFirewallProfile -Name $p -DefaultOutboundAction Block\n", 'x.ps1');
    assert.ok(b.some((h) => h.rule === 'block-outbound'));
  });

  test('จับการฝัง autorun ใน Run key', () => {
    const hits = scanText(
      'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v legit /t REG_SZ /d evil.exe /f\n',
      'x.cmd'
    );
    assert.ok(hits.some((h) => h.rule === 'run-key-autostart'));
  });

  test('สคริปต์ทั่วไปที่ไม่ได้แตะเน็ต = ไม่ถูกจับ', () => {
    const ok = write(
      'fine.ps1',
      "# just a build helper\nWrite-Output 'building'\nnpm run build\n"
    );
    assert.deepEqual(scanText(fs.readFileSync(ok, 'utf8'), 'fine.ps1'), []);
  });
});

describe('ทั้ง repo ต้องสะอาด', () => {
  test('ไม่มีไฟล์ไหนแตะพร็อกซี/เน็ต/autorun ระดับเครื่อง (ยกเว้นตัวซ่อมค่า)', () => {
    const hits = scanRepo(ROOT);
    const detail = hits.map((h) => `${h.file}:${h.line} [${h.rule}] ${h.text}`).join('\n');
    assert.equal(hits.length, 0, `พบโค้ดที่แตะเน็ตระดับเครื่อง:\n${detail}`);
  });

  test('allowlist มีแค่ตัวซ่อมค่า + ตัวด่านเอง (ไม่ใช่ที่ซ่อนโค้ดอันตราย)', () => {
    assert.deepEqual(ALLOWED_PATHS.slice().sort(), [
      'tools/security/host-network-guard.mjs',
      'tools/security/repair-host-network.ps1',
      'tools/test/host-network-guard.test.mjs',
    ]);
  });
});
