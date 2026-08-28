import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { authenticate } from '../../middleware/auth.middleware';
import { knowledgeDir } from '../../services/knowledge-dir.service';

// ────────────────────────────────────────────────────────────────────────────
// Knowledge Base — ไฟล์ .txt/.md บนดิสก์ — ย้ายมาจาก inline routes ใน server.ts
// GET  /api/knowledge/files       รายชื่อไฟล์
// GET  /api/knowledge/file/:file  อ่านเนื้อหา
// POST /api/knowledge/file/:file  เขียนเนื้อหา
// หมายเหตุ: mount หลัง search/knowledge/teach routes เสมอ
// ────────────────────────────────────────────────────────────────────────────
const KNOWLEDGE_DIR = knowledgeDir();

// Resolve a requested file name to an absolute path and ensure it stays
// inside KNOWLEDGE_DIR. Prevents path-traversal (e.g. `../../etc/passwd`).
function resolveKnowledgePath(file: string): string | null {
  if (!file) return null;
  const root = path.resolve(KNOWLEDGE_DIR);
  const resolved = path.resolve(root, file);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

const router = Router();

router.get('/files', authenticate, (_req, res) => {
  try {
    const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith('.txt') || f.endsWith('.md'));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ files: [] });
  }
});
router.get('/file/:file', authenticate, (req, res) => {
  try {
    const filePath = resolveKnowledgePath(req.params.file);
    if (!filePath) return res.status(400).json({ error: 'Invalid file path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: 'Read failed' });
  }
});
router.post('/file/:file', authenticate, (req, res) => {
  try {
    const filePath = resolveKnowledgePath(req.params.file);
    if (!filePath) return res.status(400).json({ error: 'Invalid file path' });
    fs.writeFileSync(filePath, req.body.content);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Write failed' });
  }
});

export default router;
