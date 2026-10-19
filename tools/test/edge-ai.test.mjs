import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

import {
  loadProfiles,
  pickProfile,
  fitProfileToHardware,
  buildConfig,
  validateConfig,
  modelListForPull
} from '../../sovereign-os/edge-ai/lib/config.mjs';
import { recommendProfile } from '../../sovereign-os/edge-ai/lib/hardware.mjs';
import {
  resolveModel,
  normalizeRequest,
  truncateMessages,
  cacheKey,
  shouldCache,
  estimateMemoryGB,
  applyThinkingPolicy,
  parseThinkHeader,
  ModelSelectionError
} from '../../sovereign-os/edge-ai/lib/models.mjs';
import { RequestQueue, QueueError } from '../../sovereign-os/edge-ai/lib/queue.mjs';
import { ResponseCache } from '../../sovereign-os/edge-ai/lib/cache.mjs';
import { createGateway } from '../../sovereign-os/edge-ai/gateway/server.mjs';
import { importModels } from '../../sovereign-os/edge-ai/scripts/import-models.mjs';
import { installedModelNames } from '../../sovereign-os/edge-ai/scripts/install.mjs';

const ROOT = process.cwd();
const EDGE_DIR = path.join(ROOT, 'sovereign-os', 'edge-ai');
const PROFILES = loadProfiles(path.join(EDGE_DIR, 'profiles.json'));

function hardware(overrides = {}) {
  return {
    platform: 'win32',
    arch: 'x64',
    cpuModel: 'Test CPU',
    physicalCores: 8,
    logicalCores: 16,
    ramGB: 16,
    freeRamGB: 8,
    freeDiskGB: 100,
    gpu: [{ name: 'AMD Radeon (TM) Graphics', vramGB: 2, discrete: false, integrated: true }],
    recommendedProfile: 'mini',
    notes: [],
    ...overrides
  };
}

function miniConfig(overrides = {}) {
  const { gateway: gatewayOverride, security: securityOverride, ...buildOverrides } = overrides;
  const config = buildConfig({
    profileName: 'mini',
    profilesData: PROFILES,
    hardware: hardware(),
    projectRoot: ROOT,
    edgeDir: EDGE_DIR,
    runtimeDir: path.join(EDGE_DIR, 'runtime', 'ollama'),
    modelsDir: path.join(EDGE_DIR, 'models'),
    gatewayHost: '127.0.0.1',
    gatewayPort: 11434,
    ollamaHost: '127.0.0.1',
    ollamaPort: 11435,
    ...buildOverrides
  });
  if (gatewayOverride) config.gateway = { ...config.gateway, ...gatewayOverride };
  if (securityOverride) config.security = { ...config.security, ...securityOverride };
  validateConfig(config);
  return config;
}

test('profiles cover nano, mini, standard and gpu and recommend by hardware', () => {
  assert.deepEqual(Object.keys(PROFILES.profiles).sort(), ['gpu', 'mini', 'nano', 'standard']);
  assert.equal(pickProfile(hardware({ ramGB: 8 }), PROFILES), 'nano');
  assert.equal(pickProfile(hardware({ ramGB: 13.8 }), PROFILES), 'mini');
  assert.equal(pickProfile(hardware({ ramGB: 16 }), PROFILES), 'mini');
  assert.equal(pickProfile(hardware({ ramGB: 32 }), PROFILES), 'standard');
  assert.equal(
    pickProfile(
      hardware({
        ramGB: 32,
        gpu: [{ name: 'NVIDIA GeForce RTX 4060', vramGB: 8, discrete: true, integrated: false }]
      }),
      PROFILES
    ),
    'gpu'
  );
  assert.equal(recommendProfile(hardware({ ramGB: 8 })), 'nano');
  assert.equal(recommendProfile(hardware({ ramGB: 16 })), 'mini');
});

test('fitProfileToHardware respects physical cores and small VRAM', () => {
  const mini = fitProfileToHardware(PROFILES.profiles.mini, hardware({ physicalCores: 4, ramGB: 16 }));
  assert.equal(mini.profile.ollama.numThreads, 4);
  const smallGpu = fitProfileToHardware(
    PROFILES.profiles.gpu,
    hardware({
      ramGB: 32,
      gpu: [{ name: 'NVIDIA RTX 4060', vramGB: 8, discrete: true, integrated: false }]
    })
  );
  assert.equal(smallGpu.profile.ollama.contextLength, 4096);
  assert.equal(smallGpu.profile.ollama.maxLoadedModels, 1);
  assert.ok(smallGpu.adjustments.length > 0);
});

test('buildConfig mini produces safe multi-user defaults and env', () => {
  const config = miniConfig();
  assert.equal(validateConfig(config), true);
  assert.equal(config.models.main, 'gemma3:4b');
  assert.equal(config.models.fast, 'qwen3:0.6b');
  assert.equal(config.models.deep, 'qwen3:8b');
  assert.equal(config.gateway.maxConcurrent, 2);
  assert.equal(config.gateway.perUserConcurrent, 1);
  assert.equal(config.gateway.maxQueue, 24);
  assert.equal(config.ollama.numThreads, 8);
  assert.equal(config.ollama.env.OLLAMA_NUM_PARALLEL, '2');
  assert.equal(config.ollama.env.OLLAMA_MAX_LOADED_MODELS, '2');
  assert.equal(config.ollama.env.OLLAMA_CONTEXT_LENGTH, '4096');
  assert.equal(config.ollama.env.OLLAMA_KV_CACHE_TYPE, 'q8_0');
  assert.equal(config.ollama.env.OLLAMA_MULTIUSER_CACHE, '1');
  assert.equal(config.ollama.env.OLLAMA_NO_CLOUD, '1');
  assert.equal(config.ollama.env.OLLAMA_LLM_LIBRARY, 'cpu');
  assert.ok(estimateMemoryGB(config) < 16);
  assert.deepEqual(modelListForPull(config, 'fast,main,embed'), ['qwen3:0.6b', 'gemma3:4b', 'bge-m3']);
  assert.deepEqual(modelListForPull(config, 'none'), []);
});

test('resolveModel routes tasks, aliases and protects the deep tier', () => {
  const config = miniConfig();
  assert.equal(resolveModel({ task: 'chat', config }).model, 'gemma3:4b');
  assert.equal(resolveModel({ task: 'classify', config }).model, 'qwen3:0.6b');
  assert.equal(resolveModel({ task: 'extract', config }).model, 'gemma3:4b');
  assert.equal(resolveModel({ task: 'chat', config }).tier, 'main');
  assert.equal(resolveModel({ task: 'code', config }).model, 'gemma3:4b');
  assert.equal(resolveModel({ task: 'code', allowDeep: true, config }).model, 'qwen3:8b');

  const duplicate = structuredClone(config);
  duplicate.models.fast = duplicate.models.main;
  const duplicateChat = resolveModel({ task: 'chat', config: duplicate });
  assert.equal(duplicateChat.model, 'gemma3:4b');
  assert.equal(duplicateChat.tier, 'main');

  const downgraded = resolveModel({ requestedModel: 'qwen3:8b', config });
  assert.equal(downgraded.model, 'gemma3:4b');
  assert.equal(downgraded.tier, 'main');
  assert.equal(downgraded.substituted, true);

  const explicit = resolveModel({ requestedModel: 'qwen3:8b', allowDeep: true, config });
  assert.equal(explicit.model, 'qwen3:8b');
  assert.equal(explicit.tier, 'deep');

  const unknown = resolveModel({ requestedModel: 'some-model:1b', config });
  assert.equal(unknown.model, 'gemma3:4b');
  assert.equal(unknown.substituted, true);

  const exact = resolveModel({ requestedModel: 'gemma3:4b', config });
  assert.equal(exact.model, 'gemma3:4b');
  assert.equal(exact.substituted, false);

  const nano = buildConfig({
    profileName: 'nano',
    profilesData: PROFILES,
    hardware: hardware({ ramGB: 8, physicalCores: 4 }),
    projectRoot: ROOT,
    edgeDir: EDGE_DIR,
    runtimeDir: path.join(EDGE_DIR, 'runtime', 'ollama'),
    modelsDir: path.join(EDGE_DIR, 'models')
  });
  assert.equal(resolveModel({ task: 'code', config: nano }).model, 'gemma3:1b');
  const nanoExplicit = resolveModel({ requestedModel: 'qwen3:8b', allowDeep: true, config: nano });
  assert.equal(nanoExplicit.model, 'gemma3:1b');
  assert.equal(nanoExplicit.reason, 'deep_unavailable');
  assert.throws(
    () =>
      resolveModel({
        requestedModel: 'qwen3:8b',
        config: { ...config, rollout: { ...config.rollout, deepPolicy: 'reject' } }
      }),
    (error) => error instanceof ModelSelectionError && error.code === 'DEEP_REQUIRES_OPT_IN'
  );
});

test('truncateMessages keeps system and the newest turns under both limits', () => {
  const messages = [{ role: 'system', content: 'system' }];
  for (let i = 0; i < 20; i += 1) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `message ${i} ${'x'.repeat(50)}` });
  }
  const trimmed = truncateMessages(messages, 5, 500);
  assert.equal(trimmed.messages[0].role, 'system');
  assert.equal(trimmed.messages.length, 6);
  assert.equal(trimmed.droppedMessages, 15);
  assert.ok(trimmed.chars <= 500);
  assert.match(trimmed.messages.at(-1).content, /message 19/);

  const tight = truncateMessages(messages, 20, 120);
  assert.ok(tight.chars <= 120);
  assert.match(tight.messages.at(-1).content, /message 19/);
});

test('normalizeRequest trims history, caps output, strips control fields and keeps body immutable', () => {
  const config = miniConfig();
  const original = {
    model: 'auto',
    task: 'chat',
    cache: false,
    messages: Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` })),
    options: { temperature: 0, num_predict: 99999 }
  };
  const snapshot = JSON.parse(JSON.stringify(original));
  const normalized = normalizeRequest({ endpoint: '/api/chat', body: original, config });
  assert.deepEqual(original, snapshot);
  assert.equal(normalized.body.model, 'auto');
  assert.equal(normalized.body.task, undefined);
  assert.equal(normalized.body.cache, undefined);
  assert.equal(normalized.body.options.num_ctx, 4096);
  assert.equal(normalized.body.options.num_thread, 8);
  assert.equal(normalized.body.options.num_predict, 2048);
  assert.equal(normalized.meta.cappedPredict, true);
  assert.ok(normalized.body.messages.length <= 13);
});

test('thinking is off for fast/main by default and stays available for deep', () => {
  assert.equal(parseThinkHeader('1'), true);
  assert.equal(parseThinkHeader('true'), true);
  assert.equal(parseThinkHeader('off'), false);
  assert.equal(parseThinkHeader(''), undefined);
  assert.equal(parseThinkHeader(undefined), undefined);

  const fast = applyThinkingPolicy({ prompt: 'x' }, { endpoint: '/api/generate', tier: 'fast' });
  assert.equal(fast.think, false, 'qwen3 ระดับ fast ต้องไม่กิน token ไปกับ thinking');
  const main = applyThinkingPolicy({ prompt: 'x' }, { endpoint: '/api/chat', tier: 'main' });
  assert.equal(main.think, false);
  const deep = applyThinkingPolicy({ prompt: 'x' }, { endpoint: '/api/generate', tier: 'deep' });
  assert.equal(deep.think, true, 'deep คือระดับเดียวที่อยากได้การคิดจริง');

  assert.equal(applyThinkingPolicy({ prompt: 'x', think: true }, { endpoint: '/api/generate', tier: 'main' }).think, true, 'ค่าที่ผู้เรียกส่งมาใน body ต้องชนะ');
  assert.equal(applyThinkingPolicy({ prompt: 'x' }, { endpoint: '/api/generate', tier: 'main', requestedThink: true }).think, true, 'header x-sovereign-think: 1 ต้องเปิดได้');
  assert.equal(applyThinkingPolicy({ prompt: 'x' }, { endpoint: '/api/generate', tier: 'deep', requestedThink: false }).think, false, 'header ปิดต้องชนะค่าตามระดับ');
  assert.equal(applyThinkingPolicy({ input: 'x' }, { endpoint: '/api/embed', tier: 'main' }).think, undefined, 'embedding ต้องไม่ถูกเติม think');
});

test('cacheKey is stable and shouldCache only caches deterministic non-streaming requests', () => {
  const config = miniConfig();
  const a = normalizeRequest({
    endpoint: '/api/generate',
    body: { model: 'gemma3:4b', prompt: 'hello', options: { temperature: 0, top_p: 0.9 } },
    config
  }).body;
  const b = normalizeRequest({
    endpoint: '/api/generate',
    body: { options: { top_p: 0.9, temperature: 0 }, prompt: 'hello', model: 'gemma3:4b' },
    config
  }).body;
  assert.equal(cacheKey({ endpoint: '/api/generate', model: 'gemma3:4b', body: a }), cacheKey({ endpoint: '/api/generate', model: 'gemma3:4b', body: b }));
  assert.notEqual(
    cacheKey({ endpoint: '/api/generate', model: 'gemma3:4b', body: a }),
    cacheKey({ endpoint: '/api/generate', model: 'gemma3:4b', body: { ...a, prompt: 'different' } })
  );
  assert.notEqual(
    cacheKey({ endpoint: '/api/generate', model: 'gemma3:4b', body: { ...a, think: false } }),
    cacheKey({ endpoint: '/api/generate', model: 'gemma3:4b', body: { ...a, think: true } }),
    'think ต่างกัน = คำตอบคนละแบบ ห้ามใช้ cache ร่วมกัน'
  );
  assert.equal(shouldCache({ prompt: 'x', options: { temperature: 0 } }, '/api/generate'), true);
  assert.equal(shouldCache({ prompt: 'x', options: { temperature: 0 }, stream: true }, '/api/generate'), false);
  assert.equal(shouldCache({ prompt: 'x', options: { temperature: 0 }, cache: false }, '/api/generate'), false);
  assert.equal(shouldCache({ prompt: 'x', options: { temperature: 0.7 }, cache: true }, '/api/generate'), true);
  assert.equal(
    shouldCache(
      { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,x' } }] }], options: { temperature: 0 } },
      '/api/chat'
    ),
    false
  );
});

test('RequestQueue enforces global concurrency, per-user fairness, queue limits, timeout and abort', async () => {
  const queue = new RequestQueue({ maxConcurrent: 2, perUserConcurrent: 10, maxQueue: 10, timeoutMs: 0 });
  let active = 0;
  let maxActive = 0;
  await Promise.all(
    Array.from({ length: 5 }, () =>
      queue.run('shared', async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 30));
        active -= 1;
      })
    )
  );
  assert.equal(maxActive, 2);
  await queue.whenIdle();
  assert.equal(queue.stats().active, 0);

  const fair = new RequestQueue({ maxConcurrent: 2, perUserConcurrent: 1, maxQueue: 10, timeoutMs: 0 });
  const perUser = new Map();
  let fairMax = 0;
  await Promise.all([
    fair.run('a', async () => {
      perUser.set('a', (perUser.get('a') || 0) + 1);
      fairMax = Math.max(fairMax, perUser.get('a'));
      await new Promise((r) => setTimeout(r, 50));
      perUser.set('a', perUser.get('a') - 1);
    }),
    fair.run('a', async () => {
      perUser.set('a', (perUser.get('a') || 0) + 1);
      fairMax = Math.max(fairMax, perUser.get('a'));
      await new Promise((r) => setTimeout(r, 50));
      perUser.set('a', perUser.get('a') - 1);
    }),
    fair.run('b', async () => {
      perUser.set('b', (perUser.get('b') || 0) + 1);
      fairMax = Math.max(fairMax, perUser.get('b'));
      await new Promise((r) => setTimeout(r, 50));
      perUser.set('b', perUser.get('b') - 1);
    })
  ]);
  assert.equal(fairMax, 1);

  const full = new RequestQueue({ maxConcurrent: 1, perUserConcurrent: 1, maxQueue: 1, timeoutMs: 0 });
  let release;
  const blocker = full.run('a', () => new Promise((resolve) => { release = resolve; }));
  const queued = full.run('b', async () => {});
  await assert.rejects(full.run('c', async () => {}), (error) => error instanceof QueueError && error.code === 'QUEUE_FULL');
  release();
  await Promise.all([blocker, queued]);

  const timeout = new RequestQueue({ maxConcurrent: 1, perUserConcurrent: 1, maxQueue: 1, timeoutMs: 30 });
  let releaseTimeout;
  const timeoutBlocker = timeout.run('a', () => new Promise((resolve) => { releaseTimeout = resolve; }));
  await assert.rejects(timeout.run('b', async () => {}), (error) => error instanceof QueueError && error.code === 'QUEUE_TIMEOUT');
  releaseTimeout();
  await timeoutBlocker;

  const abortQueue = new RequestQueue({ maxConcurrent: 1, perUserConcurrent: 1, maxQueue: 1, timeoutMs: 0 });
  let releaseAbort;
  const abortBlocker = abortQueue.run('a', () => new Promise((resolve) => { releaseAbort = resolve; }));
  const controller = new AbortController();
  const aborted = abortQueue.run('b', async () => {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(aborted, (error) => error instanceof QueueError && error.code === 'ABORTED');
  releaseAbort();
  await abortBlocker;
});

test('ResponseCache is LRU with TTL', () => {
  let now = 1000;
  const cache = new ResponseCache({ ttlMs: 100, maxEntries: 2, now: () => now });
  cache.set('a', 1);
  now += 10;
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1);
  now += 10;
  cache.set('c', 3);
  assert.equal(cache.get('b'), null);
  assert.equal(cache.get('a'), 1);
  now += 200;
  assert.equal(cache.get('a'), null);
  assert.equal(cache.stats().hits, 2);
});

function startMockOllama() {
  return new Promise((resolve) => {
    const state = {
      active: 0,
      maxActive: 0,
      calls: [],
      closed: false
    };
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = {};
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = { invalid: raw };
        }
      }
      if (req.url === '/api/version') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ version: 'mock-1.0' }));
        return;
      }
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'gemma3:4b' }] }));
        return;
      }
      if (req.url === '/api/generate' || req.url === '/api/chat' || req.url === '/v1/chat/completions') {
        state.active += 1;
        state.maxActive = Math.max(state.maxActive, state.active);
        state.calls.push({ url: req.url, body });
        const delay = String(body.prompt || '').includes('slow') ? 180 : 35;
        await new Promise((r) => setTimeout(r, delay));
        if (body.stream === true) {
          res.writeHead(200, { 'content-type': 'application/x-ndjson' });
          res.write(`${JSON.stringify({ model: body.model, response: 'one', done: false })}\n`);
          res.write(`${JSON.stringify({ model: body.model, response: 'two', done: true, eval_count: 2, eval_duration: 200000000 })}\n`);
          res.end();
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              model: body.model,
              response: 'mock response',
              done: true,
              eval_count: 10,
              eval_duration: 1000000000,
              prompt_eval_count: 5,
              prompt_eval_duration: 50000000
            })
          );
        }
        state.active -= 1;
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, state }));
  });
}

async function startGateway(configOverrides = {}) {
  const mock = await startMockOllama();
  const config = miniConfig({ ollamaPort: mock.port, ...configOverrides });
  const gateway = createGateway(config);
  const address = await gateway.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  return { mock, gateway, base };
}

async function closeAll(ctx) {
  await ctx.gateway.close();
  await new Promise((resolve) => ctx.mock.server.close(() => resolve()));
}

test('gateway rewrites models, caps output, exposes headers and caches deterministic requests', async () => {
  const ctx = await startGateway();
  try {
    const health = await fetch(`${ctx.base}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const first = await fetch(`${ctx.base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3:8b',
        prompt: 'hello',
        cache: true,
        options: { temperature: 0, num_predict: 9999 }
      })
    });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-edge-model'), 'gemma3:4b');
    assert.equal(first.headers.get('x-edge-tier'), 'main');
    assert.equal(first.headers.get('x-edge-substituted'), '1');
    assert.equal(first.headers.get('x-edge-capped-predict'), '1');
    assert.equal(first.headers.get('x-edge-cache'), 'miss');
    const firstBody = await first.json();
    assert.equal(firstBody.model, 'gemma3:4b');
    assert.equal(ctx.mock.state.calls.length, 1);
    const forwarded = ctx.mock.state.calls[0].body;
    assert.equal(forwarded.model, 'gemma3:4b');
    assert.equal(forwarded.task, undefined);
    assert.equal(forwarded.cache, undefined);
    assert.equal(forwarded.options.num_predict, 2048);
    assert.equal(forwarded.options.num_ctx, 4096);
    assert.equal(forwarded.options.num_thread, 8);
    assert.equal(forwarded.think, false, 'main tier ต้องปิด thinking โดยปริยาย');

    const second = await fetch(`${ctx.base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3:8b',
        prompt: 'hello',
        cache: true,
        options: { temperature: 0, num_predict: 9999 }
      })
    });
    assert.equal(second.status, 200);
    assert.equal(second.headers.get('x-edge-cache'), 'hit');
    assert.equal(ctx.mock.state.calls.length, 1);

    const classified = await fetch(`${ctx.base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sovereign-task': 'classify' },
      body: JSON.stringify({ model: 'auto', prompt: 'different', cache: false, options: { temperature: 0 } })
    });
    assert.equal(classified.status, 200);
    assert.equal(classified.headers.get('x-edge-model'), 'qwen3:0.6b');
    assert.equal(ctx.mock.state.calls.at(-1).body.model, 'qwen3:0.6b');
    assert.equal(ctx.mock.state.calls.at(-1).body.think, false, 'fast tier ปิด thinking เพื่อไม่ให้ response ว่าง');

    const thinking = await fetch(`${ctx.base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sovereign-think': '1' },
      body: JSON.stringify({ model: 'auto', prompt: 'think please', cache: false, options: { temperature: 0 } })
    });
    assert.equal(thinking.status, 200);
    assert.equal(ctx.mock.state.calls.at(-1).body.think, true, 'header x-sovereign-think: 1 ต้องเปิด thinking ได้');
  } finally {
    await closeAll(ctx);
  }
});

test('gateway trims chat history and does not leak control fields', async () => {
  const ctx = await startGateway();
  try {
    const messages = [{ role: 'system', content: 'system prompt' }];
    for (let i = 0; i < 20; i += 1) messages.push({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` });
    const response = await fetch(`${ctx.base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'auto', task: 'chat', messages, stream: false })
    });
    assert.equal(response.status, 200);
    const forwarded = ctx.mock.state.calls.at(-1).body;
    assert.equal(forwarded.model, 'gemma3:4b');
    assert.equal(forwarded.task, undefined);
    assert.ok(forwarded.messages.length <= 13);
    assert.equal(forwarded.messages[0].role, 'system');
    assert.match(forwarded.messages.at(-1).content, /m19/);

    const openai = await fetch(`${ctx.base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'auto',
        messages: [{ role: 'user', content: 'hello openai' }],
        max_tokens: 99999,
        stream: false
      })
    });
    assert.equal(openai.status, 200);
    const openaiForwarded = ctx.mock.state.calls.at(-1).body;
    assert.equal(openaiForwarded.model, 'gemma3:4b');
    assert.equal(openaiForwarded.options, undefined);
    assert.equal(openaiForwarded.keep_alive, undefined);
    assert.equal(openaiForwarded.max_tokens, 2048);
  } finally {
    await closeAll(ctx);
  }
});

test('gateway enforces concurrency and queue limits', async () => {
  const ctx = await startGateway({
    gateway: {
      ...miniConfig().gateway,
      maxConcurrent: 2,
      perUserConcurrent: 2,
      maxQueue: 4,
      queueTimeoutMs: 5000
    }
  });
  try {
    const requests = Array.from({ length: 5 }, (_, i) =>
      fetch(`${ctx.base}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sovereign-user': `u${i}` },
        body: JSON.stringify({ model: 'auto', prompt: `slow ${i}`, cache: false, options: { temperature: 0 } })
      })
    );
    const responses = await Promise.all(requests);
    assert.equal(responses.every((r) => r.status === 200), true);
    assert.ok(ctx.mock.state.maxActive <= 2);
    assert.equal(ctx.mock.state.maxActive, 2);
  } finally {
    await closeAll(ctx);
  }

  const full = await startGateway({
    gateway: {
      ...miniConfig().gateway,
      maxConcurrent: 1,
      perUserConcurrent: 1,
      maxQueue: 0,
      queueTimeoutMs: 5000
    }
  });
  try {
    const first = fetch(`${full.base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'auto', prompt: 'slow first', cache: false, options: { temperature: 0 } })
    });
    await new Promise((r) => setTimeout(r, 20));
    const second = await fetch(`${full.base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'auto', prompt: 'second', cache: false, options: { temperature: 0 } })
    });
    assert.equal(second.status, 429);
    assert.equal((await second.json()).error, 'QUEUE_FULL');
    assert.equal((await first).status, 200);
  } finally {
    await closeAll(full);
  }
});

test('gateway streams, passes through tags and protects authenticated routes', async () => {
  const ctx = await startGateway();
  try {
    const stream = await fetch(`${ctx.base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'auto', prompt: 'stream this', stream: true, options: { temperature: 0 } })
    });
    assert.equal(stream.status, 200);
    assert.equal(stream.headers.get('x-edge-cache'), 'miss');
    const text = await stream.text();
    assert.match(text, /"response":"one"/);
    assert.match(text, /"done":true/);

    const tags = await fetch(`${ctx.base}/api/tags`);
    assert.equal(tags.status, 200);
    assert.equal((await tags.json()).models[0].name, 'gemma3:4b');

    const metrics = await fetch(`${ctx.base}/metrics`);
    assert.equal(metrics.status, 200);
    const stats = await metrics.json();
    assert.ok(stats.counters.requests >= 3);
    assert.ok(stats.cache.entries >= 0);

    const notFound = await fetch(`${ctx.base}/nope`);
    assert.equal(notFound.status, 404);
  } finally {
    await closeAll(ctx);
  }

  const token = 'test-token-0123456789abcdef';
  const secured = await startGateway({ security: { token } });
  try {
    const denied = await fetch(`${secured.base}/api/tags`);
    assert.equal(denied.status, 401);
    const allowed = await fetch(`${secured.base}/api/tags`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(allowed.status, 200);
  } finally {
    await closeAll(secured);
  }
});

test('gateway coalesces identical in-flight deterministic requests', async () => {
  const ctx = await startGateway();
  try {
    const body = JSON.stringify({
      model: 'auto',
      prompt: 'slow coalesce',
      cache: true,
      options: { temperature: 0 }
    });
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        fetch(`${ctx.base}/api/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body
        })
      )
    );
    assert.equal(responses.every((r) => r.status === 200), true);
    const states = responses.map((r) => r.headers.get('x-edge-cache'));
    assert.ok(states.includes('coalesced') || states.includes('hit'));
    assert.equal(ctx.mock.state.calls.length, 1);
  } finally {
    await closeAll(ctx);
  }
});

test('importModels copies manifests and blobs without needing a network', () => {
  fs.mkdirSync(path.join(ROOT, '.freebuff'), { recursive: true });
  const temp = fs.mkdtempSync(path.join(ROOT, '.freebuff', 'edge-ai-import-'));
  const from = path.join(temp, 'from');
  const to = path.join(temp, 'to');
  try {
    const manifestDir = path.join(from, 'manifests', 'registry.ollama.ai', 'library', 'demo');
    const blobDir = path.join(from, 'blobs');
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.mkdirSync(blobDir, { recursive: true });
    const payload = Buffer.from('model-bytes');
    const digest = `sha256:${'a'.repeat(64)}`;
    fs.writeFileSync(path.join(blobDir, `sha256-${'a'.repeat(64)}`), payload);
    fs.writeFileSync(
      path.join(manifestDir, '1b'),
      JSON.stringify({
        schemaVersion: 2,
        config: { digest: `sha256:${'b'.repeat(64)}`, size: 0 },
        layers: [{ digest, size: payload.length }]
      })
    );
    fs.writeFileSync(path.join(blobDir, `sha256-${'b'.repeat(64)}`), '');
    const result = importModels({ from, to, hardlink: false, log: () => {} });
    assert.equal(result.manifests, 1);
    assert.equal(result.blobs, 2);
    assert.equal(result.errors.length, 0);
    assert.equal(fs.statSync(path.join(to, 'blobs', `sha256-${'a'.repeat(64)}`)).size, payload.length);
    assert.ok(fs.existsSync(path.join(to, 'manifests', 'registry.ollama.ai', 'library', 'demo', '1b')));

    // Users type model names with a colon (demo:1b), while manifest labels use a slash (demo/1b).
    const filtered = path.join(temp, 'filtered');
    const picked = importModels({ from, to: filtered, only: 'demo:1b', hardlink: false, log: () => {} });
    assert.equal(picked.manifests, 1);
    assert.ok(fs.existsSync(path.join(filtered, 'manifests', 'registry.ollama.ai', 'library', 'demo', '1b')));
    const missed = importModels({ from, to: path.join(temp, 'missed'), only: 'other:9b', hardlink: false, log: () => {} });
    assert.equal(missed.manifests, 0);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('installedModelNames reads Ollama tags and tolerates a missing server', async () => {
  const fetchOk = async () => ({
    ok: true,
    json: async () => ({ models: [{ name: 'gemma3:4b' }, { model: 'bge-m3' }, { name: 'qwen3:1.7b' }] })
  });
  const names = await installedModelNames('http://127.0.0.1:1', fetchOk);
  assert.deepEqual([...names].sort(), ['bge-m3', 'gemma3:4b', 'qwen3:1.7b']);

  const fetchFail = async () => {
    throw new Error('offline');
  };
  const empty = await installedModelNames('http://127.0.0.1:1', fetchFail);
  assert.equal(empty.size, 0);
});

test('edge AI command wrappers are ASCII, CRLF and set UTF-8 code page', () => {
  for (const name of ['EDGE-AI-INSTALL.cmd', 'EDGE-AI-START.cmd', 'EDGE-AI-STOP.cmd', 'EDGE-AI-BENCH.cmd', 'EDGE-AI-PROBE.cmd', 'EDGE-AI-PULL.cmd']) {
    const file = path.join(EDGE_DIR, name);
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    assert.equal(lines[0].trim().toLowerCase(), '@echo off', `${name} first line`);
    assert.equal(lines[1].trim().toLowerCase(), 'chcp 65001 >nul', `${name} second line`);
    const beforeChcp = text.slice(0, text.indexOf('chcp'));
    assert.doesNotMatch(beforeChcp, /[^\x00-\x7F]/, `${name} has non-ASCII before chcp`);
    assert.match(text, /\r\n/, `${name} must use CRLF`);
    assert.match(text, /pause/, `${name} must pause for double-click use`);
  }
});

test('runtime and model directories are ignored by git', () => {
  for (const ignored of ['sovereign-os/edge-ai/runtime/x', 'sovereign-os/edge-ai/models/x', 'sovereign-os/edge-ai/logs/x', 'sovereign-os/edge-ai/pids/x', 'sovereign-os/edge-ai/edge-ai.config.json']) {
    const result = execFileSync('git', ['check-ignore', '-q', ignored], { cwd: ROOT, stdio: 'ignore' });
    assert.equal(result === undefined || result === null || true, true);
  }
});
