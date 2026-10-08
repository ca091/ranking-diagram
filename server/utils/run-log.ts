/**
 * 生成任务结构化日志（观测旁路，零业务侵入、可独立剥离）。
 *
 * 设计约束：
 * - 只订阅既有 SSE 事件流（emitter.on 是天然观测接缝），gate/agent/search 代码零改动；
 * - stage 记录的 durationMs = 该事件出现到下一事件出现的间隔；
 *   即「最后一条检索 stage 的耗时包含最终整份 JSON 的生成时间」（两者之间没有别的事件）；
 * - 开关 NUXT_LOG_GENERATION=0 关闭；
 * - 剥离方法：删除本文件 + generate.post.ts 中标了 [generation-log] 的 import/构造/订阅/finish
 *   四处、nuxt.config.ts 的 logGeneration 一行。resolveModelIds（llm/index.ts）可保留。
 */
import type { GenerationPhase, SseEvent } from '#shared/events'
import type { ServerConfig } from './config'
import { resolveModelIds } from './llm'

export type RunOutcome = 'ok' | 'reject' | 'error' | 'timeout' | 'incomplete'

export interface StageRecord {
  phase: GenerationPhase
  label: string
  durationMs: number
}

export interface RunLogger {
  /** 直接挂到 emitter.on() 上 */
  onEvent: (event: SseEvent) => void
  /** 幂等：无论走到哪条终结路径，只打一行 */
  finish: () => void
}

/** 终结状态袋：按 outcome 判别，字段进日志时逐 key 展开（保持历史 JSON 键名不变）。 */
type Terminal =
  | { kind: 'none' }
  | { kind: 'ok'; count: number; normalizedPrompt: string; cached: boolean; fixture: boolean }
  | { kind: 'reject'; reason: string }
  | { kind: 'failure'; errorPhase: string; errorMessage: string; retryable: boolean }

function terminalFields(terminal: Terminal): Record<string, unknown> {
  switch (terminal.kind) {
    case 'ok':
      return { count: terminal.count, normalizedPrompt: terminal.normalizedPrompt, cached: terminal.cached, fixture: terminal.fixture }
    case 'reject':
      return { reason: terminal.reason }
    case 'failure':
      return { errorPhase: terminal.errorPhase, errorMessage: terminal.errorMessage, retryable: terminal.retryable }
    default:
      return {}
  }
}

export interface RunLogOptions {
  enabled?: boolean
  config: ServerConfig
  prompt: string
  /** 看门狗预算（ms），写进日志便于对照 */
  timeoutMs: number
  /** 可注入时钟（单测用），须单调递增 */
  now?: () => number
  /** epoch ms 时钟（单测用） */
  epoch?: () => number
  /** 日志出口（默认 console.info，单测注入捕获） */
  sink?: (line: string) => void
}

/**
 * 每次生成创建一个实例：事件进 → 环节耗时/终态出 → finish 打单行 JSON。
 * 纯读旁路，不改变事件，不抛错（观测代码绝不允许弄挂业务）。
 */
export function createRunLogger(options: RunLogOptions): RunLogger {
  if (options.enabled === false) {
    return { onEvent: () => {}, finish: () => {} }
  }
  const now = options.now ?? ((): number => performance.now())
  const epoch = options.epoch ?? ((): number => Date.now())
  const sink = options.sink ?? ((line: string): void => console.info(line))
  const { config, prompt, timeoutMs } = options

  const startedAt = epoch()
  const stages: StageRecord[] = []
  let open: { phase: GenerationPhase; label: string; since: number } | null = null
  let searches = 0
  let outcome: RunOutcome = 'incomplete'
  let terminal: Terminal = { kind: 'none' }
  let finished = false

  function closeStage(): void {
    if (!open) return
    stages.push({ phase: open.phase, label: open.label, durationMs: Math.round(now() - open.since) })
    open = null
  }

  function onEvent(event: SseEvent): void {
    try {
      switch (event.type) {
        case 'stage':
          closeStage()
          open = { phase: event.data.phase, label: event.data.label, since: now() }
          if (typeof event.data.searchUsed === 'number') {
            searches = Math.max(searches, event.data.searchUsed)
          }
          break
        case 'result':
          closeStage()
          outcome = 'ok'
          terminal = {
            kind: 'ok',
            count: event.data.count,
            normalizedPrompt: event.data.normalizedPrompt,
            cached: event.data.cached,
            fixture: event.data.fixture,
          }
          break
        case 'reject':
          closeStage()
          outcome = 'reject'
          terminal = { kind: 'reject', reason: event.data.reason }
          break
        case 'error':
          closeStage()
          outcome = event.data.phase === 'timeout' ? 'timeout' : 'error'
          terminal = { kind: 'failure', errorPhase: event.data.phase, errorMessage: event.data.message, retryable: event.data.retryable }
          break
        case 'done':
          closeStage()
          break
      }
    } catch {
      // 观测旁路吞下一切异常，业务事件流不受影响
    }
  }

  function finish(): void {
    if (finished) return
    finished = true
    closeStage()
    let models: { provider: string; ranking: string; gate: string }
    try {
      models = resolveModelIds(config)
    } catch {
      models = { provider: config.llmProvider || '(invalid)', ranking: config.modelRanking, gate: config.modelGate }
    }
    const record = {
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Math.max(0, Math.round(epoch() - startedAt)),
      outcome,
      prompt,
      ...terminalFields(terminal),
      provider: models.provider,
      modelRanking: models.ranking,
      modelGate: models.gate,
      fixture: config.useFixture,
      searches,
      timeoutMs,
      stages,
    }
    try {
      sink(`[generation] ${JSON.stringify(record)}`)
    } catch {
      // 日志出口失败同样不影响业务
    }
  }

  return { onEvent, finish }
}
