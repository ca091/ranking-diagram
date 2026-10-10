/**
 * Parade 路线几何单测（评审 Spec (c)1 回归锁）：
 * focus dolly 必须随自适应 gap 缩放——绝不穿过冠军柱，够长时精确居中（dz≈focusDz）。
 */
import { describe, expect, it } from 'vitest'
import { ROUTE, cruiseEndZ, cruiseGap, focusDolly, lastColumnZ } from '../app/lib/three/parade-route'

describe('parade-route 终点与 dolly 数学', () => {
  it('长榜单（n≥16）：gap 封顶 25，dolly 封顶 12，收尾 dz = 13（冠军居中）', () => {
    expect(cruiseGap(30)).toBe(25)
    expect(focusDolly(30)).toBe(12)
    expect(cruiseEndZ(30) - lastColumnZ(30) - focusDolly(30)).toBeCloseTo(ROUTE.focusDz, 6)
  })

  it('中短榜单（n=10）：dolly 收缩到 gap-focusDz，收尾 dz 仍精确居中', () => {
    const gap = cruiseGap(10)
    expect(gap).toBeLessThan(ROUTE.endGapMax)
    expect(cruiseEndZ(10) - lastColumnZ(10)).toBeCloseTo(gap, 6)
    expect(gap - focusDolly(10)).toBeCloseTo(ROUTE.focusDz, 6)
  })

  it('极短榜单（n=3..6）：gap < focusDz 时 dolly=0，绝不越过冠军柱', () => {
    for (const n of [3, 4, 5, 6]) {
      expect(focusDolly(n)).toBe(0)
      const finalDz = cruiseGap(n) - focusDolly(n)
      expect(finalDz).toBeGreaterThan(0)
    }
  })

  it('终点恒在起点前方（自适应 30% 保证不倒退）', () => {
    for (let n = 3; n <= 50; n++) {
      expect(cruiseEndZ(n)).toBeLessThan(ROUTE.startZ)
      expect(lastColumnZ(n)).toBeLessThan(cruiseEndZ(n))
    }
  })

  it('倒序布局：rank 越大 z 越近（越大），#1 最远压轴', () => {
    const n = 30
    const zOf = (rank: number) => ROUTE.columnStartZ - (n - rank) * ROUTE.spacing
    expect(zOf(n)).toBe(ROUTE.columnStartZ) // 最大名次最近
    expect(zOf(1)).toBe(lastColumnZ(n)) // #1 恰好是巡航参照的最远柱
    expect(zOf(5)).toBeLessThan(zOf(6))
  })
})
