// เทส verify-asset — ครอบทุกเส้นทาง (ผ่าน 2 ทาง + fail-closed ทุกเคส) ด้วย fetcher/hash ปลอม ไม่แตะเน็ต
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const { verifyAssetWith, sha256File, parseAssetUrl, expectedFromSums } = require(join(process.cwd(), 'sovereign-frontend', 'electron', 'verify-asset.js'));

let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (d ? ' — ' + d : '')); if (!ok) fails++; };

const GOOD = 'a'.repeat(64);
const H = async () => GOOD;
const digestOf = (name) => async () => (name === 'Sovereign-OS-1.1.0-portable.exe' ? GOOD : null);
const noSums = async () => null;
const URL_OK = 'https://github.com/o/r/releases/download/v1.1.0/Sovereign-OS-1.1.0-portable.exe';

// 1) ผ่านทาง digest
let r = await verifyAssetWith({ assetUrl: URL_OK, dest: 'x', getDigest: digestOf('Sovereign-OS-1.1.0-portable.exe'), getSums: noSums, hashFile: H });
check('digest path approves', r.ok === true && r.source === 'github-digest', JSON.stringify(r).slice(0, 80));

// 2) ผ่านทาง SHA256SUMS
r = await verifyAssetWith({ assetUrl: URL_OK, dest: 'x', getDigest: async () => null, getSums: async () => GOOD, hashFile: H });
check('SHA256SUMS path approves', r.ok === true && r.source === 'sha256sums', JSON.stringify(r).slice(0, 80));

// 3) fail-closed: ไม่มีลายเซ็นอ้างอิงเลย
r = await verifyAssetWith({ assetUrl: URL_OK, dest: 'x', getDigest: async () => null, getSums: noSums, hashFile: H });
check('no-reference rejected', r.ok === false && r.reason === 'no-reference', JSON.stringify(r).slice(0, 80));

// 4) fail-closed: hash ไฟล์ไม่ตรงลายเซ็น
r = await verifyAssetWith({ assetUrl: URL_OK, dest: 'x', getDigest: async () => 'b'.repeat(64), getSums: noSums, hashFile: H });
check('mismatch rejected', r.ok === false && r.reason === 'mismatch', JSON.stringify(r).slice(0, 80));

// 5) fail-closed: ลายเซ็นไม่ใช่ 64-hex
r = await verifyAssetWith({ assetUrl: URL_OK, dest: 'x', getDigest: async () => 'sha256:xyz', getSums: noSums, hashFile: H });
check('bad-reference rejected', r.ok === false && r.reason === 'bad-reference', JSON.stringify(r).slice(0, 80));

// 6) fail-closed: URL นอกรูปแบบ release
r = await verifyAssetWith({ assetUrl: 'https://evil.example/x.exe', dest: 'x', getDigest: digestOf('x'), getSums: async () => GOOD, hashFile: H });
check('non-release URL rejected before any lookup', r.ok === false && r.reason === 'bad-asset-url', JSON.stringify(r).slice(0, 80));

// 7) parser + บรรทัด SHA256SUMS
check('parseAssetUrl extracts parts', JSON.stringify(parseAssetUrl(URL_OK)) === JSON.stringify({ owner: 'o', repo: 'r', tag: 'v1.1.0', name: 'Sovereign-OS-1.1.0-portable.exe' }));
check('parseAssetUrl rejects non-release URL', parseAssetUrl('https://example.com/a.exe') === null);
check('expectedFromSums reads standard line', expectedFromSums(`${'a'.repeat(64)}  Sovereign-OS-1.1.0-portable.exe\n${'c'.repeat(64)}  other.exe`, 'Sovereign-OS-1.1.0-portable.exe') === GOOD);
check('expectedFromSums reads binary-marker line', expectedFromSums(`${GOOD} *Sovereign-OS-1.1.0-portable.exe`, 'Sovereign-OS-1.1.0-portable.exe') === GOOD);
check('expectedFromSums returns null for unknown file', expectedFromSums(`${GOOD}  other.exe`, 'nope.exe') === null);

// 8) sha256File จริง เทียบกับ certutil (oracle อิสระของ Windows)
const dir = mkdtempSync(join(tmpdir(), 'verify-asset-test-'));
try {
  const file = join(dir, 'sample.bin');
  const buf = crypto.randomBytes(100 * 1024);
  writeFileSync(file, buf);
  const got = await sha256File(file);
  const cert = execSync(`certutil -hashfile "${file}" SHA256`).toString().split('\r\n')[1].replace(/\s+/g, '').toLowerCase();
  check('sha256File matches certutil on real 100KB file', got === cert, `got=${got.slice(0, 12)}… cert=${cert.slice(0, 12)}…`);
} finally { rmSync(dir, { recursive: true, force: true }); }

console.log(fails === 0 ? 'ALL PASS' : `FAILS: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
