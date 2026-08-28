// src/modules/notes/notes.routes.ts
// Notes — ปุ่มโน้ตส่วนตัว
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { listNotes, addNote, deleteNote } from '../../services/notes.service';

const router = Router();

// GET /api/notes — รายการโน้ต
router.get('/', authenticate, async (_req, res) => {
  try {
    res.json({ notes: await listNotes() });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ดึงโน้ตไม่สำเร็จ') });
  }
});

// POST /api/notes { content } — เพิ่มโน้ต
router.post('/', authenticate, async (req, res) => {
  try {
    const { id } = await addNote(String(req.body?.content || ''));
    res.status(201).json({ success: true, id });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'เพิ่มโน้ตไม่สำเร็จ') });
  }
});

// DELETE /api/notes/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await deleteNote(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ลบโน้ตไม่สำเร็จ') });
  }
});

export default router;