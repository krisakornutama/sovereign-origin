import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../lib/config.mjs';
import { startDetached, waitForHttp, writePid, tail } from '../lib/process.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDGE_DIR = path.resolve(HERE, '..');

async function ollamaVersion(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return null;
    const data = await response.json().catch(() => ({}));
    return data?.version || 'unknown';
  } catch {
    return null;
  }
}

async function main() {
  const configFile = process.argv.includes('--config')
    ? process.argv[process.argv.indexOf('--config') + 1]
    : undefined;
  let config;
  try {
    config = configFile ? readConfig(configFile) : readConfig();
  } catch (error) {
    console.error(`Could not read Edge AI config: ${error.message}`);
    console.error('Run EDGE-AI-INSTALL.cmd first.');
    process.exit(1);
    return;
  }
  fs.mkdirSync(config.paths.logsDir, { recursive: true });
  fs.mkdirSync(config.paths.pidsDir, { recursive: true });

  if (!config.runtime.external) {
    if (!config.runtime.exe || !fs.existsSync(config.runtime.exe)) {
      console.error(`Ollama executable not found: ${config.runtime.exe || '(not configured)'}`);
      console.error('Run EDGE-AI-INSTALL.cmd or pass --config with a valid runtime.exe.');
      process.exit(1);
      return;
    }
    const running = await ollamaVersion(config.ollama.port);
    if (!running) {
      console.log(`Starting Ollama on 127.0.0.1:${config.ollama.port} ...`);
      const pid = startDetached(
        config.runtime.exe,
        ['serve'],
        config.ollama.env,
        config.runtime.dir,
        path.join(config.paths.logsDir, 'ollama.log')
      );
      writePid(path.join(config.paths.pidsDir, 'ollama.pid'), pid);
      try {
        await waitForHttp(`http://127.0.0.1:${config.ollama.port}/api/version`, 120000, 'Ollama');
      } catch (error) {
        throw new Error(`${error.message}\n${tail(path.join(config.paths.logsDir, 'ollama.log'))}`);
      }
    } else {
      console.log(`Ollama already running on ${config.ollama.port} (${running})`);
    }
  } else {
    const running = await ollamaVersion(config.ollama.port);
    if (!running) throw new Error(`External Ollama is not reachable on 127.0.0.1:${config.ollama.port}`);
    console.log(`Using external Ollama ${running} on ${config.ollama.port}`);
  }

  const gatewayUrl = `http://${config.gateway.host}:${config.gateway.port}`;
  let gatewayHealthy = false;
  try {
    const response = await fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(2000) });
    gatewayHealthy = response.ok;
  } catch {
    gatewayHealthy = false;
  }
  if (!gatewayHealthy) {
    console.log(`Starting Edge AI gateway on ${gatewayUrl} ...`);
    const pid = startDetached(
      process.execPath,
      [path.join(EDGE_DIR, 'gateway', 'server.mjs'), '--config', config.paths.configFile],
      {},
      EDGE_DIR,
      path.join(config.paths.logsDir, 'gateway.log')
    );
    writePid(path.join(config.paths.pidsDir, 'gateway.pid'), pid);
    try {
      await waitForHttp(`${gatewayUrl}/health`, 30000, 'Edge AI gateway');
    } catch (error) {
      throw new Error(`${error.message}\n${tail(path.join(config.paths.logsDir, 'gateway.log'))}`);
    }
  } else {
    console.log(`Gateway already running on ${gatewayUrl}`);
  }

  console.log('');
  console.log(`Edge AI is ready: ${gatewayUrl}`);
  console.log(`Health: ${gatewayUrl}/health`);
  console.log(`Profile: ${config.profile}`);
}

main().catch((error) => {
  console.error(`Edge AI start failed: ${error?.message || error}`);
  process.exit(1);
});
