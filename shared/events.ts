/** SSE 事件协议：/api/generate 服务端 ⇄ 客户端的唯一通信契约。 */
import type { RankingResult } from './ranking'

export type GenerationPhase = 'validating' | 'ranking' | 'finalizing'

export interface ResultPayload {
  result: RankingResult
  /** 实际条数 */
  count: number
  /** 用户要求的数量被 clamp（requestedCount > MAX_COUNT） */
  clamped: boolean
  requestedCount: number | null
  cached: boolean
  normalizedPrompt: string
  fixture: boolean
}

export type SseEvent =
  | { type: 'stage'; data: { phase: GenerationPhase; label: string; searchUsed?: number } }
  | { type: 'result'; data: ResultPayload }
  | { type: 'reject'; data: { reason: string; suggestion?: string } }
  | { type: 'error'; data: { phase: GenerationPhase | 'config' | 'input' | 'timeout'; message: string; retryable: boolean } }
  | { type: 'done' }
