import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EDGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROFILES_FILE = path.join(EDGE_DIR, 'profiles.json');
export const CONFIG_FILE = path.join(EDGE_DIR, 'edge-ai.config.json');

export const DEFAULT_ROUTING = {
  defaultTask: 'chat',
  tasks: {
    chat: 'main',
    general: 'main',
    classify: 'fast',
    extract: 'main',
    embed: 'embed',
    vision: 'vision',
    code: 'deep',
    reason: 'deep',
    deep: 'deep'
  },
  aliases: {
    'gemma3:1b': 'main',
    'gemma3:4b': 'main',
    'qwen3:0.6b': 'fast',
    'qwen3:1.7b': 'fast',
    'qwen3:4b': 'main',
    'qwen3:8b': 'deep',
    'qwen3:14b': 'deep',
    'deepseek-r1:1.5b': 'fast',
    'deepseek-r1:8b': 'deep',
    'qwen3-vl:8b': 'vision',
    'nomic-embed-text': 'embed',
    'bge-m3': 'embed'
  },
  unknownModelPolicy: 'main'
};

export const DEFAULT_GATEWAY = {
  host: '127.0.0.1',
  port: 11434,
  maxConcurrent: 2,
  perUserConcurrent: 1,
  maxQueue: 24,
  queueTimeoutMs: 180000,
  cacheTtlMs: 600000,
  cacheMaxEntries: 200,
  maxHistoryMessages: 12,
  maxPromptChars: 24000,
  maxPredictTokens: 2048,
  maxBodyBytes: 10 * 1024 * 1024,
  upstreamTimeoutMs: 300000
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadProfiles(file = PROFILES_FILE) {
  const data = readJson(file);
  if (!data || typeof data !== 'object' || !data.profiles || typeof data.profiles !== 'object') {
    throw new Error(`Invalid profiles file: ${file}`);
  }
  return data;
}

export function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = hasOwn(base, key) ? deepMerge(base[key], value) : value;
  }
  return out;
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function pickProfile(hardware, profilesData, override) {
  const profiles = profilesData.profiles || profilesData;
  if (override) {
    if (!profiles[override]) {
      throw new Error(`Unknown profile "${override}". Choose one of: ${Object.keys(profiles).join(', ')}`);
    }
    return override;
  }
  const gpu = (hardware.gpu || []).find((g) => g.discrete && Number(g.vramGB) >= 7);
  const ram = Number(hardware.ramGB) || 0;
  if (gpu && ram >= 12) return 'gpu';
  if (ram >= 28) return 'standard';
  if (ram >= 12) return 'mini';
  return 'nano';
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function fitProfileToHardware(profile, hardware) {
  const out = structuredClone(profile);
  const adjustments = [];
  const physical = Number(hardware.physicalCores) || Math.max(2, Math.floor((Number(hardware.logicalCores) || 4) / 2));
  const threads = clampInt(out.ollama?.numThreads, 2, Math.max(2, physical), Math.max(2, physical));
  if (threads !== out.ollama.numThreads) {
    adjustments.push(`threads ${out.ollama.numThreads} -> ${threads} (physical cores: ${physical})`);
    out.ollama.numThreads = threads;
  }
  const ram = Number(hardware.ramGB) || 0;
  if (ram > 0 && ram < 12) {
    if (out.ollama.maxLoadedModels > 1) {
      adjustments.push(`maxLoadedModels ${out.ollama.maxLoadedModels} -> 1 (RAM ${ram} GB)`);
      out.ollama.maxLoadedModels = 1;
    }
    if (out.gateway.maxConcurrent > 1) {
      adjustments.push(`maxConcurrent ${out.gateway.maxConcurrent} -> 1 (RAM ${ram} GB)`);
      out.gateway.maxConcurrent = 1;
      out.gateway.perUserConcurrent = 1;
    }
    if (out.ollama.contextLength > 2048) {
      adjustments.push(`contextLength ${out.ollama.contextLength} -> 2048 (RAM ${ram} GB)`);
      out.ollama.contextLength = 2048;
    }
  }
  const bestVram = Math.max(0, ...(hardware.gpu || []).filter((g) => g.discrete).map((g) => Number(g.vramGB) || 0));
  if (bestVram > 0 && bestVram < 10) {
    if (out.ollama.contextLength > 4096) {
      adjustments.push(`contextLength ${out.ollama.contextLength} -> 4096 (VRAM ${bestVram} GB)`);
      out.ollama.contextLength = 4096;
    }
    if (out.ollama.maxLoadedModels > 1) {
      adjustments.push(`maxLoadedModels ${out.ollama.maxLoadedModels} -> 1 (VRAM ${bestVram} GB)`);
      out.ollama.maxLoadedModels = 1;
    }
    if (out.gateway.maxConcurrent > 2) {
      adjustments.push(`maxConcurrent ${out.gateway.maxConcurrent} -> 2 (VRAM ${bestVram} GB)`);
      out.gateway.maxConcurrent = 2;
    }
  }
  if (out.gateway.perUserConcurrent > out.gateway.maxConcurrent) {
    out.gateway.perUserConcurrent = out.gateway.maxConcurrent;
  }
  return { profile: out, adjustments };
}

function portableExeName(platform = process.platform) {
  return platform === 'win32' ? 'ollama.exe' : 'ollama';
}

export function buildConfig({
  profileName,
  profilesData,
  hardware,
  projectRoot,
  edgeDir = path.join(projectRoot, 'sovereign-os', 'edge-ai'),
  runtimeDir = path.join(edgeDir, 'runtime'),
  modelsDir = path.join(edgeDir, 'models'),
  ollamaExe,
  gatewayHost = '127.0.0.1',
  gatewayPort = 11434,
  ollamaHost = '127.0.0.1',
  ollamaPort = 11435,
  externalOllama = false,
  token = null,
  now = new Date()
}) {
  const profiles = profilesData.profiles || profilesData;
  const profile = profiles[profileName];
  if (!profile) throw new Error(`Unknown profile "${profileName}"`);
  const fitted = fitProfileToHardware(profile, hardware);
  const p = fitted.profile;
  const config = {
    version: 1,
    generatedAt: now.toISOString(),
    profile: profileName,
    profileLabel: p.label,
    projectRoot,
    hardware: {
      cpuModel: hardware.cpuModel || 'unknown',
      physicalCores: hardware.physicalCores,
      logicalCores: hardware.logicalCores,
      ramGB: hardware.ramGB,
      freeDiskGB: hardware.freeDiskGB,
      gpu: hardware.gpu || []
    },
    runtime: {
      name: 'ollama',
      dir: runtimeDir,
      exe: ollamaExe || path.join(runtimeDir, portableExeName(hardware.platform)),
      modelsDir,
      external: Boolean(externalOllama)
    },
    ollama: {
      host: ollamaHost,
      port: ollamaPort,
      ...p.ollama
    },
    gateway: {
      ...DEFAULT_GATEWAY,
      ...p.gateway,
      host: gatewayHost,
      port: gatewayPort
    },
    models: { ...p.models },
    routing: structuredClone(DEFAULT_ROUTING),
    rollout: { ...p.rollout },
    security: { token: token || null },
    paths: {
      edgeDir,
      logsDir: path.join(edgeDir, 'logs'),
      pidsDir: path.join(edgeDir, 'pids'),
      benchmarksDir: path.join(edgeDir, 'benchmarks'),
      configFile: path.join(edgeDir, 'edge-ai.config.json')
    },
    adjustments: fitted.adjustments
  };
  config.ollama.env = ollamaEnv(config);
  return config;
}

export function ollamaEnv(config) {
  const o = config.ollama;
  const env = {
    OLLAMA_HOST: `${o.host}:${o.port}`,
    OLLAMA_MODELS: config.runtime.modelsDir,
    OLLAMA_NUM_PARALLEL: String(o.numParallel),
    OLLAMA_MAX_LOADED_MODELS: String(o.maxLoadedModels),
    OLLAMA_CONTEXT_LENGTH: String(o.contextLength),
    OLLAMA_MAX_QUEUE: String(o.maxQueue),
    OLLAMA_KEEP_ALIVE: String(o.keepAlive),
    OLLAMA_FLASH_ATTENTION: String(o.flashAttention),
    OLLAMA_KV_CACHE_TYPE: String(o.kvCacheType),
    OLLAMA_MULTIUSER_CACHE: String(o.multiUserCache),
    OLLAMA_LOAD_TIMEOUT: String(o.loadTimeout || '10m'),
    OLLAMA_NO_CLOUD: '1'
  };
  if (o.forceCpu) env.OLLAMA_LLM_LIBRARY = 'cpu';
  return env;
}

export function validateConfig(config) {
  const errors = [];
  const base = (name, value) => {
    if (typeof value !== 'string' || value.length < 16) errors.push(`${name} must be a string of at least 16 characters`);
  };
  if (!config || typeof config !== 'object') errors.push('config must be an object');
  if (config?.version !== 1) errors.push('config.version must be 1');
  if (!config?.profile) errors.push('config.profile is required');
  if (!config?.models?.main) errors.push('config.models.main is required');
  for (const tier of ['fast', 'main', 'embed']) {
    if (typeof config?.models?.[tier] !== 'string' || !config.models[tier].trim()) {
      errors.push(`config.models.${tier} must be a non-empty string`);
    }
  }
  for (const tier of ['deep', 'vision']) {
    const value = config?.models?.[tier];
    if (value !== null && value !== undefined && (typeof value !== 'string' || !value.trim())) {
      errors.push(`config.models.${tier} must be null or a non-empty string`);
    }
  }
  const port = (name, value) => {
    if (!Number.isInteger(value) || value < 1 || value > 65535) errors.push(`${name} must be an integer 1-65535`);
  };
  port('config.gateway.port', config?.gateway?.port);
  port('config.ollama.port', config?.ollama?.port);
  if (config?.gateway?.host === config?.ollama?.host && config?.gateway?.port === config?.ollama?.port) {
    errors.push('gateway.port and ollama.port must differ when hosts are equal');
  }
  const int = (name, value, min, max) => {
    if (!Number.isInteger(value) || value < min || value > max) errors.push(`${name} must be an integer ${min}-${max}`);
  };
  int('config.gateway.maxConcurrent', config?.gateway?.maxConcurrent, 1, 64);
  int('config.gateway.perUserConcurrent', config?.gateway?.perUserConcurrent, 1, 64);
  int('config.gateway.maxQueue', config?.gateway?.maxQueue, 0, 4096);
  int('config.gateway.queueTimeoutMs', config?.gateway?.queueTimeoutMs, 1, 3600000);
  int('config.gateway.cacheTtlMs', config?.gateway?.cacheTtlMs, 0, 86400000);
  int('config.gateway.cacheMaxEntries', config?.gateway?.cacheMaxEntries, 0, 100000);
  int('config.gateway.maxHistoryMessages', config?.gateway?.maxHistoryMessages, 1, 256);
  int('config.gateway.maxPromptChars', config?.gateway?.maxPromptChars, 256, 1000000);
  int('config.gateway.maxPredictTokens', config?.gateway?.maxPredictTokens, 64, 131072);
  int('config.ollama.contextLength', config?.ollama?.contextLength, 512, 1048576);
  int('config.ollama.numThreads', config?.ollama?.numThreads, 1, 256);
  int('config.ollama.numParallel', config?.ollama?.numParallel, 1, 64);
  int('config.ollama.maxLoadedModels', config?.ollama?.maxLoadedModels, 1, 16);
  if (config?.gateway?.perUserConcurrent > config?.gateway?.maxConcurrent) {
    errors.push('config.gateway.perUserConcurrent must be <= maxConcurrent');
  }
  if (config?.security?.token !== null && config?.security?.token !== undefined) {
    base('config.security.token', config.security.token);
  }
  if (errors.length) {
    const err = new Error(`Invalid Edge AI config:\n- ${errors.join('\n- ')}`);
    err.code = 'EDGE_AI_CONFIG_INVALID';
    err.errors = errors;
    throw err;
  }
  return true;
}

export function configPathFor(projectRoot) {
  return path.join(projectRoot, 'sovereign-os', 'edge-ai', 'edge-ai.config.json');
}

export function readConfig(file = CONFIG_FILE) {
  const config = readJson(file);
  validateConfig(config);
  return config;
}

export function writeConfig(config, file = CONFIG_FILE) {
  validateConfig(config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

export function redactConfig(config) {
  const out = structuredClone(config);
  if (out.security?.token) out.security.token = '***redacted***';
  if (out.ollama?.env) out.ollama.env = { ...out.ollama.env };
  return out;
}

export function modelListForPull(config, selection = 'fast,main,embed') {
  const choices = String(selection || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (choices.includes('none')) return [];
  const tiers = choices.includes('all')
    ? ['fast', 'main', 'deep', 'vision', 'embed']
    : choices;
  const models = [];
  for (const tier of tiers) {
    const model = config.models?.[tier];
    if (!model) continue;
    if (!models.includes(model)) models.push(model);
  }
  return models;
}
