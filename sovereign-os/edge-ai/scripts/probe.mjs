import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectHardware, hardwareSummary } from '../lib/hardware.mjs';
import { loadProfiles, pickProfile, fitProfileToHardware } from '../lib/config.mjs';
import { estimateMemoryGB } from '../lib/models.mjs';
import { buildConfig } from '../lib/config.mjs';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export function probe({ root = process.cwd(), profile } = {}) {
  const hardware = detectHardware({ root });
  const profiles = loadProfiles();
  const profileName = pickProfile(hardware, profiles, profile);
  const fitted = fitProfileToHardware(profiles.profiles[profileName], hardware);
  const config = buildConfig({
    profileName,
    profilesData: profiles,
    hardware,
    projectRoot: root,
    gatewayPort: 11434,
    ollamaPort: 11435
  });
  return {
    hardware,
    profile: profileName,
    profileLabel: profiles.profiles[profileName].label,
    adjustments: fitted.adjustments,
    models: fitted.profile.models,
    ollama: fitted.profile.ollama,
    gateway: fitted.profile.gateway,
    estimatedMemoryGB: estimateMemoryGB(config)
  };
}

function printHuman(result) {
  console.log('Sovereign Edge AI - hardware probe');
  console.log('==================================');
  console.log(hardwareSummary(result.hardware));
  console.log('');
  console.log(`Selected profile: ${result.profile} (${result.profileLabel})`);
  console.log(`Estimated model + KV + OS memory: ${result.estimatedMemoryGB} GB / ${result.hardware.ramGB} GB`);
  console.log('');
  console.log('Tiered models:');
  for (const [tier, model] of Object.entries(result.models)) {
    console.log(`  ${tier.padEnd(7)} ${model || '(disabled)'}`);
  }
  console.log('');
  console.log('Runtime limits:');
  console.log(`  parallel requests: ${result.ollama.numParallel}`);
  console.log(`  max loaded models: ${result.ollama.maxLoadedModels}`);
  console.log(`  context length: ${result.ollama.contextLength}`);
  console.log(`  gateway concurrency: ${result.gateway.maxConcurrent} (per user: ${result.gateway.perUserConcurrent})`);
  console.log(`  gateway queue: ${result.gateway.maxQueue}`);
  console.log(`  threads: ${result.ollama.numThreads}`);
  if (result.adjustments.length) {
    console.log('');
    console.log('Auto adjustments:');
    for (const adjustment of result.adjustments) console.log(`  - ${adjustment}`);
  }
  console.log('');
  console.log('Nothing was installed or started. Next: node scripts/install.mjs --dry-run');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const root = path.resolve(arg('root', process.cwd()));
  const profile = arg('profile', undefined);
  const result = probe({ root, profile });
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
}
