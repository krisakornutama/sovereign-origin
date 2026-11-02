// src/modules/consent/consent.routes.ts
//
// PDPA: ศูนย์ความยินยอม + สิทธิ์เข้าถึง/ลบข้อมูลของผู้ใช้เอง
// ทุกเส้นผูกกับตัวผู้ใช้จาก token เท่านั้น — ห้ามรับ user_id จาก body/query
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { AuditService } from '../../services/audit.service';
import { disconnectUserSockets } from '../../realtime/io-registry';
import {
  CONSENT_POLICY_VERSION,
  listConsents,
  listConsentEvents,
  setConsent,
  anonymizeAccount,
} from '../../services/consent.service';

const router = Router();

// GET /api/consent — สถานะความยินยอมของฉัน + เวอร์ชันนโยบาย
router.get('/', authenticate, async (req, res) => {
  try {
    const data = await listConsents(req.user!.id);
    res.set('Cache-Control', 'private, no-store');
    res.json(data);
  } catch (err) {
    console.error('[consent:list] failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'อ่านสถานะความยินยอมไม่สำเร็จ' });
  }
});

// PUT /api/consent — ให้/ถอนความยินยอมหนึ่งวัตถุประสงค์
router.put('/', authenticate, async (req, res) => {
  try {
    const result = await setConsent({
      userId: req.user!.id,
      purpose: String(req.body?.purpose ?? ''),
      granted: req.body?.granted === true,
      source: 'web',
      ip: req.ip,
    });
    if (!result.ok) {
      if (result.reason === 'unknown_purpose') {
        return res.status(400).json({ error: 'วัตถุประสงค์ความยินยอมไม่ถูกต้อง', reason: result.reason });
      }
      return res.status(409).json({
        error: 'ความยินยอมที่จำเป็นต่อการให้บริการปิดไม่ได้',
        reason: result.reason,
      });
    }
    res.json({
      purpose: result.purpose,
      granted: result.granted,
      policyVersion: result.policyVersion,
    });
  } catch (err) {
    console.error('[consent:set] failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'บันทึกความยินยอมไม่สำเร็จ' });
  }
});

// GET /api/consent/history — ประวัติการให้/ถอน (หลักฐานย้อนหลัง)
router.get('/history', authenticate, async (req, res) => {
  try {
    const raw = Number(req.query?.limit ?? 50);
    const events = await listConsentEvents(req.user!.id, Number.isFinite(raw) ? raw : 50);
    res.set('Cache-Control', 'private, no-store');
    res.json({ policyVersion: CONSENT_POLICY_VERSION, events });
  } catch (err) {
    console.error('[consent:history] failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'อ่านประวัติความยินยอมไม่สำเร็จ' });
  }
});

// DELETE /api/consent/account — สิทธิ์ถูกลืม: ทำให้บัญชีไม่ระบุตัวตนได้
// ต้องยืนยันด้วยรหัสผ่าน + พิมพ์ DELETE (กันกดพลาด) และผู้ดูแลคนสุดท้ายลบไม่ได้
router.delete('/account', authenticate, async (req, res) => {
  try {
    const result = await anonymizeAccount({
      userId: req.user!.id,
      password: String(req.body?.password ?? ''),
      confirm: String(req.body?.confirm ?? ''),
    });
    if (!result.ok) {
      const map: Record<string, { status: number; error: string }> = {
        not_found: { status: 404, error: 'ไม่พบบัญชีนี้' },
        already_deleted: { status: 409, error: 'บัญชีนี้ถูกลบไปแล้ว' },
        bad_password: { status: 401, error: 'รหัสผ่านไม่ถูกต้อง' },
        bad_confirm: { status: 400, error: 'ต้องพิมพ์ DELETE เพื่อยืนยัน' },
        last_admin: { status: 409, error: 'ผู้ดูแลระบบคนสุดท้ายลบบัญชีตัวเองไม่ได้' },
      };
      const hit = map[result.reason] ?? { status: 400, error: 'ลบบัญชีไม่สำเร็จ' };
      return res.status(hit.status).json({ error: hit.error, reason: result.reason });
    }

    await AuditService.logAction({
      userId: req.user!.id,
      actionType: 'ACCOUNT_SELF_DELETED',
      payload: { anon_username: result.username, at: result.anonymizedAt.toISOString(), ip: req.ip },
    });
    // session ทุกอุปกรณ์ต้องตายทันที (token_version ถูก bump แล้วในบริการ)
    disconnectUserSockets(req.user!.id);
    res.json({ success: true, username: result.username, anonymizedAt: result.anonymizedAt });
  } catch (err) {
    console.error('[consent:delete-account] failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'ลบบัญชีไม่สำเร็จ' });
  }
});

export default router;
