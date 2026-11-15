import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { backupService, appendRestoreJournal, readRestoreJournal, BackupRequestError } from '../../services/backup.service';

const router = Router();

// GET /api/backup – รายการไฟล์ backup (SUPERADMIN — ชื่อไฟล์/เวลา/ขนาดเป็นข้อมูลของผู้ดูแล)
router.get('/', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  try {
    res.json({ backups: backupService.listBackups(), schedule: backupService.getSchedule() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

// GET /api/backup/status – ความสดของ backup ล่าสุด (SUPERADMIN)
// แยกจาก GET / เพราะตัวเฝ้าระวังต้องถามซ้ำได้โดยไม่ดึงรายการไฟล์ทั้งชุด
router.get('/status', authenticate, requireRole('SUPERADMIN'), (_req, res) => {
  try {
    res.json(backupService.status());
  } catch (err) {
    res.status(500).json({ error: 'Failed to read backup status' });
  }
});

// POST /api/backup – สร้าง backup ตอนนี้ (SUPERADMIN เท่านั้น)
router.post('/', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const result = await backupService.createBackup();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Create backup error:', err);
    res.status(500).json({ error: (err as Error).message || 'Backup failed' });
  }
});

// GET /api/backup/restore-history – ประวัติการกู้คืนล่าสุด (SUPERADMIN)
// journal อยู่ข้างไฟล์ backup (ไม่ใช่ DB) จึงอยู่รอดแม้เพิ่งกู้คืนทับฐานข้อมูลทั้งก้อน
router.get('/restore-history', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  const requested = parseInt(String(req.query.limit ?? '10'), 10);
  const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 10, 1), 50);
  try {
    res.json({ restores: readRestoreJournal(limit) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read restore history' });
  }
});

// POST /api/backup/restore { file, confirm } – กู้คืนจากไฟล์ (SUPERADMIN, มีผลกับทั้ง DB!)
// เป็นการกระทำที่ทำลายข้อมูลมากที่สุดในระบบ ⇒ ต้องบังคับ "เจตนาชัดเจน":
//   - `confirm` ต้องตรงกับชื่อไฟล์ (พิมพ์ผิดตัวเดียวก็ไม่ผ่าน) — window.confirm ฝั่ง UI
//     เป็นแค่ความสะดวก ปุ่ม/yิง API ตรงได้เสมอ จึงต้องมีด่านที่ server
//   - ทุกความพยายาม (สำเร็จหรือไม่) ถูกบันทึกใน journal ข้าง backup ซึ่งรอดจากการกู้คืน
router.post('/restore', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const file = typeof req.body?.file === 'string' ? req.body.file.trim() : '';
  const confirm = typeof req.body?.confirm === 'string' ? req.body.confirm.trim() : '';
  const actor = { userId: req.user?.id ?? null, ip: req.ip ?? null };

  if (!file) {
    return res.status(400).json({ error: 'ต้องระบุชื่อไฟล์ backup ที่จะกู้คืน' });
  }
  if (!confirm || confirm !== file) {
    return res.status(400).json({
      error: 'ยืนยันไม่ถูกต้อง — พิมพ์ชื่อไฟล์ backup ให้ตรงทุกตัวอักษรเพื่อยืนยันว่าต้องการกู้คืน (ข้อมูลปัจจุบันจะถูกแทนที่ทั้งหมด)',
    });
  }

  try {
    await backupService.restoreBackup(file);
    appendRestoreJournal({ at: new Date().toISOString(), file, ok: true, status: 200, ...actor });
    res.json({ success: true });
  } catch (err) {
    const status = err instanceof BackupRequestError ? err.status : 500;
    appendRestoreJournal({
      at: new Date().toISOString(),
      file,
      ok: false,
      status,
      error: (err as Error).message || 'unknown error',
      ...actor,
    });
    console.error('Restore backup error:', err);
    res.status(status).json({ error: (err as Error).message || 'Restore failed' });
  }
});

// POST /api/backup/schedule { enabled, time } – ตั้งเวลา backup อัตโนมัติ (SUPERADMIN)
router.post('/schedule', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const enabled = !!req.body?.enabled;
  const time = String(req.body?.time || '02:00');
  // แก้ 3/10/69: เดิมตรวจแค่รูป /^\\d{2}:\\d{2}$/ → "25:00" ผ่าน แล้ว toMin = 1500 นาที
  // ซึ่งเกินเวลาที่เป็นไปได้ของวัน (สูงสุด 23:59 = 1439) → catch-up window ไม่มีวันเข้า
  // = backup ไม่เคยรันอีก โดยไม่มีอะไรฟ้อง (รอ machine-health เตือนที่ 26 ชม.) · ต้องตรวจช่วงค่าจริง
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    return res.status(400).json({ error: 'Invalid time format (HH:mm, 00:00–23:59)' });
  }
  backupService.setSchedule(enabled, time);
  res.json({ success: true, schedule: backupService.getSchedule() });
});

// DELETE /api/backup/:file – ลบไฟล์ backup (SUPERADMIN)
router.delete('/:file', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  try {
    backupService.deleteBackup(req.params.file);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Delete failed' });
  }
});

export default router;
