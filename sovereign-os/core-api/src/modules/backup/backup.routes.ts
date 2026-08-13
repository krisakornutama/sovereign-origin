import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { backupService } from '../../services/backup.service';

const router = Router();

// GET /api/backup – รายการไฟล์ backup
router.get('/', authenticate, (req, res) => {
  try {
    res.json({ backups: backupService.listBackups(), schedule: backupService.getSchedule() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list backups' });
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

// POST /api/backup/restore { file } – กู้คืนจากไฟล์ (SUPERADMIN, มีผลกับทั้ง DB!)
router.post('/restore', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    await backupService.restoreBackup(String(req.body?.file || ''));
    res.json({ success: true });
  } catch (err) {
    console.error('Restore backup error:', err);
    res.status(500).json({ error: (err as Error).message || 'Restore failed' });
  }
});

// POST /api/backup/schedule { enabled, time } – ตั้งเวลา backup อัตโนมัติ (SUPERADMIN)
router.post('/schedule', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const enabled = !!req.body?.enabled;
  const time = String(req.body?.time || '02:00');
  if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: 'Invalid time format (HH:mm)' });
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
