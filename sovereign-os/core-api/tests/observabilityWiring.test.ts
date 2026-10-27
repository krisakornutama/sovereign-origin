// sovereign-os/core-api/tests/observabilityWiring.test.ts
//
// เทสต์ "ต่อสาย" — unit test ข้าง ๆ (observability.test.ts) พิสูจน์ว่าเครื่องมือทำงาน
// แต่ไม่ได้พิสูจน์ว่ามันถูกต่อเข้าของจริง (เคยพลาดมาแล้ว: ฟีเจอร์ดีแต่ไม่มีใครเรียก)
//
// ที่ตรวจ:
//   1) server.ts ติด requestContext "ก่อน" body parser (ไม่งั้นคำขอที่ body เสียไม่ถูก log)
//   2) routes.ts mount GET /api/metrics จริง และไม่ผ่าน authenticate (Prometheus ไม่มี user)
//   3) config อ่าน METRICS_TOKEN / TENANT_ID จาก env
//   4) error response พา requestId กลับไปให้ผู้ใช้ (ผู้ใช้แจ้งเลข → ไล่ log ได้)
//   5) frontend แนบ x-request-id ไปกับทุกคำขอ (trace ข้าม frontend → API)
import './setup-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(__dirname, '..', 'src');
const FRONTEND = path.join(__dirname, '..', '..', '..', 'sovereign-frontend', 'src');
const read = (p: string) => fs.readFileSync(p, 'utf8');

describe('ต่อสาย observability เข้ากับของจริง', () => {
  test('server.ts ใช้ requestContext และอยู่ก่อน body parser', () => {
    const server = read(path.join(SRC, 'server.ts'));
    const at = server.indexOf('getObservability().requestContext');
    assert.ok(at > -1, 'server.ts ต้อง app.use(getObservability().requestContext)');
    const bodyParser = server.indexOf('applyJsonBodyParsers(app)');
    assert.ok(bodyParser > -1, 'ต้องยังมี applyJsonBodyParsers(app)');
    assert.ok(
      at < bodyParser,
      'requestContext ต้องมาก่อน applyJsonBodyParsers — ไม่งั้นคำขอที่ body เสีย (413/400) จะหายจาก log',
    );
    assert.ok(
      server.indexOf('app.set(\'trust proxy\'') < at,
      'ต้องตั้ง trust proxy ก่อน — ไม่งั้น log/metric ของ IP ผิดเมื่ออยู่หลัง proxy',
    );
  });

  test('routes.ts mount GET /api/metrics แบบไม่ต้อง authenticate', () => {
    const routes = read(path.join(SRC, 'routes.ts'));
    const line = routes
      .split(/\r?\n/)
      .find((l) => l.includes("'/api/metrics'") || l.includes('"/api/metrics"'));
    assert.ok(line, 'routes.ts ต้องมี app.get(\'/api/metrics\', ...)');
    assert.match(String(line), /metricsHandler/, 'ต้องใช้ metricsHandler จาก observability');
    assert.doesNotMatch(String(line), /authenticate|featureGuard/, 'Prometheus ไม่มี user — ห้ามครอบ auth ของแอป');
  });

  test('config อ่าน METRICS_TOKEN / TENANT_ID และ default tenant = default', () => {
    const cfg = read(path.join(SRC, 'config', 'index.ts'));
    assert.match(cfg, /metricsToken:\s*\(process\.env\.METRICS_TOKEN/, 'ต้องอ่าน METRICS_TOKEN จาก env');
    assert.match(cfg, /tenantId:\s*\(process\.env\.TENANT_ID/, 'ต้องอ่าน TENANT_ID จาก env');
    assert.match(cfg, /'default'/, 'tenant ว่างต้องตกเป็น default');
    assert.match(cfg, /process\.env\.ACCESS_LOG/, 'ต้องมีสวิตช์ ACCESS_LOG (ดิสก์เล็ก/ต้องการ log น้อย)');
  });

  test('error response พา requestId กลับไป', () => {
    const mw = read(path.join(SRC, 'middleware', 'error.middleware.ts'));
    assert.match(mw, /res\.locals\??\.requestId/, 'ต้องอ่าน requestId จาก res.locals');
    assert.match(mw, /Internal server error', \.\.\.withId/, '500 ต้องมี requestId ใน body');
    assert.match(mw, /code, \.\.\.withId/, '4xx ต้องมี requestId ใน body');
  });

  test('frontend แนบ x-request-id ทุกคำขอ', () => {
    const api = read(path.join(FRONTEND, 'lib', 'apiFetch.ts'));
    assert.match(api, /newRequestId/, 'apiFetch ต้องสร้าง request id');
    assert.match(api, /headers\['x-request-id'\] = requestId/, 'ต้องแนบ header x-request-id จริง');
  });
});
