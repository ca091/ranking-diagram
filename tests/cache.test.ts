import { describe, expect, it } from 'vitest'
import { createTtlCache, resultCacheKey } from '../server/utils/cache'

function makeCache(ttl = 1000, max = 3) {
  let clock = 0
  const cache = createTtlCache<string>({ ttlMs: ttl, maxEntries: max, now: () => clock })
  return { cache, advance: (ms: number) => { clock += ms } }
}

describe('createTtlCache', () => {
  it('TTL 过期即失效', () => {
    const { cache, advance } = makeCache(1000)
    cache.set('k', 'v')
    expect(cache.get('k')).toBe('v')
    advance(999)
    expect(cache.get('k')).toBe('v')
    advance(2)
    expect(cache.get('k')).toBeUndefined()
  })

  it('超过 maxEntries 时淘汰最久未用（LRU，命中刷新）', () => {
    const { cache, advance } = makeCache(10_000, 3)
    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('c', '3')
    advance(1)
    cache.get('a') // a 变为最近使用 → 应淘汰 b
    cache.set('d', '4')
    expect(cache.get('a')).toBe('1')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe('3')
    expect(cache.get('d')).toBe('4')
    expect(cache.size()).toBeLessThanOrEqual(3)
  })

  it('同键 set 覆盖而非新增', () => {
    const { cache } = makeCache()
    cache.set('k', 'v1')
    cache.set('k', 'v2')
    expect(cache.get('k')).toBe('v2')
    expect(cache.size()).toBe(1)
  })

  it('delete/clear 行为正确', () => {
    const { cache } = makeCache()
    cache.set('x', '1')
    cache.delete('x')
    expect(cache.has('x')).toBe(false)
    cache.set('y', '2')
    cache.clear()
    expect(cache.size()).toBe(0)
  })
})

describe('resultCacheKey', () => {
  it('trim + 大小写折叠', () => {
    expect(resultCacheKey('  One Piece 战力榜 ')).toBe(resultCacheKey('one piece 战力榜'))
  })
})
