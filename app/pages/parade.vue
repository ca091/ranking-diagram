<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { SAMPLE_PROMPTS } from '../lib/samples'
import { PIPELINE_PHASES, usePipelineSteps } from '../composables/usePipelineSteps'
import type { StepState } from '../composables/usePipelineSteps'
import { MAX_SEARCHES } from '#shared/limits'

const { status, phase, stageLabel, searchUsed, payload, rejection, error, generate, cancel } = useGenerate()

interface StageExpose {
  replay: () => void
}

const prompt = ref('')
const lastPrompt = ref('')
const stageRef = ref<StageExpose | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
/** 自动巡航结束后才显示 W/S 提示 */
const drivingUnlocked = ref(false)

const PHASES = PIPELINE_PHASES
const { running, stateOf, errorPhaseLabel } = usePipelineSteps(status, phase, error)

/** 步骤三态视觉映射（评审 Repeated Switches：三处三元级联收敛成查表） */
const STEP_DOT_CLASS: Record<StepState, string> = {
  done: 'bg-emerald-500/80 text-white',
  active: 'bg-blue-500/80 text-white animate-pulse',
  failed: 'bg-red-500/80 text-white',
  pending: 'bg-zinc-700/50 text-zinc-500',
}
const STEP_LABEL_CLASS: Record<StepState, string> = {
  done: 'text-zinc-300',
  active: 'text-blue-300',
  failed: 'text-zinc-300',
  pending: 'text-zinc-500',
}
const STEP_GLYPH: Record<StepState, string | null> = {
  done: '✓',
  failed: '✗',
  active: null,
  pending: null,
}

async function submit(p?: string, force = false) {
  const text = (p ?? prompt.value).trim()
  if (!text || running.value) return
  if (p) prompt.value = p
  lastPrompt.value = text
  drivingUnlocked.value = false // 新生成会重播巡航，先收起手动提示
  await generate(text, { force })
}

function focusPrompt() {
  void nextTick(() => textareaRef.value?.focus())
}

/** Enter 提交；中文输入法 composing 中的 Enter 是确认候选词，不得触发 */
function onEnter(event: Event) {
  const keyboard = event as KeyboardEvent
  if (keyboard.isComposing) return
  keyboard.preventDefault()
  void submit()
}
</script>

<template>
  <div class="fixed inset-0 overflow-hidden bg-[#05070c]">
    <!-- 3D 场景 -->
    <ClientOnly>
      <ParadeStage
        ref="stageRef"
        :result="payload?.result ?? null"
        @manual-unlocked="drivingUnlocked = true"
      />
    </ClientOnly>

    <!-- 暗角遮罩 -->
    <div class="pointer-events-none absolute inset-0" style="background: radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.4) 100%);" />

    <!-- 顶部输入框 -->
    <div class="absolute left-0 right-0 top-0 z-10 flex justify-center p-6">
      <div class="w-full max-w-2xl">
        <textarea
          ref="textareaRef"
          v-model="prompt"
          placeholder="例如：全球人口最多的城市排行，前 20 —— Enter 生成"
          class="w-full resize-none rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 shadow-lg backdrop-blur focus:border-blue-500/50 focus:outline-none"
          rows="2"
          style="field-sizing: content; min-height: 3rem; max-height: 6rem;"
          @keydown="onEnter"
        />
      </div>
    </div>

    <!-- 操作提示（右上角）：自动巡航结束后才出现 -->
    <div
      v-if="drivingUnlocked"
      class="pointer-events-none absolute right-6 top-24 z-10 rounded-md bg-slate-950/70 px-3 py-1.5 text-xs font-medium text-zinc-400 backdrop-blur"
    >
      W 前进 · S 后退 · 悬停条目看来源
    </div>

    <!-- 左下角信息面板 -->
    <aside
      class="absolute bottom-6 left-6 z-10 w-80 max-w-[calc(100vw-3rem)] rounded-xl border border-white/10 bg-slate-950/80 p-4 text-sm text-zinc-200 shadow-xl backdrop-blur"
    >
      <!-- 生成中 -->
      <template v-if="running">
        <p class="mb-3 font-semibold text-zinc-100">生成中…</p>
        <div class="space-y-2">
          <div v-for="(p, i) in PHASES" :key="p.key" class="flex items-center gap-2">
            <div
              class="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold"
              :class="STEP_DOT_CLASS[stateOf(i)]"
            >
              {{ STEP_GLYPH[stateOf(i)] ?? i + 1 }}
            </div>
            <span :class="STEP_LABEL_CLASS[stateOf(i)]">
              {{ p.label }}
            </span>
          </div>
        </div>
        <div v-if="stageLabel" class="mt-3 text-xs text-zinc-400">
          {{ stageLabel }}
          <span v-if="searchUsed > 0" class="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
            检索 {{ searchUsed }}/{{ MAX_SEARCHES }}
          </span>
        </div>
        <button
          class="mt-3 w-full rounded-lg bg-red-500/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 transition-colors"
          @click="cancel"
        >
          取消
        </button>
      </template>

      <!-- 被拒绝 -->
      <template v-else-if="rejection">
        <p class="mb-2 font-semibold text-red-400">❌ 不可排行</p>
        <p class="mb-3 text-xs text-zinc-300">{{ rejection.reason }}</p>
        <button
          v-if="rejection.suggestion"
          class="w-full rounded-lg bg-blue-500/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
          @click="submit(rejection.suggestion)"
        >
          试试：{{ rejection.suggestion }}
        </button>
      </template>

      <!-- 错误 -->
      <template v-else-if="error">
        <p class="mb-2 font-semibold text-red-400">失败环节：{{ errorPhaseLabel() }}</p>
        <p class="mb-3 text-xs text-zinc-300">{{ error.message }}</p>
        <div class="flex gap-2">
          <button
            class="flex-1 rounded-lg bg-blue-500/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
            @click="submit(lastPrompt, true)"
          >
            重试
          </button>
          <button
            class="flex-1 rounded-lg bg-zinc-700/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-600 transition-colors"
            @click="focusPrompt"
          >
            改 prompt
          </button>
        </div>
      </template>

      <!-- 成功 -->
      <template v-else-if="payload">
        <p class="mb-1 text-base font-bold text-zinc-100">{{ payload.result.title }}</p>
        <p class="mb-3 text-xs text-zinc-400">
          {{ payload.count }} 条
          <span v-if="payload.cached" class="ml-1 rounded bg-emerald-900/50 px-1.5 py-0.5 text-[10px] text-emerald-300">缓存</span>
          <span v-if="payload.fixture" class="ml-1 rounded bg-purple-900/50 px-1.5 py-0.5 text-[10px] text-purple-300">样例</span>
          <span v-if="payload.clamped" class="ml-1 rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] text-amber-300">截取</span>
        </p>
        <div class="flex gap-2">
          <button
            class="flex-1 rounded-lg bg-blue-500/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
            @click="drivingUnlocked = false; stageRef?.replay()"
          >
            回到起点
          </button>
          <button
            class="flex-1 rounded-lg bg-zinc-700/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-600 transition-colors"
            @click="submit(lastPrompt, true)"
          >
            重新生成
          </button>
        </div>
      </template>

      <!-- 空闲 -->
      <template v-else>
        <p class="mb-3 text-sm font-semibold text-zinc-300">试试</p>
        <div class="space-y-1.5">
          <button
            v-for="s in SAMPLE_PROMPTS"
            :key="s"
            class="w-full rounded-lg bg-white/5 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-white/10 transition-colors"
            @click="submit(s)"
          >
            {{ s }}
          </button>
        </div>
      </template>

      <!-- 底部导航 -->
      <div class="mt-4 border-t border-white/5 pt-3 text-[10px] text-zinc-500">
        <NuxtLink to="/" class="inline-block text-blue-400 hover:text-blue-300">
          ← 切换到标准模式
        </NuxtLink>
      </div>
    </aside>
  </div>
</template>
