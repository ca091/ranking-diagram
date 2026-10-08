/**
 * 客户端与服务端共用的排行数据契约。
 * 单一事实源：zod schema + 派生 TS 类型 + 结构校验。
 */
import { z } from 'zod'

export const MIN_COUNT = 3
export const MAX_COUNT = 50
/**
 * 默认条目数。排行 JSON 是单次最大输出（每条目 ≈150 output tokens），
 * 直接决定最后一步生成时长；用户显式要求时可到 MAX_COUNT=50。
 */
export const DEFAULT_COUNT = 15

/** 数量护栏：非法/缺失回落默认值，越界 clamp 到 3~50。纯函数。 */
export function clampCount(raw: number | null | undefined): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_COUNT
  return Math.min(Math.max(Math.floor(raw), MIN_COUNT), MAX_COUNT)
}

export const sourceSchema = z.object({
  title: z.string().min(1).max(150),
  url: z.string().url(),
})

export const rankingEntrySchema = z.object({
  rank: z.number().int().min(1).max(MAX_COUNT),
  name: z.string().min(1).max(80),
  score: z.number().min(0).max(100),
  oneLiner: z.string().min(1).max(120),
  sources: z.array(sourceSchema).min(1).max(3),
  /** 模型给出的头像源地址；可能失效，由 /api/img 代理 + 前端占位兜底。 */
  avatarUrl: z.string().url().optional(),
})

export const rankingResultSchema = z.object({
  title: z.string().min(1).max(160),
  entries: z.array(rankingEntrySchema).min(1).max(MAX_COUNT),
})

/** 模型爱犯、且值得机械吸收的错：字符串布尔/数字、超长文本、坏字段。 */
const trimTo = (max: number) => (v: unknown) => (typeof v === 'string' ? v.slice(0, max) : v)
const asFiniteNumber = (v: unknown) =>
  typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v

/**
 * gate 判定容错 schema：valid 接受 "true"/"false" 字符串，count 接受数字字符串，
 * 文本字段超长按上限截断，坏值丢弃（optional 字段没必要让整次判定报废）。
 * valid 缺失或不可辨认仍然失败——那是真的没法判定。
 */
export const gateResultSchema = z.object({
  valid: z
    .union([z.boolean(), z.string()])
    .transform((v, ctx) => {
      if (typeof v === 'boolean') return v
      const normalized = v.trim().toLowerCase()
      if (normalized === 'true' || normalized === '1') return true
      if (normalized === 'false' || normalized === '0') return false
      // 不可辨认就明确失败：静默判 false 会把用户的正常请求误杀
      ctx.addIssue({ code: 'custom', message: 'valid 不是可辨认的布尔值' })
      return z.NEVER
    }),
  /** valid=false 时给用户的拒绝理由 */
  reason: z.preprocess(trimTo(300), z.string().optional()).catch(undefined),
  /** valid=false 时的改写建议 */
  suggestion: z.preprocess(trimTo(200), z.string().optional()).catch(undefined),
  /** valid=true 时规范化后的真实排行任务 */
  normalizedPrompt: z.preprocess(trimTo(500), z.string().optional()).catch(undefined),
  /** 用户要求/规范化后的条目数 */
  count: z.preprocess(asFiniteNumber, z.number().int().min(1).max(200).optional()).catch(undefined),
})

const FENCE_RE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i

/**
 * 模型常把 JSON 包在 ```json 围栏里：剥围栏后再 JSON.parse。
 * 失败返回 undefined，由调用方决定怎么报问题。纯函数。
 */
export function parseModelJson(text: string): unknown {
  const stripped = text.match(FENCE_RE)?.[1] ?? text
  try {
    return JSON.parse(stripped)
  } catch {
    return undefined
  }
}

export type Source = z.infer<typeof sourceSchema>
export type RankingEntry = z.infer<typeof rankingEntrySchema>
export type RankingResult = z.infer<typeof rankingResultSchema>
export type GateResult = z.infer<typeof gateResultSchema>

export interface RankingIssue {
  path: string
  message: string
}

/**
 * schema 通过后的结构校验（喂给修复回路）：
 * 名次须为 1..n 连续升序、分数随名次非递增、条目名去重、条数不得超上限。
 * 纯函数，返回问题列表（空 = 合法）。
 */
export function validateRankingStructure(result: RankingResult): RankingIssue[] {
  const issues: RankingIssue[] = []
  const { entries } = result

  if (entries.length > MAX_COUNT) {
    issues.push({ path: 'entries', message: `条目数 ${entries.length} 超过上限 ${MAX_COUNT}，请截取前 ${MAX_COUNT} 名` })
  }

  const seen = new Map<string, number>()
  const sorted = [...entries].sort((a, b) => a.rank - b.rank)

  sorted.forEach((entry, i) => {
    const expected = i + 1
    if (entry.rank !== expected) {
      issues.push({ path: `entries[${entry.rank}]`, message: `名次必须从 1 开始连续（期望 rank=${expected}，实际 rank=${entry.rank}）` })
    }
    const key = entry.name.trim().toLowerCase()
    if (seen.has(key)) {
      issues.push({ path: `entries[${entry.rank}]`, message: `条目「${entry.name}」与 rank=${seen.get(key)} 重复` })
    } else {
      seen.set(key, entry.rank)
    }
    if (i > 0) {
      const prev = sorted[i - 1]!
      if (entry.score > prev.score) {
        issues.push({ path: `entries[${entry.rank}]`, message: `分数必须随名次下降/持平：rank ${prev.rank}(${prev.score}) → rank ${entry.rank}(${entry.score})` })
      }
    }
  })

  return issues
}

export interface RankingCoercion {
  /** 恰好 count 条的合规结果；条目不足无法凭空捏造时为 null */
  result: RankingResult | null
  /** result=null 时的问题列表（可直接喂给修复回路） */
  issues: RankingIssue[]
}

/**
 * 把「差一点就合规」的模型输出确定性地修好，避免为机械小错再花一次模型调用：
 * 按 rank 升序（并列看 score）→ 名称去重（保留先出现者）→ 分数随名次压平
 * → 超长截尾 → 重编 1..n。不修改入参，全部返回新对象。
 * 唯一修不了的是条目不够——那需要新事实，只能交给修复回路。
 */
export function coerceRanking(raw: RankingResult, count: number): RankingCoercion {
  const ordered = [...raw.entries].sort((a, b) => a.rank - b.rank || b.score - a.score)

  const seen = new Set<string>()
  const deduped: RankingEntry[] = []
  let ceiling = Number.POSITIVE_INFINITY
  for (const entry of ordered) {
    const key = entry.name.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    ceiling = Math.min(entry.score, ceiling)
    deduped.push({ ...entry, score: ceiling })
  }

  if (deduped.length < count) {
    return {
      result: null,
      issues: [{ path: 'entries', message: `有效条目 ${deduped.length} 条，少于要求的 ${count} 条，请补齐并保持名次连续、不重复` }],
    }
  }

  const entries = deduped.slice(0, count).map((entry, i) => ({ ...entry, rank: i + 1 }))
  return { result: { title: raw.title, entries }, issues: [] }
}
