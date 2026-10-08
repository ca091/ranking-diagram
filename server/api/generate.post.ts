/**
 * POST /api/generate —— SSE 编排器（设计共识 Q6/Q11/Q16）。
 * 事件协议见 #shared/events：stage | result | reject | error | done。
 */
import { defineEventHandler, readBody, setHeader, createError } from 'h3'
import type { SseEvent, ResultPayload } from '#shared/events'
import type { RankingResult } from '#shared/ranking'
import { createEmitter } from '../utils/emitter'
import { checkGenerationConfig, type ServerConfig } from '../utils/config'
import { runGate, GateError } from '../utils/gate'
import type { GateDecision } from '../utils/gate'
import { runRankingAgent, AgentError } from '../utils/agent'
import { FIXTURE_RANKING } from '../utils/fixture'
import { createTtlCache, resultCacheKey } from '../utils/cache'
import { describeLlmError, errorMessage } from '../utils/errors'
import { DEFAULT_TOTAL_TIMEOUT_MS, RESULT_CACHE_MAX, RESULT_CACHE_TTL_MS } from '../utils/limits'
import { createRunLogger } from '../utils/run-log' // [generation-log] 剥离时删除本行

type CachedPayload = Omit<ResultPayload, 'cached' | 'fixture'>

const resultCache = createTtlCache<CachedPayload>({ ttlMs: RESULT_CACHE_TTL_MS, maxEntries: RESULT_CACHE_MAX })

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Nuxt 会用 destr 解析 env：'1' → 数字 1、'true' → true，这里统一归一化。 */
function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

interface PipelineContext {
  config: ServerConfig
  prompt: string
  force: boolean
  emit: (event: SseEvent) => void
  signal: AbortSignal
  /** 看门狗是否已触发（触发后管线内部不再重复报错） */
  abortedByWatchdog: () => boolean
}

/** fixture 分支：不碰任何外部依赖，把内置数据按真实节奏走一遍事件协议。 */
async function emitFixture(ctx: PipelineContext): Promise<void> {
  const { prompt, emit } = ctx
  emit({ type: 'stage', data: { phase: 'validating', label: '校验可排行性…（fixture 模式跳过）' } })
  await sleep(250)
  emit({ type: 'stage', data: { phase: 'ranking', label: '检索资料（fixture 直供数据 1/3）' } })
  await sleep(400)
  emit({ type: 'stage', data: { phase: 'ranking', label: '聚合多源共识、定名次（fixture）' } })
  await sleep(400)
  emit({
    type: 'result',
    data: {
      result: FIXTURE_RANKING,
      count: FIXTURE_RANKING.entries.length,
      clamped: false,
      requestedCount: null,
      normalizedPrompt: prompt,
      cached: false,
      fixture: true,
    },
  })
}

/** gate 阶段：成功返回判定；失败已 emit error 并返回 'halted'。 */
async function gateStage(ctx: PipelineContext): Promise<GateDecision | 'halted'> {
  const { config, prompt, emit, signal } = ctx
  emit({ type: 'stage', data: { phase: 'validating', label: '判断可排行性…' } })
  let decision
  try {
    decision = await runGate(config, prompt, { ...(signal.aborted ? {} : { signal }) })
  } catch (error) {
    if (ctx.abortedByWatchdog()) return 'halted'
    if (error instanceof GateError) {
      emit({ type: 'error', data: { phase: 'validating', message: `校验失败：${error.message}`, retryable: true } })
    } else {
      // 上游 4xx 常带厂商错误体（模型名/协议/配额问题），解出来直接可见
      emit({ type: 'error', data: { phase: 'validating', message: `校验失败：${describeLlmError(error)}`, retryable: true } })
    }
    return 'halted'
  }
  if (!decision.valid) {
    emit({ type: 'reject', data: { reason: decision.reason ?? '该主题无法真实排行', ...(decision.suggestion ? { suggestion: decision.suggestion } : {}) } })
    return 'halted'
  }
  if (decision.clamped && decision.requestedCount) {
    emit({
      type: 'stage',
      data: { phase: 'validating', label: `数量按护栏截取：${decision.requestedCount} → ${decision.count}` },
    })
  }
  return decision
}

async function executePipeline(ctx: PipelineContext): Promise<void> {
  const { config, prompt, force, emit, signal } = ctx

  if (config.useFixture) {
    await emitFixture(ctx)
    return
  }

  const check = checkGenerationConfig(config)
  if (!check.ok) {
    emit({
      type: 'error',
      data: {
        phase: 'config',
        message: `缺少服务端配置：${check.missing.join('、')}。请参照 .env.example 配置后重启 dev server`,
        retryable: false,
      },
    })
    return
  }

  const cacheKey = resultCacheKey(prompt)
  const cached = force ? undefined : resultCache.get(cacheKey)
  if (cached) {
    emit({ type: 'stage', data: { phase: 'validating', label: '命中生成缓存，直接回放' } })
    emit({ type: 'result', data: { ...cached, cached: true, fixture: false } })
    return
  }

  const decision = await gateStage(ctx)
  if (decision === 'halted') return

  emit({ type: 'stage', data: { phase: 'ranking', label: '开始检索与排行…' } })
  let result: RankingResult
  try {
    result = await runRankingAgent({ config, prompt: decision.normalizedPrompt, count: decision.count, emit, ...(signal.aborted ? {} : { signal }) })
  } catch (error) {
    if (ctx.abortedByWatchdog()) return
    if (error instanceof AgentError) {
      emit({ type: 'error', data: { phase: error.phase, message: error.message, retryable: error.retryable } })
    } else {
      emit({ type: 'error', data: { phase: 'ranking', message: `排行生成失败：${errorMessage(error)}`, retryable: true } })
    }
    return
  }

  const payload: CachedPayload = {
    result,
    count: result.entries.length,
    clamped: decision.clamped,
    requestedCount: decision.requestedCount,
    normalizedPrompt: decision.normalizedPrompt,
  }
  resultCache.set(cacheKey, payload)
  emit({ type: 'result', data: { ...payload, cached: false, fixture: false } })
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ prompt?: unknown; force?: unknown }>(event).catch(() => null)
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  const force = body?.force === true
  if (!prompt) {
    throw createError({ statusCode: 400, statusMessage: 'prompt 不能为空' })
  }
  if (prompt.length > 500) {
    throw createError({ statusCode: 400, statusMessage: 'prompt 过长（上限 500 字符）' })
  }

  const runtime = useRuntimeConfig(event)
  const config: ServerConfig = {
    llmProvider: runtime.llm.provider,
    llmBaseUrl: runtime.llm.baseUrl,
    llmApiKey: runtime.llm.apiKey,
    modelRanking: runtime.modelRanking,
    modelGate: runtime.modelGate,
    tavilyApiKey: runtime.tavilyApiKey,
    useFixture: isTruthyFlag(runtime.useFixture),
    llmTimeoutMs: typeof runtime.llmTimeoutMs === 'number' ? runtime.llmTimeoutMs : 0,
    llmThinking: isTruthyFlag(runtime.llmThinking),
  }

  // [generation-log] begin：任务级结构化日志，旁路订阅事件流，业务零侵入
  //（实现与剥离步骤见 server/utils/run-log.ts 头注释）
  const timeoutMs = config.llmTimeoutMs > 0 ? config.llmTimeoutMs : DEFAULT_TOTAL_TIMEOUT_MS
  const runLogger = createRunLogger({
    enabled: isTruthyFlag(runtime.logGeneration),
    config,
    prompt,
    timeoutMs,
  })
  // [generation-log] end

  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-cache, no-transform')
  setHeader(event, 'X-Accel-Buffering', 'no')
  setHeader(event, 'Connection', 'keep-alive')

  const emitter = createEmitter()
  const controller = new AbortController()
  let watchdogFired = false

  return new ReadableStream<Uint8Array>({
    start(streamController) {
      const encoder = new TextEncoder()
      const send = (sseEvent: SseEvent) => {
        try {
          streamController.enqueue(encoder.encode(`data: ${JSON.stringify(sseEvent)}\n\n`))
        } catch {
          // 流已关闭（客户端断开），静默丢弃
        }
      }
      const unsubscribe = emitter.on(send)
      const unsubscribeLog = emitter.on(runLogger.onEvent) // [generation-log]

      const finish = () => {
        clearTimeout(watchdog)
        unsubscribe()
        unsubscribeLog() // [generation-log]
        send({ type: 'done' })
        runLogger.finish() // [generation-log]
        try {
          streamController.close()
        } catch {
          /* already closed */
        }
      }

      const watchdog = setTimeout(() => {
        watchdogFired = true
        controller.abort()
        emitter.emit({
          type: 'error',
          data: {
            phase: 'timeout',
            message: `生成超过 ${Math.round(timeoutMs / 1000)}s 超时，可点击重试、收窄排行主题，或调大 NUXT_LLM_TIMEOUT_MS（推理型模型偏慢）`,
            retryable: true,
          },
        })
        finish()
      }, timeoutMs)

      void executePipeline({
        config,
        prompt,
        force,
        emit: (sseEvent) => emitter.emit(sseEvent),
        signal: controller.signal,
        abortedByWatchdog: () => watchdogFired || controller.signal.aborted,
      })
        .catch((error) => {
          // 全量错误留在服务端日志；下发通用消息，不外泄内部细节（security 规范）
          console.error('[generate] pipeline error:', error)
          if (!watchdogFired) {
            emitter.emit({
              type: 'error',
              data: { phase: 'ranking', message: '服务内部错误，请稍后重试', retryable: true },
            })
          }
        })
        .finally(finish)
    },
    cancel() {
      controller.abort()
    },
  })
})
