import { describe, expect, it } from 'vitest'
import {
  clampCount,
  DEFAULT_COUNT,
  MAX_COUNT,
  MIN_COUNT,
  rankingResultSchema,
  validateRankingStructure,
} from '#shared/ranking'
import { normalizeGateOutput } from '../server/utils/gate'

const entry = (rank: number, name = `N${rank}`, score = 100 - rank) => ({
  rank,
  name,
  score,
  oneLiner: 'x',
  sources: [{ title: 't', url: 'https://example.com/a' }],
})

describe('clampCount 数量护栏', () => {
  it('非法输入回落默认 30', () => {
    expect(clampCount(undefined)).toBe(DEFAULT_COUNT)
    expect(clampCount(null)).toBe(DEFAULT_COUNT)
    expect(clampCount(Number.NaN)).toBe(DEFAULT_COUNT)
    expect(clampCount(0)).toBe(MIN_COUNT)
    expect(clampCount(-5)).toBe(MIN_COUNT)
  })

  it('越界 clamp 到 3~50', () => {
    expect(clampCount(100)).toBe(MAX_COUNT)
    expect(clampCount(51)).toBe(MAX_COUNT)
    expect(clampCount(50)).toBe(50)
    expect(clampCount(3)).toBe(3)
    expect(clampCount(7.9)).toBe(7)
  })
})

describe('validateRankingStructure 结构校验', () => {
  it('合法结果零问题', () => {
    const result = { title: 'T', entries: [entry(1, 'a', 90), entry(2, 'b', 80), entry(3, 'c', 70)] }
    expect(validateRankingStructure(result)).toEqual([])
  })

  it('并列分数合法（非递增即可）', () => {
    const result = { title: 'T', entries: [entry(1, 'a', 80), entry(2, 'b', 80), entry(3, 'c', 70)] }
    expect(validateRankingStructure(result)).toEqual([])
  })

  it('名次不连续被抓', () => {
    const result = { title: 'T', entries: [entry(1), entry(3)] }
    const issues = validateRankingStructure(result)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some((i) => i.message.includes('连续'))).toBe(true)
  })

  it('分数随名次上升被抓', () => {
    const result = { title: 'T', entries: [entry(1, 'a', 50), entry(2, 'b', 90)] }
    const issues = validateRankingStructure(result)
    expect(issues.some((i) => i.message.includes('下降/持平'))).toBe(true)
  })

  it('重复条目名被抓（大小写不敏感）', () => {
    const result = { title: 'T', entries: [entry(1, 'Luffy', 90), entry(2, 'luffy', 80), entry(3, 'x', 70)] }
    const issues = validateRankingStructure(result)
    expect(issues.some((i) => i.message.includes('重复'))).toBe(true)
  })
})

describe('rankingResultSchema 边界', () => {
  it('编造不了的字段缺省会失败：score 越界 / 空 sources', () => {
    expect(
      rankingResultSchema.safeParse({ title: 'T', entries: [{ ...entry(1), score: 101 } ] }).success,
    ).toBe(false)
    expect(
      rankingResultSchema.safeParse({
        title: 'T',
        entries: [{ rank: 1, name: 'a', score: 1, oneLiner: 'x', sources: [] }],
      }).success,
    ).toBe(false)
  })
})

describe('normalizeGateOutput', () => {
  it('拒绝时给兜底理由，且不抛错', () => {
    const d = normalizeGateOutput({ valid: false }, '我的心情排行')
    expect(d.valid).toBe(false)
    expect(d.reason).toContain('数据支撑')
    expect(d.normalizedPrompt).toBe('我的心情排行')
  })

  it('通过时 normalizedPrompt 兜底原 prompt，count 走 clamp', () => {
    const d = normalizeGateOutput({ valid: true, count: 120 }, '原始请求')
    expect(d.valid).toBe(true)
    expect(d.count).toBe(MAX_COUNT)
    expect(d.clamped).toBe(true)
    expect(d.requestedCount).toBe(120)

    const d2 = normalizeGateOutput({ valid: true }, '原始请求')
    expect(d2.count).toBe(DEFAULT_COUNT)
    expect(d2.clamped).toBe(false)
  })
})
