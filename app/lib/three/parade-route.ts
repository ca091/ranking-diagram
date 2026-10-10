/**
 * Parade 路线几何（纯函数、零 THREE 依赖，可单测）。
 *
 * 布局约定（世界坐标）：
 *   - 柱子排在 x = -6 一线，沿 -z 排开；rank 越大越近（#n 最近），#1 最远压轴
 *   - 相机走 x = +4 的车道，视线恒定左偏 ~38°（见 parade-scene 的 look 常量）
 *
 * 巡航终点距冠军柱 cruiseGap；focus 收尾沿道路再推进 focusDolly，
 * 理想是推进到 dz = focusDz（此时冠军恰好落在视线中心）。
 * 短榜单 gap 本身不足 focusDz 时 dolly 取 0 —— 宁可停在略偏中心的位置，
 * 也绝不穿过冠军柱（旧版固定 12 单位对 n≤6 直接冲过头，评审 (c)1）。
 */

export const ROUTE = {
  startZ: 8,
  columnStartZ: -10,
  spacing: 4.5,
  /** 巡航终点与冠军柱的最大 z 距离 */
  endGapMax: 25,
  /** 短榜单自适应：gap 不超过全程的 30%，保证终点在起点前方 */
  gapOfTotalRatio: 0.3,
  /** 收尾 dolly 的最大推进量 */
  dollyMax: 12,
  /** 冠军柱居于视线中心时对应的相机-柱距离：atan(横向 10 / focusDz) ≈ 视线角 38° */
  focusDz: 13,
} as const

export function lastColumnZ(count: number): number {
  return ROUTE.columnStartZ - (count - 1) * ROUTE.spacing
}

/** 巡航终点与冠军柱（最远柱）的 z 距离 */
export function cruiseGap(count: number): number {
  const total = ROUTE.startZ - lastColumnZ(count)
  return Math.min(ROUTE.endGapMax, total * ROUTE.gapOfTotalRatio)
}

/** 巡航终点的 z */
export function cruiseEndZ(count: number): number {
  return lastColumnZ(count) + cruiseGap(count)
}

/** focus 收尾沿 -z 的推进量：推到 dz=focusDz 居中为止，短榜单钳制为 0（绝不穿过柱体） */
export function focusDolly(count: number): number {
  return Math.max(0, Math.min(ROUTE.dollyMax, cruiseGap(count) - ROUTE.focusDz))
}
