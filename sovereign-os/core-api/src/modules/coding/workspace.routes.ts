// src/modules/coding/workspace.routes.ts
// Workspace — ตำแหน่งโปรเจ็ก + เปิดดูไฟล์ + เทอร์มินัล
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/auth.middleware';
import {
  getProjectPath,
  saveSettings,
  listFiles,
  readProjectFile,
  runTerminal,
} from '../../services/agent-workspace.service';

const router = Router();

// GET /api/coding/workspace — ตำแหน่งโปรเจ็กปัจจุบัน
router.get('/workspace', authenticate, (_req, res) => {
  try {
    res.json({ projectPath: getProjectPath() });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ดึงตำแหน่งโปรเจ็กไม่สำเร็จ') });
  }
});

// PUT /api/coding/workspace { projectPath } — เปลี่ยนตำแหน่งโปรเจ็ก (SUPERADMIN)
router.put('/workspace', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  try {
    const saved = saveSettings({ projectPath: String(req.body?.projectPath || '') });
    res.json({ success: true, projectPath: saved.projectPath });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'เปลี่ยนตำแหน่งโปรเจ็กไม่สำเร็จ') });
  }
});

// GET /api/coding/files?path=... — รายการไฟล์ในโปรเจ็ก
router.get('/files', authenticate, (req, res) => {
  try {
    res.json({ entries: listFiles(String(req.query?.path || '')) });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'เปิดโฟลเดอร์ไม่สำเร็จ') });
  }
});

// GET /api/coding/file?path=... — เนื้อหาไฟล์ (preview)
router.get('/file', authenticate, (req, res) => {
  try {
    const result = readProjectFile(String(req.query?.path || ''));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'อ่านไฟล์ไม่สำเร็จ') });
  }
});

// POST /api/coding/terminal { command } — รันคำสั่งในเครื่อง (cwd = โปรเจ็ก)
router.post('/terminal', authenticate, async (req, res) => {
  try {
    const result = await runTerminal(String(req.body?.command || ''));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'รันคำสั่งไม่สำเร็จ') });
  }
});

export default router;