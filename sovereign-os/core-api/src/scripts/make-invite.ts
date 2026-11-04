// src/scripts/make-invite.ts
// CLI สำหรับ self-hosted: สร้างรหัสเชิญได้โดยไม่ต้องเข้าเว็บ
// docker compose -f deploy/community/docker-compose.yml exec api node dist/scripts/make-invite.js --role OPERATOR --days 7
import { createInvite } from '../services/invite.service';
import { prisma } from '../lib/prisma';

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const hoursArg = arg('hours', '');
  const daysArg = arg('days', '0');
  const result = await createInvite({
    role: arg('role', 'OPERATOR'),
    label: arg('label', 'CLI') || null,
    maxUses: Number(arg('uses', '1')),
    expiresInHours: hoursArg ? Number(hoursArg) : Number(daysArg) * 24,
  });
  console.log('');
  console.log('  รหัสเชิญ: ' + result.code);
  console.log('  บทบาท: ' + result.role + '  หมดอายุ: ' + (result.expiresAt ? result.expiresAt.toISOString() : 'ไม่หมดอายุ'));
  console.log('  หน้าสมัคร: /register?code=' + result.code);
  console.log('');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[make-invite] ' + (err?.message || err));
  await prisma.$disconnect();
  process.exit(1);
});
