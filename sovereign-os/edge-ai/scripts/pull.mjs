import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, modelListForPull } from '../lib/config.mjs';
import { installedModelNames, pullModelWithRetry } from './install.mjs';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDGE_DIR = path.resolve(HERE, '..');

async function main() {
  const configFile = arg('config', null);
  const config = configFile === true ? readConfig() : readConfig(configFile || path.join(EDGE_DIR, 'edge-ai.config.json'));
  const explicitModel = arg('model', null);
  const selection = arg('models', 'fast,main');
  const models = explicitModel && explicitModel !== true
    ? [String(explicitModel)]
    : modelListForPull(config, selection === true ? 'fast,main' : selection);
  if (!models.length) {
    console.log('No models selected. Use --models fast,main,embed, --models all, or --model <name>.');
    return;
  }
  const baseUrl = `http://${config.ollama.host}:${config.ollama.port}`;
  const installed = await installedModelNames(baseUrl);
  const missing = models.filter((model) => !installed.has(model));
  const reused = models.filter((model) => installed.has(model));
  if (reused.length) console.log(`Already present: ${reused.join(', ')}`);
  if (!missing.length) {
    console.log('All selected models are already present.');
    return;
  }
  console.log(`Ollama: ${baseUrl}`);
  console.log(`Pulling: ${missing.join(', ')}`);
  for (const model of missing) {
    await pullModelWithRetry(baseUrl, model, config.profile, Number(arg('retry', 6)) || 6);
  }
  console.log('Done.');
}

main().catch((error) => {
  console.error(`pull failed: ${error.message}`);
  process.exit(1);
});
