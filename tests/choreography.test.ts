import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHOREO,
  buildTimeline,
  easeOutBack,
  easeOutCubic,
  slotProgress,
  type ChoreoConfig,
} from '../app/lib/three/choreography'

/** 显式节奏，让时间线数学与默认参数解耦 */
const CFG: ChoreoConfig = { staggerMs: 120, growMs: 520, championPauseMs: 600 }

describe('DEFAULT_CHOREO', () => {
  it('出场间隔按需求暂定 1s，且整体可配置', () => {
    expect(DEFAULT_CHOREO.staggerMs).toBe(1000)
    expect(buildTimeline(3, CFG).starts[1]).toBe(120) // 自定义节奏即插即用
  })
})

describe('buildTimeline', () => {
  it('空数量返回空时间线', () => {
    expect(buildTimeline(0, CFG)).toEqual({ starts: [], totalMs: 0 })
  })

  it('3 条：前两条按 stagger，冠军额外蓄力 championPause', () => {
    const { starts, totalMs } = buildTimeline(3, CFG)
    expect(starts).toEqual([0, 120, 120 + 600])
    expect(totalMs).toBe(720 + 520)
  })

  it('单条：冠军即第一条，从 0 开始', () => {
    const { starts, totalMs } = buildTimeline(1, CFG)
    expect(starts).toEqual([0])
    expect(totalMs).toBe(CFG.growMs)
  })

  it('30 条：起跳时刻严格递增，冠军与季军间隔 >= championPause', () => {
    const { starts, totalMs } = buildTimeline(30, CFG)
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]!).toBeGreaterThan(starts[i - 1]!)
    }
    expect(starts[29]! - starts[28]!).toBeGreaterThanOrEqual(CFG.championPauseMs)
    expect(totalMs).toBe(starts[29]! + CFG.growMs)
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
