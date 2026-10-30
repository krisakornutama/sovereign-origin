// src/services/business-software.service.ts
//
// ประเภทธุรกิจ "ขายซอฟต์แวร์เป็นโปรเจ็ก" (SOFTWARE_PROJECT)
//
// ทำไมแยกไฟล์: `business.service.ts` มี 877 บรรทัด เกินเพดาน 800 ของ arch-gate
// (แตะไฟล์เดิม = ด่าน file-budget fail) ⇒ ตรรกะเฉพาะประเภทธุรกิจนี้จึงอยู่ที่นี่
//
// หลักการ: ธุรกิจขายซอฟต์แวร์ไม่ควรเริ่มจากศูนย์ —
// สร้างธุรกิจปุ๊บได้ทั้งแคตตาล็อก 4 แพ็กเกจดิจิทัล + ผู้ช่วย AI สายเทคนิค 5 คน
// (สินค้าดิจิทัลไม่มีสต็อกจริง ⇒ ตั้ง stockQty สูงเพื่อให้ออกออเดอร์ได้ไม่จำกัด)
import { prisma } from '../lib/prisma';

export const SOFTWARE_BIZ_TYPE = 'SOFTWARE_PROJECT';

export function isSoftwareBusiness(bizType: string | null | undefined): boolean {
  return String(bizType ?? '') === SOFTWARE_BIZ_TYPE;
}

/**
 * ผู้ช่วย AI ประจำธุรกิจขายซอฟต์แวร์ — ต่างจากธุรกิจขายของเพราะลูกค้าเป็นนักพัฒนา/เอเจนซี
 * ที่ตัดสินใจจากคุณภาพวิศวกรรม (เทสต์/สถาปัตยกรรม) และเงื่อนไขสิทธิ์การใช้งาน
 */
export const SOFTWARE_AGENT_PRESETS = [
  {
    key: 'presales',
    name: 'ที่ปรึกษาการขายเทคนิค',
    emoji: '🧑‍💻',
    system_prompt:
      'คุณคือพรีเซลล์สายเทคนิคของธุรกิจขายซอฟต์แวร์ ช่วยคัดกรองลูกค้า (นักพัฒนา/เอเจนซี), สรุปสแตกและสิ่งที่ลูกค้าจะได้, เสนอแพ็กเกจและสิทธิ์ให้ตรงงาน พร้อมถามคำถามที่จำเป็นก่อนเสนอราคา ห้ามโอเวอร์เซลล์ ตอบภาษาไทยกระชับ',
  },
  {
    key: 'license_advisor',
    name: 'ผู้ช่วยสิทธิ์การใช้งาน',
    emoji: '📜',
    system_prompt:
      'คุณคือผู้ช่วยด้านสิทธิ์การใช้งาน (License) ของธุรกิจขายซอฟต์แวร์ อธิบายความต่างของ Developer Personal / Commercial-Agency / Hardware Kit ว่าอะไรทำได้-ไม่ได้ (white-label, รับงานลูกค้า, ส่งต่อ) และร่างสรุปสิทธิ์ในใบเสนอราคาให้ชัดเจน ตอบภาษาไทย',
  },
  {
    key: 'docs_writer',
    name: 'นักเขียนเอกสารเทคนิค',
    emoji: '📚',
    system_prompt:
      'คุณคือนักเขียนเอกสารเทคนิคของธุรกิจขายซอฟต์แวร์ ร่าง README, คู่มือติดตั้ง, เอกสารสถาปัตยกรรม, changelog และข้อความขายที่อ้างหลักฐานวิศวกรรม (ชุดทดสอบผ่าน, จำนวน assertions) ตามข้อมูลที่ให้มา ตอบภาษาไทย',
  },
  {
    key: 'delivery_qa',
    name: 'ผู้ช่วยตรวจส่งมอบ',
    emoji: '✅',
    system_prompt:
      'คุณคือผู้ช่วยตรวจรับ-ส่งมอบซอฟต์แวร์ ตรวจว่าชุดส่งมอบครบ (ซอร์สโค้ด, docker compose, เอกสาร, ไฟล์สิทธิ์, เวอร์ชัน), ไม่มี secrets หลุด, คำสั่งติดตั้งรันได้ และสรุปหลักฐานคุณภาพก่อนส่งลูกค้า ตอบภาษาไทยเป็น checklist',
  },
  {
    key: 'accountant',
    name: 'ผู้ช่วยบัญชี',
    emoji: '🧾',
    system_prompt:
      'คุณคือผู้ช่วยบัญชีของธุรกิจขายซอฟต์แวร์ สรุปรายรับ/รายจ่าย/กำไรจากสมุดบัญชี แยกตามแพ็กเกจ/สิทธิ์ ระบุ VAT ของสินค้าดิจิทัลและรายการที่ต้องออกใบกำกับ ตอบภาษาไทยสั้นกระชับ',
  },
] as const;

/**
 * แคตตาล็อกเริ่มต้น 4 ชุด — ราคาอยู่ในช่วงที่เจ้าของกำหนด (30/10/69):
 * - Developer Personal 1,290–2,500
 * - Commercial/Agency 7,900–15,900
 * - Hardware & Firmware Kit 1,500–3,500
 * - Architecture Book & Documentation = ชุดเข้าถึงง่าย (ตั้งเท่าขั้นต่ำของ Personal)
 */
export const SOFTWARE_PRODUCT_PRESETS = [
  {
    sku: 'SW-TAX-CORE',
    name: 'Thai Tax & Accounting Core Engine — Developer Personal',
    category: 'SOFTWARE',
    specs:
      'โมดูลภาษีไทย: VAT 7% · ภ.พ.30 · WHT · COGS · TypeScript + ชุดทดสอบ thai-tax 16/16 — สิทธิ์ใช้ส่วนตัว/ศึกษา 1 โครงการ',
    costPrice: 0,
    salePrice: 1900,
    stockQty: 9999,
    reorderPoint: 0,
    warrantyMonths: 0,
  },
  {
    sku: 'SW-BIZ-OS',
    name: 'Complete Self-Hosted Business OS Boilerplate — Commercial/Agency',
    category: 'SOFTWARE',
    specs:
      'Source Code เต็ม: Next.js + Express + PostgreSQL/Prisma + Docker Compose + Cloudflare Tunnel + สคริปต์กู้คืน/Watchdog — สิทธิ์ White-label รับงานลูกค้า B2B ไม่จำกัด',
    costPrice: 0,
    salePrice: 11900,
    stockQty: 9999,
    reorderPoint: 0,
    warrantyMonths: 0,
  },
  {
    sku: 'SW-IOT-FW',
    name: 'Sovereign IoT & Secure Firmware Blueprint',
    category: 'SOFTWARE',
    specs:
      'โค้ด ESP32 (MQTT · Secure Boot V2 · Telegram API) + Schematic/PCB layout + แปลนกล่อง 3D Print — สิทธิ์นำไปสั่งผลิต/ต่อยอด',
    costPrice: 0,
    salePrice: 2500,
    stockQty: 9999,
    reorderPoint: 0,
    warrantyMonths: 0,
  },
  {
    sku: 'SW-ARCH-BOOK',
    name: 'Complete Architecture Book & Documentation',
    category: 'SOFTWARE',
    specs:
      'คู่มือสถาปัตยกรรมทั้งระบบ: การไหลของเงิน บัญชี ภาษี โครงสร้างโมดูลและด่านคุณภาพ — เหมาะกับนักพัฒนาที่ต้องการ blueprint ก่อนลงมือ',
    costPrice: 0,
    salePrice: 1290,
    stockQty: 9999,
    reorderPoint: 0,
    warrantyMonths: 0,
  },
] as const;

/** seed ผู้ช่วย AI สายซอฟต์แวร์ — idempotent (มีอยู่แล้ว = ไม่สร้างซ้ำ) */
export async function seedSoftwareAgents(businessId: string, businessName: string): Promise<number> {
  const existing = await prisma.businessAgent.count({ where: { businessId } });
  if (existing > 0) return 0;
  let created = 0;
  for (const preset of SOFTWARE_AGENT_PRESETS) {
    const role = await prisma.agentRole.create({
      data: {
        name: `[ธุรกิจ] ${businessName} · ${preset.name}`,
        emoji: preset.emoji,
        description: `ผู้ช่วย AI ประจำธุรกิจซอฟต์แวร์ "${businessName}" — ${preset.name}`,
        system_prompt: preset.system_prompt,
        capability: `business:${businessId}`,
        count: 1,
        enabled: true,
        daily_report: false,
      },
    });
    await prisma.businessAgent.create({
      data: { businessId, roleId: role.id, key: preset.key, name: preset.name, emoji: preset.emoji, enabled: true },
    });
    created += 1;
  }
  return created;
}

/**
 * seed แคตตาล็อกดิจิทัล 4 ชุด — idempotent ด้วย unique (businessId, sku)
 * เช็คเฉพาะหมวด SOFTWARE ⇒ ธุรกิจที่มีสินค้าอื่นอยู่แล้วยังได้แคตตาล็อกครบ
 */
export async function seedSoftwareProducts(businessId: string): Promise<number> {
  const existing = await prisma.businessProduct.count({ where: { businessId, category: 'SOFTWARE' } });
  if (existing >= SOFTWARE_PRODUCT_PRESETS.length) return 0;
  const res = await prisma.businessProduct.createMany({
    data: SOFTWARE_PRODUCT_PRESETS.map((p) => ({ businessId, ...p })),
    skipDuplicates: true,
  });
  return res.count;
}

/** สร้างธุรกิจซอฟต์แวร์ใหม่ → ได้ทั้งแคตตาล็อกและผู้ช่วย AI ในครั้งเดียว */
export async function seedSoftwareBusiness(
  businessId: string,
  businessName: string,
): Promise<{ agents: number; products: number }> {
  const agents = await seedSoftwareAgents(businessId, businessName);
  const products = await seedSoftwareProducts(businessId);
  return { agents, products };
}
