/**
 * 排行 agent：generateText + Tavily tool 循环 + 结构化输出（设计共识 Q3/Q4/Q16/Q20）。
 * 校验失败先走 coerceRanking 确定性整形；修不了的才自动修复恰好 1 次；
 * 搜索预算/步数/超时硬顶。
 */
import { generateText, Output, isStepCount, NoObjectGeneratedError, NoOutputGeneratedError } from 'ai'
import type { LanguageModel } from 'ai'
import type { z } from 'zod'
import { coerceRanking, parseModelJson, rankingResultSchema } from '#shared/ranking'
import type { RankingIssue, RankingResult } from '#shared/ranking'
import { MAX_SEARCHES, MAX_STEPS } from './limits'
import { buildSearchTool, createSearchRunner } from './search'
import type { SearchRunner } from './search'
import type { ServerConfig } from './config'
import { makeLlmModel } from './llm'
import { describeLlmError, errorMessage } from './errors'
import type { SseEvent } from '#shared/events'

export class AgentError extends Error {
  constructor(
    readonly phase: 'ranking' | 'finalizing',
    message: string,
    readonly retryable = true,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

function buildSystemPrompt(count: number): string {
  return `你是严谨的数据记者，负责把一个排行任务落成有据可依的名次表。
工作流程：
1. 先用 web_search 做 2-4 次批量检索拿到候选榜单/统计数据（一次查整体，不要逐条查）；
2. 只对存疑的头部名次补充查证；搜索有硬预算（最多 ${MAX_SEARCHES} 次），耗尽后必须基于已有资料收敛。
输出要求（严格）：
- entries 恰好 ${count} 条；rank 1 = 最强/最高位；名次连续 1..${count}；
- score 为 0-100 的相对强度分，随名次单调非递增，首尾拉开差距，避免大面积并列；
- 每条 sources 给 1-2 项即可、title 保持简短，url 必须逐字来自你实际检索到的结果，绝对禁止编造；
- oneLiner：40 字以内一句话说明该名次依据；
- 条目名使用该语言下最通行写法；输出语言跟随排行任务的语言；
- avatarUrl：仅当检索结果（含 pageImages）中出现明显属于该条目的头像/代表图 URL 时才填写，宁缺毋滥；
- 来源冲突时按多数共识定名次，并在 oneLiner 中点明分歧；
- 篇幅纪律：整个 JSON 必须完整闭合，宁可每条写得短，也绝不能中途截断；
- 最终回复必须是一个合法的 JSON 对象。`
}

/**
 * 终稿守卫（评审后修正）：预算耗尽或只剩最后一步时收走用户工具，强制本步产出终稿——
 * 循环停在 tool-call 步会导致 result.output 为空（NoOutputGeneratedError，历史故障）。
 *
 * 只用 activeTools:[]，刻意不设 toolChoice:'none'：
 * filterActiveTools 仅过滤用户 tools 表，provider 内部为无原生结构化输出而合成的
 * json 工具（如 @ai-sdk/anthropic 的 "json"）由 responseFormat 驱动、不受 activeTools
 * 影响；但 toolChoice:'none' 可能反向解除该模式下的强制工具调用，跨 provider 有风险。
 * 纯函数便于单测（tests/agent-guard.test.ts 用 MockLanguageModelV4 证明闭环）。
 */
export function finalStepGuard(stepNumber: number, searchesUsed: number): { activeTools: never[] } | Record<string, never> {
  return stepNumber >= MAX_STEPS - 1 || searchesUsed >= MAX_SEARCHES
    ? { activeTools: [] as never[] }
    : {}
}

function zodIssues(error: z.ZodError): RankingIssue[] {
  return error.issues.slice(0, 10).map((issue) => ({
    path: issue.path.map(String).join('.') || 'root',
    message: issue.message,
  }))
}

function safeJsonParse(text: string): unknown {
  const parsed = parseModelJson(text)
  // 解析失败保留原文，让 schema 校验产出真实问题（而不是把围栏 JSON 直接判死）
  return parsed === undefined ? text : parsed
}

/** NoObjectGenerated 消重（两处 catch 同形）：从异常里捞原始文本，捞不到给 undefined。 */
function noObjectFallback(error: NoObjectGeneratedError): unknown {
  return typeof error.text === 'string' ? safeJsonParse(error.text) : undefined
}

type Evaluation = { result?: RankingResult; issues: RankingIssue[] }

/**
 * 宽松解析（1..50 条）+ 确定性整形到恰好 count：
 * 名次跳号、重复条目、分数倒挂、多吐几条这类机械小错不再消耗修复调用，
 * 只有「需要新事实」的问题（条目不足、字段不合法）才进修复回路。
 */
function evaluate(candidate: unknown, count: number): Evaluation {
  const parsed = rankingResultSchema.safeParse(candidate)
  if (!parsed.success) {
    return { issues: zodIssues(parsed.error) }
  }
  const coercion = coerceRanking(parsed.data, count)
  if (!coercion.result) {
    return { issues: coercion.issues }
  }
  return { result: coercion.result, issues: [] }
}

async function repairOnce(deps: {
  model: LanguageModel
  bad: unknown
  issues: RankingIssue[]
  signal?: AbortSignal
}): Promise<unknown> {
  const issueLines = deps.issues.map((i) => `- [${i.path}] ${i.message}`).join('\n')
  const repairPrompt = `下面这份排行榜 JSON 未通过校验。
校验问题：
${issueLines}

原始数据（可能被截断）：
${JSON.stringify(deps.bad).slice(0, 12000)}

请只修正上述校验问题：保留既有的事实、分数关系、来源 URL 与语言，不得新增编造内容，不要再调用搜索。
输出修正后的完整 JSON 对象，不要任何解释文字，不要用代码块包裹，确保 JSON 完整闭合。`
  try {
    const { output } = await generateText({
      model: deps.model,
      prompt: repairPrompt,
      output: Output.object({ schema: rankingResultSchema }),
      maxRetries: 1,
      ...(deps.signal ? { signal: deps.signal } : {}),
    })
    return output
  } catch (error) {
    // 修复轮同样可能不合 schema：把原始文本交给上层 evaluate 产出真实校验问题，
    // 而不是把 SDK 内部文案（No object generated…）直接抛给 UI
    if (NoObjectGeneratedError.isInstance(error)) {
      return noObjectFallback(error)
    }
    throw error
  }
}

export interface AgentDeps {
  config: ServerConfig
  prompt: string
  count: number
  emit: (event: SseEvent) => void
  signal?: AbortSignal
}

/** 初稿阶段：工具循环。返回候选数据；NoObjectGenerated 降级为修复入口，其余失败直接抛。 */
async function runInitialGeneration(deps: {
  model: LanguageModel
  runner: SearchRunner
  prompt: string
  count: number
  emit: (event: SseEvent) => void
  signal?: AbortSignal
}): Promise<unknown> {
  const { model, runner, prompt, count, emit, signal } = deps
  try {
    const result = await generateText({
      model,
      system: buildSystemPrompt(count),
      prompt: `排行任务：${prompt}\n\n请以 JSON 对象作答。`,
      tools: { web_search: buildSearchTool(runner) },
      output: Output.object({ schema: rankingResultSchema }),
      stopWhen: isStepCount(MAX_STEPS),
      prepareStep: ({ stepNumber }) => finalStepGuard(stepNumber, runner.usedCount()),
      // 默认 2 次静默重试 + 退避，会在全局超时预算里吃掉几十秒；1 次足够扛瞬时抖动
      maxRetries: 1,
      ...(signal ? { signal } : {}),
    })
    emit({ type: 'stage', data: { phase: 'finalizing', label: '校验并定稿…' } })
    return result.output
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      emit({ type: 'stage', data: { phase: 'finalizing', label: '模型输出不合结构，进入修复…' } })
      return noObjectFallback(error)
    } else if (NoOutputGeneratedError.isInstance(error)) {
      // 循环没走到产出终稿的那一步（历史故障：步数预算内模型一直在检索）
      throw new AgentError('ranking', '排行循环未能产出终稿（检索/步数预算耗尽），请重试或收窄排行主题', true, { cause: error })
    } else if (signal?.aborted) {
      throw new AgentError('ranking', '生成已中止（超时或取消）', true, { cause: error })
    } else {
      throw new AgentError('ranking', `排行生成失败：${describeLlmError(error)}`, true, { cause: error })
    }
  }
}

/** 定稿阶段：evaluate → 必要时恰好 1 次模型修复 → 再评估。 */
async function finalizeRanking(deps: {
  model: LanguageModel
  candidate: unknown
  count: number
  emit: (event: SseEvent) => void
  signal?: AbortSignal
}): Promise<RankingResult> {
  const { model, candidate, count, emit, signal } = deps
  let evaluation = evaluate(candidate, count)
  if (evaluation.result) return evaluation.result

  emit({ type: 'stage', data: { phase: 'finalizing', label: '自动修复排行数据（1 次）…' } })
  let repaired: unknown
  try {
    repaired = await repairOnce({ model, bad: candidate, issues: evaluation.issues, ...(signal ? { signal } : {}) })
  } catch (error) {
    if (signal?.aborted) {
      throw new AgentError('finalizing', '修复阶段超时/中止', true, { cause: error })
    }
    throw new AgentError('finalizing', `修复调用失败：${errorMessage(error)}`, true, { cause: error })
  }
  evaluation = evaluate(repaired, count)
  if (!evaluation.result) {
    throw new AgentError(
      'finalizing',
      `自动修复后仍不合格：${evaluation.issues.slice(0, 3).map((i) => i.message).join('；')}`,
      false,
    )
  }
  return evaluation.result
}

export async function runRankingAgent(deps: AgentDeps): Promise<RankingResult> {
  const { config, prompt, count, emit, signal } = deps
  const model = makeLlmModel(config, 'ranking')

  const runner = createSearchRunner({
    apiKey: config.tavilyApiKey,
    onUse: (used, query) => {
      emit({
        type: 'stage',
        data: {
          phase: 'ranking',
          label: `检索资料（${used}/${MAX_SEARCHES}）：${query.slice(0, 48)}`,
          searchUsed: used,
        },
      })
    },
  })

  emit({ type: 'stage', data: { phase: 'ranking', label: '规划检索与初排…' } })
  const candidate = await runInitialGeneration({ model, runner, prompt, count, ...(signal ? { signal } : {}), emit })
  return finalizeRanking({ model, candidate, count, emit, ...(signal ? { signal } : {}) })
}
