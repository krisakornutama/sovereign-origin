// src/modules/coding/workspace.routes.ts
// Workspace — ตำแหน่งโปรเจ็ก + เปิดดูไฟล์ + เทอร์มินัล
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/auth.middleware';
import { rateLimit } from '../../middleware/rateLimit.middleware';
import {
  getProjectPath,
  saveSettings,
  listFiles,
  readProjectFile,
  runTerminal,
} from '../../services/agent-workspace.service';

const router = Router();

// จำกัดการอ่าน/สั่งงาน coding ต่อบัญชี — กันการวนอ่านไฟล์หรือยิง terminal ถี่ผิดปกติ
export const codingLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  message: 'คำขอ Coding ถี่เกินไป กรุณาลองใหม่ภายหลัง',
  keyBy: (req) => String(req.user?.id ?? ''),
});

// GET /api/coding/workspace — ตำแหน่งโปรเจ็กปัจจุบัน (SUPERADMIN เท่านั้น — ไม่เปิดเผย path ให้ user ทั่วไป)
router.get('/workspace', authenticate, requireRole('SUPERADMIN'), (_req, res) => {
  try {
    res.json({ projectPath: getProjectPath() });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ดึงตำแหน่งโปรเจ็กไม่สำเร็จ') });
  }
});

// PUT /api/coding/workspace { projectPath } — เปลี่ยนตำแหน่งโปรเจ็ก (SUPERADMIN)
router.put('/workspace', authenticate, codingLimiter, requireRole('SUPERADMIN'), (req, res) => {
  try {
    const saved = saveSettings({ projectPath: String(req.body?.projectPath || '') });
    res.json({ success: true, projectPath: saved.projectPath });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'เปลี่ยนตำแหน่งโปรเจ็กไม่สำเร็จ') });
  }
});

// GET /api/coding/files?path=... — รายการไฟล์ในโปรเจ็ก
router.get('/files', authenticate, codingLimiter, requireRole('SUPERADMIN'), (req, res) => {
  try {
    res.json({ entries: listFiles(String(req.query?.path || '')) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'เปิดโฟลเดอร์ไม่สำเร็จ') });
  }
});

// GET /api/coding/file?path=... — เนื้อหาไฟล์ (preview)
router.get('/file', authenticate, codingLimiter, requireRole('SUPERADMIN'), (req, res) => {
  try {
    const result = readProjectFile(String(req.query?.path || ''));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'อ่านไฟล์ไม่สำเร็จ') });
  }
});

// POST /api/coding/terminal { command } — รันคำสั่งในเครื่อง (cwd = โปรเจ็ก)
router.post('/terminal', authenticate, codingLimiter, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const result = await runTerminal(String(req.body?.command || ''));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'รันคำสั่งไม่สำเร็จ') });
  }
});

export default router;