/**
 * hover 卡片的视口收进定位（评审 Duplicated Code：ThreeStage 与 ParadeStage 各存一份）：
 * 水平按半宽 clamp（贴边柱体不被裁），垂直优先柱顶上方、放不下翻到下方；
 * 需渲染后量到实际尺寸，故在 hover 更新的下一帧精确重定位（先给近似值防一帧错位）。
 */
import { nextTick, ref, watch } from 'vue'
import type { Ref } from 'vue'

interface HoverPoint { x: number; y: number }

export function useStageTooltip(
  hover: Ref<HoverPoint | null>,
  holderRef: Ref<HTMLElement | null>,
) {
  const tooltipRef = ref<HTMLElement | null>(null)
  const tooltipStyle = ref({ left: '0px', top: '0px' })

  watch(hover, async (h) => {
    if (!h) return
    tooltipStyle.value = { left: `${h.x}px`, top: `${Math.max(h.y - 10, 10)}px` }
    await nextTick()
    const el = tooltipRef.value
    const holder = holderRef.value
    if (!el || !holder) return
    const pad = 10
    const cardW = el.offsetWidth
    const cardH = el.offsetHeight
    const viewW = holder.clientWidth
    const viewH = holder.clientHeight
    const left = Math.min(Math.max(h.x, cardW / 2 + pad), Math.max(viewW - cardW / 2 - pad, pad))
    const above = h.y - 10 - cardH
    const top = above >= pad ? above : Math.min(h.y + 18, Math.max(viewH - cardH - pad, pad))
    tooltipStyle.value = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
  })

  return { tooltipRef, tooltipStyle }
}
