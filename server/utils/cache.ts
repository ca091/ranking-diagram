/**
 * TTL + LRU 上限的内存缓存（结果缓存与图片缓存共用）。
 * 纯逻辑、时钟可注入，便于单测；不做持久化（设计共识 Q10b）。
 */

interface CacheEntry<V> {
  value: V
  expiresAt: number
}

export interface TtlCacheOptions {
  ttlMs: number
  maxEntries: number
  /** 注入时钟，默认 Date.now */
  now?: () => number
}

export interface TtlCache<V> {
  get: (key: string) => V | undefined
  set: (key: string, value: V) => void
  has: (key: string) => boolean
  delete: (key: string) => void
  clear: () => void
  size: () => number
}

export function createTtlCache<V>({ ttlMs, maxEntries, now = Date.now }: TtlCacheOptions): TtlCache<V> {
  const map = new Map<string, CacheEntry<V>>()

  const get = (key: string): V | undefined => {
    const entry = map.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= now()) {
      map.delete(key)
      return undefined
    }
    // LRU：命中即刷新为最近使用
    map.delete(key)
    map.set(key, entry)
    return entry.value
  }

  const set = (key: string, value: V): void => {
    map.delete(key)
    map.set(key, { value, expiresAt: now() + ttlMs })
    while (map.size > maxEntries) {
      const oldest = map.keys().next()
      if (oldest.done) break
      map.delete(oldest.value)
    }
  }

  return {
    get,
    set,
    has: (key) => get(key) !== undefined,
    delete: (key) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
    size: () => map.size,
  }
}

/** 结果缓存键：规范化前的原始 prompt 也算命中（同 prompt 回放动效）。 */
export function resultCacheKey(prompt: string): string {
  return prompt.trim().toLowerCase()
}
