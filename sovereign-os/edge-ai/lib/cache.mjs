export class ResponseCache {
  #ttlMs;
  #maxEntries;
  #map = new Map();
  #hits = 0;
  #misses = 0;
  #evictions = 0;
  #now;

  constructor({ ttlMs = 0, maxEntries = 0, now = () => Date.now() } = {}) {
    this.#ttlMs = Math.max(0, Number(ttlMs) || 0);
    this.#maxEntries = Math.max(0, Number(maxEntries) || 0);
    this.#now = now;
  }

  get(key) {
    const entry = this.#map.get(key);
    if (!entry) {
      this.#misses += 1;
      return null;
    }
    if (entry.expiresAt <= this.#now()) {
      this.#map.delete(key);
      this.#misses += 1;
      return null;
    }
    this.#map.delete(key);
    this.#map.set(key, entry);
    this.#hits += 1;
    return entry.value;
  }

  set(key, value, ttlMs = this.#ttlMs) {
    if (this.#maxEntries <= 0 || ttlMs <= 0) return false;
    if (this.#map.has(key)) this.#map.delete(key);
    this.#map.set(key, { value, expiresAt: this.#now() + ttlMs, storedAt: this.#now() });
    while (this.#map.size > this.#maxEntries) {
      const oldest = this.#map.keys().next().value;
      this.#map.delete(oldest);
      this.#evictions += 1;
    }
    return true;
  }

  clear() {
    this.#map.clear();
  }

  stats() {
    return {
      entries: this.#map.size,
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
      ttlMs: this.#ttlMs,
      maxEntries: this.#maxEntries
    };
  }
}
