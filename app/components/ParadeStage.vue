<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { RankingResult } from '#shared/ranking'
import type { HoverInfo } from '../lib/three/parade-scene'
import { useStageTooltip } from '../composables/useStageTooltip'

const props = defineProps<{
  result: RankingResult | null
}>()

const emit = defineEmits<{
  /** auto（巡航 + focus dolly）全程走完，W/S 手动接管 */
  manualUnlocked: []
}>()

interface StageHandle {
  setResult: (r: RankingResult) => void
  replay: () => void
  dispose: () => void
}

const containerRef = ref<HTMLElement | null>(null)
const stage = shallowRef<StageHandle | null>(null)
const hover = ref<HoverInfo | null>(null)
const webglError = ref(false)
const { tooltipRef, tooltipStyle } = useStageTooltip(hover, containerRef)

/**
 * 动态 import 在途时可能被多次调用（mount 与 result watch 会师），
 * 用 in-flight promise 记忆化保证只 new 一次，避免双实例 + canvas 泄漏。
 */
let ensuring: Promise<boolean> | null = null
function ensureStage(): Promise<boolean> {
  if (stage.value) return Promise.resolve(true)
  if (!ensuring) {
    ensuring = (async () => {
      if (!containerRef.value) return false
      try {
        const { ParadeStage } = await import('../lib/three/parade-scene')
        // import 期间可能已被别的路径创建（或已卸载）
        if (stage.value || !containerRef.value) return !!stage.value
        stage.value = new ParadeStage(containerRef.value, {
          onHover: (info) => { hover.value = info },
          onManualUnlocked: () => { emit('manualUnlocked') },
        })
        return true
      } catch (error) {
        webglError.value = true
        console.warn('WebGL init failed:', error)
        return false
      } finally {
        ensuring = null
      }
    })()
  }
  return ensuring
}

async function renderIfReady(): Promise<void> {
  if (!props.result) return
  if (!(await ensureStage())) return
  hover.value = null
  stage.value?.setResult(props.result)
}

onMounted(() => {
  void ensureStage().then(() => renderIfReady())
})

// immediate: HMR/组件重建时 result 引用不变也能重新灌入场景
watch(() => props.result, () => { void renderIfReady() }, { immediate: true })

function replay() {
  hover.value = null
  stage.value?.replay()
}

defineExpose({ replay })

onBeforeUnmount(() => {
  stage.value?.dispose()
  stage.value = null
})
</script>

<template>
  <div class="relative h-full w-full overflow-hidden">
    <div ref="containerRef" class="absolute inset-0" />

    <div
      v-if="webglError"
      class="absolute inset-0 z-10 grid place-items-center px-8 text-center text-sm text-zinc-300"
    >
      <div>
        <p class="mb-2 font-semibold text-red-400">WebGL 不可用</p>
        <p>请检查浏览器是否支持 WebGL，或尝试刷新页面。</p>
      </div>
    </div>

    <!-- Hover Tooltip -->
    <div
      v-if="hover"
      ref="tooltipRef"
      class="pointer-events-none absolute z-20 w-72 -translate-x-1/2 rounded-lg border border-white/15 bg-slate-950/92 p-3 text-xs shadow-2xl backdrop-blur"
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
