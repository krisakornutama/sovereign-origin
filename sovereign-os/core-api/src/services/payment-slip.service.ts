// services/payment-slip.service.ts
//
// Payment slips — free-first:
//   - เก็บภาพสลิป + ข้อมูลที่พนักงานกรอกลง Postgres (ไม่ต้องใช้ผู้ให้บริการเสียเงิน)
//   - กันสลิปซ้ำสองชั้น: sha256 ของภาพ และ (provider, transRef)
//   - ให้เจ้าของ/ผู้จัดการตรวจด้วยมือ (PENDING → APPROVED | REJECTED) + audit
//   - adapter interface สำหรับอนาคต แต่รอบนี้มีเฉพาะ MANUAL ที่ไม่เรียกเครือข่าย
//
// ข้อจำกัดที่ตั้งใจ: การอนุมัติสลิป = "ตรวจแล้ว" ไม่ได้บันทึกการชำระเงินอัตโนมัติ
// (ยังใช้ business.service.addPayment ตามเดิม) — แยกหน้าที่ตรวจสลิปกับการลงบัญชี
import crypto from 'node:crypto';
import { prisma } from '../lib/prisma';
import { AuditService } from './audit.service';
import { getOrder } from './business.service';
import { toSatang } from './slip-verify.service';

export const SLIP_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type SlipStatus = (typeof SLIP_STATUSES)[number];
export const SLIP_MAX_BYTES = 5 * 1024 * 1024;
export const SLIP_MAX_AMOUNT_BAHT = 10_000_000;

export class SlipError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'SlipError';
    this.status = status;
  }
}

export interface SlipProviderAdapter {
  /** key เดียวกับ payment_slips.provider */
  key: string;
  /**
   * อ่านข้อเท็จจริงจากภาพสลิป
   * รอบนี้มีแต่ MANUAL ที่คืนค่าว่าง (ให้คนกรอกเอง) — adapter ที่เสียเงินจะถูกเพิ่มภายหลัง
   * โดยไม่แตะกติกาตรวจใน slip-verify.service.ts
   */
  read(input: { image: Buffer; mime: string }): Promise<Record<string, unknown>>;
}

export const MANUAL_SLIP_ADAPTER: SlipProviderAdapter = {
  key: 'MANUAL',
  async read() {
    return {};
  },
};

/** ตรวจ magic bytes เอง — ไม่เชื่อ content-type/นามสกุลที่ client ส่งมา */
export function detectSlipMime(image: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) {
    return 'image/jpeg';
  }
  if (image.length >= 12 && image.subarray(0, 4).toString('latin1') === 'RIFF' && image.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function normalizeProvider(value: unknown): string {
  const provider = String(value ?? 'MANUAL').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,32}$/.test(provider)) {
    throw new SlipError('provider ไม่ถูกต้อง (A-Z, 0-9, _ หรือ - ความยาว 2-32)');
  }
  return provider;
}

export function normalizeTransRef(value: unknown): string | null {
  const ref = String(value ?? '').trim();
  if (!ref) return null;
  if (ref.length > 120) throw new SlipError('transRef ยาวเกิน 120 ตัวอักษร');
  return ref;
}

export function amountToSatang(value: unknown): number {
  const raw = String(value ?? '').trim().replace(/,/g, '');
  const baht = Number(raw);
  if (!Number.isFinite(baht) || baht <= 0) throw new SlipError('amount ต้องเป็นตัวเลขมากกว่า 0');
  if (baht > SLIP_MAX_AMOUNT_BAHT) throw new SlipError(`amount ต้องไม่เกิน ${SLIP_MAX_AMOUNT_BAHT.toLocaleString('en-US')} บาท`);
  const satang = toSatang(baht);
  if (!Number.isSafeInteger(satang) || satang <= 0 || satang > 2_147_483_647) {
    throw new SlipError('amount อยู่นอกช่วงที่ระบบรองรับ');
  }
  return satang;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isSlipUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function maskRef(ref: string | null): string | null {
  if (!ref) return null;
  return ref.length <= 4 ? '***' : `***${ref.slice(-4)}`;
}

export function serializeSlip(row: any) {
  return {
    id: row.id,
    businessId: row.businessId,
    orderId: row.orderId ?? null,
    provider: row.provider,
    transRef: row.transRef ?? null,
    amountSatang: row.amountSatang,
    currency: row.currency,
    status: row.status,
    imageMime: row.imageMime,
    imageSha256: row.imageSha256,
    imageSize: row.imageSize,
    note: row.note ?? null,
    uploadedBy: row.uploadedBy ?? null,
    reviewedBy: row.reviewedBy ?? null,
    reviewedAt: row.reviewedAt ?? null,
    reviewNote: row.reviewNote ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function audit(actionType: string, userId: string, payload: Record<string, unknown>): Promise<void> {
  await AuditService.logAction({ userId, actionType, payload });
}

export async function createPaymentSlip(input: {
  businessId: string;
  orderId?: unknown;
  provider?: unknown;
  transRef?: unknown;
  amount: unknown;
  note?: unknown;
  image: Buffer;
  uploadedBy: string;
}): Promise<ReturnType<typeof serializeSlip>> {
  if (!isSlipUuid(input.businessId)) throw new SlipError('businessId ไม่ถูกต้อง');
  const provider = normalizeProvider(input.provider);
  const transRef = normalizeTransRef(input.transRef);
  const amountSatang = amountToSatang(input.amount);
  const note = String(input.note ?? '').trim().slice(0, 500) || null;
  const image = input.image;

  if (!Buffer.isBuffer(image) || image.length === 0) throw new SlipError('ไม่พบไฟล์สลิป');
  if (image.length > SLIP_MAX_BYTES) throw new SlipError(`ไฟล์สลิปต้องไม่เกิน ${SLIP_MAX_BYTES / 1024 / 1024} MB`, 413);
  const imageMime = detectSlipMime(image);
  if (!imageMime) throw new SlipError('ไฟล์สลิปต้องเป็น PNG, JPEG หรือ WebP ที่ถูกต้อง');

  let orderId: string | null = null;
  if (input.orderId !== undefined && input.orderId !== null && String(input.orderId).trim() !== '') {
    orderId = String(input.orderId).trim();
    if (!isSlipUuid(orderId)) throw new SlipError('orderId ไม่ถูกต้อง');
    try {
      // ผ่าน service ของเจ้าของตาราง (business) — ไม่ query ตาราง business_orders ตรงจากโมดูล payments
      await getOrder(input.businessId, orderId);
    } catch {
      throw new SlipError('ไม่พบออเดอร์ในธุรกิจนี้', 404);
    }
  }

  const imageSha256 = crypto.createHash('sha256').update(image).digest('hex');
  const duplicate = await prisma.paymentSlip.findFirst({
    where: {
      OR: [
        { imageSha256 },
        ...(transRef ? [{ provider, transRef }] : []),
      ],
    },
    select: { id: true, imageSha256: true, provider: true, transRef: true },
  });
  if (duplicate) {
    throw new SlipError(
      duplicate.imageSha256 === imageSha256 ? 'สลิปภาพนี้ถูกอัปโหลดแล้ว' : 'เลขอ้างอิงสลิปนี้ถูกใช้แล้ว',
      409,
    );
  }

  let row: any;
  try {
    row = await prisma.paymentSlip.create({
      data: {
        businessId: input.businessId,
        orderId,
        provider,
        transRef,
        amountSatang,
        imageMime,
        imageSha256,
        imageSize: image.length,
        imageData: image,
        note,
        uploadedBy: input.uploadedBy,
      },
    });
  } catch (err: any) {
    // unique index คือด่านจริง — request พร้อมกันสองตัวอาจผ่าน pre-check ทั้งคู่
    if (err?.code === 'P2002') throw new SlipError('สลิปซ้ำ (ภาพหรือเลขอ้างอิง)', 409);
    throw err;
  }

  await audit('PAYMENT_SLIP_UPLOAD', input.uploadedBy, {
    slipId: row.id,
    businessId: row.businessId,
    orderId: row.orderId,
    provider: row.provider,
    transRef: maskRef(row.transRef),
    amountSatang: row.amountSatang,
    status: row.status,
  });
  return serializeSlip(row);
}

export async function listPaymentSlips(input: {
  businessId: string;
  status?: string | null;
  limit?: unknown;
}): Promise<Array<ReturnType<typeof serializeSlip>>> {
  if (!isSlipUuid(input.businessId)) throw new SlipError('businessId ไม่ถูกต้อง');
  const status = input.status ? String(input.status).toUpperCase() : '';
  if (status && !(SLIP_STATUSES as readonly string[]).includes(status)) {
    throw new SlipError('status ไม่ถูกต้อง');
  }
  const take = Math.max(1, Math.min(200, Math.round(Number(input.limit) || 50)));
  const rows = await prisma.paymentSlip.findMany({
    where: { businessId: input.businessId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      businessId: true,
      orderId: true,
      provider: true,
      transRef: true,
      amountSatang: true,
      currency: true,
      status: true,
      imageMime: true,
      imageSha256: true,
      imageSize: true,
      note: true,
      uploadedBy: true,
      reviewedBy: true,
      reviewedAt: true,
      reviewNote: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows.map(serializeSlip);
}

export async function getPaymentSlipImage(input: { businessId: string; id: string }): Promise<{ mime: string; data: Buffer } | null> {
  if (!isSlipUuid(input.businessId) || !isSlipUuid(input.id)) throw new SlipError('id ไม่ถูกต้อง');
  const row = await prisma.paymentSlip.findFirst({
    where: { id: input.id, businessId: input.businessId },
    select: { imageMime: true, imageData: true },
  });
  if (!row) return null;
  return { mime: row.imageMime, data: Buffer.from(row.imageData) };
}

export async function reviewPaymentSlip(input: {
  businessId: string;
  id: string;
  decision: unknown;
  note?: unknown;
  reviewedBy: string;
}): Promise<{ slip: ReturnType<typeof serializeSlip>; changed: boolean }> {
  if (!isSlipUuid(input.businessId) || !isSlipUuid(input.id)) throw new SlipError('id ไม่ถูกต้อง');
  const decision = String(input.decision ?? '').toUpperCase();
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    throw new SlipError('decision ต้องเป็น APPROVED หรือ REJECTED');
  }
  const reviewNote = String(input.note ?? '').trim().slice(0, 500) || null;

  const current = await prisma.paymentSlip.findFirst({ where: { id: input.id, businessId: input.businessId } });
  if (!current) throw new SlipError('ไม่พบสลิป', 404);
  if (current.status !== 'PENDING') {
    if (current.status === decision) return { slip: serializeSlip(current), changed: false };
    throw new SlipError(`สลิปถูกตรวจแล้ว (${current.status}) — เปลี่ยนคำตัดสินไม่ได้`, 409);
  }

  const result = await prisma.paymentSlip.updateMany({
    where: { id: input.id, businessId: input.businessId, status: 'PENDING' },
    data: {
      status: decision,
      reviewedBy: input.reviewedBy,
      reviewedAt: new Date(),
      reviewNote,
    },
  });
  if (result.count === 0) {
    const latest = await prisma.paymentSlip.findFirst({ where: { id: input.id, businessId: input.businessId } });
    if (latest && latest.status === decision) return { slip: serializeSlip(latest), changed: false };
    throw new SlipError('สลิปถูกตรวจโดยผู้ใช้อื่นแล้ว', 409);
  }

  const row = await prisma.paymentSlip.findUnique({ where: { id: input.id } });
  if (!row) throw new SlipError('ไม่พบสลิป', 404);
  await audit('PAYMENT_SLIP_REVIEW', input.reviewedBy, {
    slipId: row.id,
    businessId: row.businessId,
    orderId: row.orderId,
    decision,
    previousStatus: current.status,
    transRef: maskRef(row.transRef),
    amountSatang: row.amountSatang,
  });
  return { slip: serializeSlip(row), changed: true };
}
