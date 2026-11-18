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
//
// แก้ 17/11/69 (stored XSS): เดิมรับ "นามสกุลอะไรก็ได้" ⇒ เขียน `uploads/evil.html`
// ผ่าน `POST /file/uploads%2Fevil.html` ได้ แล้ว `GET /uploads/evil.html` ใช้
// `res.sendFile` ที่ตั้ง Content-Type ตามนามสกุล = text/html ⇒ สคริปต์รันใน origin
// ของแอป (เส้นสาธารณะ domain → :3000 → rewrite /api/* → :3001 = origin เดียวกับ JWT
// ใน localStorage) ⇒ เขียน session ได้
// เอกสารของโมดูลนี้คือ .txt/.md ชั้นเดียวใน KNOWLEDGE_DIR — uploads/ เป็นของ route
// อัปโหลดที่ตรวจ magic bytes แล้ว จึงห้ามเขียนข้ามโฟลเดอร์จากที่นี่
const TEXT_EXTENSIONS = new Set(['.txt', '.md']);

function resolveKnowledgePath(file: string): string | null {
  if (!file) return null;
  if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) return null;
  const root = path.resolve(KNOWLEDGE_DIR);
  const resolved = path.resolve(root, file);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  // ชื่อต้องอยู่ชั้นเดียว (readdir/list ของโมดูลนี้ก็อ่านชั้นเดียว) — กันการเขียนทะลุเข้า uploads/
  if (path.basename(resolved) !== file) return null;
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
