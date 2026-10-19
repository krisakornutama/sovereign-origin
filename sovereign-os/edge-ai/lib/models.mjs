import crypto from 'node:crypto';

export const MODEL_SIZES_GB = {
  'qwen3:0.6b': 0.5,
  'gemma3:1b': 0.9,
  'qwen3:1.7b': 1.4,
  'gemma3:4b': 3.4,
  'qwen3:4b': 2.6,
  'qwen3:8b': 5.3,
  'qwen3:14b': 9.0,
  'qwen3-vl:8b': 5.5,
  'deepseek-r1:1.5b': 1.1,
  'deepseek-r1:8b': 5.2,
  'bge-m3': 1.2,
  'nomic-embed-text': 0.3
};

export class ModelSelectionError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message);
    this.name = 'ModelSelectionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function modelSizeGB(model) {
  return MODEL_SIZES_GB[model] ?? 3.5;
}

function tierOfModel(models, model) {
  for (const [tier, value] of Object.entries(models)) {
    if (value && value === model) return tier;
  }
  return 'explicit';
}

function normalizeTask(task) {
  return String(task || 'chat').trim().toLowerCase() || 'chat';
}

export function resolveModel({ requestedModel, task = 'chat', allowDeep = false, config }) {
  const models = config.models || {};
  const rollout = config.rollout || {};
  const deepAllowed = Boolean(rollout.allowDeep || allowDeep);
  const mainModel = models.main;
  if (!mainModel) throw new ModelSelectionError('NO_MAIN_MODEL', 'No main model is configured', 500);
  const originalModel = requestedModel && requestedModel !== 'auto' ? String(requestedModel).trim() : null;

  const resolveTier = (tier, reason, original = originalModel) => {
    let resolvedTier = tier;
    if (resolvedTier === 'deep') {
      if (!models.deep) {
        return {
          model: mainModel,
          tier: 'main',
          requestedTier: 'deep',
          originalModel: original,
          substituted: true,
          reason: 'deep_unavailable'
        };
      }
      if (!deepAllowed) {
        if ((rollout.deepPolicy || 'downgrade') === 'downgrade') {
          return {
            model: mainModel,
            tier: 'main',
            requestedTier: 'deep',
            originalModel: original,
            substituted: true,
            reason: 'deep_requires_opt_in'
          };
        }
        throw new ModelSelectionError(
          'DEEP_REQUIRES_OPT_IN',
          'Deep model is disabled for this profile. Send x-sovereign-allow-deep: 1 to opt in.',
          409
        );
      }
    }
    if (resolvedTier === 'vision' && !models.vision) resolvedTier = 'main';
    if (resolvedTier === 'embed' && !models.embed) resolvedTier = 'main';
    const model = models[resolvedTier] || mainModel;
    return {
      model,
      tier: models[resolvedTier] ? resolvedTier : tierOfModel(models, model),
      requestedTier: tier,
      originalModel: original,
      substituted: Boolean(original && original !== model),
      reason
    };
  };

  if (originalModel) {
    const exactTier = tierOfModel(models, originalModel);
    if (exactTier !== 'explicit') {
      if (exactTier === 'deep' && !deepAllowed) return resolveTier('deep', 'explicit_deep');
      return {
        model: originalModel,
        tier: exactTier,
        requestedTier: exactTier,
        originalModel,
        substituted: false,
        reason: 'explicit'
      };
    }
    const alias = config.routing?.aliases?.[originalModel];
    if (alias) return resolveTier(alias, 'alias');
    const policy = config.routing?.unknownModelPolicy || 'main';
    if (policy === 'reject') {
      throw new ModelSelectionError('UNKNOWN_MODEL', `Model "${originalModel}" is not enabled on this machine`, 409);
    }
    return resolveTier('main', 'unknown_model');
  }

  const taskKey = normalizeTask(task);
  const tier = config.routing?.tasks?.[taskKey] || config.routing?.tasks?.[config.routing?.defaultTask || 'chat'] || 'main';
  return resolveTier(tier, 'task');
}

function textOfMessage(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
  }
  return '';
}

export function hasImage(messages) {
  if (!Array.isArray(messages)) return false;
  return messages.some((message) => {
    if (!message || typeof message !== 'object') return false;
    if (Array.isArray(message.images) && message.images.length) return true;
    if (Array.isArray(message.content)) {
      return message.content.some((part) => {
        if (!part || typeof part !== 'object') return false;
        return part.type === 'image_url' || part.type === 'image' || part.type === 'input_image';
      });
    }
    return false;
  });
}

export function truncateText(text, maxChars) {
  const value = String(text ?? '');
  if (value.length <= maxChars) return { text: value, truncated: false };
  if (maxChars <= 64) return { text: value.slice(0, Math.max(0, maxChars)), truncated: true };
  const head = Math.floor(maxChars * 0.3);
  const tail = maxChars - head - 24;
  return {
    text: `${value.slice(0, head)}\n[...truncated...]\n${value.slice(-tail)}`,
    truncated: true
  };
}

export function truncateMessages(messages, maxMessages, maxChars) {
  if (!Array.isArray(messages)) throw new ModelSelectionError('BAD_MESSAGES', 'messages must be an array', 400);
  const systemMessages = messages.filter((m) => m?.role === 'system').slice(0, 1);
  let chatMessages = messages.filter((m) => m?.role !== 'system');
  let dropped = 0;
  if (chatMessages.length > maxMessages) {
    dropped += chatMessages.length - maxMessages;
    chatMessages = chatMessages.slice(-maxMessages);
  }
  let systemChars = systemMessages.reduce((sum, m) => sum + textOfMessage(m).length, 0);
  if (systemChars > maxChars && systemMessages.length) {
    const trimmed = truncateText(textOfMessage(systemMessages[0]), Math.max(1, Math.floor(maxChars * 0.3)));
    systemMessages[0] = { ...systemMessages[0], content: trimmed.text };
    systemChars = systemMessages.reduce((sum, m) => sum + textOfMessage(m).length, 0);
  }
  let budget = Math.max(1, maxChars - systemChars);
  let total = chatMessages.reduce((sum, m) => sum + textOfMessage(m).length, 0);
  while (total > budget && chatMessages.length > 1) {
    const removed = chatMessages.shift();
    total -= textOfMessage(removed).length;
    dropped += 1;
  }
  if (total > budget && chatMessages.length === 1) {
    const last = chatMessages[0];
    const content = textOfMessage(last);
    const trimmed = truncateText(content, budget);
    if (Array.isArray(last.content)) {
      chatMessages[0] = { ...last, content: [{ type: 'text', text: trimmed.text }] };
    } else {
      chatMessages[0] = { ...last, content: trimmed.text };
    }
    total = trimmed.text.length;
  }
  const result = [...systemMessages, ...chatMessages];
  return {
    messages: result,
    truncated: dropped > 0 || total > budget,
    droppedMessages: dropped,
    chars: result.reduce((sum, m) => sum + textOfMessage(m).length, 0)
  };
}

function pickOptions(options = {}) {
  const keys = ['temperature', 'top_p', 'top_k', 'seed', 'repeat_penalty', 'num_predict', 'num_ctx', 'stop', 'format'];
  const out = {};
  for (const key of keys) {
    if (options[key] !== undefined) out[key] = options[key];
  }
  return out;
}

export function normalizeRequest({ endpoint, body, config }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ModelSelectionError('BAD_BODY', 'Request body must be a JSON object', 400);
  }
  const out = structuredClone(body);
  const gateway = config.gateway || {};
  const maxPromptChars = Number(gateway.maxPromptChars) || 24000;
  const maxPredict = Number(gateway.maxPredictTokens) || 2048;
  const meta = { truncated: false, droppedMessages: 0, cappedPredict: false, promptChars: 0, messageCount: 0 };

  if (endpoint === '/api/generate') {
    if (typeof out.prompt !== 'string') {
      throw new ModelSelectionError('BAD_PROMPT', 'prompt must be a string', 400);
    }
    if (typeof out.system === 'string' && out.system.length > maxPromptChars) {
      const trimmed = truncateText(out.system, Math.floor(maxPromptChars * 0.3));
      out.system = trimmed.text;
      meta.truncated = true;
    }
    const systemChars = typeof out.system === 'string' ? out.system.length : 0;
    const promptBudget = Math.max(1, maxPromptChars - systemChars);
    if (out.prompt.length > promptBudget) {
      const trimmed = truncateText(out.prompt, promptBudget);
      out.prompt = trimmed.text;
      meta.truncated = true;
    }
    meta.promptChars = out.prompt.length + systemChars;
  } else if (endpoint === '/api/chat' || endpoint === '/v1/chat/completions') {
    const normalized = truncateMessages(out.messages, Number(gateway.maxHistoryMessages) || 12, maxPromptChars);
    out.messages = normalized.messages;
    meta.truncated = normalized.truncated;
    meta.droppedMessages = normalized.droppedMessages;
    meta.messageCount = normalized.messages.length;
    meta.promptChars = normalized.chars;
  } else if (endpoint === '/api/embeddings' || endpoint === '/api/embed') {
    const field = endpoint === '/api/embeddings' ? 'prompt' : 'input';
    const value = out[field];
    if (typeof value !== 'string' && !Array.isArray(value)) {
      throw new ModelSelectionError('BAD_EMBED_INPUT', `${field} must be a string or array`, 400);
    }
    const chars = typeof value === 'string' ? value.length : value.join('').length;
    if (chars > maxPromptChars) {
      throw new ModelSelectionError('EMBED_INPUT_TOO_LARGE', `Embedding input exceeds ${maxPromptChars} characters`, 413);
    }
    meta.promptChars = chars;
  } else {
    throw new ModelSelectionError('UNSUPPORTED_ENDPOINT', `Unsupported inference endpoint: ${endpoint}`, 404);
  }

  if (endpoint === '/v1/chat/completions') {
    if (out.max_tokens !== undefined && Number(out.max_tokens) > maxPredict) {
      out.max_tokens = maxPredict;
      meta.cappedPredict = true;
    }
  } else {
    if (!out.options || typeof out.options !== 'object' || Array.isArray(out.options)) out.options = {};
    if (out.options.num_ctx === undefined) out.options.num_ctx = config.ollama.contextLength;
    if (out.options.num_thread === undefined) out.options.num_thread = config.ollama.numThreads;
    if (out.options.num_predict !== undefined && Number(out.options.num_predict) > maxPredict) {
      out.options.num_predict = maxPredict;
      meta.cappedPredict = true;
    }
    if (out.keep_alive === undefined) out.keep_alive = config.ollama.keepAlive;
  }

  delete out.task;
  delete out.cache;
  delete out.user;
  delete out.allowDeep;
  delete out.__sovereign;
  return { body: out, meta };
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function cacheablePayload(endpoint, body) {
  if (endpoint === '/api/generate') {
    return {
      prompt: body.prompt,
      system: body.system,
      template: body.template,
      format: body.format,
      options: pickOptions(body.options),
      keep_alive: body.keep_alive
    };
  }
  if (endpoint === '/api/chat') {
    return {
      messages: body.messages,
      tools: body.tools,
      format: body.format,
      options: pickOptions(body.options),
      keep_alive: body.keep_alive
    };
  }
  if (endpoint === '/v1/chat/completions') {
    return {
      messages: body.messages,
      temperature: body.temperature,
      top_p: body.top_p,
      max_tokens: body.max_tokens,
      seed: body.seed,
      response_format: body.response_format,
      tools: body.tools,
      tool_choice: body.tool_choice
    };
  }
  if (endpoint === '/api/embeddings') {
    return { prompt: body.prompt, options: pickOptions(body.options) };
  }
  if (endpoint === '/api/embed') {
    return { input: body.input, truncate: body.truncate, options: pickOptions(body.options) };
  }
  return body;
}

export function cacheKey({ endpoint, model, body }) {
  const payload = cacheablePayload(endpoint, body);
  return crypto.createHash('sha256').update(stableStringify({ endpoint, model, payload })).digest('hex');
}

export function shouldCache(body, endpoint) {
  if (!body || body.stream === true) return false;
  if (body.cache === false) return false;
  if (endpoint === '/api/chat' || endpoint === '/v1/chat/completions') {
    if (hasImage(body.messages)) return false;
  }
  if (endpoint === '/api/generate' && Array.isArray(body.images) && body.images.length) return false;
  if (body.cache === true) return true;
  const temperature = body.options?.temperature ?? body.temperature;
  return temperature === 0;
}

export function estimateMemoryGB(config) {
  const models = config.models || {};
  const loaded = [models.main, models.embed];
  if ((config.ollama?.maxLoadedModels || 1) > 1) loaded.push(models.fast);
  const weights = loaded.filter(Boolean).reduce((sum, model) => sum + modelSizeGB(model), 0);
  const kv = (Number(config.ollama?.contextLength) || 4096) * (Number(config.ollama?.numParallel) || 1) * 0.00012;
  return Math.round((weights + kv + 2.0) * 10) / 10;
}
