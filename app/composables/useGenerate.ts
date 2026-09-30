/**
 * /api/generate SSE 客户端：解析 data: 帧 → 驱动状态机。
 * 协议见 #shared/events。
 */
import { ref } from 'vue'
import type { GenerationPhase, ResultPayload, SseEvent } from '#shared/events'

export type GenerateStatus = 'idle' | 'running' | 'success' | 'rejected' | 'error'

export interface GenerationErrorState {
  phase: string
  message: string
  retryable: boolean
}

export function useGenerate() {
  const status = ref<GenerateStatus>('idle')
  const phase = ref<GenerationPhase | null>(null)
  const stageLabel = ref('')
  const searchUsed = ref(0)
  const payload = ref<ResultPayload | null>(null)
  const rejection = ref<{ reason: string; suggestion?: string } | null>(null)
  const error = ref<GenerationErrorState | null>(null)

  let controller: AbortController | null = null

  function reset() {
    status.value = 'idle'
    phase.value = null
    stageLabel.value = ''
    searchUsed.value = 0
    payload.value = null
    rejection.value = null
    error.value = null
  }

  function applyEvent(event: SseEvent) {
    switch (event.type) {
      case 'stage':
        phase.value = event.data.phase
        stageLabel.value = event.data.label
        if (typeof event.data.searchUsed === 'number') searchUsed.value = event.data.searchUsed
        break
      case 'result':
        payload.value = event.data
        status.value = 'success'
        break
      case 'reject':
        rejection.value = { reason: event.data.reason, ...(event.data.suggestion ? { suggestion: event.data.suggestion } : {}) }
        status.value = 'rejected'
        break
      case 'error':
        error.value = { phase: event.data.phase, message: event.data.message, retryable: event.data.retryable }
        status.value = 'error'
        break
      case 'done':
        break
    }
  }

  function handleFrame(frame: string) {
    const dataLine = frame
      .split('\n')
      .find((line) => line.startsWith('data: '))
    if (!dataLine) return
    try {
      applyEvent(JSON.parse(dataLine.slice(6)) as SseEvent)
    } catch {
      // 忽略坏帧：SSE 注释/心跳等
    }
  }

  async function consumeStream(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        handleFrame(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
      }
    }
    if (buffer.trim()) handleFrame(buffer)
  }

  async function generate(prompt: string, options: { force?: boolean } = {}) {
    controller?.abort()
    reset()
    status.value = 'running'
    const own = new AbortController()
    controller = own
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, ...(options.force ? { force: true } : {}) }),
        signal: own.signal,
      })
      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => '')
        applyEvent({
          type: 'error',
          data: {
            phase: 'input',
            message: detail || `请求失败（HTTP ${response.status}）`,
            retryable: true,
          },
        })
        return
      }
      await consumeStream(response.body)
      if (status.value === 'running') {
        applyEvent({
          type: 'error',
          data: { phase: 'ranking', message: '连接中断，未收到排行结果', retryable: true },
        })
      }
    } catch (caught) {
      if (own.signal.aborted) return // 用户主动取消或新任务覆盖
      applyEvent({
        type: 'error',
        data: {
          phase: 'ranking',
          message: caught instanceof Error ? caught.message : '网络错误',
          retryable: true,
        },
      })
    }
  }

  function cancel() {
    controller?.abort()
    if (status.value === 'running') {
      status.value = 'idle'
      stageLabel.value = ''
    }
  }

  return { status, phase, stageLabel, searchUsed, payload, rejection, error, generate, cancel }
}
