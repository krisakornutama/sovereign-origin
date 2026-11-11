// ─────────────────────────────────────────────────────────────
// Upload hardening ชั้นที่สอง
//   1) magic bytes ของโค้ดที่รันได้ยังไม่ครบ — เดิมจับแค่ MZ (PE) กับ ELF
//      ⇒ ไฟล์ Mach-O (macOS/iOS) / Java class / WebAssembly ผ่านด่านได้
//   2) disk-mode upload: ถ้าบันทึกลง DB ไม่สำเร็จ ไฟล์ที่ multer เขียนไว้แล้วค้างบนดิสก์
//      ⇒ ไม่มีแถวไหนอ้างถึง แต่ไฟล์ยังกินที่และยังถูกเสิร์ฟถ้ารู้ path
// ─────────────────────────────────────────────────────────────
import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyUploadedContent } from '../src/lib/harden-upload';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

test('verifyUploadedContent: ปฏิเสธ Mach-O / Java class / WebAssembly แม้นามสกุลจะดูปลอดภัย', () => {
  const cases: Array<[string, number[]]> = [
    ['notes.txt', [0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x02]],
    ['notes.md', [0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00, 0x00, 0x01]],
    ['notes.txt', [0xfe, 0xed, 0xfa, 0xce, 0x00, 0x00, 0x00, 0x00]],
    ['notes.md', [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]],
  ];
  for (const [name, bytes] of cases) {
    assert.throws(
      () => verifyUploadedContent({ originalname: name, buffer: Buffer.from(bytes) }),
      /executable|โค้ด/,
      `${name} ที่ขึ้นต้นด้วย ${bytes.map((b) => b.toString(16)).join(' ')} ต้องถูกปฏิเสธ`,
    );
  }
});

test('knowledge upload: DB ล้ม ⇒ ไฟล์ที่ multer เขียนไว้ต้องถูกลบ ไม่ค้างบนดิสก์', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-knowledge-cleanup-'));
  const uploads = path.join(dir, 'uploads');
  process.env.KNOWLEDGE_DIR = dir;
  fs.mkdirSync(uploads, { recursive: true });

  mockModel(prisma, 'knowledgeItem', {
    create: async () => {
      throw new Error('db down');
    },
    findMany: async () => [],
    findUnique: async () => null,
    update: async () => null,
    delete: async () => null,
    count: async () => 0,
  });

  const router = (await import('../src/modules/knowledge/knowledge.routes')).default;
  const server: TestServer = await createTestServer((app) => app.use('/api/knowledge', router));
  try {
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from('hello world')], { type: 'text/plain' }), 'note.txt');
    const res = await fetch(`${server.baseUrl}/api/knowledge/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` },
      body: fd,
    });
    assert.equal(res.status, 500, 'ต้องรายงานว่าล้ม');
    const left = fs.readdirSync(uploads);
    assert.deepEqual(left, [], `ไฟล์ต้องไม่ค้างบนดิสก์ (พบ ${left.join(', ')})`);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
