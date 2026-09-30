import type { SseEvent } from '#shared/events'

export type EventListener = (event: SseEvent) => void

export interface Emitter {
  emit: (event: SseEvent) => void
  /** 返回取消订阅函数 */
  on: (listener: EventListener) => () => void
}

/** 极简同步事件总线：管线只 emit，路由负责翻译为 SSE 帧。 */
export function createEmitter(): Emitter {
  const listeners = new Set<EventListener>()
  return {
    emit: (event) => {
      for (const listener of listeners) {
        listener(event)
      }
    },
    on: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
