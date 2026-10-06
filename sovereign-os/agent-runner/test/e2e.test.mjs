// test/e2e.test.mjs — e2e จำลอง: runner จริง ↔ HUB จำลอง (HTTP server จริง)
//
// พิสูจน์ว่าชิ้นทั้งหมดต่อกันได้จริง ไม่ใช่แค่ผ่าน mock
// - ยก HTTP server จริงบนพอร์ตสุ่ม
// - ให้ runner จริง (src/runner.mjs) ยิงมาจริงผ่าน fetch
// - ตรวจว่า heartbeat → pull → run → report เรียงลำดับถูก
// - รวมถึงเคส HUB ปฏิเสธ token ผิด (401)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pollOnce, runJob, uploadScreenshot } from '../src/runner.mjs';

function startFakeHub({ jobs = [], token = 'tok-abc' } = {}) {
  const seen = { paths: [], auth: [], results: [] };
  const queued = [...jobs];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.paths.push(req.url);
      seen.auth.push(req.headers['x-machine-token'] || null);
      if ((req.headers['x-machine-token'] || '') !== token) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid machine token' }));
        return;
      }
      const parsed = body ? JSON.parse(body) : {};
      if (req.url === '/api/agent-machines/heartbeat') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ machine: { status: 'online' } }));
        return;
      }
      if (req.url === '/api/agent-machines/jobs/pull') {
        const take = queued.splice(0, parsed.limit || 3);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jobs: take }));
        return;
      }
      if (req.url?.startsWith('/api/agent-machines/jobs/') && req.url.endsWith('/result')) {
        seen.results.push(parsed);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ job: { id: 'x', status: parsed.status } }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        seen,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function makeHubClient(baseUrl, token) {
  const call = async (path, body) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-machine-token': token },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`${path} -> HTTP ${res.status} ${t.slice(0, 120)}`);
    }
    return await res.json();
  };
  return {
    heartbeat: () => call('/api/agent-machines/heartbeat', {}),
    pullJobs: () => call('/api/agent-machines/jobs/pull', { limit: 3 }),
    reportResult: (id, payload) => call(`/api/agent-machines/jobs/${id}/result`, payload),
  };
}

test('e2e — runner ดึงงานจาก HUB จริง รัน และส่งผลกลับครบวงจร', async () => {
  const hub = await startFakeHub({
    jobs: [
      { id: 'e2e-1', executor: 'echo', prompt: 'ทดสอบสายตรง' },
      { id: 'e2e-2', executor: 'echo', prompt: 'งานที่สอง' },
    ],
  });
  try {
    const client = makeHubClient(hub.baseUrl, 'tok-abc');
    const out = await pollOnce({ hub: client, runner: { machineName: 'runner-a' }, machineName: 'runner-a' });

    assert.equal(out.error, undefined, 'ไม่ควรมี error');
    assert.equal(out.dispatched, 2);
    assert.equal(out.failed, 0);
    assert.deepEqual(hub.seen.paths, [
      '/api/agent-machines/heartbeat',
      '/api/agent-machines/jobs/pull',
      '/api/agent-machines/jobs/e2e-1/result',
      '/api/agent-machines/jobs/e2e-2/result',
    ]);
    assert.equal(hub.seen.results.length, 2);
    for (const r of hub.seen.results) {
      assert.equal(r.status, 'done');
      assert.equal(r.exitCode, 0);
      assert.match(r.result, /runner-a/);
    }
    // token ต้องถูกส่งทุกคำขอ
    for (const a of hub.seen.auth) assert.equal(a, 'tok-abc');
  } finally {
    await hub.close();
  }
});

test('e2e — HUB ปฏิเสธ token ผิด → runner รายงาน error ไม่ crash', async () => {
  const hub = await startFakeHub({ jobs: [{ id: 'e2e-x', executor: 'echo', prompt: 'x' }], token: 'right-token' });
  try {
    const client = makeHubClient(hub.baseUrl, 'wrong-token');
    const out = await pollOnce({ hub: client, runner: { machineName: 'runner-a' }, machineName: 'runner-a' });
    assert.equal(out.dispatched, 0);
    assert.match(out.error, /401/);
  } finally {
    await hub.close();
  }
});

test('e2e — งานที่ executor ใช้ไม่ได้ ต้องรายงาน error กลับ HUB (ห้ามเงียบ)', async () => {
  const hub = await startFakeHub({ jobs: [{ id: 'e2e-bad', executor: 'freebuff', prompt: 'งานที่ทำไม่ได้' }] });
  try {
    const client = makeHubClient(hub.baseUrl, 'tok-abc');
    const out = await pollOnce({ hub: client, runner: { machineName: 'runner-a' }, machineName: 'runner-a' });
    assert.equal(out.dispatched, 1);
    assert.equal(out.failed, 1);
    assert.equal(hub.seen.results[0].status, 'error');
    assert.match(hub.seen.results[0].error, /freebuff|headless/i);
  } finally {
    await hub.close();
  }
});

// red-first (chunk 2): ฟอร์แมต multipart ที่ runner ส่ง ต้องตรงกับที่ HUB route รับ
// (field 'file' · header x-machine-token · path /jobs/:id/screenshot) — ผิดจุดเดียว = ภาพไม่ถึง

test('e2e — อัปโหลดภาพหน้าจอเป็น multipart ฟิลด์ file พร้อม x-machine-token ให้ HUB จริง', async () => {
  const received = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({
        url: req.url,
        token: req.headers['x-machine-token'],
        ctype: req.headers['content-type'],
        body: Buffer.concat(chunks).toString('latin1'),
      });
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, screenshotUrl: '/api/agent-machines/screenshots/x.png' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const out = await uploadScreenshot({
      hubUrl: `http://127.0.0.1:${port}`,
      token: 'tok-abc',
      jobId: 'j-1',
      buffer: Buffer.from('PNGDATA'),
    });
    assert.equal(out.screenshotUrl, '/api/agent-machines/screenshots/x.png');
    assert.equal(received.length, 1);
    assert.equal(received[0].url, '/api/agent-machines/jobs/j-1/screenshot');
    assert.equal(received[0].token, 'tok-abc');
    assert.match(received[0].ctype, /^multipart\/form-data; boundary=/);
    assert.match(received[0].body, /name="file"/);
    assert.match(received[0].body, /filename="screenshot\.png"/);
    assert.match(received[0].body, /PNGDATA/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('e2e — HUB ตอบปฏิเสธการอัปโหลด ต้อง throw ให้ caller จับได้', async () => {
  const server = createServer((req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid machine token' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    await assert.rejects(
      () => uploadScreenshot({ hubUrl: `http://127.0.0.1:${port}`, token: 'bad', jobId: 'j-1', buffer: Buffer.from('x') }),
      /401/,
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('e2e — runJob คืนผลที่รายงานกลับได้ครบทุกฟิลด์', async () => {
  const r = await runJob({ id: 'j', executor: 'echo', prompt: 'ตรวจฟิลด์' }, { machineName: 'runner-b' });
  assert.deepEqual(Object.keys(r).sort(), ['exitCode', 'logTail', 'status', 'summary'].sort());
  assert.equal(r.status, 'done');
  assert.match(r.summary, /runner-b/);
  assert.match(r.summary, /ตรวจฟิลด์/);
});