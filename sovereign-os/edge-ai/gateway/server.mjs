import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { RequestQueue, QueueError } from '../lib/queue.mjs';
import { ResponseCache } from '../lib/cache.mjs';
import {
  resolveModel,
  normalizeRequest,
  cacheKey,
  shouldCache,
  hasImage,
  ModelSelectionError
} from '../lib/models.mjs';
import { readConfig, validateConfig } from '../lib/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

class UpstreamError extends Error {
  constructor(statusCode, body) {
    super(`Upstream returned ${statusCode}: ${String(body || '').slice(0, 1800)}`);
    this.name = 'UpstreamError';
    this.upstreamStatus = statusCode;
    this.statusCode = statusCode >= 400 && statusCode < 500 ? statusCode : 502;
    this.body = body;
  }
}

function headerString(value) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function userOf(req) {
  const raw = headerString(req.headers['x-sovereign-user'] || req.headers['x-user-id']).trim();
  return raw ? raw.slice(0, 128) : null;
}

function taskOf(req, body, endpoint) {
  if (endpoint === '/api/embeddings' || endpoint === '/api/embed') return 'embed';
  if (hasImage(body?.messages)) return 'vision';
  const fromHeader = headerString(req.headers['x-sovereign-task']).trim().toLowerCase();
  if (fromHeader) return fromHeader;
  const fromBody = typeof body?.task === 'string' ? body.task.trim().toLowerCase() : '';
  return fromBody || 'chat';
}

function allowDeep(req) {
  const value = headerString(req.headers['x-sovereign-allow-deep']).trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function upstreamBase(config) {
  const host = config.ollama.host.includes(':') ? `[${config.ollama.host}]` : config.ollama.host;
  return `http://${host}:${config.ollama.port}`;
}

function authOk(req, config) {
  const token = config.security?.token;
  if (!token) return true;
  const auth = headerString(req.headers.authorization);
  const expected = `Bearer ${token}`;
  const a = Buffer.from(auth);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) {
      reject(new HttpError(413, 'BODY_TOO_LARGE', `Request body exceeds ${limit} bytes`));
      return;
    }
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new HttpError(413, 'BODY_TOO_LARGE', `Request body exceeds ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseJsonBody(req, limit) {
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'Request body must be valid JSON');
  }
}

function sendJson(res, statusCode, payload, headers = {}) {
  if (res.writableEnded || res.destroyed) return;
  const text = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    ...headers
  });
  res.end(text);
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8', headers = {}) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(statusCode, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(text),
    ...headers
  });
  res.end(text);
}

function sendError(res, err, extraHeaders = {}) {
  if (res.writableEnded || res.destroyed) return;
  if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.code === 'ERR_CANCELED') {
    if (!res.headersSent) res.destroy();
    return;
  }
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (err instanceof HttpError) {
    sendJson(res, err.statusCode, { error: err.code, message: err.message }, extraHeaders);
    return;
  }
  if (err instanceof ModelSelectionError || err instanceof QueueError) {
    const headers = { ...extraHeaders };
    if (err.retryAfter) headers['retry-after'] = String(err.retryAfter);
    sendJson(res, err.statusCode || 429, { error: err.code, message: err.message }, headers);
    return;
  }
  if (err instanceof UpstreamError) {
    sendJson(
      res,
      err.statusCode,
      {
        error: 'upstream_error',
        message: 'The local inference runtime returned an error',
        upstream_status: err.upstreamStatus,
        detail: String(err.body || '').slice(0, 2000)
      },
      extraHeaders
    );
    return;
  }
  sendJson(
    res,
    502,
    {
      error: 'edge_ai_error',
      message: err?.message ? String(err.message).slice(0, 2000) : 'Unknown Edge AI gateway error'
    },
    extraHeaders
  );
}

function copyResponseHeaders(upstream) {
  const headers = {};
  for (const name of ['content-type', 'cache-control', 'etag']) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  if (!headers['content-type']) headers['content-type'] = 'application/octet-stream';
  return headers;
}

export function createGateway(config, deps = {}) {
  validateConfig(config);
  const fetchImpl = deps.fetch || globalThis.fetch;
  const queue = new RequestQueue({
    maxConcurrent: config.gateway.maxConcurrent,
    perUserConcurrent: config.gateway.perUserConcurrent,
    maxQueue: config.gateway.maxQueue,
    timeoutMs: config.gateway.queueTimeoutMs
  });
  const cache = new ResponseCache({
    ttlMs: config.gateway.cacheTtlMs,
    maxEntries: config.gateway.cacheMaxEntries
  });
  const inflight = new Map();
  const startedAt = new Date().toISOString();
  const counters = {
    requests: 0,
    ok: 0,
    errors: 0,
    cacheHits: 0,
    cacheCoalesced: 0,
    queueFull: 0,
    queueTimeouts: 0,
    byModel: {}
  };
  const maxBodyBytes = Number(config.gateway.maxBodyBytes) || 10 * 1024 * 1024;
  const upstreamTimeoutMs = Number(config.gateway.upstreamTimeoutMs) || 300000;

  function recordModel(model, ms) {
    const row = counters.byModel[model] || { requests: 0, totalMs: 0 };
    row.requests += 1;
    row.totalMs += ms;
    counters.byModel[model] = row;
  }

  function stats() {
    return {
      startedAt,
      profile: config.profile,
      uptimeSeconds: Math.round(process.uptime()),
      counters,
      queue: queue.stats(),
      cache: cache.stats(),
      upstream: upstreamBase(config)
    };
  }

  function edgeHeaders(selection, meta) {
    const headers = {
      'x-edge-model': selection.model,
      'x-edge-tier': selection.tier
    };
    if (selection.substituted) {
      headers['x-edge-substituted'] = '1';
      if (selection.originalModel) headers['x-edge-original-model'] = selection.originalModel;
    }
    if (meta?.truncated) headers['x-edge-truncated'] = '1';
    if (meta?.cappedPredict) headers['x-edge-capped-predict'] = '1';
    if (meta?.droppedMessages) headers['x-edge-dropped-messages'] = String(meta.droppedMessages);
    return headers;
  }

  function sendResult(res, result, headers, cacheState) {
    const all = { ...headers, 'x-edge-cache': cacheState };
    if (result.queueMs !== undefined) all['x-edge-queue-ms'] = String(result.queueMs);
    if (result.upstreamMs !== undefined) all['x-edge-upstream-ms'] = String(result.upstreamMs);
    res.writeHead(result.statusCode || 200, {
      'content-type': result.contentType || 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(result.text),
      ...all
    });
    res.end(result.text);
  }

  async function proxyPassthrough(req, res, pathname, search) {
    const timeoutMs = pathname === '/api/pull' || pathname === '/api/create' ? 30 * 60 * 1000 : upstreamTimeoutMs;
    const raw = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : await readBody(req, maxBodyBytes);
    const headers = {};
    if (raw.length) headers['content-type'] = headerString(req.headers['content-type']) || 'application/json';
    const accept = headerString(req.headers.accept);
    if (accept) headers.accept = accept;
    let upstream;
    try {
      upstream = await fetchImpl(`${upstreamBase(config)}${pathname}${search || ''}`, {
        method: req.method,
        headers,
        body: raw.length ? raw : undefined,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      sendError(res, error);
      return;
    }
    res.writeHead(upstream.status, copyResponseHeaders(upstream));
    if (!upstream.body) {
      res.end();
      return;
    }
    try {
      for await (const chunk of upstream.body) {
        if (!res.write(chunk)) await once(res, 'drain');
      }
      res.end();
    } catch {
      res.destroy();
    }
  }

  async function handleInference(req, res, pathname) {
    const body = await parseJsonBody(req, maxBodyBytes);
    const task = taskOf(req, body, pathname);
    const selection = resolveModel({
      requestedModel: body.model,
      task,
      allowDeep: allowDeep(req),
      config
    });
    const normalized = normalizeRequest({ endpoint: pathname, body, config });
    normalized.body.model = selection.model;
    const headers = edgeHeaders(selection, normalized.meta);

    const cacheable = shouldCache(normalized.body, pathname);
    const key = cacheable ? cacheKey({ endpoint: pathname, model: selection.model, body: normalized.body }) : null;
    if (key) {
      const hit = cache.get(key);
      if (hit) {
        counters.cacheHits += 1;
        sendResult(res, hit, { ...headers, 'x-edge-cache': 'hit' }, 'hit');
        return;
      }
    }

    if (key && inflight.has(key)) {
      counters.cacheCoalesced += 1;
      try {
        const result = await inflight.get(key);
        sendResult(res, result, headers, 'coalesced');
      } catch (error) {
        sendError(res, error, headers);
      }
      return;
    }

    const stream = normalized.body.stream === true;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    req.once('aborted', onAbort);
    res.once('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    let resolveInflight;
    let rejectInflight;
    if (key && !stream) {
      const promise = new Promise((resolve, reject) => {
        resolveInflight = resolve;
        rejectInflight = reject;
      });
      // Keep the promise rejected for any coalesced waiters, but mark it handled so a
      // queue/upstream failure with no waiter does not become an unhandled rejection.
      promise.catch(() => {});
      inflight.set(key, promise);
    }

    const queuedAt = Date.now();
    try {
      if (stream) {
        await queue.run(
          userOf(req),
          async ({ signal }) => {
            const runStarted = Date.now();
            const upstream = await fetchImpl(`${upstreamBase(config)}${pathname}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(normalized.body),
              signal: AbortSignal.any([signal, AbortSignal.timeout(upstreamTimeoutMs)])
            });
            if (!upstream.ok) {
              const text = await upstream.text();
              throw new UpstreamError(upstream.status, text);
            }
            const responseHeaders = {
              ...headers,
              'x-edge-cache': 'miss',
              'x-edge-queue-ms': String(runStarted - queuedAt)
            };
            res.writeHead(upstream.status, { ...copyResponseHeaders(upstream), ...responseHeaders });
            const reader = upstream.body;
            if (reader) {
              for await (const chunk of reader) {
                if (!res.write(chunk)) await once(res, 'drain');
              }
            }
            res.end();
            counters.ok += 1;
            recordModel(selection.model, Date.now() - runStarted);
            return null;
          },
          { signal: controller.signal }
        );
        return;
      }

      const result = await queue.run(
        userOf(req),
        async ({ signal }) => {
          const runStarted = Date.now();
          const upstream = await fetchImpl(`${upstreamBase(config)}${pathname}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(normalized.body),
            signal: AbortSignal.any([signal, AbortSignal.timeout(upstreamTimeoutMs)])
          });
          const text = await upstream.text();
          if (!upstream.ok) throw new UpstreamError(upstream.status, text);
          const out = {
            statusCode: upstream.status,
            contentType: upstream.headers.get('content-type') || 'application/json; charset=utf-8',
            text,
            queueMs: runStarted - queuedAt,
            upstreamMs: Date.now() - runStarted
          };
          counters.ok += 1;
          recordModel(selection.model, out.upstreamMs);
          return out;
        },
        { signal: controller.signal }
      );
      if (key && result.statusCode >= 200 && result.statusCode < 300 && result.text.length <= 2 * 1024 * 1024) {
        cache.set(key, result);
      }
      if (resolveInflight) resolveInflight(result);
      sendResult(res, result, headers, 'miss');
    } catch (error) {
      if (rejectInflight) rejectInflight(error);
      if (error instanceof QueueError) {
        if (error.code === 'QUEUE_FULL') counters.queueFull += 1;
        if (error.code === 'QUEUE_TIMEOUT') counters.queueTimeouts += 1;
      }
      counters.errors += 1;
      sendError(res, error, headers);
    } finally {
      req.removeListener('aborted', onAbort);
      if (key) inflight.delete(key);
    }
  }

  async function handler(req, res) {
    counters.requests += 1;
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname.replace(/\/+$/, '') || '/';

      if (req.method === 'GET' && pathname === '/') {
        sendText(
          res,
          200,
          [
            'Sovereign Edge AI gateway',
            `profile: ${config.profile}`,
            `upstream: ${upstreamBase(config)}`,
            'endpoints: /health /metrics /api/tags /api/ps /api/version /api/generate /api/chat /v1/chat/completions',
            ''
          ].join('\n')
        );
        return;
      }

      if (req.method === 'GET' && pathname === '/health') {
        let upstreamOk = false;
        let upstreamVersion = null;
        try {
          const upstream = await fetchImpl(`${upstreamBase(config)}/api/version`, {
            signal: AbortSignal.timeout(2500)
          });
          upstreamOk = upstream.ok;
          if (upstream.ok) {
            const data = await upstream.json().catch(() => null);
            upstreamVersion = data?.version || null;
          }
        } catch {
          upstreamOk = false;
        }
        sendJson(res, upstreamOk ? 200 : 503, {
          ok: upstreamOk,
          profile: config.profile,
          upstream: upstreamBase(config),
          upstreamVersion,
          queue: queue.stats(),
          cache: cache.stats()
        });
        return;
      }

      if (!authOk(req, config)) {
        sendJson(res, 401, { error: 'UNAUTHORIZED', message: 'Missing or invalid bearer token' });
        return;
      }

      if (req.method === 'GET' && pathname === '/metrics') {
        sendJson(res, 200, stats());
        return;
      }

      if (pathname === '/api/generate' || pathname === '/api/chat' || pathname === '/v1/chat/completions') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Use POST for inference' });
          return;
        }
        await handleInference(req, res, pathname);
        return;
      }

      if (pathname === '/api/embeddings' || pathname === '/api/embed') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Use POST for embeddings' });
          return;
        }
        await handleInference(req, res, pathname);
        return;
      }

      const passthrough =
        pathname === '/api/tags' ||
        pathname === '/api/ps' ||
        pathname === '/api/version' ||
        pathname === '/api/show' ||
        pathname === '/api/pull' ||
        pathname === '/api/delete' ||
        pathname === '/api/copy' ||
        pathname === '/api/create' ||
        pathname === '/v1/models' ||
        pathname.startsWith('/api/blobs/');
      if (passthrough) {
        await proxyPassthrough(req, res, pathname, url.search);
        return;
      }

      sendJson(res, 404, {
        error: 'NOT_FOUND',
        message: `No Edge AI route for ${req.method} ${pathname}`
      });
    } catch (error) {
      counters.errors += 1;
      sendError(res, error);
    }
  }

  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => sendError(res, error));
  });
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  async function listen(port = config.gateway.port, host = config.gateway.host) {
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        server.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve(server.address());
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  }

  async function close() {
    if (!server.listening) return;
    server.closeIdleConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
  }

  return { server, listen, close, stats, queue, cache, config };
}

async function main() {
  const argIndex = process.argv.indexOf('--config');
  const configFile = argIndex >= 0 ? process.argv[argIndex + 1] : undefined;
  const config = configFile ? readConfig(configFile) : readConfig();
  const gateway = createGateway(config);
  const address = await gateway.listen();
  const host = typeof address === 'object' && address ? address.address : config.gateway.host;
  const port = typeof address === 'object' && address ? address.port : config.gateway.port;
  console.log(`[edge-ai] gateway listening on http://${host}:${port} -> ${config.ollama.host}:${config.ollama.port}`);
  const shutdown = async () => {
    console.log('[edge-ai] shutting down gateway');
    await gateway.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(`[edge-ai] fatal: ${error?.stack || error}`);
    process.exit(1);
  });
}

export { HERE };
