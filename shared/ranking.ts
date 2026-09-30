/**
 * 客户端与服务端共用的排行数据契约。
 * 单一事实源：zod schema + 派生 TS 类型 + 结构校验。
 */
import { z } from 'zod'

export const MIN_COUNT = 3
export const MAX_COUNT = 50
export const DEFAULT_COUNT = 30

/** 数量护栏：非法/缺失回落默认值，越界 clamp 到 3~50。纯函数。 */
export function clampCount(raw: number | null | undefined): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_COUNT
  return Math.min(Math.max(Math.floor(raw), MIN_COUNT), MAX_COUNT)
}

export const sourceSchema = z.object({
  title: z.string().min(1).max(300),
  url: z.string().url(),
})

export const rankingEntrySchema = z.object({
  rank: z.number().int().min(1).max(MAX_COUNT),
  name: z.string().min(1).max(80),
  score: z.number().min(0).max(100),
  oneLiner: z.string().min(1).max(300),
  sources: z.array(sourceSchema).min(1).max(5),
  /** 模型给出的头像源地址；可能失效，由 /api/img 代理 + 前端占位兜底。 */
  avatarUrl: z.string().url().optional(),
})

export const rankingResultSchema = z.object({
  title: z.string().min(1).max(160),
  entries: z.array(rankingEntrySchema).min(1).max(MAX_COUNT),
})

export const gateResultSchema = z.object({
  valid: z.boolean(),
  /** valid=false 时给用户的拒绝理由 */
  reason: z.string().max(300).optional(),
  /** valid=false 时的改写建议 */
  suggestion: z.string().max(200).optional(),
  /** valid=true 时规范化后的真实排行请求 */
  normalizedPrompt: z.string().max(500).optional(),
  /** 用户要求/规范化后的条目数 */
  count: z.number().int().min(1).max(200).optional(),
})

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
