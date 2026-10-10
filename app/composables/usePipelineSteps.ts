/**
 * 生成管线三步骤（校验/排行/定稿）的展示状态派生（评审 Duplicated Code：
 * index.vue 与 parade.vue 曾各存一份逐字相同的 PHASES/stateOf/errorPhaseLabel）。
 * 纯派生、无副作用，输入直接吃 useGenerate 的响应式引用。
 */
import { computed } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { GenerationPhase } from '#shared/events'
import type { GenerateStatus, GenerationErrorState } from './useGenerate'

export const PIPELINE_PHASES: ReadonlyArray<{ key: GenerationPhase; label: string }> = [
  { key: 'validating', label: '校验可排行性' },
  { key: 'ranking', label: '检索 · 排行' },
  { key: 'finalizing', label: '数据定稿' },
]

export type StepState = 'done' | 'active' | 'failed' | 'pending'

export function usePipelineSteps(
  status: Ref<GenerateStatus> | ComputedRef<GenerateStatus>,
  phase: Ref<GenerationPhase | null>,
  error: Ref<GenerationErrorState | null>,
) {
  const running = computed(() => status.value === 'running')
  const phaseIndex = computed(() => PIPELINE_PHASES.findIndex((p) => p.key === phase.value))

  function stateOf(stepIndex: number): StepState {
    if (error.value && phase.value) {
      const failedIndex = PIPELINE_PHASES.findIndex((p) => p.key === error.value!.phase)
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

  /** 失败环节中文名：命中三步骤则用其标签，否则回落到 配置/超时/输入 */
  function errorPhaseLabel(): string {
    const key = error.value?.phase
    const hit = PIPELINE_PHASES.find((p) => p.key === key)?.label
    if (hit) return hit
    return key === 'config' ? '服务端配置' : key === 'timeout' ? '超时' : '输入'
  }

  return { running, stateOf, errorPhaseLabel }
}
