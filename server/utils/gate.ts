/**
 * 可排行性校验 gate（设计共识 Q5a/Q25）：一次轻量模型调用同时完成
 * 拦截不可排行 prompt + 产出规范化任务与条目数。
 */
import { generateText, Output, NoObjectGeneratedError } from 'ai'
import { gateResultSchema, clampCount, MAX_COUNT } from '#shared/ranking'
import type { GateResult } from '#shared/ranking'
import type { ServerConfig } from './config'
import { makeLlmModel } from './llm'

export interface GateDecision {
  valid: boolean
  reason?: string
  suggestion?: string
  normalizedPrompt: string
  count: number
  requestedCount: number | null
  clamped: boolean
}

export class GateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GateError'
  }
}

const GATE_SYSTEM = `你是「排行可行性校验器」。用户会提交一个可能是排行榜请求的描述。
判定标准（全部满足才 valid=true）：
1. 存在可枚举的 3 个以上真实条目（作品角色、实体、事件等）；
2. 存在可被公开网页数据/榜单/统计支撑的排序依据（战力/票房/GDP/销量/评分等，主观榜单以社区共识数据也算）；
3. 意图明确，不是审美独问、私人咨询、开放式闲聊。
不合格：valid=false，给一句 reason（为什么排不了/缺数据支撑），并给一条同主题的 compliant suggestion（用户可直接照抄的合格排行请求）。
合格：normalizedPrompt 改写为一句自包含排行任务（主题+排序依据+条目数+语言），count 填条目数（用户没说就 20，最多 50）。
输出语言跟随用户请求语言。不要虚构具体名次结论。`

/** 纯函数：把模型输出规整成 GateDecision，count 走全局 clamp。 */
export function normalizeGateOutput(raw: GateResult, originalPrompt: string): GateDecision {
  if (!raw.valid) {
    return {
      valid: false,
      reason: raw.reason?.trim() || '该主题缺乏可排序、可查证的数据支撑',
      suggestion: raw.suggestion?.trim() || undefined,
      normalizedPrompt: originalPrompt,
      count: clampCount(raw.count),
      requestedCount: raw.count ?? null,
      clamped: typeof raw.count === 'number' && raw.count > MAX_COUNT,
    }
  }
  const count = clampCount(raw.count)
  return {
    valid: true,
    normalizedPrompt: raw.normalizedPrompt?.trim() || originalPrompt,
    count,
    requestedCount: raw.count ?? null,
    clamped: typeof raw.count === 'number' && raw.count !== count,
  }
}

export async function runGate(
  config: ServerConfig,
  prompt: string,
  options: { signal?: AbortSignal },
): Promise<GateDecision> {
  const model = makeLlmModel(config, 'gate')
  try {
    const { output } = await generateText({
      model,
      system: GATE_SYSTEM,
      prompt,
      output: Output.object({ schema: gateResultSchema }),
      ...(options.signal ? { signal: options.signal } : {}),
    })
    return normalizeGateOutput(output, prompt)
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      throw new GateError('校验模型返回了无法解析的判定结果', { cause: error })
    }
    throw error
  }
}
