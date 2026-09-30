import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHOREO,
  buildTimeline,
  easeOutBack,
  easeOutCubic,
  slotProgress,
} from '../app/lib/three/choreography'

describe('buildTimeline', () => {
  it('空数量返回空时间线', () => {
    expect(buildTimeline(0)).toEqual({ starts: [], totalMs: 0 })
  })

  it('3 条：前两条按 stagger，冠军额外蓄力 championPause', () => {
    const { starts, totalMs } = buildTimeline(3, DEFAULT_CHOREO)
    expect(starts).toEqual([0, 120, 120 + 600])
    expect(totalMs).toBe(720 + 520)
  })

  it('单条：冠军即第一条，从 0 开始', () => {
    const { starts, totalMs } = buildTimeline(1)
    expect(starts).toEqual([0])
    expect(totalMs).toBe(DEFAULT_CHOREO.growMs)
  })

  it('30 条：起跳时刻严格递增，冠军与季军间隔 >= championPause', () => {
    const { starts, totalMs } = buildTimeline(30)
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]!).toBeGreaterThan(starts[i - 1]!)
    }
    expect(starts[29]! - starts[28]!).toBeGreaterThanOrEqual(DEFAULT_CHOREO.championPauseMs)
    expect(totalMs).toBe(starts[29]! + DEFAULT_CHOREO.growMs)
    // 30 条全程约 4.5s：stagger 28*120 + pause 600 + grow 520 = 4480ms
    expect(totalMs).toBe(28 * 120 + 600 + 520)
  })
})

describe('缓动函数', () => {
  it('端点归一', () => {
    expect(easeOutBack(0)).toBeCloseTo(0)
    expect(easeOutBack(1)).toBeCloseTo(1)
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
  })

  it('easeOutBack 中段有 overshoot（>1），easeOutCubic 无', () => {
    expect(easeOutBack(0.8)).toBeGreaterThan(1)
    expect(easeOutCubic(0.8)).toBeLessThanOrEqual(1)
  })

  it('输入越界被夹到 [0,1]', () => {
    expect(easeOutBack(-1)).toBeCloseTo(0)
    expect(easeOutBack(9)).toBeCloseTo(1)
  })
})

describe('slotProgress', () => {
  it('未到起跳恒 0；线性推进；封顶 1', () => {
    expect(slotProgress(100, 200, 500)).toBe(0)
    expect(slotProgress(450, 200, 500)).toBeCloseTo(0.5)
    expect(slotProgress(9999, 200, 500)).toBe(1)
  })
})
