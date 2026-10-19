import fs from 'node:fs';
import path from 'node:path';
import { readConfig } from '../lib/config.mjs';
import { readPid, stopPid, isPidRunning } from '../lib/process.mjs';

async function main() {
  const configFile = process.argv.includes('--config')
    ? process.argv[process.argv.indexOf('--config') + 1]
    : undefined;
  const config = configFile ? readConfig(configFile) : readConfig();
  const gatewayPidFile = path.join(config.paths.pidsDir, 'gateway.pid');
  const ollamaPidFile = path.join(config.paths.pidsDir, 'ollama.pid');

  const gatewayPid = readPid(gatewayPidFile);
  if (gatewayPid && isPidRunning(gatewayPid)) {
    console.log(`Stopping Edge AI gateway (pid ${gatewayPid}) ...`);
    await stopPid(gatewayPid, 'Edge AI gateway');
    fs.rmSync(gatewayPidFile, { force: true });
  } else {
    console.log('Edge AI gateway is not running (no live pid file).');
    fs.rmSync(gatewayPidFile, { force: true });
  }

  if (config.runtime.external) {
    console.log('Ollama is external; leaving it running.');
    return;
  }
  const ollamaPid = readPid(ollamaPidFile);
  if (ollamaPid && isPidRunning(ollamaPid)) {
    console.log(`Stopping Ollama (pid ${ollamaPid}) ...`);
    await stopPid(ollamaPid, 'Ollama');
    fs.rmSync(ollamaPidFile, { force: true });
  } else {
    console.log('Ollama is not running (no live pid file).');
    fs.rmSync(ollamaPidFile, { force: true });
  }
}

main().catch((error) => {
  console.error(`Edge AI stop failed: ${error?.message || error}`);
  process.exit(1);
});
