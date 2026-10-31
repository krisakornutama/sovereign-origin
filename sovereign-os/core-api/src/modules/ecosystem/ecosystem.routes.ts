// src/modules/ecosystem/ecosystem.routes.ts
//
// ── Ecosystem ส่วนตัวของผู้ใช้ ────────────────────────────────────────────────
// ทุก endpoint ต้องล็อกอิน และเห็น/แก้ได้เฉพาะบัญชีของตัวเอง (user_id จาก token)
//   GET    /catalog              แคตตาล็อก platform + หมวด + สถานะ
//   GET    /accounts             รายการบัญชี + สรุป (ไม่คืนรหัสผ่าน)
//   POST   /accounts             เพิ่มบัญชี (รหัสผ่านเข้ารหัสก่อนเก็บ · Gmail ที่อีเมลตรงกัน = ผูกอัตโนมัติ)
//   POST   /accounts/auto-link   ผูกบัญชีที่ยังไม่ผูกทั้งหมดเข้ากับ Gmail ที่อีเมลตรงกัน
//   PATCH  /accounts/:id         แก้บัญชี (ไม่ส่ง password = คงรหัสเดิม)
//   DELETE /accounts/:id         ลบบัญชี
//   POST   /accounts/:id/reveal  ขอรหัสผ่านจริง (audit log ทุกครั้ง)
//   POST   /accounts/:id/open    ตรวจ URL + บันทึกการใช้งาน แล้วคืน URL ให้เปิด
//
// Express 4: async handler ที่ throw จะค้างไม่ตอบ ⇒ ทุก handler มี try/catch เอง
import { Router, type Request, type Response } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import {
  EcosystemError,
  createAccount,
  deleteAccount,
  autoLinkAccounts,
  getEcosystemCatalog,
  listAccounts,
  openAccount,
  revealPassword,
  updateAccount,
} from '../../services/ecosystem.service';

const router = Router();

function fail(res: Response, err: unknown, where: string) {
  if (err instanceof EcosystemError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  console.error(`${where} error:`, err instanceof Error ? err.message : err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ Ecosystem' });
}

// GET /api/ecosystem/catalog
router.get('/catalog', authenticate, (_req: Request, res: Response) => {
  try {
    res.json(getEcosystemCatalog());
  } catch (err) {
    fail(res, err, 'GET /api/ecosystem/catalog');
  }
});

// GET /api/ecosystem/accounts
router.get('/accounts', authenticate, async (req: Request, res: Response) => {
  try {
    const out = await listAccounts(req.user!.id);
    // ห้าม cache: มีข้อมูลบัญชีผู้ใช้ (แม้ไม่ใช่รหัสผ่าน) — เครื่องที่ใช้ร่วมกันต้องไม่เห็นของคนก่อน
    res.setHeader('Cache-Control', 'no-store');
    res.json(out);
  } catch (err) {
    fail(res, err, 'GET /api/ecosystem/accounts');
  }
});

// POST /api/ecosystem/accounts
router.post('/accounts', authenticate, async (req: Request, res: Response) => {
  try {
    const account = await createAccount(req.user!.id, req.body || {});
    res.status(201).json({ account });
  } catch (err) {
    fail(res, err, 'POST /api/ecosystem/accounts');
  }
});

// POST /api/ecosystem/accounts/auto-link
// ต้องอยู่ก่อน route ที่มี :id เพื่อไม่ให้ "auto-link" ถูกตีความเป็น id
router.post('/accounts/auto-link', authenticate, async (req: Request, res: Response) => {
  try {
    const out = await autoLinkAccounts(req.user!.id);
    res.json(out);
  } catch (err) {
    fail(res, err, 'POST /api/ecosystem/accounts/auto-link');
  }
});

// PATCH /api/ecosystem/accounts/:id
router.patch('/accounts/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const account = await updateAccount(req.user!.id, String(req.params.id || ''), req.body || {});
    res.json({ account });
  } catch (err) {
    fail(res, err, 'PATCH /api/ecosystem/accounts/:id');
  }
});

// DELETE /api/ecosystem/accounts/:id
router.delete('/accounts/:id', authenticate, async (req: Request, res: Response) => {
  try {
    await deleteAccount(req.user!.id, String(req.params.id || ''));
    res.json({ success: true });
  } catch (err) {
    fail(res, err, 'DELETE /api/ecosystem/accounts/:id');
  }
});

// POST /api/ecosystem/accounts/:id/reveal
router.post('/accounts/:id/reveal', authenticate, async (req: Request, res: Response) => {
  try {
    const password = await revealPassword(req.user!.id, String(req.params.id || ''));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ password });
  } catch (err) {
    fail(res, err, 'POST /api/ecosystem/accounts/:id/reveal');
  }
});

// POST /api/ecosystem/accounts/:id/open
router.post('/accounts/:id/open', authenticate, async (req: Request, res: Response) => {
  try {
    const out = await openAccount(req.user!.id, String(req.params.id || ''));
    res.json(out);
  } catch (err) {
    fail(res, err, 'POST /api/ecosystem/accounts/:id/open');
  }
});

export default router;
