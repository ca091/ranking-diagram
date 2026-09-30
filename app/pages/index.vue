<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { GenerationPhase } from '#shared/events'
import { SAMPLE_PROMPTS } from '../lib/samples'

const { status, phase, stageLabel, searchUsed, payload, rejection, error, generate, cancel } = useGenerate()

interface StageExpose {
  replay: () => void
  refit: () => void
}

const prompt = ref('')
const lastPrompt = ref('')
const uiVisible = ref(true)
/** 入场播放导致的自动隐藏（区别于用户手动按 J，播完只恢复自动隐藏的那次） */
const autoHidden = ref(false)
const stageRef = ref<StageExpose | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const running = computed(() => status.value === 'running')

const PHASES: Array<{ key: GenerationPhase; label: string }> = [
  { key: 'validating', label: '校验可排行性' },
  { key: 'ranking', label: '检索 · 排行' },
  { key: 'finalizing', label: '数据定稿' },
]
const phaseIndex = computed(() => PHASES.findIndex((p) => p.key === phase.value))

function stateOf(stepIndex: number): 'done' | 'active' | 'failed' | 'pending' {
  if (error.value && phase.value) {
    const failedIndex = PHASES.findIndex((p) => p.key === error.value!.phase)
    if (stepIndex === failedIndex) return 'failed'
    if (failedIndex >= 0 && stepIndex < failedIndex) return 'done'
  }
  if (status.value === 'success') return 'done'
  if (!running.value) return 'pending'
  if (phaseIndex.value < 0) return 'pending'
  if (stepIndex < phaseIndex.value) return 'done'
  if (stepIndex === phaseIndex.value) return 'active'
  return 'pending'
}

function errorPhaseLabel(): string {
  const key = error.value?.phase
  return PHASES.find((p) => p.key === key)?.label ?? (key === 'config' ? '服务端配置' : key === 'timeout' ? '超时' : '输入')
}

async function submit(p?: string, force = false) {
  const text = (p ?? prompt.value).trim()
  if (!text || running.value) return
  if (p) prompt.value = p
  lastPrompt.value = text
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

/** F 自适应重居中；J 收起/展开两块浮层（输入中不劫持按键） */
function onGlobalKeydown(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  if (event.key === 'f' || event.key === 'F') {
    event.preventDefault()
    stageRef.value?.refit()
  } else if (event.key === 'j' || event.key === 'J') {
    event.preventDefault()
    uiVisible.value = !uiVisible.value
    // 手动接管后不再被入场流程自动改回
    autoHidden.value = false
  }
}

function onEntering() {
  if (uiVisible.value) {
    uiVisible.value = false
    autoHidden.value = true
  }
}

function onEntered() {
  if (autoHidden.value) {
    uiVisible.value = true
    autoHidden.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <div class="fixed inset-0 overflow-hidden bg-[#04060c] text-slate-200">
    <!-- 全屏 3D 舞台 -->
    <div class="absolute inset-0">
      <ClientOnly>
        <ThreeStage
          ref="stageRef"
          :result="payload?.result ?? null"
          :show-chrome="uiVisible"
          class="h-full w-full"
          @entering="onEntering"
          @entered="onEntered"
        />
        <template #fallback>
          <div class="grid h-full w-full place-items-center text-sm text-slate-700">加载中…</div>
        </template>
      </ClientOnly>
    </div>

    <!-- 四周暗角：让条形与背景图边缘融合、面板可读（月光氛围由背景图自带） -->
    <div
      class="pointer-events-none absolute inset-0 z-5"
      style="background: radial-gradient(95% 95% at 50% 55%, transparent 55%, rgba(1, 2, 4, 0.55) 100%)"
    />

    <Transition name="chrome-fade">
      <!-- 顶部中央：输入框（Enter 提交，无按钮） -->
      <div v-show="uiVisible" class="absolute left-1/2 top-5 z-10 w-[min(500px,90vw)] -translate-x-1/2">
        <div
          class="flex items-end rounded-2xl border border-white/10 bg-white/6 px-4 py-2.5 shadow-[0_8px_40px_rgba(0,0,0,0.7)] backdrop-blur-md transition"
        >
          <textarea
            ref="textareaRef"
            v-model="prompt"
            rows="1"
            :maxlength="500"
            placeholder="例如：海贼王中人物的实力排行，取前30位 —— Enter 生成"
            class="max-h-28 w-full resize-none bg-transparent py-1 text-sm leading-6 text-slate-100 outline-none field-sizing-content"
            @keydown.enter.exact="onEnter"
            @keydown.ctrl.enter.prevent="submit()"
            @keydown.meta.enter.prevent="submit()"
          />
        </div>
      </div>
    </Transition>

    <Transition name="chrome-fade">
      <!-- 左下：生成信息与全部状态 -->
      <aside
        v-show="uiVisible"
        class="absolute bottom-5 left-5 z-10 flex max-h-[calc(100dvh-170px)] w-80 max-w-[92vw] flex-col gap-2 overflow-y-auto rounded-2xl border border-white/10 bg-white/6 p-3 shadow-[0_8px_40px_rgba(0,0,0,0.7)] backdrop-blur-sm"
      >

        <!-- 运行中 -->
        <div v-if="running" class="space-y-1.5">
          <div v-for="(step, index) in PHASES" :key="step.key" class="flex items-center gap-2 text-[13px]">
            <span
              class="grid size-5 place-items-center rounded-full text-[10px] leading-none"
              :class="{
                'bg-zinc-600/25 text-zinc-400': stateOf(index) === 'done',
                'animate-pulse bg-zinc-400/15 text-zinc-200': stateOf(index) === 'active',
                'bg-red-900/50 text-red-400/90': stateOf(index) === 'failed',
                'bg-zinc-800/40 text-zinc-600': stateOf(index) === 'pending',
              }"
            >
              <template v-if="stateOf(index) === 'done'">✓</template>
              <template v-else-if="stateOf(index) === 'failed'">✗</template>
              <template v-else>{{ index + 1 }}</template>
            </span>
            <span :class="stateOf(index) === 'pending' ? 'text-slate-600' : 'text-slate-300'">{{ step.label }}</span>
          </div>
          <p class="text-xs text-zinc-400">
            {{ stageLabel || '准备中…' }}
            <UBadge v-if="searchUsed > 0" color="neutral" variant="subtle" size="xs" class="ml-1">
              检索 {{ searchUsed }}/12
            </UBadge>
          </p>
          <UButton size="xs" color="neutral" variant="outline" @click="cancel">取消</UButton>
        </div>

        <!-- 拒绝 -->
        <div v-if="rejection" class="rounded-lg border border-white/8 bg-white/3 p-2.5">
          <p class="text-sm font-medium text-zinc-200">该请求无法真实排行</p>
          <p class="mt-1 text-sm leading-relaxed text-zinc-400">{{ rejection.reason }}</p>
          <UButton
            v-if="rejection.suggestion"
            size="xs"
            color="secondary"
            variant="soft"
            class="mt-2"
            @click="prompt = rejection.suggestion!; focusPrompt()"
          >
            采用建议：{{ rejection.suggestion }}
          </UButton>
        </div>

        <!-- 错误 -->
        <div v-if="error" class="rounded-lg border border-red-900/40 bg-red-950/25 p-2.5">
          <p class="text-sm font-medium text-red-400/85">失败环节：{{ errorPhaseLabel() }}</p>
          <p class="mt-1 text-sm leading-relaxed text-red-200/50">{{ error.message }}</p>
          <div class="mt-2 flex gap-2">
            <UButton v-if="error?.retryable" size="xs" color="error" variant="soft" @click="submit(lastPrompt)">
              重试
            </UButton>
            <UButton size="xs" color="neutral" variant="outline" @click="focusPrompt">改 prompt</UButton>
          </div>
        </div>

        <!-- 成功 -->
        <div v-if="payload" class="rounded-lg border border-white/8 bg-white/3 p-2.5">
          <p class="text-sm font-medium text-zinc-200">{{ payload.result.title }}</p>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <UBadge color="neutral" variant="subtle">{{ payload.count }} 条</UBadge>
            <UBadge v-if="payload.cached" color="neutral" variant="subtle">缓存回放</UBadge>
            <UBadge v-if="payload.fixture" color="neutral" variant="subtle">fixture 演示数据</UBadge>
            <UBadge v-if="payload.clamped && payload.requestedCount" color="neutral" variant="subtle">
              已截取：{{ payload.requestedCount }} → {{ payload.count }}
            </UBadge>
          </div>
          <div class="mt-2 flex gap-2">
            <UButton size="xs" color="secondary" variant="soft" @click="stageRef?.replay()">↻ 重播入场</UButton>
            <UButton size="xs" color="neutral" variant="outline" @click="submit(lastPrompt, true)">重新生成</UButton>
          </div>
          <p class="mt-2 text-[11px] leading-relaxed text-zinc-500">{{ payload.normalizedPrompt }}</p>
        </div>

        <!-- 空闲：示例引导 -->
        <div v-if="status === 'idle'">
          <p class="mb-2 text-xs uppercase tracking-wider text-zinc-400">试试</p>
          <div class="flex flex-col gap-1.5">
            <UButton
              v-for="sample in SAMPLE_PROMPTS"
              :key="sample"
              size="xs"
              color="neutral"
              variant="ghost"
              class="justify-start text-zinc-300 hover:text-zinc-50"
              @click="submit(sample)"
            >
              {{ sample }}
            </UButton>
          </div>
        </div>

        <p class="mt-auto border-t border-white/5 pt-2 text-[11px] leading-relaxed text-zinc-400">
          Enter 生成 · F 自适应画面 · J 隐藏/显示面板<br>
          拖拽旋转 · 滚轮缩放 · 悬停条目看来源<br>
        </p>
      </aside>
    </Transition>
  </div>
</template>

<style scoped>
.chrome-fade-enter-active,
.chrome-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.chrome-fade-enter-from,
.chrome-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
