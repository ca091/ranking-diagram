import { describe, expect, it, vi } from 'vitest'
import { createSearchRunner } from '../server/utils/search'

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

const TAVILY_BODY = {
  results: [
    { title: 'Tier List', url: 'https://example.com/tier', content: 'abc' },
    { title: '', url: '', content: 'no url -> filtered' },
  ],
  images: ['https://example.com/i1.jpg'],
}

function makeRunner(maxSearches = 3, fetchImpl?: ReturnType<typeof vi.fn>) {
  const mock =
    fetchImpl ??
    vi.fn(async () => okResponse(TAVILY_BODY))
  const usedLog: number[] = []
  const runner = createSearchRunner({
    apiKey: 'test-key',
    maxSearches,
    fetchImpl: mock as unknown as typeof fetch,
    onUse: (n) => usedLog.push(n),
  })
  return { runner, mock, usedLog }
}

describe('createSearchRunner 预算与容错', () => {
  it('正常检索：过滤无 URL 结果，计数与回调一致', async () => {
    const { runner, mock, usedLog } = makeRunner()
    const outcome = await runner.run('one piece power tier list', false)
    expect(outcome.ok).toBe(true)
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0]!.url).toBe('https://example.com/tier')
    expect(outcome.pageImages).toEqual([])
    expect(usedLog).toEqual([1])
    expect(mock).toHaveBeenCalledTimes(1)
    expect(runner.usedCount()).toBe(1)
  })

  it('wantImages=true 才透传页面图片', async () => {
    const { runner } = makeRunner()
    const outcome = await runner.run('q', true)
    expect(outcome.pageImages).toEqual(['https://example.com/i1.jpg'])
  })

  it('预算耗尽：直接拒绝，不再发起请求', async () => {
    const { runner, mock } = makeRunner(2)
    await runner.run('a', false)
    await runner.run('b', false)
    const third = await runner.run('c', false)
    expect(third.ok).toBe(false)
    expect(third.error).toContain('预算上限')
    expect(mock).toHaveBeenCalledTimes(2)
    expect(runner.usedCount()).toBe(2)
  })

  it('空查询不消耗预算', async () => {
    const { runner, mock, usedLog } = makeRunner()
    const outcome = await runner.run('   ', false)
    expect(outcome.ok).toBe(false)
    expect(mock).not.toHaveBeenCalled()
    expect(usedLog).toEqual([])
  })

  it('HTTP 错误/网络异常都收敛为 ok:false，绝不抛出打断 agent', async () => {
    const failing = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response)
    const r1 = createSearchRunner({ apiKey: 'k', fetchImpl: failing as unknown as typeof fetch })
    const out1 = await r1.run('q', false)
    expect(out1.ok).toBe(false)
    expect(out1.error).toContain('503')

    const boom = vi.fn(async () => {
      throw new Error('network down')
    })
    const r2 = createSearchRunner({ apiKey: 'k', fetchImpl: boom as unknown as typeof fetch })
    const out2 = await r2.run('q', false)
    expect(out2.ok).toBe(false)
    expect(out2.error).toContain('network down')
  })

  it('请求带 Bearer 认证与 POST', async () => {
    const { runner, mock } = makeRunner()
    await runner.run('hello', false)
    const [url, init] = mock.mock.calls[0]!
    expect(url).toBe('https://api.tavily.com/search')
    expect((init as RequestInit).method).toBe('POST')
    expect(((init as RequestInit).headers as Record<string, string>).authorization).toBe('Bearer test-key')
  })
})
