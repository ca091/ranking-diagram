/**
 * 入场编排时间线：纯函数、可单测，渲染层只消费结果。
 * 语义（设计共识 Q7/Q8）：slot 0 = 最弱（rank=count，最左）… slot count-1 = 冠军（rank 1，最右、压轴）。
 */

export interface ChoreoConfig {
  /** 相邻条目入场间隔 */
  staggerMs: number
  /** 单根条形的生长时长（含 overshoot） */
  growMs: number
  /** 冠军前的停顿蓄力 */
  championPauseMs: number
}

export const DEFAULT_CHOREO: ChoreoConfig = {
  staggerMs: 120,
  growMs: 520,
  championPauseMs: 600,
}

export interface Timeline {
  /** starts[slot] = 该槽位开始时刻（ms） */
  starts: number[]
  /** 全部动画结束时刻（ms） */
  totalMs: number
}

export function buildTimeline(count: number, cfg: ChoreoConfig = DEFAULT_CHOREO): Timeline {
  if (count <= 0) return { starts: [], totalMs: 0 }
  const starts: number[] = []
  for (let slot = 0; slot < count; slot++) {
    starts.push(slot * cfg.staggerMs)
  }
  // 冠军蓄力：仅当冠军不是唯一条目时，在最后一名之后额外停顿
  if (count > 1) {
    starts[count - 1] = starts[count - 2]! + cfg.championPauseMs
  }
  return { starts, totalMs: starts[count - 1]! + cfg.growMs }
}

/** easeOutBack：末段回弹 overshoot，条形"长过头再落回"。 */
export function easeOutBack(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1)
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(clamped - 1, 3) + c1 * Math.pow(clamped - 1, 2)
}

/** easeOutCubic：滑移/透明度用，单调不回弹。 */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1)
  return 1 - Math.pow(1 - clamped, 3)
}

/** 单槽位进度 [0,1]；start 之前恒为 0。 */
export function slotProgress(nowMs: number, startMs: number, growMs: number): number {
  if (nowMs <= startMs) return 0
  return Math.min((nowMs - startMs) / growMs, 1)
}
