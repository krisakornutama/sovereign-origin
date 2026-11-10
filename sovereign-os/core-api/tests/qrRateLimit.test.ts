// GET /api/util/qr — endpoint สาธารณะที่ไม่ต้องล็อกอิน และเป็นงาน CPU ทุกครั้ง
//
// ใช้สร้าง PNG จาก text ที่ client ส่งมา (สูงสุด 1024px) ⇒ ใครก็ยิงวนได้ไม่จำกัด
// ในเมื่อไม่แตะ DB และไม่ต้องมี token, มันจึงเป็นช่องเผา CPU/หน่วยความจำฟรี
// ที่ไม่ต้องมีบัญชีเลย — เพดานต่อ IP ทำให้ "พิมพ์สติกเกอร์ทั้งล็อต" ยังทำได้
// แต่การยิงวน 24 ชั่วโมงกลายเป็นเรื่องที่ถูกตัดจบ
import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import qrRoutes from '../src/modules/system/qr.routes';
import { createTestServer, TestServer } from './helpers';

const LIMIT_MAX = 240; // ต้องตรงกับค่า max ใน route

let server: TestServer;

test('เตรียมเซิร์ฟเวอร์', async () => {
  server = await createTestServer((app) => app.use('/api/util', qrRoutes));
});

test('คำขอปกติยังได้ PNG', async () => {
  const res = await fetch(`${server.baseUrl}/api/util/qr?text=SN-12345&size=128`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.ok(bytes.byteLength > 100, 'ต้องได้ไฟล์ PNG จริง');
});

test('ยิงรัวเกินเพดานต้องโดน 429 พร้อม Retry-After', async () => {
  let blocked: Response | null = null;
  for (let i = 0; i < LIMIT_MAX + 10; i += 1) {
    const res = await fetch(`${server.baseUrl}/api/util/qr?text=spam-${i}`);
    if (res.status === 429) {
      blocked = res;
      break;
    }
    assert.equal(res.status, 200, `คำขอที่ ${i + 1} ควรผ่านก่อนถึงเพดาน`);
    await res.arrayBuffer(); // ปล่อย body ให้หมด กัน socket ค้าง
  }
  assert.ok(blocked, `ยิง ${LIMIT_MAX + 10} ครั้งแล้วยังไม่ถูกจำกัดอัตราเลย`);
  assert.ok(blocked.headers.get('retry-after'), '429 ต้องบอก Retry-After ให้ client รอ');
});

test('ปิดเซิร์ฟเวอร์', async () => {
  await server.close();
});
