import { describe, expect, it } from 'vitest'
import type { SseEvent } from '#shared/events'
import type { ServerConfig } from '../server/utils/config'
import { createRunLogger } from '../server/utils/run-log'

const config: ServerConfig = {
  llmProvider: 'qwen',
  llmBaseUrl: '',
  llmApiKey: 'k',
  modelRanking: '',
  modelGate: '',
  tavilyApiKey: '',
  useFixture: false,
  llmTimeoutMs: 300_000,
  llmThinking: false,
}

const okResult: SseEvent = {
  type: 'result',
  data: {
    result: {
      title: 'T',
      entries: [{ rank: 1, name: 'a', score: 90, oneLiner: 'x', sources: [{ title: 't', url: 'https://e.com' }] }],
    },
    count: 1,
    clamped: false,
    requestedCount: null,
    normalizedPrompt: '规范后任务',
    cached: false,
    fixture: false,
  },
}

function harness() {
  let t = 0
  const lines: string[] = []
  const logger = createRunLogger({
    config,
    prompt: '测试 prompt',
    timeoutMs: 300_000,
    now: () => t,
    epoch: () => 1_700_000_000_000 + t,
    sink: (line) => lines.push(line),
  })
  const advance = (ms: number) => {
    t += ms
  }
  const record = () => {
    expect(lines).toHaveLength(1)
    expect(lines[0]!.startsWith('[generation] ')).toBe(true)
    return JSON.parse(lines[0]!.slice('[generation] '.length)) as Record<string, unknown>
  }
  return { logger, advance, lines, record }
}

describe('createRunLogger 事件旁路', () => {
  it('happy path：逐环节耗时、检索计数、终态、解析后的模型名', () => {
    const { logger, advance, record } = harness()
    logger.onEvent({ type: 'stage', data: { phase: 'validating', label: '判断可排行性…' } })
    advance(1500)
    logger.onEvent({ type: 'stage', data: { phase: 'ranking', label: '开始检索与排行…' } })
    advance(500)
    logger.onEvent({ type: 'stage', data: { phase: 'ranking', label: '检索资料（1/6）：x', searchUsed: 1 } })
    advance(2000)
    logger.onEvent(okResult)
    logger.finish()

    const r = record()
    expect(r.outcome).toBe('ok')
    expect(r.prompt).toBe('测试 prompt')
    expect(r.provider).toBe('qwen')
    expect(r.modelRanking).toBe('qwen3.8-flash')
    expect(r.searches).toBe(1)
    expect(r.count).toBe(1)
    const stages = r.stages as Array<{ label: string; durationMs: number }>
    expect(stages.map((s) => s.durationMs)).toEqual([1500, 500, 2000])
  })

  it('finish 幂等：只输出一行', () => {
    const { logger, lines } = harness()
    logger.onEvent(okResult)
    logger.finish()
    logger.finish()
    expect(lines).toHaveLength(1)
  })

  it('超时终结：outcome=timeout，进行中的环节也被结算', () => {
    const { logger, advance, record } = harness()
    logger.onEvent({ type: 'stage', data: { phase: 'ranking', label: '规划检索与初排…' } })
    advance(9000)
    logger.onEvent({ type: 'error', data: { phase: 'timeout', message: '生成超过 300s 超时', retryable: true } })
    logger.finish()
    const r = record()
    expect(r.outcome).toBe('timeout')
    expect(r.errorMessage).toBe('生成超过 300s 超时')
    expect((r.stages as Array<{ durationMs: number }>)[0]!.durationMs).toBe(9000)
  })

  it('reject 终结带原因', () => {
    const { logger, record } = harness()
    logger.onEvent({ type: 'reject', data: { reason: '无法真实排行' } })
    logger.finish()
    const r = record()
    expect(r.outcome).toBe('reject')
    expect(r.reason).toBe('无法真实排行')
  })

  it('客户端断开（无终结事件）→ incomplete，不丢进行中环节', () => {
    const { logger, advance, record } = harness()
    logger.onEvent({ type: 'stage', data: { phase: 'validating', label: '判断可排行性…' } })
    advance(800)
    logger.finish()
    const r = record()
    expect(r.outcome).toBe('incomplete')
    expect((r.stages as unknown[])).toHaveLength(1)
  })

  it('开关关闭时完全静默', () => {
    const lines: string[] = []
    const logger = createRunLogger({ enabled: false, config, prompt: 'p', timeoutMs: 1, sink: (l) => lines.push(l) })
    logger.onEvent(okResult)
    logger.finish()
    expect(lines).toHaveLength(0)
  })
})
