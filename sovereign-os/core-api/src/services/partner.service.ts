// src/services/partner.service.ts
//
// PARTNER NETWORK (P16) — ร้านค้า SME/ช่าง/ผู้ให้บริการ สมัครเข้าแผนที่ร่วม
// หลักการ:
//  - สมัครสาธารณะ → PENDING (ข้อมูลติดต่อผู้สมัครไม่ออกสาธารณะ)
//  - เจ้าของอนุมัติ → ACTIVE ถึงโชว์บนแผนที่/รายชื่อ (โชว์เฉพาะของสาธารณะ: ชื่อ/หมวด/รายละเอียด/ที่อยู่/เบอร์ร้าน/pin)
//  - ปฏิเสธ/สแปม = REJECTED (เก็บไว้ดูแพตเทิร์น ไม่โชว์)
//  - honeypot `website` กันบอทเหมือนระบบ feedback/track
import { prisma } from '../lib/prisma';
import { ipHashOf } from './feedback.service';

// แจ้งเตือน Telegram ทันทีเมื่อมีใบสมัครใหม่ (P16 คำสั่งเจ้าของ 30/9/69 — ไม่ต้องรอ digest วันจันทร์)
//  fire-and-forget: ส่งไม่สำเร็จ = บันทึก console อย่างเดียว — การสมัครต้องสำเร็จปกติเสมอ
async function notifyNewPartner(p: { id: string; name: string; category: string; contactName: string; contactPhone: string }): Promise<void> {
  try {
    const { getTelegramCredentials } = await import('./telegram-credentials.service');
    const creds = await getTelegramCredentials();
    if (!creds.botToken || !creds.chatId) return;
    const axios = (await import('axios')).default;
    const CAT: Record<string, string> = { SHOP: '🏪 ร้านค้า', TECHNICIAN: '🔧 ช่าง', SERVICE: '🛠️ บริการ', OTHER: '🤝 อื่น ๆ' };
    const msg = [
      `🤝 <b>ใบสมัครคู่ค้าใหม่</b> (${CAT[p.category] ?? p.category})`,
      `ชื่อ: <b>${p.name.replace(/[<>&]/g, '')}</b>`,
      `ติดต่อ: ${p.contactName.replace(/[<>&]/g, '')} · ${p.contactPhone.replace(/[<>&]/g, '')}`,
      '',
      `อนุมัติได้ที่: ${process.env.PUBLIC_APP_URL || ''}/feedback-admin`,
    ].join('\n');
    await axios.post(`https://api.telegram.org/bot${creds.botToken}/sendMessage`, {
      chat_id: creds.chatId, text: msg, parse_mode: 'HTML',
    });
  } catch (err) {
    console.error('[partner] แจ้งเตือนสมัครใหม่ไม่สำเร็จ (ไม่กระทบการสมัคร):', err instanceof Error ? err.message : err);
  }
}

const CATEGORIES = ['SHOP', 'TECHNICIAN', 'SERVICE', 'OTHER'] as const;

export interface PartnerApplyInput {
  name?: string;
  category?: string;
  detail?: string;
  address?: string;
  phone?: string;
  lat?: number;
  lng?: number;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  website?: string; // honeypot — ต้องว่างเสมอ
  ip?: string;
  userAgent?: string;
}

export type PartnerApplyResult =
  | { accepted: true; id: string }
  | { accepted: false; reason: 'honeypot' | 'invalid' };

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max) || null;

/** สมัครพาร์ทเนอร์ — ของเพี้ยน/บอท = ทิ้งเงียบ */
export async function applyPartner(input: PartnerApplyInput): Promise<PartnerApplyResult> {
  if (String(input.website ?? '').trim() !== '') return { accepted: false, reason: 'honeypot' };

  const name = str(input.name, 120);
  const contactName = str(input.contactName, 120);
  const contactPhone = str(input.contactPhone, 40);
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (!name || name.length < 2) return { accepted: false, reason: 'invalid' };
  if (!contactName || !contactPhone) return { accepted: false, reason: 'invalid' };
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { accepted: false, reason: 'invalid' };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { accepted: false, reason: 'invalid' };

  const category = (CATEGORIES as readonly string[]).includes(String(input.category)) ? String(input.category) : 'OTHER';
  const row = await prisma.partner.create({
    data: {
      name,
      category,
      detail: str(input.detail, 400),
      address: str(input.address, 300),
      phone: str(input.phone, 40),
      lat,
      lng,
      contactName,
      contactPhone,
      contactEmail: str(input.contactEmail, 120),
      user_agent: str(input.userAgent, 200),
      ip_hash: input.ip ? ipHashOf(input.ip) : null,
    },
  });
  void notifyNewPartner({ id: row.id, name, category, contactName, contactPhone }); // ไม่ await — สมัครตอบ 202 ทันที
  return { accepted: true, id: row.id };
}

/** แผนที่/รายชื่อสาธารณะ — เฉพาะ ACTIVE และเฉพาะฟิลด์สาธารณะ (ตัดข้อมูลติดต่อผู้สมัครทิ้ง) */
export async function publicPartners(): Promise<Array<{
  id: string; name: string; category: string; detail: string | null;
  address: string | null; phone: string | null; lat: number; lng: number;
}>> {
  const rows = await prisma.partner.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { created_at: 'asc' },
    select: {
      id: true, name: true, category: true, detail: true,
      address: true, phone: true, lat: true, lng: true,
    },
  });
  return rows;
}

/** จำนวนพาร์ทเนอร์ (โชว์หน้าแรก — เลขจริงจาก DB เฉพาะ ACTIVE) */
export async function partnerCounts(): Promise<{ active: number; pending: number }> {
  const [active, pending] = await Promise.all([
    prisma.partner.count({ where: { status: 'ACTIVE' } }),
    prisma.partner.count({ where: { status: 'PENDING' } }),
  ]);
  return { active, pending };
}
