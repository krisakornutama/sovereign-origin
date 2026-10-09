// sovereign-os/core-api/scripts/issue-machine-token.ts
//
// ออก machine token บน HUB โดยไม่ต้องกด "ลงทะเบียนเครื่องใหม่" ในหน้าเว็บ
// ใช้โดย tools/agent-pack/pack.mjs เพื่อฝัง token ลงชุดติดตั้งเครื่องลูก
//
//   npx tsx scripts/issue-machine-token.ts --name="คอมเครื่องที่ 2" [--executors=echo] [--json]
//
// ความปลอดภัย: DB เก็บแค่ sha256(token) → token นี้พิมพ์ได้ครั้งเดียวตอนออก
// ถ้าเครื่องปลายทางไม่ได้ติดตั้งจริง ให้ลบเครื่องนั้นในหน้า HUB แล้วออกใหม่
import { prisma, registerMachine, generateToken, hashToken } from '../src/services/agent-machines.service';

function arg(name: string, fallback = ''): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const name = arg('name').trim();
  if (!name) {
    console.error('ต้องระบุ --name=<ชื่อเครื่อง>');
    process.exit(2);
  }
  const executors = arg('executors', 'echo')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const note = arg('note', 'ออกให้โดย tools/agent-pack (ชุดติดตั้งเครื่องลูก)');
  const json = has('json');

  const existing = await prisma.agentMachine.findFirst({
    where: { name },
    select: { id: true, status: true, last_heartbeat: true },
  });

  let machine: { id: string; name: string };
  let token: string;
  let reused = false;

  if (existing && !has('force') && existing.last_heartbeat) {
    // เคยออนไลน์แล้ว = ห้ามออก token ทับเงียบ ๆ (เครื่องที่รันอยู่จะหลุดจาก HUB ทันที)
    if (json) {
      process.stdout.write(
        JSON.stringify({
          error: 'name_exists',
          id: existing.id,
          status: existing.status,
          lastHeartbeat: existing.last_heartbeat.toISOString(),
        }) + '\n'
      );
    }
    console.error(
      `มีเครื่องชื่อ "${name}" ที่เคยออนไลน์แล้ว (id ${existing.id}) — ใช้ชื่ออื่น หรือส่ง --force ` +
        'ถ้าตั้งใจเปลี่ยน token (เครื่องที่ใช้ token เก่าจะต่อ HUB ไม่ได้ทันที)'
    );
    process.exit(3);
  }

  if (existing) {
    // แถวค้างจากการแพ็กที่ล้มกลางทาง (ยังไม่เคยออนไลน์) → หมุน token ของแถวเดิม ไม่สร้างแถวซ้ำ
    token = generateToken();
    await prisma.agentMachine.update({
      where: { id: existing.id },
      data: { token_hash: hashToken(token), executors, note, status: 'offline', version: null },
    });
    machine = { id: existing.id, name };
    reused = true;
  } else {
    const created = await registerMachine({ name, executors, note, os: arg('os', 'windows') });
    machine = { id: created.machine.id, name: created.machine.name };
    token = created.token;
  }

  if (json) {
    process.stdout.write(JSON.stringify({ id: machine.id, name: machine.name, executors, token, reused }) + '\n');
  } else {
    console.log(`เครื่อง : ${machine.name} (${machine.id})`);
    console.log(`executors: ${executors.join(', ')}`);
    console.log(`token   : ${token}`);
    console.log('เก็บ token นี้ใน .env ของเครื่องปลายทางเท่านั้น (แสดงครั้งเดียว)');
  }
  await prisma.$disconnect();
}

main().catch(async (err: unknown) => {
  console.error(String((err as Error)?.message ?? err));
  try {
    await prisma.$disconnect();
  } catch {
    // ปิดไม่ได้ก็ไม่เป็นไร — งานหลักล้มไปแล้ว
  }
  process.exit(1);
});
