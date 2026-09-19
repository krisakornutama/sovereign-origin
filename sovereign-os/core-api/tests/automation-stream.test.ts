import './setup-env';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import automationRoutes from '../src/modules/automation/automation.routes';
import { automationEmitter } from '../src/services/automation.service';
import { createTestServer, makeToken, TestServer } from './helpers';

// ── ด่าน SSE /alerts/stream: ต้อง query-token (JWT + mfa_verified) แบบเดียวกับ nextgen/events ──
// เดิมเส้นทางนี้เปิดหมด — จับได้จากการทดสอบระบบ 19 ก.ย. 2026 (frontend ไม่ได้ใช้เส้นนี้ แต่มันเปิดอยู่จริง)
describe('automation /alerts/stream — ด่าน query-token (SSE)', () => {
  let server: TestServer;

  before(async () => {
    server = await createTestServer((app) => app.use('/api/automation', automationRoutes));
  });
  after(async () => {
    await server.close();
  });

  test('ไม่มี token → 401', async () => {
    const res = await fetch(`${server.baseUrl}/api/automation/alerts/stream`);
    assert.equal(res.status, 401);
  });

  test('token ปลอม → 401 (ไม่ crash)', async () => {
    const res = await fetch(`${server.baseUrl}/api/automation/alerts/stream?token=not-a-jwt`);
    assert.equal(res.status, 401);
  });

  test('token ถูกแต่ยังไม่ MFA → 403', async () => {
    const token = makeToken('SUPERADMIN', { mfa_verified: false });
    const res = await fetch(`${server.baseUrl}/api/automation/alerts/stream?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 403);
  });

  test('token ถูก → 200 event-stream และได้ข้อมูลจริงเมื่อมี alert', async () => {
    const token = makeToken();
    const ac = new AbortController();
    // SSE จะ flush header เมื่อมี alert แรก — emit ซ้ำเป็นจังหวะจนคำขอผูกกับ listener เสมอ
    const emit = () => automationEmitter.emit('alert', { metric: 'test', message: 'probe', severity: 'info' });
    const timer = setInterval(emit, 40);
    try {
      const res = await fetch(`${server.baseUrl}/api/automation/alerts/stream?token=${encodeURIComponent(token)}`, {
        signal: ac.signal,
      });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /text\/event-stream/);

      const reader = res.body!.getReader();
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      assert.ok(text.includes('data: '), `ต้องได้ SSE data — ได้: ${text.slice(0, 80)}`);
    } finally {
      clearInterval(timer);
      ac.abort(); // ปิด socket ทันที → server เอา listener ออกเองผ่าน req.on('close') และโปรเซสเทสจบสะอาด
    }
  });
});
