/**
 * 排行 agent：generateText + Tavily tool 循环 + 结构化输出（设计共识 Q3/Q4/Q16/Q20）。
 * 校验失败自动修复恰好 1 次；搜索预算/步数/超时硬顶。
 */
import { generateText, Output, isStepCount, NoObjectGeneratedError } from 'ai'
import type { LanguageModel } from 'ai'
import { z } from 'zod'
import { rankingEntrySchema, validateRankingStructure } from '#shared/ranking'
import type { RankingIssue, RankingResult } from '#shared/ranking'
import { MAX_SEARCHES, MAX_STEPS } from './limits'
import { buildSearchTool, createSearchRunner } from './search'
import type { ServerConfig } from './config'
import { makeAnthropic } from './provider'
import { errorMessage } from './errors'
import type { SseEvent } from '#shared/events'

export class AgentError extends Error {
  constructor(
    readonly phase: 'ranking' | 'finalizing',
    message: string,
    readonly retryable = true,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'AgentError'
  }
}

function buildTaskSchema(count: number) {
  return z.object({
    title: z.string().min(1).max(160),
    entries: z.array(rankingEntrySchema).length(count),
  })
}

function buildSystemPrompt(count: number): string {
  return `你是严谨的数据记者，负责把一个排行任务落成有据可依的名次表。
工作流程：
1. 先用 web_search 做 2-4 次批量检索拿到候选榜单/统计数据（一次查整体，不要逐条查）；
2. 只对存疑的头部名次补充查证；搜索有硬预算（最多 ${MAX_SEARCHES} 次），耗尽后必须基于已有资料收敛。
输出要求（严格）：
- entries 恰好 ${count} 条；rank 1 = 最强/最高位；名次连续 1..${count}；
- score 为 0-100 的相对强度分，随名次单调非递增，首尾拉开差距，避免大面积并列；
- 每条 sources 至少 1 项，url 必须逐字来自你实际检索到的结果，绝对禁止编造；
- oneLiner：一句话说明该名次依据；
- 条目名使用该语言下最通行写法；输出语言跟随排行任务的语言；
- avatarUrl：仅当检索结果（含 pageImages）中出现明显属于该条目的头像/代表图 URL 时才填写，宁缺毋滥；
- 来源冲突时按多数共识定名次，并在 oneLiner 中点明分歧。`
}

function zodIssues(error: z.ZodError): RankingIssue[] {
  return error.issues.slice(0, 10).map((issue) => ({
    path: issue.path.map(String).join('.') || 'root',
    message: issue.message,
  }))
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

type Evaluation = { result?: RankingResult; issues: RankingIssue[] }

function evaluate(schema: ReturnType<typeof buildTaskSchema>, candidate: unknown): Evaluation {
  const parsed = schema.safeParse(candidate)
  if (!parsed.success) {
    return { issues: zodIssues(parsed.error) }
  }
  const structure = validateRankingStructure(parsed.data)
  if (structure.length > 0) {
    return { issues: structure.slice(0, 10) }
  }
  return { result: parsed.data, issues: [] }
}

async function repairOnce(deps: {
  model: LanguageModel
  schema: ReturnType<typeof buildTaskSchema>
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

请只修正上述校验问题：保留既有的事实、分数关系、来源 URL 与语言，不得新增编造内容，不要再调用搜索。输出修正后的完整对象。`
  const { output } = await generateText({
    model: deps.model,
    prompt: repairPrompt,
    output: Output.object({ schema: deps.schema }),
    ...(deps.signal ? { signal: deps.signal } : {}),
  })
  return output
}

export interface AgentDeps {
  config: ServerConfig
  prompt: string
  count: number
  emit: (event: SseEvent) => void
  signal?: AbortSignal
}

export async function runRankingAgent(deps: AgentDeps): Promise<RankingResult> {
  const { config, prompt, count, emit, signal } = deps
  const anthropic = makeAnthropic(config)
  const model = anthropic(config.modelRanking)
  const schema = buildTaskSchema(count)

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

  let candidate: unknown
  try {
    const result = await generateText({
      model,
      system: buildSystemPrompt(count),
      prompt: `排行任务：${prompt}`,
      tools: { web_search: buildSearchTool(runner) },
      output: Output.object({ schema }),
      stopWhen: isStepCount(MAX_STEPS),
      ...(signal ? { signal } : {}),
    })
    candidate = result.output
    emit({ type: 'stage', data: { phase: 'finalizing', label: '校验并定稿…' } })
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      emit({ type: 'stage', data: { phase: 'finalizing', label: '模型输出不合结构，进入修复…' } })
      candidate = typeof error.text === 'string' ? safeJsonParse(error.text) : undefined
    } else if (signal?.aborted) {
      throw new AgentError('ranking', '生成已中止（超时或取消）', true, { cause: error })
    } else {
      throw new AgentError('ranking', `排行生成失败：${errorMessage(error)}`, true, { cause: error })
    }
  }

  let evaluation = evaluate(schema, candidate)
  if (!evaluation.result) {
    emit({ type: 'stage', data: { phase: 'finalizing', label: '自动修复排行数据（1 次）…' } })
    let repaired: unknown
    try {
      repaired = await repairOnce({ model, schema, bad: candidate, issues: evaluation.issues, ...(signal ? { signal } : {}) })
    } catch (error) {
      if (signal?.aborted) {
        throw new AgentError('finalizing', '修复阶段超时/中止', true, { cause: error })
      }
      throw new AgentError('finalizing', `修复调用失败：${errorMessage(error)}`, true, { cause: error })
    }
    evaluation = evaluate(schema, repaired)
    if (!evaluation.result) {
      throw new AgentError(
        'finalizing',
        `自动修复后仍不合格：${evaluation.issues.slice(0, 3).map((i) => i.message).join('；')}`,
        false,
      )
    }
  }

  return evaluation.result
}
