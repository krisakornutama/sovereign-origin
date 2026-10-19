export class QueueError extends Error {
  constructor(code, message, statusCode = 429, retryAfter = 1) {
    super(message);
    this.name = 'QueueError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
  }
}

export class RequestQueue {
  #maxConcurrent;
  #perUserConcurrent;
  #maxQueue;
  #timeoutMs;
  #active = 0;
  #activeByUser = new Map();
  #queue = [];
  #idleWaiters = [];

  constructor({
    maxConcurrent = 1,
    perUserConcurrent = 1,
    maxQueue = 0,
    timeoutMs = 0
  } = {}) {
    this.#maxConcurrent = Math.max(1, Math.floor(Number(maxConcurrent) || 1));
    this.#perUserConcurrent = Math.max(1, Math.floor(Number(perUserConcurrent) || 1));
    this.#maxQueue = Math.max(0, Math.floor(Number(maxQueue) || 0));
    this.#timeoutMs = Math.max(0, Math.floor(Number(timeoutMs) || 0));
  }

  #keyOf(user) {
    return user ? String(user) : null;
  }

  #userActive(key) {
    return key === null ? 0 : this.#activeByUser.get(key) || 0;
  }

  #canStart(key) {
    return this.#active < this.#maxConcurrent && (key === null || this.#userActive(key) < this.#perUserConcurrent);
  }

  run(user, fn, { signal } = {}) {
    const key = this.#keyOf(user);
    if (signal?.aborted) {
      return Promise.reject(new QueueError('ABORTED', 'Request aborted before it was queued', 499));
    }
    if (this.#canStart(key)) return this.#start(key, fn, signal);
    if (this.#queue.length >= this.#maxQueue) {
      return Promise.reject(
        new QueueError('QUEUE_FULL', `Queue is full (${this.#queue.length}/${this.#maxQueue}). Try again shortly.`, 429, 2)
      );
    }
    return new Promise((resolve, reject) => {
      const job = {
        key,
        fn,
        signal,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        timer: null,
        abortHandler: null
      };
      if (this.#timeoutMs > 0) {
        job.timer = setTimeout(() => {
          this.#remove(job);
          reject(new QueueError('QUEUE_TIMEOUT', 'Request waited too long in the queue', 429, 2));
        }, this.#timeoutMs);
      }
      if (signal) {
        job.abortHandler = () => {
          this.#remove(job);
          reject(new QueueError('ABORTED', 'Request aborted while queued', 499));
        };
        signal.addEventListener('abort', job.abortHandler, { once: true });
      }
      this.#queue.push(job);
    });
  }

  #remove(job) {
    const index = this.#queue.indexOf(job);
    if (index >= 0) this.#queue.splice(index, 1);
    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    if (job.signal && job.abortHandler) {
      job.signal.removeEventListener('abort', job.abortHandler);
      job.abortHandler = null;
    }
  }

  #start(key, fn, signal) {
    this.#active += 1;
    if (key !== null) this.#activeByUser.set(key, this.#userActive(key) + 1);
    const promise = Promise.resolve().then(() => fn({ signal }));
    return promise.finally(() => {
      this.#active -= 1;
      if (key !== null) {
        const next = this.#userActive(key) - 1;
        if (next > 0) this.#activeByUser.set(key, next);
        else this.#activeByUser.delete(key);
      }
      this.#drain();
      this.#resolveIdleIfNeeded();
    });
  }

  #drain() {
    while (this.#active < this.#maxConcurrent && this.#queue.length) {
      const index = this.#queue.findIndex((job) => job.key === null || this.#userActive(job.key) < this.#perUserConcurrent);
      if (index < 0) return;
      const [job] = this.#queue.splice(index, 1);
      if (job.timer) {
        clearTimeout(job.timer);
        job.timer = null;
      }
      if (job.signal && job.abortHandler) {
        job.signal.removeEventListener('abort', job.abortHandler);
        job.abortHandler = null;
      }
      this.#start(job.key, job.fn, job.signal).then(job.resolve, job.reject);
    }
  }

  stats() {
    return {
      active: this.#active,
      queued: this.#queue.length,
      maxConcurrent: this.#maxConcurrent,
      perUserConcurrent: this.#perUserConcurrent,
      maxQueue: this.#maxQueue,
      activeByUser: Object.fromEntries(this.#activeByUser.entries())
    };
  }

  whenIdle() {
    if (this.#active === 0 && this.#queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  #resolveIdleIfNeeded() {
    if (this.#active !== 0 || this.#queue.length !== 0) return;
    const waiters = this.#idleWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}
