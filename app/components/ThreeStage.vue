<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { RankingResult } from '#shared/ranking'
import type { HoverInfo } from '../lib/three/scene'

const props = defineProps<{ result: RankingResult | null }>()

const containerRef = ref<HTMLElement | null>(null)
const stage = shallowRef<Awaited<ReturnType<typeof createStage>> | null>(null)
const hover = ref<HoverInfo | null>(null)
const webglError = ref(false)

const hasData = computed(() => (props.result?.entries.length ?? 0) > 0)

async function createStage(container: HTMLElement) {
  const { RankingStage } = await import('../lib/three/scene')
  return new RankingStage(container, { onHover: (info) => { hover.value = info } })
}

async function ensureStage(): Promise<boolean> {
  if (stage.value) return true
  if (!containerRef.value) return false
  try {
    stage.value = await createStage(containerRef.value)
    return true
  } catch (error) {
    webglError.value = true
    console.warn('WebGL init failed:', error)
    return false
  }
}

watch(
  () => props.result,
  async (result) => {
    if (!result) return
    await nextTick()
    if (await ensureStage()) {
      hover.value = null
      stage.value?.setResult(result)
    }
  },
)

function replay() {
  hover.value = null
  stage.value?.replay()
}

onBeforeUnmount(() => {
  stage.value?.dispose()
  stage.value = null
})
</script>

<template>
  <div class="relative min-h-105 h-full w-full overflow-hidden rounded-xl border border-white/10 bg-[#070a12]">
    <div ref="containerRef" class="absolute inset-0" />

    <div
      v-if="!hasData && !webglError"
      class="pointer-events-none absolute inset-0 grid place-items-center px-8 text-center text-sm text-slate-600"
    >
      输入排行任务并提交 —— 30 位强者将从左到右依次入场，冠军最后压轴
    </div>

    <div
      v-if="webglError"
      class="absolute inset-0 grid place-items-center px-8 text-center text-sm text-amber-400"
    >
      当前浏览器无法初始化 WebGL，3D 舞台不可用
    </div>

    <button
      v-if="hasData && !webglError"
      type="button"
      class="absolute right-3 top-3 z-10 rounded-md border border-white/15 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-300 backdrop-blur transition hover:bg-slate-800/80"
      @click="replay"
    >
      ↻ 重播入场
    </button>

    <div v-if="hasData" class="pointer-events-none absolute bottom-2 left-3 z-10 text-[11px] text-slate-500">
      拖拽旋转 · 滚轮缩放 · 悬停查看详情
    </div>

    <div
      v-if="hover"
      class="pointer-events-none absolute z-20 w-78 max-w-[80vw] -translate-x-1/2 -translate-y-full rounded-lg border border-white/15 bg-slate-950/92 p-3 text-xs shadow-2xl backdrop-blur"
      :style="{ left: `${hover.x}px`, top: `${Math.max(hover.y - 10, 130)}px` }"
    >
      <div class="mb-1 flex items-center gap-2">
        <span class="rounded bg-amber-400/90 px-1.5 py-0.5 font-bold text-slate-950">#{{ hover.entry.rank }}</span>
        <span class="font-semibold text-slate-100">{{ hover.entry.name }}</span>
        <span class="ml-auto tabular-nums text-slate-400">{{ hover.entry.score.toFixed(1) }}</span>
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
          class="block truncate text-sky-400 underline-offset-2 hover:underline"
          @click.stop
        >{{ source.title }}</a>
      </div>
    </div>
  </div>
</template>
