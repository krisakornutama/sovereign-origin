import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detectHardware, hardwareSummary } from '../lib/hardware.mjs';
import {
  loadProfiles,
  pickProfile,
  buildConfig,
  writeConfig,
  validateConfig,
  modelListForPull,
  configPathFor
} from '../lib/config.mjs';
import { estimateMemoryGB } from '../lib/models.mjs';
import { importModels } from './import-models.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDGE_DIR = path.resolve(HERE, '..');
const ROOT = path.resolve(EDGE_DIR, '..', '..');

const DEFAULT_OLLAMA_VERSION = 'v0.40.6';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function log(message = '') {
  console.log(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, { timeout = 30000 } = {}) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'sovereign-edge-ai-installer', accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function downloadFile(url, destination, { expectedSha256 = null, label = 'download', force = false } = {}) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination) && !force) {
    const actual = await sha256File(destination);
    if (!expectedSha256 || actual === expectedSha256) {
      log(`  ${label}: already downloaded (${Math.round(fs.statSync(destination).size / 1048576)} MB)`);
      return { file: destination, sha256: actual, skipped: true };
    }
    log(`  ${label}: existing file hash mismatch, downloading again`);
  }
  const response = await fetch(url, {
    headers: { 'user-agent': 'sovereign-edge-ai-installer' },
    signal: AbortSignal.timeout(2 * 60 * 60 * 1000)
  });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} for ${url}`);
  if (!response.body) throw new Error(`Download failed: empty response for ${url}`);
  const total = Number(response.headers.get('content-length') || 0);
  const temp = `${destination}.part`;
  const output = fs.createWriteStream(temp);
  const hash = crypto.createHash('sha256');
  let downloaded = 0;
  let lastPrint = 0;
  try {
    for await (const chunk of response.body) {
      hash.update(chunk);
      downloaded += chunk.length;
      if (!output.write(chunk)) await once(output, 'drain');
      const now = Date.now();
      if (now - lastPrint > 2000) {
        lastPrint = now;
        const mb = (downloaded / 1048576).toFixed(1);
        const totalMb = total ? (total / 1048576).toFixed(1) : '?';
        const pct = total ? ` ${((downloaded / total) * 100).toFixed(1)}%` : '';
        process.stdout.write(`\r  ${label}: ${mb} / ${totalMb} MB${pct}   `);
      }
    }
    output.end();
    await once(output, 'close');
  } catch (error) {
    output.destroy();
    fs.rmSync(temp, { force: true });
    throw error;
  }
  process.stdout.write('\n');
  const actual = hash.digest('hex');
  if (expectedSha256 && actual !== expectedSha256) {
    fs.rmSync(temp, { force: true });
    throw new Error(`SHA-256 mismatch for ${label}: expected ${expectedSha256}, got ${actual}`);
  }
  fs.renameSync(temp, destination);
  return { file: destination, sha256: actual, skipped: false };
}

function chooseAsset(release, platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`;
  const names = {
    'win32-x64': ['ollama-windows-amd64.zip'],
    'win32-arm64': ['ollama-windows-arm64.zip'],
    'linux-x64': ['ollama-linux-amd64.tar.zst'],
    'linux-arm64': ['ollama-linux-arm64.tar.zst'],
    'darwin-arm64': ['ollama-darwin.tgz', 'Ollama-darwin.zip'],
    'darwin-x64': ['ollama-darwin.tgz', 'Ollama-darwin.zip']
  };
  const wanted = names[key];
  if (!wanted) throw new Error(`Unsupported platform for automatic Ollama install: ${key}`);
  for (const name of wanted) {
    const asset = (release.assets || []).find((item) => item.name === name);
    if (asset) {
      const digest = String(asset.digest || '').startsWith('sha256:') ? asset.digest.slice(7) : null;
      return {
        name: asset.name,
        url: asset.browser_download_url,
        size: asset.size,
        sha256: digest
      };
    }
  }
  throw new Error(`Release ${release.tag_name} has no asset for ${key}. Available: ${(release.assets || []).map((a) => a.name).join(', ')}`);
}

function extractArchive(archive, destination, platform = process.platform) {
  fs.mkdirSync(destination, { recursive: true });
  if (archive.endsWith('.zip')) {
    if (platform === 'win32') {
      const tar = spawnSync('tar', ['-xf', archive, '-C', destination], { windowsHide: true, stdio: 'ignore' });
      if (tar.status === 0) return;
      const escape = (value) => String(value).replace(/'/g, "''");
      const command = `Expand-Archive -LiteralPath '${escape(archive)}' -DestinationPath '${escape(destination)}' -Force`;
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        windowsHide: true,
        stdio: 'inherit'
      });
      if (result.status !== 0) throw new Error('Failed to extract zip with PowerShell Expand-Archive');
      return;
    }
    const result = spawnSync('unzip', ['-q', '-o', archive, '-d', destination], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Failed to extract zip with unzip');
    return;
  }
  if (archive.endsWith('.tar.zst')) {
    const result = spawnSync('tar', ['--zstd', '-xf', archive, '-C', destination], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Failed to extract .tar.zst; install zstd and tar first');
    return;
  }
  if (archive.endsWith('.tgz') || archive.endsWith('.tar.gz')) {
    const result = spawnSync('tar', ['-xzf', archive, '-C', destination], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Failed to extract tar archive');
    return;
  }
  throw new Error(`Unsupported archive: ${archive}`);
}

function walkForExecutable(dir, names, depth = 0) {
  if (depth > 4 || !fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && names.includes(entry.name.toLowerCase())) return full;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'downloads') continue;
    const found = walkForExecutable(path.join(dir, entry.name), names, depth + 1);
    if (found) return found;
  }
  return null;
}

function ollamaExecutable(runtimeDir, platform = process.platform) {
  const names = platform === 'win32' ? ['ollama.exe'] : ['ollama'];
  return walkForExecutable(runtimeDir, names);
}

function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

async function findFreePort(start, host = '127.0.0.1', exclude = []) {
  for (let port = start; port < start + 50; port += 1) {
    if (exclude.includes(port)) continue;
    if (await isPortFree(port, host)) return port;
  }
  throw new Error(`Could not find a free port starting at ${start}`);
}

async function existingOllama(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return null;
    const data = await response.json().catch(() => ({}));
    return data?.version || 'unknown';
  } catch {
    return null;
  }
}

async function waitForHttp(url, timeoutMs, label) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(700);
  }
  throw new Error(`${label} did not become healthy within ${Math.round(timeoutMs / 1000)}s: ${lastError?.message || 'timeout'}`);
}

function startDetached(exe, args, env, cwd, logFile) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, 'a');
  const child = spawn(exe, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', fd, fd]
  });
  child.unref();
  try {
    fs.closeSync(fd);
  } catch {
    // The child keeps its own descriptor; closing the parent copy is best effort.
  }
  return child.pid;
}

function writePid(pidFile, pid) {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, `${pid}\n`, 'utf8');
}

function tail(file, lines = 20) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '';
  }
}

export async function installedModelNames(baseUrl, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return new Set();
    const data = await response.json();
    const names = new Set();
    for (const model of data.models || []) {
      if (model?.name) names.add(model.name);
      if (model?.model) names.add(model.model);
    }
    return names;
  } catch {
    return new Set();
  }
}

async function pullModel(baseUrl, model, label) {
  log(`  pulling ${model} ...`);
  const response = await fetch(`${baseUrl}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: model, stream: true }),
    signal: AbortSignal.timeout(2 * 60 * 60 * 1000)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Pull ${model} failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  if (!response.body) throw new Error(`Pull ${model} failed: empty response`);
  let buffer = '';
  let lastPrint = 0;
  let lastStatus = '';
  for await (const chunk of response.body) {
    buffer += Buffer.from(chunk).toString('utf8');
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.error) throw new Error(`Pull ${model} failed: ${event.error}`);
      if (event.status) lastStatus = event.status;
      const now = Date.now();
      if (event.total && event.completed !== undefined && now - lastPrint > 1500) {
        lastPrint = now;
        const pct = ((event.completed / event.total) * 100).toFixed(1);
        process.stdout.write(`\r    ${model}: ${lastStatus} ${pct}%   `);
      }
    }
  }
  process.stdout.write('\n');
  log(`  pulled ${model} (${label})`);
}

export async function pullModelWithRetry(baseUrl, model, label, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pullModel(baseUrl, model, label);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      const waitMs = attempt * 15000;
      log(`  pull ${model} interrupted (${error.message}); retry ${attempt}/${attempts - 1} in ${waitMs / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

async function buildPlan({
  root = ROOT,
  profile,
  models = 'fast,main',
  gatewayHost = '127.0.0.1',
  gatewayPort,
  ollamaPort,
  reuseExisting = true,
  token = null,
  runtimeDir = path.join(EDGE_DIR, 'runtime', 'ollama'),
  modelsDir = path.join(EDGE_DIR, 'models')
} = {}) {
  const hardware = detectHardware({ root });
  const profiles = loadProfiles();
  const profileName = pickProfile(hardware, profiles, profile === true ? undefined : profile);
  const existing = await existingOllama(11434);
  let resolvedOllamaPort = ollamaPort ? Number(ollamaPort) : null;
  let resolvedGatewayPort = gatewayPort ? Number(gatewayPort) : null;
  let external = false;

  if (!resolvedOllamaPort && existing && reuseExisting) {
    resolvedOllamaPort = 11434;
    external = true;
  }
  if (!resolvedOllamaPort) {
    resolvedOllamaPort = await findFreePort(11435, '127.0.0.1');
  }
  if (!resolvedGatewayPort) {
    resolvedGatewayPort = await findFreePort(11434, gatewayHost, [resolvedOllamaPort]);
  }
  if (resolvedGatewayPort === resolvedOllamaPort) {
    throw new Error(`Gateway port and Ollama port must differ (both ${resolvedGatewayPort})`);
  }
  if (resolvedGatewayPort === 11434 && resolvedOllamaPort === 11434) {
    throw new Error('Gateway and Ollama cannot both use port 11434');
  }
  if (gatewayPort && !(await isPortFree(resolvedGatewayPort, gatewayHost))) {
    throw new Error(`Requested gateway port ${resolvedGatewayPort} is already in use`);
  }
  if (ollamaPort) {
    const occupiedByOllama = await existingOllama(resolvedOllamaPort);
    if (occupiedByOllama && resolvedOllamaPort === 11434) {
      external = true;
    } else if (!occupiedByOllama && !(await isPortFree(resolvedOllamaPort, '127.0.0.1'))) {
      throw new Error(`Requested Ollama port ${resolvedOllamaPort} is already in use`);
    }
  }
  if (external && resolvedGatewayPort === 11434) {
    resolvedGatewayPort = await findFreePort(11435, gatewayHost, [resolvedOllamaPort]);
  }

  const existingExe = external ? null : ollamaExecutable(runtimeDir, hardware.platform);
  const edgeDir = path.join(root, 'sovereign-os', 'edge-ai');
  const config = buildConfig({
    profileName,
    profilesData: profiles,
    hardware,
    projectRoot: root,
    edgeDir,
    runtimeDir,
    modelsDir,
    ollamaExe: existingExe,
    gatewayHost,
    gatewayPort: resolvedGatewayPort,
    ollamaHost: '127.0.0.1',
    ollamaPort: resolvedOllamaPort,
    externalOllama: external,
    token
  });
  validateConfig(config);
  const selectedModels = modelListForPull(config, models === true ? 'fast,main' : models);
  const estimatedMemoryGB = estimateMemoryGB(config);
  const warnings = [];
  if (estimatedMemoryGB > Number(hardware.ramGB) * 0.85) {
    warnings.push(
      `Estimated memory ${estimatedMemoryGB} GB is above 85% of ${hardware.ramGB} GB RAM. Use models=fast,main and close other apps.`
    );
  }
  if (gatewayHost !== '127.0.0.1' && gatewayHost !== 'localhost' && !token) {
    warnings.push('Gateway is bound beyond loopback without a bearer token. Use --token or keep 127.0.0.1.');
  }
  return {
    hardware,
    profileName,
    config,
    selectedModels,
    estimatedMemoryGB,
    warnings,
    existingOllamaVersion: existing,
    external,
    runtimeDir,
    modelsDir
  };
}

function printPlan(plan) {
  const { hardware, profileName, config, selectedModels, estimatedMemoryGB, warnings } = plan;
  log('Sovereign Edge AI - install plan');
  log('===============================');
  log(hardwareSummary(hardware));
  log('');
  log(`Profile: ${profileName}`);
  log(`Models: ${selectedModels.length ? selectedModels.join(', ') : '(none; import or pull later)'}`);
  log(`Estimated model + KV + OS memory: ${estimatedMemoryGB} GB / ${hardware.ramGB} GB`);
  log(`Gateway: http://${config.gateway.host}:${config.gateway.port}`);
  log(`Ollama:  http://${config.ollama.host}:${config.ollama.port}${plan.external ? ' (existing instance)' : ''}`);
  log(`Runtime: ${config.runtime.dir}${plan.external ? ' (not managed)' : ''}`);
  log(`Models:  ${config.runtime.modelsDir}`);
  log(`Config:  ${config.paths.configFile}`);
  if (config.adjustments?.length) {
    log('');
    log('Auto adjustments:');
    for (const item of config.adjustments) log(`  - ${item}`);
  }
  if (warnings.length) {
    log('');
    log('Warnings:');
    for (const item of warnings) log(`  - ${item}`);
  }
  log('');
}

function printNextSteps(plan) {
  log('Ready.');
  log(`  Gateway: http://${plan.config.gateway.host}:${plan.config.gateway.port}`);
  log(`  Health:  http://${plan.config.gateway.host}:${plan.config.gateway.port}/health`);
  log(`  Config:  ${plan.config.paths.configFile}`);
  log('');
  log('The gateway speaks the Ollama API used by core-api (/api/generate, /api/chat, /api/tags).');
  log('Keep the gateway on 11434 if you want core-api to reach it without changing OLLAMA_URL.');
  log('Cold Soak: this installer does not edit .env, Docker, or the database.');
}

async function main() {
  const dryRun = flag('dry-run');
  const noStart = flag('no-start') || flag('download-only');
  const skipModels = flag('skip-models') || flag('download-only');
  const profile = arg('profile', undefined);
  const models = arg('models', skipModels ? 'none' : 'fast,main');
  const gatewayHost = arg('gateway-host', '127.0.0.1');
  const gatewayPort = arg('gateway-port', undefined);
  const ollamaPort = arg('ollama-port', undefined);
  const reuseExisting = !flag('no-reuse');
  const runtimeDir = path.resolve(arg('runtime-dir', path.join(EDGE_DIR, 'runtime', 'ollama')));
  const modelsDir = path.resolve(arg('models-dir', path.join(EDGE_DIR, 'models')));
  const importFrom = arg('import-from', null);
  const importOnly = arg('import-only', null);
  let token = arg('token', null);
  if (token === true) token = null;
  if (gatewayHost !== '127.0.0.1' && gatewayHost !== 'localhost' && !token) {
    token = crypto.randomBytes(24).toString('hex');
    log('Generated a bearer token for non-loopback gateway binding. Store it securely:');
    log(`  ${token}`);
  }

  const plan = await buildPlan({
    root: ROOT,
    profile,
    models,
    gatewayHost,
    gatewayPort,
    ollamaPort,
    reuseExisting,
    token,
    runtimeDir,
    modelsDir
  });
  printPlan(plan);
  if (plan.warnings.some((w) => w.includes('bearer token'))) {
    throw new Error('Refusing to bind a non-loopback gateway without a token. Re-run with --token <secret>.');
  }
  if (dryRun) {
    log('Dry run only. Nothing was downloaded, written, or started.');
    return;
  }

  fs.mkdirSync(EDGE_DIR, { recursive: true });
  fs.mkdirSync(plan.config.paths.logsDir, { recursive: true });
  fs.mkdirSync(plan.config.paths.pidsDir, { recursive: true });
  fs.mkdirSync(plan.modelsDir, { recursive: true });

  if (!plan.external) {
    let exe = ollamaExecutable(plan.runtimeDir, process.platform);
    if (!exe || flag('force')) {
      const version = String(arg('version', DEFAULT_OLLAMA_VERSION) || DEFAULT_OLLAMA_VERSION);
      const releaseUrl =
        version === 'latest'
          ? 'https://api.github.com/repos/ollama/ollama/releases/latest'
          : `https://api.github.com/repos/ollama/ollama/releases/tags/${encodeURIComponent(version)}`;
      log(`Resolving Ollama ${version} ...`);
      const release = await fetchJson(releaseUrl);
      const asset = chooseAsset(release);
      log(`Downloading ${asset.name} (${Math.round(asset.size / 1048576)} MB) ...`);
      const downloaded = await downloadFile(asset.url, path.join(EDGE_DIR, 'runtime', 'downloads', asset.name), {
        expectedSha256: asset.sha256,
        label: asset.name,
        force: flag('force')
      });
      log(`Extracting ${asset.name} ...`);
      extractArchive(downloaded.file, plan.runtimeDir, process.platform);
      exe = ollamaExecutable(plan.runtimeDir, process.platform);
      if (!exe) throw new Error(`Could not find ollama executable under ${plan.runtimeDir} after extraction`);
      log(`Ollama executable: ${exe}`);
    }
    plan.config.runtime.exe = exe;
  }

  writeConfig(plan.config, plan.config.paths.configFile);
  log(`Wrote ${plan.config.paths.configFile}`);

  if (importFrom && importFrom !== true) {
    log(`Importing models from ${importFrom} ...`);
    const imported = importModels({
      from: path.resolve(importFrom),
      to: plan.modelsDir,
      only: importOnly === true ? null : importOnly,
      hardlink: !flag('copy'),
      strict: flag('strict-import'),
      dryRun: false,
      log
    });
    log(
      `Import complete: ${imported.manifests} manifest(s), ${imported.blobs} blob(s), ${(imported.bytes / 1024 ** 3).toFixed(2)} GB copied, ${imported.linked} hardlinked, ${imported.skipped} already present.`
    );
    if (imported.errors.length) log(`Import warnings: ${imported.errors.length} (partial/missing models were skipped)`);
  }

  if (noStart) {
    log('Download/config only. Start later with: node sovereign-os/edge-ai/scripts/start.mjs');
    return;
  }

  const ollamaUrl = `http://127.0.0.1:${plan.config.ollama.port}`;
  const gatewayUrl = `http://127.0.0.1:${plan.config.gateway.port}`;

  if (!plan.external) {
    const healthy = await existingOllama(plan.config.ollama.port);
    if (!healthy) {
      log(`Starting Ollama on 127.0.0.1:${plan.config.ollama.port} ...`);
      const pid = startDetached(
        plan.config.runtime.exe,
        ['serve'],
        plan.config.ollama.env,
        plan.runtimeDir,
        path.join(plan.config.paths.logsDir, 'ollama.log')
      );
      writePid(path.join(plan.config.paths.pidsDir, 'ollama.pid'), pid);
    } else {
      log(`Ollama already listening on ${plan.config.ollama.port} (${healthy})`);
    }
    try {
      await waitForHttp(`${ollamaUrl}/api/version`, 120000, 'Ollama');
    } catch (error) {
      const logText = tail(path.join(plan.config.paths.logsDir, 'ollama.log'));
      throw new Error(`${error.message}\n--- ollama.log ---\n${logText}`);
    }
  } else {
    const version = await existingOllama(plan.config.ollama.port);
    if (!version) throw new Error(`No Ollama instance found on 127.0.0.1:${plan.config.ollama.port}`);
    log(`Using existing Ollama ${version} on 127.0.0.1:${plan.config.ollama.port}`);
  }

  if (plan.selectedModels.length) {
    const installed = await installedModelNames(ollamaUrl);
    const missing = plan.selectedModels.filter((model) => !installed.has(model));
    const reused = plan.selectedModels.filter((model) => installed.has(model));
    if (reused.length) log(`Models already present (skipped): ${reused.join(', ')}`);
    if (missing.length) {
      log('Pulling models (first run can take a while) ...');
      for (const model of missing) {
        await pullModelWithRetry(ollamaUrl, model, plan.profileName);
      }
    } else {
      log('All selected models are already present.');
    }
  } else {
    log('Skipping model pull.');
  }

  try {
    const response = await fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(1500) });
    if (response.ok) log(`Gateway already listening on ${gatewayUrl}`);
    else throw new Error(`HTTP ${response.status}`);
  } catch {
    log(`Starting Edge AI gateway on ${gatewayUrl} ...`);
    const pid = startDetached(
      process.execPath,
      [path.join(EDGE_DIR, 'gateway', 'server.mjs'), '--config', plan.config.paths.configFile],
      {},
      EDGE_DIR,
      path.join(plan.config.paths.logsDir, 'gateway.log')
    );
    writePid(path.join(plan.config.paths.pidsDir, 'gateway.pid'), pid);
  }
  try {
    await waitForHttp(`${gatewayUrl}/health`, 30000, 'Edge AI gateway');
  } catch (error) {
    const logText = tail(path.join(plan.config.paths.logsDir, 'gateway.log'));
    throw new Error(`${error.message}\n--- gateway.log ---\n${logText}`);
  }
  printNextSteps(plan);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(`\nEdge AI install failed: ${error?.message || error}`);
    process.exit(1);
  });
}

export { buildPlan, printPlan, main, DEFAULT_OLLAMA_VERSION };
