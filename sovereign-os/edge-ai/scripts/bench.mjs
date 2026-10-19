import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../lib/config.mjs';
import { detectHardware } from '../lib/hardware.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDGE_DIR = path.resolve(HERE, '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

function seconds(ns) {
  return Number(ns) / 1e9;
}

const PROMPTS = [
  {
    id: 'thai_short',
    task: 'chat',
    prompt: 'ตอบเป็นภาษาไทยสั้นๆ 2 ประโยค: เครื่องคอมพิวเตอร์ขนาดเล็กควรรันโมเดล AI แบบไหนถึงจะรับผู้ใช้ 2-5 คนได้'
  },
  {
    id: 'english_short',
    task: 'chat',
    prompt: 'In two short sentences, explain why request queueing matters when several people share one local LLM.'
  },
  {
    id: 'classify_short',
    task: 'classify',
    maxPredict: 12,
    prompt:
      'Classify this message as exactly one word, billing or technical. Reply with the word only. Message: "My invoice shows the wrong amount."'
  },
  {
    id: 'json_extract',
    task: 'extract',
    prompt:
      'Return JSON only, no markdown. Classify this message as {"intent":"...","urgent":true|false}. Message: "The greenhouse pump stopped and the soil is drying out."'
  },
  {
    id: 'code_explain',
    task: 'code',
    prompt: 'Explain in 3 bullet points why a fixed-size request queue is safer than unbounded concurrency for a small local LLM server.'
  },
  {
    id: 'long_context',
    task: 'chat',
    prompt:
      'Read this operational note and answer in one sentence: what should the operator check first?\\n\\n' +
      'The sensor gateway reported intermittent timeouts after a firmware update. The local model server stayed healthy, ' +
      'but the dashboard paused for 20 seconds every few minutes. Disk usage was normal, RAM was 78 percent, and the ' +
      'database connection pool showed waits. The pump controller was online. The operator should check whether the ' +
      'dashboard is waiting on a saturated LLM queue before restarting any hardware. '.repeat(4)
  }
];

async function requestGenerate(target, prompt, task, maxPredict = 128, user = 'benchmark') {
  const started = Date.now();
  const response = await fetch(`${target}/api/generate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sovereign-task': task,
      'x-sovereign-user': user
    },
    body: JSON.stringify({
      model: 'auto',
      prompt: prompt.prompt,
      stream: false,
      cache: false,
      options: { temperature: 0, num_predict: maxPredict }
    }),
    signal: AbortSignal.timeout(10 * 60 * 1000)
  });
  const wallMs = Date.now() - started;
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  const evalCount = Number(data.eval_count) || 0;
  const evalDuration = seconds(data.eval_duration);
  const promptCount = Number(data.prompt_eval_count) || 0;
  const promptDuration = seconds(data.prompt_eval_duration);
  return {
    id: prompt.id,
    task,
    model: response.headers.get('x-edge-model') || data.model || 'unknown',
    tier: response.headers.get('x-edge-tier') || 'unknown',
    cache: response.headers.get('x-edge-cache') || 'unknown',
    wallMs,
    promptTokens: promptCount,
    outputTokens: evalCount,
    outputTokensPerSecond: evalDuration > 0 ? Math.round((evalCount / evalDuration) * 10) / 10 : null,
    promptTokensPerSecond: promptDuration > 0 ? Math.round((promptCount / promptDuration) * 10) / 10 : null,
    loadMs: Math.round(seconds(data.load_duration) * 1000),
    responseChars: String(data.response || '').length,
    responsePreview: String(data.response || '').replace(/\s+/g, ' ').slice(0, 120)
  };
}

async function main() {
  const configFile = process.argv.includes('--config')
    ? process.argv[process.argv.indexOf('--config') + 1]
    : undefined;
  const config = configFile ? readConfig(configFile) : readConfig();
  const target = String(arg('target', `http://${config.gateway.host}:${config.gateway.port}`)).replace(/\/+$/, '');
  const quick = process.argv.includes('--quick');
  const outFile = String(arg('out', path.join(config.paths.benchmarksDir, 'this-machine.json')));
  const concurrency = Math.max(1, Math.min(8, Number(arg('concurrency', config.gateway.maxConcurrent)) || 1));

  const health = await fetch(`${target}/health`, { signal: AbortSignal.timeout(4000) });
  if (!health.ok) throw new Error(`Gateway is not healthy at ${target}/health (HTTP ${health.status})`);
  console.log(`Benchmarking ${target} (profile: ${config.profile})`);
  console.log(`Models: fast=${config.models.fast} main=${config.models.main} deep=${config.models.deep || '-'}`);
  console.log('Warmup ...');
  await requestGenerate(target, { id: 'warmup', prompt: 'Reply with OK.' }, 'chat', 8);
  const prompts = quick ? PROMPTS.slice(0, 2) : PROMPTS;
  const results = [];
  for (const prompt of prompts) {
    process.stdout.write(`- ${prompt.id} ... `);
    try {
      const result = await requestGenerate(target, prompt, prompt.task, prompt.maxPredict || 128);
      results.push(result);
      console.log(`${result.outputTokensPerSecond ?? '?'} tok/s, ${result.wallMs} ms, model=${result.model}`);
    } catch (error) {
      results.push({ id: prompt.id, task: prompt.task, error: error.message });
      console.log(`FAILED: ${error.message}`);
    }
  }

  const concurrentPrompt = PROMPTS[1];
  const concurrentStarted = Date.now();
  const concurrentResults = await Promise.all(
    Array.from({ length: concurrency }, (_, index) =>
      requestGenerate(
        target,
        { ...concurrentPrompt, id: `${concurrentPrompt.id}_${index + 1}`, prompt: `${concurrentPrompt.prompt}\n\nRequest ${index + 1}` },
        'chat',
        96,
        `benchmark-${index + 1}`
      )
    )
  );
  const concurrentWallMs = Date.now() - concurrentStarted;
  const concurrent = {
    requests: concurrency,
    wallMs: concurrentWallMs,
    throughputRequestsPerSecond: Math.round((concurrency / (concurrentWallMs / 1000)) * 100) / 100,
    perRequest: concurrentResults.map((r) => ({
      model: r.model,
      wallMs: r.wallMs,
      outputTokensPerSecond: r.outputTokensPerSecond
    }))
  };

  const hardware = detectHardware({ root: config.projectRoot });
  const report = {
    schema: 1,
    timestamp: new Date().toISOString(),
    target,
    profile: config.profile,
    hardware,
    runtime: {
      ollamaHost: config.ollama.host,
      ollamaPort: config.ollama.port,
      numParallel: config.ollama.numParallel,
      maxLoadedModels: config.ollama.maxLoadedModels,
      contextLength: config.ollama.contextLength,
      numThreads: config.ollama.numThreads,
      forceCpu: config.ollama.forceCpu
    },
    gateway: {
      maxConcurrent: config.gateway.maxConcurrent,
      perUserConcurrent: config.gateway.perUserConcurrent,
      maxQueue: config.gateway.maxQueue
    },
    models: config.models,
    results,
    concurrent
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const successful = results.filter((r) => typeof r.outputTokensPerSecond === 'number');
  const failed = results.filter((r) => r.error);
  console.log('');
  console.log(`Saved ${outFile}`);
  console.log(
    `Single-stream average: ${
      Math.round(
        (successful.reduce((sum, r) => sum + r.outputTokensPerSecond, 0) / Math.max(1, successful.length)) * 10
      ) / 10
    } tok/s (${successful.length}/${results.length} prompts)`
  );
  console.log(`Concurrent ${concurrency}: ${concurrent.throughputRequestsPerSecond} req/s, wall ${concurrentWallMs} ms`);
  if (failed.length) {
    console.log(`Incomplete: ${failed.map((r) => r.id).join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Benchmark failed: ${error?.message || error}`);
  process.exit(1);
});
