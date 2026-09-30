<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { GenerationPhase } from '#shared/events'
import { SAMPLE_PROMPTS } from '../lib/samples'

const { status, phase, stageLabel, searchUsed, payload, rejection, error, generate, cancel } = useGenerate()

const prompt = ref('')
const lastPrompt = ref('')
const textareaRef = ref<{ $el?: HTMLElement } | null>(null)
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

async function submit(p?: string, force = false) {
  const text = (p ?? prompt.value).trim()
  if (!text || running.value) return
  if (p) prompt.value = p
  lastPrompt.value = text
  await generate(text, { force })
}

async function focusPrompt() {
  await nextTick()
  const el = textareaRef.value?.$el?.querySelector('textarea') ?? textareaRef.value?.$el
  ;(el as HTMLTextAreaElement | undefined)?.focus()
}
</script>

<template>
  <div class="min-h-dvh bg-[#05070d] text-slate-200">
    <header class="border-b border-white/5 px-6 py-4">
      <h1 class="text-lg font-semibold tracking-tight">
        Ranking Stage
        <span class="ml-2 text-sm font-normal text-slate-500">联网取证的 3D 排行舞台 · 从左到右，冠军压轴</span>
      </h1>
    </header>

    <main class="mx-auto grid max-w-350 gap-5 p-5 lg:grid-cols-[400px_minmax(0,1fr)]">
      <!-- 左列：输入与状态 -->
      <section class="flex flex-col gap-4 rounded-xl border border-white/10 bg-slate-950/60 p-4">
        <div>
          <UTextarea
            ref="textareaRef"
            v-model="prompt"
            :rows="3"
            :maxlength="500"
            placeholder="例如：海贼王中人物的实力排行，取前30位"
            class="w-full"
            @keydown.ctrl.enter="submit()"
            @keydown.meta.enter="submit()"
          />
          <p class="mt-1 text-right text-[11px] text-slate-600">{{ prompt.length }}/500 · Ctrl/⌘ + Enter 生成</p>
        </div>

        <div class="flex gap-2">
          <UButton
            color="warning"
            variant="solid"
            :loading="running"
            :disabled="!prompt.trim() || running"
            class="flex-1 justify-center"
            @click="submit()"
          >
            {{ running ? '生成中…' : '生成排行' }}
          </UButton>
          <UButton v-if="running" color="neutral" variant="outline" @click="cancel">
            取消
          </UButton>
        </div>

        <div>
          <p class="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">示例</p>
          <div class="flex flex-wrap gap-1.5">
            <UButton
              v-for="sample in SAMPLE_PROMPTS"
              :key="sample"
              size="xs"
              color="neutral"
              variant="subtle"
              :disabled="running"
              @click="submit(sample)"
            >
              {{ sample }}
            </UButton>
          </div>
        </div>

        <!-- 运行中：阶段进度 -->
        <div v-if="running" class="space-y-2 rounded-lg border border-white/5 bg-slate-900/50 p-3">
          <div
            v-for="(step, index) in PHASES"
            :key="step.key"
            class="flex items-center gap-2 text-sm"
          >
            <span
              class="grid size-5 place-items-center rounded-full text-[10px] leading-none"
              :class="{
                'bg-emerald-500/20 text-emerald-400': stateOf(index) === 'done',
                'bg-sky-500/20 text-sky-400 animate-pulse': stateOf(index) === 'active',
                'bg-red-500/20 text-red-400': stateOf(index) === 'failed',
                'bg-slate-700/40 text-slate-500': stateOf(index) === 'pending',
              }"
            >
              <template v-if="stateOf(index) === 'done'">✓</template>
              <template v-else-if="stateOf(index) === 'failed'">✗</template>
              <template v-else>{{ index + 1 }}</template>
            </span>
            <span :class="stateOf(index) === 'pending' ? 'text-slate-600' : 'text-slate-300'">{{ step.label }}</span>
          </div>
          <p class="pt-1 text-xs text-slate-400">
            {{ stageLabel || '准备中…' }}
            <UBadge v-if="searchUsed > 0" color="info" variant="subtle" size="xs" class="ml-1">
              检索 {{ searchUsed }}/12
            </UBadge>
          </p>
        </div>

        <!-- 拒绝 -->
        <div v-if="rejection" class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p class="text-sm font-medium text-amber-300">该请求无法真实排行</p>
          <p class="mt-1 text-sm text-amber-200/80">{{ rejection.reason }}</p>
          <UButton
            v-if="rejection.suggestion"
            size="xs"
            color="warning"
            variant="soft"
            class="mt-2"
            @click="prompt = rejection.suggestion!; focusPrompt()"
          >
            采用建议：{{ rejection.suggestion }}
          </UButton>
        </div>

        <!-- 错误 -->
        <div v-if="error" class="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <p class="text-sm font-medium text-red-300">
            失败环节：{{ PHASES.find((p) => p.key === error?.phase)?.label ?? (error?.phase === 'config' ? '服务端配置' : '输入') }}
          </p>
          <p class="mt-1 text-sm leading-relaxed text-red-200/80">{{ error.message }}</p>
          <div class="mt-2 flex gap-2">
            <UButton v-if="error?.retryable" size="xs" color="error" variant="soft" @click="submit(lastPrompt)">
              重试
            </UButton>
            <UButton size="xs" color="neutral" variant="outline" @click="focusPrompt">改 prompt</UButton>
          </div>
        </div>

        <!-- 成功 -->
        <div v-if="payload" class="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
          <p class="text-sm font-medium text-emerald-300">{{ payload.result.title }}</p>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <UBadge color="success" variant="subtle">{{ payload.count }} 条</UBadge>
            <UBadge v-if="payload.cached" color="info" variant="subtle">缓存回放</UBadge>
            <UBadge v-if="payload.fixture" color="secondary" variant="subtle">fixture 演示数据</UBadge>
            <UBadge v-if="payload.clamped && payload.requestedCount" color="warning" variant="subtle">
              已截取：{{ payload.requestedCount }} → {{ payload.count }}
            </UBadge>
            <UButton size="xs" color="neutral" variant="outline" class="ml-auto" @click="submit(lastPrompt, true)">
              重新生成
            </UButton>
          </div>
          <p class="mt-2 text-[11px] leading-relaxed text-slate-500">{{ payload.normalizedPrompt }}</p>
        </div>

        <p v-if="status === 'idle'" class="text-xs leading-relaxed text-slate-600">
          管线：可排行性校验（拦截无数据支撑的主题）→ 联网检索取证 → 多源聚合定名次。
          单次生成约 30~120s；榜单条目均带来源链接。
        </p>
      </section>

      <!-- 右列：3D 舞台 -->
      <section class="min-h-130 lg:h-auto">
        <ClientOnly>
          <ThreeStage :result="payload?.result ?? null" class="h-full min-h-130" />
          <template #fallback>
            <div class="grid h-full min-h-130 place-items-center rounded-xl border border-white/10 bg-[#070a12] text-sm text-slate-600">
              加载 3D 舞台…
            </div>
          </template>
        </ClientOnly>
      </section>
    </main>
  </div>
</template>
