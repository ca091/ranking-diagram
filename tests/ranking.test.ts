import { describe, expect, it } from 'vitest'
import {
  clampCount,
  coerceRanking,
  DEFAULT_COUNT,
  gateResultSchema,
  MAX_COUNT,
  MIN_COUNT,
  parseModelJson,
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
  it('非法输入回落默认值', () => {
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

describe('gateResultSchema 容错（机械小错不报废整次判定）', () => {
  it('字符串布尔/数字被吸收', () => {
    const ok = gateResultSchema.safeParse({ valid: 'true', normalizedPrompt: 'p', count: '12' })
    expect(ok.success).toBe(true)
    expect(ok.data?.valid).toBe(true)
    expect(ok.data?.count).toBe(12)
  })

  it('超长的 reason/suggestion 截断而非报错', () => {
    const ok = gateResultSchema.safeParse({
      valid: false,
      reason: '理'.repeat(400),
      suggestion: '议'.repeat(300),
    })
    expect(ok.success).toBe(true)
    expect(ok.data?.reason).toHaveLength(300)
    expect(ok.data?.suggestion).toHaveLength(200)
  })

  it('optional 字段坏值直接丢弃，不影响判定', () => {
    const ok = gateResultSchema.safeParse({ valid: true, count: 'abc', normalizedPrompt: 42 })
    expect(ok.success).toBe(true)
    expect(ok.data?.count).toBeUndefined()
    expect(ok.data?.normalizedPrompt).toBeUndefined()
  })

  it('valid 不可辨认仍然失败', () => {
    expect(gateResultSchema.safeParse({ normalizedPrompt: 'p' }).success).toBe(false)
    expect(gateResultSchema.safeParse({ valid: 'maybe' }).success).toBe(false)
  })
})

describe('parseModelJson', () => {
  it('剥 ```json 围栏后解析', () => {
    expect(parseModelJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 })
    expect(parseModelJson('```\n{"a": 1}\n```')).toEqual({ a: 1 })
  })

  it('非 JSON 返回 undefined，由调用方决定报法', () => {
    expect(parseModelJson('not json at all')).toBeUndefined()
    expect(parseModelJson('{"a":')).toBeUndefined()
  })
})

describe('coerceRanking 确定性整形', () => {
  const wrap = (...entries: ReturnType<typeof entry>[]) => ({ title: 'T', entries })

  it('乱序/跳号名次 → 重排并重编号 1..n', () => {
    const { result, issues } = coerceRanking(wrap(entry(5, 'e', 50), entry(2, 'b', 80), entry(9, 'i', 30)), 3)
    expect(issues).toEqual([])
    expect(result!.entries.map((e) => [e.rank, e.name])).toEqual([[1, 'b'], [2, 'e'], [3, 'i']])
  })

  it('重复条目名去重（大小写/空白不敏感，保留先出现者）', () => {
    const { result } = coerceRanking(wrap(entry(1, ' Luffy ', 90), entry(2, 'luffy', 80), entry(3, 'zoro', 70)), 2)
    expect(result!.entries.map((e) => e.name)).toEqual([' Luffy ', 'zoro'])
  })

  it('分数随名次上升 → 压平为前值，不再触发模型修复', () => {
    const { result } = coerceRanking(wrap(entry(1, 'a', 60), entry(2, 'b', 95), entry(3, 'c', 30)), 3)
    expect(result!.entries.map((e) => e.score)).toEqual([60, 60, 30])
  })

  it('多吐条目 → 截尾到恰好 count', () => {
    const { result } = coerceRanking(wrap(entry(1, 'a'), entry(2, 'b'), entry(3, 'c'), entry(4, 'd')), 3)
    expect(result!.entries).toHaveLength(3)
    expect(result!.entries.at(-1)!.name).toBe('c')
  })

  it('条目不足 → result=null 且 issues 说明少于要求（需要新事实，只能走修复回路）', () => {
    const { result, issues } = coerceRanking(wrap(entry(1, 'a'), entry(2, 'b')), 5)
    expect(result).toBeNull()
    expect(issues[0]!.message).toContain('少于')
  })

  it('不修改入参（immutability 规范）', () => {
    const raw = wrap(entry(2, 'b', 80), entry(1, 'a', 90))
    const snapshot = JSON.stringify(raw)
    coerceRanking(raw, 2)
    expect(JSON.stringify(raw)).toBe(snapshot)
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
