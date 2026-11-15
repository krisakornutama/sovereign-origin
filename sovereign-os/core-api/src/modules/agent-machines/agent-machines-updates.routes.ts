// src/modules/agent-machines/agent-machines-updates.routes.ts
// ────────────────────────────────────────────────────────────────────────────
// เส้นที่ runner/ตัวอัปเดตเรียก (machine token หรือ enroll code) — แยกจาก routes ผู้ใช้
// ลำดับการ mount สำคัญ: ต้องอยู่ที่ตำแหน่งเดิมใน agent-machines.routes.ts
// ────────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import { resolveUpdateFile, isSafeRelPath } from '../../services/agent-update.service';
import { readVerifiedUpdateManifest } from '../../services/update-manifest-trust.service';
import { readDesktopManifest, resolveVerifiedDesktopAsset } from '../../services/desktop-update.service';
import {
  readNodeKitManifest,
  resolveVerifiedNodeKitAsset,
  resolveVerifiedBootstrap,
  nodeKitManifestForClient,
} from '../../services/node-kit.service';
import {
  authenticateMachineToken,
  authorizeNodeKitAccess,
  gateFleetUpdate,
  requireMachineToken,
  sha256Hex,
} from './agent-machines.shared';

const router = Router();

// ── ฝั่ง runner (machine token) ──

// GET /api/agent-machines/update/manifest — เครื่องลูกถามว่า "มีโค้ดเวอร์ชันใหม่ไหม"
// ตอบ 404 (ไม่ใช่ error) เมื่อ HUB ยังไม่ได้เผยแพร่ชุดอัปเดต — เครื่องลูกจะได้ไม่ต้องตีความ
router.get('/update/manifest', async (req: Request, res: Response) => {
  try {
    const machine = await authenticateMachineToken(req, res);
    if (!machine) return;
    const gate = await gateFleetUpdate(machine, res);
    if (!gate) return;
    const verified = readVerifiedUpdateManifest();
    if (!verified.ok) {
      if (verified.code === 'no-bundle') {
        return res.status(404).json({ error: 'no update bundle published', hint: 'รัน node tools/agent-pack/pack.mjs ที่ HUB' });
      }
      console.error(`[agent-update] ปฏิเสธ manifest: ${verified.code} — ${verified.reason}`);
      return res.status(503).json({
        error: 'update manifest is not signed by a trusted key',
        code: verified.code,
        hint: 'ตรวจ private key ที่ใช้แพ็ก + public key ใน update-manifest-trust.service.ts / updateTrust.mjs',
      });
    }
    res.json({ ...verified.manifest, channel: gate.channel, rolloutPercent: gate.rolloutPercent });
  } catch (err) {
    console.error('GET /api/agent-machines/update/manifest error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to read update manifest' });
  }
});

// GET /api/agent-machines/update/file?path=src/main.mjs — ส่งไฟล์ 1 ไฟล์ในชุดอัปเดต
// เฉพาะชื่อที่อยู่ใน manifest เท่านั้น (กันการอ่านไฟล์อื่นบนเครื่อง HUB) + ตรวจ hash ให้ตรงกับ manifest
router.get('/update/file', async (req: Request, res: Response) => {
  try {
    const machine = await authenticateMachineToken(req, res);
    if (!machine) return;
    if (!(await gateFleetUpdate(machine, res))) return;
    const rel = String(req.query.path ?? '');
    if (!isSafeRelPath(rel)) return res.status(400).json({ error: 'invalid file path' });
    // ตรวจ manifest ก่อนเสิร์ฟไฟล์ด้วย: manifest ที่ไม่ผ่าน trust = ห้ามส่งโค้ดออกไปแม้ไฟล์จะตรง hash
    const verified = readVerifiedUpdateManifest();
    if (!verified.ok) {
      if (verified.code === 'no-bundle') return res.status(404).json({ error: 'not part of the published bundle' });
      console.error(`[agent-update] ปฏิเสธ manifest ตอนส่งไฟล์: ${verified.code} — ${verified.reason}`);
      return res.status(503).json({ error: 'update manifest is not signed by a trusted key', code: verified.code });
    }
    const found = resolveUpdateFile(rel, undefined, verified.manifest);
    if (!found) return res.status(404).json({ error: 'not part of the published bundle' });
    const body = fs.readFileSync(found.abs);
    if (sha256Hex(body) !== found.entry.sha256) {
      console.error(`[agent-update] ไฟล์ชุดอัปเดตไม่ตรง manifest: ${rel}`);
      return res.status(500).json({ error: 'published file does not match manifest — publish again' });
    }
    res.type('text/plain; charset=utf-8').send(body);
  } catch (err) {
    console.error('GET /api/agent-machines/update/file error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to serve update file' });
  }
});

// ── ชุดอัปเดต "แอปเดสก์ท็อป" (Electron) — เครื่องปลายทางดึงจาก HUB ──
// เจ้าของสั่ง 11/10/69: ให้ HUB เป็นแหล่งอัปเดตของแอป (ไม่ต้องรอ GitHub release)
// เครื่องปลายทางถาม manifest → เห็นว่าใหม่กว่า → ดาวน์โหลดไฟล์เดียว → ตรวจ SHA-256 ก่อนติดตั้ง
// ตอบ 404 (ไม่ใช่ error) เมื่อ HUB ยังไม่เผยแพร่ — แอปจะตกไปเช็ค GitHub แทนได้

// GET /api/agent-machines/desktop-update/manifest
router.get('/desktop-update/manifest', async (req: Request, res: Response) => {
  try {
    const machine = await authenticateMachineToken(req, res);
    if (!machine) return;
    const gate = await gateFleetUpdate(machine, res);
    if (!gate) return;
    const manifest = readDesktopManifest();
    if (!manifest) {
      return res.status(404).json({
        error: 'no desktop update published',
        hint: 'ประกอบแอปที่ HUB (BUILD-DESKTOP.cmd) แล้วเผยแพร่ด้วย node PACK-DESKTOP.mjs --publish',
      });
    }
    res.json({ ...manifest, channel: gate.channel, rolloutPercent: gate.rolloutPercent });
  } catch (err) {
    console.error('GET /api/agent-machines/desktop-update/manifest error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to read desktop update manifest' });
  }
});

// GET /api/agent-machines/desktop-update/asset — ส่งตัวติดตั้ง (ตรวจแฮชกับ manifest ก่อนส่งทุกครั้ง)
router.get('/desktop-update/asset', async (req: Request, res: Response) => {
  try {
    const machine = await authenticateMachineToken(req, res);
    if (!machine) return;
    if (!(await gateFleetUpdate(machine, res))) return;
    const found = await resolveVerifiedDesktopAsset();
    if (!found) return res.status(404).json({ error: 'desktop asset missing or does not match manifest' });
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(found.entry.size),
      'Content-Disposition': `attachment; filename="${found.entry.name}"`,
      'Cache-Control': 'no-store',
    });
    // สตรีมไฟล์ — ไฟล์ระดับร้อย MB ห้ามโหลดทั้งก้อนเข้า memory
    const stream = fs.createReadStream(found.abs);
    stream.on('error', (err) => {
      console.error('GET /api/agent-machines/desktop-update/asset stream error:', err.message);
      res.destroy(err);
    });
    stream.pipe(res);
  } catch (err) {
    console.error('GET /api/agent-machines/desktop-update/asset error:', err instanceof Error ? err.message : err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to serve desktop update asset' });
  }
});

// GET /api/node-kits/manifest — ชุดติดตั้งเครื่องใหม่ (ไฟล์เดียว)
//
// เจ้าของสั่ง 12/10/69: ตัวติดตั้งไฟล์เดียวต้องดึงชุดระบบจาก HUB เอง
//   (เดิมต้องให้เจ้าของก๊อปโฟลเดอร์ ~700 MB ไปเอง = "งงมากเลย ไม่รู้จะกดอันไหน")
//
// เปิดให้อ่านได้โดยไม่ต้องมี machine token: เครื่องใหม่ยังไม่มี token มาจะส่ง
//   แต่ต้องมีรหัสเชิญในการ "ลงทะเบียน" เสมอ (ดู /enroll) — ชุดติดตั้งไม่ใช่คีย์ลับ
router.get('/node-kits/manifest', async (req: Request, res: Response) => {
  try {
    if (!(await authorizeNodeKitAccess(req, res))) return;
    const manifest = readNodeKitManifest();
    if (!manifest) {
      res.status(404).json({
        error: 'ยังไม่ได้เผยแพร่ชุดติดตั้งเครื่องใหม่',
        hint: 'รันที่เครื่อง HUB: node tools/build-node-kit.mjs --publish',
      });
      return;
    }
    // ส่งพาธสัมพัทธ์ ไม่ใช่ URL เต็ม — เครื่องลูกรู้ HUB_URL ของตัวเองอยู่แล้ว
    //   (HUB อาจอยู่หลัง tunnel/โดเมน ถ้ายัด URL เต็มตอนนี้จะผูกกับทางเดินของ HUB เท่านั้น)
    const client = nodeKitManifestForClient(manifest, '/api/agent-machines/node-kits/asset');
    if (!client) return res.status(404).json({ error: 'node kit manifest invalid' });
    // เครื่องใหม่ยังไม่มี machine token จึงใช้ได้เฉพาะช่อง stable (ช่องอื่นต้องผูกเครื่องก่อน)
    res.json({ ...client, channel: 'stable' });
  } catch (err) {
    console.error('GET /api/agent-machines/node-kits/manifest error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to read node kit manifest' });
  }
});

// GET /api/agent-machines/node-kits/bootstrap — สคริปต์ตัวติดตั้งไฟล์เดียว (~10 KB)
//
// ไฟล์ .cmd ที่คนก๊อปไปเครื่องใหม่ต้องเป็น ASCII ล้วน (ข้อความไทวงใน .cmd ทำให้
//   cmd.exe พัง — เจอจริง 10/10/69 ทั้งโปรเจกต์) แต่ข้อความที่คนอ่านต้องเป็นไทย
//   ⇒ ตัว .cmd จึงโหลดสคริปต์ชิ้นนี้มารันแทน (UTF-8) แล้วค่อยดึงชุดติดตั้งตาม
router.get('/node-kits/bootstrap', async (req: Request, res: Response) => {
  try {
    if (!(await authorizeNodeKitAccess(req, res))) return;
    const found = await resolveVerifiedBootstrap();
    if (!found) {
      res.status(404).json({ error: 'installer script missing or does not match manifest' });
      return;
    }
    res.set({
      // UTF-8 เท่านั้น — สคริปต์นี้มีข้อความไทย (ต่างจาก .cmd ที่ต้อง ASCII)
      'Content-Type': 'application/octet-stream; charset=utf-8',
      'Content-Length': String(found.entry.size),
      'Cache-Control': 'no-store',
      // ถ้าไฟล์ .cmd ถูกแก้ ให้ที่อยู่คำโทษไม่ข้ามผ่าน proxy ขององค์กร
      'X-Content-Type-Options': 'nosniff',
    });
    const stream = fs.createReadStream(found.abs);
    stream.on('error', (err) => {
      console.error('GET node-kits/bootstrap stream error:', err.message);
      res.destroy(err);
    });
    stream.pipe(res);
  } catch (err) {
    console.error('GET /api/agent-machines/node-kits/bootstrap error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to read node kit bootstrap' });
  }
});

// GET /api/agent-machines/node-kits/asset — ส่ง archive ชุดติดตั้ง (ตรวจแฮชกับ manifest ก่อนทุกครั้ง)
router.get('/node-kits/asset', async (req: Request, res: Response) => {
  try {
    if (!(await authorizeNodeKitAccess(req, res))) return;
    const found = await resolveVerifiedNodeKitAsset();
    if (!found) return res.status(404).json({ error: 'node kit missing or does not match manifest' });
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(found.entry.size),
      'Content-Disposition': `attachment; filename="${found.entry.name}"`,
      'Cache-Control': 'no-store',
    });
    // สตรีมไฟล์ — ระดับร้อย MB ห้ามโหลดทั้งก้อนเข้า memory
    const stream = fs.createReadStream(found.abs);
    stream.on('error', (err) => {
      console.error('GET node-kits/asset stream error:', err.message);
      res.destroy(err);
    });
    stream.pipe(res);
  } catch (err) {
    console.error('GET /api/agent-machines/node-kits/asset error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to read node kit asset' });
  }
});

export default router;
