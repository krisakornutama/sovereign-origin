#!/usr/bin/env node
/* seal-cli — ตราประทับไฟล์แบบออฟไลน์ (ลายเซ็นดิจิทัล + SHA-256)
 *
 * ใช้ฟอร์แมตเดียวกับ seal.html ทุกไบต์: ตราที่เซ็นในเบราว์เซอร์ต้องตรวจผ่านที่นี่
 * และตราที่เซ็นที่นี่ต้องตรวจผ่านในเบราว์เซอร์
 *
 * รองรับสองอัลกอริทึม เพราะ WebCrypto ของเบราว์เซอร์รุ่นเก่ายังไม่มี Ed25519:
 *   Ed25519      — ค่าเริ่มต้น (กุญแจสั้น ลายเซ็น 64 ไบต์)
 *   ECDSA-P256   — ใช้เมื่อเบราว์เซอร์ไม่รองรับ Ed25519 (raw r||s 64 ไบต์)
 * `verify` อ่าน alg จากไฟล์ตราเอง จึงตรวจได้ทั้งสองแบบโดยไม่ต้องบอกธง
 *
 *   node seal-cli.mjs keygen [--alg ed25519|p256] [--out seal-key.json]
 *   node seal-cli.mjs sign <file...> [--key seal-key.json] [--out name.seal.json]
 *   node seal-cli.mjs verify <file> <seal.json>
 *
 * ไม่มี dependency, ไม่ต่อเน็ต, ไม่ส่งไฟล์ออกไปไหน
 */
import {
  createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify,
} from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const FORMAT_VERSION = 1;
const FINGERPRINT_HEX = 32;
const DEFAULT_ALG = 'ed25519';

/* ── canonical JSON: เรียงคีย์ทุกชั้น แล้ว stringify แบบไม่มีช่องว่าง ── */
const sortValue = (v) => {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortValue(v[k])]));
  }
  return v;
};
const canon = (v) => JSON.stringify(sortValue(v));

const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex');

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => h.update(chunk))
      .on('end', () => resolve(h.digest('hex')));
  });
}

const rawPub = (jwk) => Buffer.from(jwk.x, 'base64url');
const fingerprintOf = (jwk) => sha256Hex(rawPub(jwk)).slice(0, FINGERPRINT_HEX);

function algOf(jwk) {
  if (jwk && jwk.kty === 'OKP' && jwk.crv === 'Ed25519') return 'Ed25519';
  if (jwk && jwk.kty === 'EC' && jwk.crv === 'P-256') return 'ECDSA-P256';
  return null;
}

/* ECDSA ต้องสั่ง raw r||s ให้ตรงกับ WebCrypto (ค่าเริ่มต้นของ Node เป็น DER) */
const isP256 = (alg) => alg === 'ECDSA-P256';

function signData(alg, data, privateKey) {
  return isP256(alg)
    ? sign('sha256', data, { key: privateKey, dsaEncoding: 'ieee-p1363' })
    : sign(null, data, privateKey);
}

function verifyData(alg, data, publicKey, signature) {
  return isP256(alg)
    ? verify('sha256', data, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)
    : verify(null, data, publicKey, signature);
}

function loadKey(file) {
  if (!existsSync(file)) return null;
  const jwk = JSON.parse(readFileSync(file, 'utf8'));
  if (!algOf(jwk) || !jwk.d) throw new Error(`${file}: not a usable signing key`);
  return jwk;
}

function keygen(outFile, algName) {
  const pair = algName === 'p256'
    ? generateKeyPairSync('ec', { namedCurve: 'P-256' })
    : generateKeyPairSync('ed25519');
  const jwk = pair.privateKey.export({ format: 'jwk' });
  writeFileSync(outFile, `${JSON.stringify(jwk, null, 2)}\n`, { mode: 0o600 });
  return jwk;
}

function publicJwk(jwk) {
  const out = { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
  if (jwk.y) out.y = jwk.y;
  return out;
}

async function signFiles(files, keyFile) {
  let jwk = loadKey(keyFile);
  if (!jwk) {
    jwk = keygen(keyFile, DEFAULT_ALG);
    console.log(`สร้างกุญแจใหม่: ${keyFile} (เก็บไว้ให้ดี — หายแล้วเซ็นแทนของเดิมไม่ได้)`);
  }
  const alg = algOf(jwk);
  const privateKey = createPrivateKey({ key: jwk, format: 'jwk' });

  const items = [];
  for (const file of files) {
    items.push({ name: path.basename(file), sha256: await sha256File(file), size: statSync(file).size });
  }
  const body = { v: FORMAT_VERSION, alg, at: new Date().toISOString(), items };
  const sig = signData(alg, Buffer.from(canon(body), 'utf8'), privateKey).toString('base64');
  return { body, sig, publicKey: publicJwk(jwk) };
}

function parseArgs(argv) {
  const rest = [];
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--key' || a === '--out' || a === '--alg') {
      opts[a.slice(2)] = argv[i + 1];
      i += 1;
    } else rest.push(a);
  }
  return { cmd: rest[0], args: rest.slice(1), opts };
}

function usage() {
  console.log(`seal-cli — ตราประทับไฟล์ออฟไลน์

  node seal-cli.mjs keygen [--alg ed25519|p256] [--out seal-key.json]
  node seal-cli.mjs sign <file...> [--key seal-key.json] [--out name.seal.json]
  node seal-cli.mjs verify <file> <seal.json>

ตรวจด้วยกุญแจที่ฝังในตรา: ผ่าน = ไบต์เดียวกันกับตอนเซ็น, ไม่ผ่าน = ถูกแก้หรือตราไม่ใช่ของไฟล์นี้`);
}

async function main() {
  const { cmd, args, opts } = parseArgs(process.argv.slice(2));
  if (!cmd || cmd === 'help' || cmd === '--help') return usage();

  if (cmd === 'keygen') {
    const out = opts.out || 'seal-key.json';
    const wanted = opts.alg === 'p256' ? 'p256' : DEFAULT_ALG;
    if (existsSync(out) && !opts.alg) {
      const existing = loadKey(out);
      console.log(out);
      console.log(`fingerprint  ${fingerprintOf(existing)}`);
      console.log('ไฟล์มีอยู่แล้ว — ใช้ของเดิม (ใส่ --out เพื่อสร้างไฟล์ใหม่)');
      return;
    }
    const jwk = keygen(out, wanted);
    console.log(out);
    console.log(`alg         ${algOf(jwk)}`);
    console.log(`fingerprint  ${fingerprintOf(jwk)}`);
    return;
  }

  if (cmd === 'sign') {
    if (args.length === 0) throw new Error('ต้องระบุไฟล์อย่างน้อย 1 ไฟล์');
    const keyFile = opts.key || 'seal-key.json';
    const seal = await signFiles(args, keyFile);
    const out = opts.out || `${path.basename(args[0])}.seal.json`;
    writeFileSync(out, `${JSON.stringify(seal, null, 2)}\n`);
    console.log(`เซ็นแล้ว: ${out}`);
    for (const it of seal.body.items) console.log(`  ${it.name}  ${it.sha256}  ${it.size} ไบต์`);
    console.log(`อัลกอริทึม: ${seal.body.alg}`);
    console.log(`ผู้เซ็น: ${fingerprintOf(seal.publicKey)}`);
    return;
  }

  if (cmd === 'verify') {
    if (args.length !== 2) throw new Error('ต้องระบุ <file> <seal.json>');
    const [file, sealFile] = args;
    const seal = JSON.parse(readFileSync(sealFile, 'utf8'));
    if (!seal || !seal.body || !seal.sig || !seal.publicKey) throw new Error(`${sealFile}: not a seal file`);
    const alg = algOf(seal.publicKey) || seal.body.alg;
    const publicKey = createPublicKey({ key: seal.publicKey, format: 'jwk' });
    const okSign = verifyData(alg, Buffer.from(canon(seal.body), 'utf8'), publicKey, Buffer.from(seal.sig, 'base64'));
    const item = seal.body.items.find((i) => i.name === path.basename(file));
    const digest = await sha256File(file);
    const okHash = Boolean(item) && item.sha256 === digest;
    console.log(`ไฟล์      ${path.basename(file)}`);
    console.log(`SHA-256   ${digest}`);
    console.log(`ตรา       ${okSign ? 'ลายเซ็นถูกต้อง' : 'ลายเซ็นไม่ถูกต้อง (ตราถูกแก้ หรือกุญแจไม่ตรง)'}`);
    console.log(`ไบต์      ${okHash ? 'ตรงกับตอนเซ็น' : 'ไม่ตรง — ไฟล์ถูกแก้ หรือไม่มีไฟล์นี้ในตรา'}`);
    console.log(`อัลกอริทึม: ${alg}`);
    console.log(`ผู้เซ็น    ${fingerprintOf(seal.publicKey)}`);
    if (!okSign || !okHash) process.exitCode = 1;
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`seal-cli: ${err.message}`);
  process.exitCode = 1;
});
