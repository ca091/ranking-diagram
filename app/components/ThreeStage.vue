<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { RankingResult } from '#shared/ranking'
import type { HoverInfo } from '../lib/three/scene'
import { useStageTooltip } from '../composables/useStageTooltip'
import { DEFAULT_CHOREO, type ChoreoConfig } from '../lib/three/choreography'

const props = defineProps<{
  result: RankingResult | null
  /** J 键隐藏 UI 时连 tooltip 一起收起，只留纯 3D */
  showChrome?: boolean
  /** 出场节奏覆盖（staggerMs/growMs/championPauseMs），缺省用 DEFAULT_CHOREO */
  choreo?: Partial<ChoreoConfig>
}>()

const emit = defineEmits<{
  /** 入场播放开始（含重播）——父级借此进入"纯 3D"模式 */
  entering: []
  /** 全部柱子落位 */
  entered: []
}>()

interface StageHandle {
  setResult: (r: RankingResult) => void
  replay: () => void
  refitView: () => void
  dispose: () => void
  getScrollRangePx: () => number
  getScrollPx: () => number
  setScrollPx: (px: number) => void
}

const containerRef = ref<HTMLElement | null>(null)
const scrollRef = ref<HTMLElement | null>(null)
const stage = shallowRef<StageHandle | null>(null)
const hover = ref<HoverInfo | null>(null)
const { tooltipRef, tooltipStyle } = useStageTooltip(hover, containerRef)
const webglError = ref(false)
/** 内容超宽时的滚动代理宽度（px）；0 = 无需滚动 */
const scrollInnerPx = ref(0)

/**
 * scene 是滚动位置的唯一事实源：布局变化后把 scene 当前值镜像到滚动条。
 * （display:none 时 scrollLeft 不可写，故入场期间也要保持本元素可测量。）
 */
function syncScroll(): void {
  const range = stage.value?.getScrollRangePx() ?? 0
  const viewWidth = containerRef.value?.clientWidth ?? 0
  scrollInnerPx.value = range > 0 ? Math.round(viewWidth + range) : 0
  const el = scrollRef.value
  if (!el || !stage.value) return
  const current = Math.min(stage.value.getScrollPx(), range)
  if (Math.abs(el.scrollLeft - current) > 0.5) el.scrollLeft = current
}

function onScroll(): void {
  if (scrollRef.value) stage.value?.setScrollPx(scrollRef.value.scrollLeft)
}

/** 触控板横扫 / shift+滚轮 驱动同一滚动 */
function onWheel(event: WheelEvent): void {
  const el = scrollRef.value
  if (!el || scrollInnerPx.value === 0) return
  const horizontal = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0
  if (horizontal !== 0) el.scrollLeft += horizontal
}

async function ensureStage(): Promise<boolean> {
  if (stage.value) return true
  if (!containerRef.value) return false
  try {
    const { RankingStage } = await import('../lib/three/scene')
    stage.value = new RankingStage(
      containerRef.value,
      {
        onHover: (info) => { hover.value = info },
        onLayout: () => { syncScroll() },
        onPlayStart: () => { emit('entering') },
        onEnded: () => { emit('entered') },
        onAutoScroll: (px) => {
          // 入场自动跟拍回写滚动条；写入同值不会反向触发 scroll 事件
          const el = scrollRef.value
          if (el && Math.abs(el.scrollLeft - px) > 0.5) el.scrollLeft = px
        },
      },
      { ...DEFAULT_CHOREO, ...props.choreo },
    )
    return true
  } catch (error) {
    webglError.value = true
    console.warn('WebGL init failed:', error)
    return false
  }
}

/**
 * 舞台与结果的会合点：两者就绪顺序不定（首帧 result 为空 / immediate watch 早于
 * 挂载导致 containerRef 未就绪 / HMR 重建后 result 引用不变），
 * 因此 mount 与 result watch 都调它，缺谁等谁。
 */
async function renderIfReady(): Promise<void> {
  if (!containerRef.value || !props.result) return
  if (!(await ensureStage())) return
  hover.value = null
  stage.value?.setResult(props.result)
}

onMounted(() => {
  // 背景图在页面初始化即渲染，不等排行结果
  void ensureStage().then((ok) => {
    if (ok) nextTick(syncScroll)
    void renderIfReady()
  })
})

// immediate: HMR/组件重建时 result 引用不变也能重新灌入场景
watch(() => props.result, () => { void renderIfReady() }, { immediate: true })

watch(
  () => props.showChrome,
  (visible) => {
    if (visible === false) hover.value = null
  },
)

// hover 卡片的视口收进定位逻辑抽至 useStageTooltip（与 ParadeStage 共用）

function replay() {
  hover.value = null
  stage.value?.replay()
}

function refit() {
  hover.value = null
  void ensureStage().then((ok) => {
    if (ok) stage.value?.refitView()
  })
}

defineExpose({ replay, refit })

onBeforeUnmount(() => {
  stage.value?.dispose()
  stage.value = null
})
</script>

<template>
  <div class="relative h-full w-full overflow-hidden">
    <div ref="containerRef" class="absolute inset-0" @wheel="onWheel" />

    <div
      v-if="webglError"
      class="absolute inset-0 z-10 grid place-items-center px-8 text-center text-sm text-zinc-300"
    >
      当前浏览器无法初始化 WebGL，3D 舞台不可用
    </div>

    <!-- 横向滚动代理：柱子多于可视宽度时出现（背景固定，滚动带视差）。
         入场（chrome 隐藏）期间用 opacity 而非 display 隐藏——display:none 会让
         scrollLeft 不可写，入场跟拍的回写就丢了 -->
    <div
      v-show="scrollInnerPx > 0"
      ref="scrollRef"
      class="stage-scroll absolute inset-x-0 bottom-0 z-10 h-4 overflow-x-auto overflow-y-hidden transition-opacity"
      :class="showChrome === false ? 'pointer-events-none opacity-0' : 'opacity-100'"
      @scroll.passive="onScroll"
    >
      <div class="h-px" :style="{ width: `${scrollInnerPx}px` }" />
    </div>

    <div
      v-if="hover && showChrome !== false"
      ref="tooltipRef"
      class="pointer-events-none absolute z-20 w-78 max-w-[80vw] -translate-x-1/2 rounded-lg border border-white/15 bg-slate-950/92 p-3 text-xs shadow-2xl backdrop-blur"
      :style="tooltipStyle"
    >
      <div class="mb-1 flex items-center gap-2">
        <span class="rounded bg-zinc-500/70 px-1.5 py-0.5 font-bold text-zinc-100">#{{ hover.entry.rank }}</span>
        <span class="font-semibold text-zinc-100">{{ hover.entry.name }}</span>
        <span class="ml-auto tabular-nums text-zinc-400">{{ hover.entry.score.toFixed(1) }}</span>
      </div>
      <p class="mb-2 leading-relaxed text-slate-300">{{ hover.entry.oneLiner }}</p>
      <div class="space-y-0.5">
        <p class="text-[10px] uppercase tracking-wider text-slate-500">来源</p>
        <a
          v-for="source in hover.entry.sources.slice(0, 2)"
          :key="source.url"
          :href="source.url"
          target="_blank"
          rel="noopener noreferrer"
          class="block truncate text-[#93a7c9] underline-offset-2 hover:text-zinc-200 hover:underline"
          @click.stop
        >{{ source.title }}</a>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 黑暗风格下细化滚动条 */
.stage-scroll::-webkit-scrollbar {
  height: 6px;
}
.stage-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.stage-scroll::-webkit-scrollbar-thumb {
  background: rgba(120, 140, 170, 0.35);
  border-radius: 3px;
}
.stage-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(150, 168, 196, 0.5);
}
.stage-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(120, 140, 170, 0.35) transparent;
}
</style>
