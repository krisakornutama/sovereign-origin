// src/services/consent-gate.service.ts
//
// ── ด่านความยินยอมจริง (PDPA) ───────────────────────────────────────────────
// ทำไมต้องมี: `consent.service.ts` เก็บสถานะ + หลักฐานครบ แต่ไม่มีจุดใด *บล็อก*
// การเขียนข้อมูล ⇒ ระบบเก็บข้อมูลอ่อนไหวได้แม้ผู้ใช้ไม่เคยยินยอม
//
// กติกาที่ล็อกไว้:
//   · ค่าเริ่มต้น = ไม่ยินยอม (ไม่มีแถว = ปฏิเสธ) — ไม่ใช่ยินยอมโดยปริยาย
//   · แถวที่เขียนไว้ใต้นโยบายเวอร์ชันเก่า = ต้องขอใหม่ (ถ้าปล่อยผ่าน
//     ผู้ใช้จะถูกผูกกับวัตถุประสงค์ที่เขาไม่เคยเห็น — ผิดเจตนาของการ bump เวอร์ชัน)
//   · วัตถุประสงค์ "จำเป็นต่อการให้บริการ" ผ่านได้โดยไม่ต้องมีแถว (ฐานกฎหมายอื่น)
//   · DB ล่ม = fail closed (503) ไม่ใช่ปล่อยผ่าน — ความยินยอมที่ตรวจไม่ได้
//     ไม่ใช่ความยินยอม
//
// ขอบเขตโมดูล: บริการนี้แตะเฉพาะตาราง `user_consents` ของงานความยินยอมเท่านั้น
// สวิตช์เฉพาะทางของโมดูลอื่น (เช่น `health_consents`) ให้โมดูลเจ้าของส่งเข้ามา
// ทาง `extraReason` — ด่านกลางไม่ไปล้วงตารางของคนอื่น
import { prisma } from '../lib/prisma';
import {
  CONSENT_POLICY_VERSION,
  isConsentCurrent,
  purposeSpec,
  type ConsentPurposeKey,
} from './consent.service';

export type ConsentGateReason = 'consent_required' | 'consent_version_stale' | 'consent_legacy_revoked';

/** เงื่อนไขเพิ่มเติมจากโมดูลเจ้าของข้อมูล — คืน reason เมื่อต้องการปฏิเสธ */
export type ExtraConsentCheck = (userId: string) => Promise<ConsentGateReason | null>;

export type ConsentGateResult =
  | { ok: true; purpose: ConsentPurposeKey; policyVersion: string }
  | { ok: false; purpose: ConsentPurposeKey; reason: ConsentGateReason; policyVersion: string };

/**
 * ตรวจว่าผู้ใช้ให้ความยินยอมสำหรับวัตถุประสงค์นี้หรือยัง
 * ใช้ได้ทั้งเป็น middleware (`requireConsent`) และเรียกตรงในบริการ
 */
export async function checkSensitiveConsent(
  userId: string,
  purpose: ConsentPurposeKey,
  extraReason?: ExtraConsentCheck
): Promise<ConsentGateResult> {
  const spec = purposeSpec(purpose);
  if (spec.required) {
    return { ok: true, purpose, policyVersion: CONSENT_POLICY_VERSION };
  }

  const row = await prisma.userConsent.findUnique({
    where: { user_id_purpose: { user_id: userId, purpose } },
  });

  if (!row || row.granted !== true) {
    return { ok: false, purpose, reason: 'consent_required', policyVersion: CONSENT_POLICY_VERSION };
  }
  // เทียบกับเวอร์ชันที่ "วัตถุประสงค์นี้" เปลี่ยนล่าสุด — bump นโยบายที่แตะเฉพาะเรื่องอื่น
  // ต้องไม่ทำให้ผู้ใช้ต้องยอมรับซ้ำทั้งระบบ (แต่ถ้าวัตถุประสงค์นี้ถูกแก้ = ต้องขอใหม่)
  if (!isConsentCurrent(purpose, row)) {
    return { ok: false, purpose, reason: 'consent_version_stale', policyVersion: CONSENT_POLICY_VERSION };
  }

  if (extraReason) {
    const extra = await extraReason(userId);
    if (extra) {
      return { ok: false, purpose, reason: extra, policyVersion: CONSENT_POLICY_VERSION };
    }
  }

  return { ok: true, purpose, policyVersion: CONSENT_POLICY_VERSION };
}

const REASON_TEXT: Record<ConsentGateReason, string> = {
  consent_required: 'ต้องให้ความยินยอมก่อนบันทึกข้อมูลประเภทนี้',
  consent_version_stale: 'นโยบายความเป็นส่วนตัวเปลี่ยนแล้ว — ต้องยืนยันความยินยอมฉบับใหม่ก่อน',
  consent_legacy_revoked: 'คุณปิดการบันทึกข้อมูลประเภทนี้ไว้ในหน้าสุขภาพ',
};

/** เรียกหลัง `authenticate` — ตอบ 403 พร้อมเหตุผลที่ UI เอาไปบอกต่อได้ */
export function requireConsent(purpose: ConsentPurposeKey, options: { extraReason?: ExtraConsentCheck } = {}) {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.id as string | undefined;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    try {
      const result = await checkSensitiveConsent(userId, purpose, options.extraReason);
      if (result.ok) return next();
      return res.status(403).json({
        error: REASON_TEXT[result.reason],
        code: result.reason,
        purpose,
        policyVersion: result.policyVersion,
        consentUrl: '/consent',
      });
    } catch (err) {
      // ตรวจไม่ได้ = ไม่ปล่อยผ่าน (ห้ามเดาว่าเขายินยอม)
      console.error('[consent-gate] check failed:', err instanceof Error ? err.message : err);
      return res.status(503).json({
        error: 'ตรวจสอบความยินยอมไม่ได้ในขณะนี้ กรุณาลองใหม่',
        code: 'consent_unavailable',
        purpose,
      });
    }
  };
}
