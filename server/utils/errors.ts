export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** UI 面向的错误文案最长展示量（服务端完整信息留在日志里）。 */
const BRIEF_LIMIT = 200

/**
 * 厂商错误体是外部数据，可能夹带 key/token（如上游把 Authorization 回显进 message）。
 * 进 UI 前统一脱敏：sk-/Bearer/凭据赋值一律打码。
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._+/=-]{8,}/gi,
  /(api[_-]?key|access[_-]?key|authorization|secret|token)\s*[:=]\s*\S{6,}/gi,
]

function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, '[redacted]'), text)
}

/** 只提取白名单字段为简短文案；不接受任意结构直接 String()。 */
function briefFromBody(body: Record<string, unknown>): string {
  const nested = typeof body.error === 'object' && body.error !== null
    ? body.error as Record<string, unknown>
    : undefined
  const candidates: unknown[] = [
    nested?.message,
    nested?.type,
    typeof body.message === 'string' ? body.message : undefined,
    typeof body.code === 'string' || typeof body.code === 'number' ? String(body.code) : undefined,
    typeof body.error === 'string' ? body.error : undefined,
  ]
  const hit = candidates.find((c): c is string => typeof c === 'string' && c.trim().length > 0)
  return hit ?? ''
}

/**
 * 上游 LLM 调用错误的人读描述：AI SDK 的 APICallError（statusCode + responseBody）
 * 的 message 只有 "Bad Request" 这类干瘪文案，这里把厂商错误体里的白名单字段
 * （message/type/code）解出来、脱敏后截断 200 字符，让 UI 错误卡能自证。
 * 完整原始错误只进服务端日志，不走向用户。
 */
export function describeLlmError(error: unknown): string {
  const err = error as { statusCode?: unknown; responseBody?: unknown } | null
  const status = typeof err?.statusCode === 'number' && Number.isInteger(err.statusCode) ? err.statusCode : null
  if (err && status !== null && typeof err.responseBody === 'string' && err.responseBody.length > 0) {
    let brief = ''
    try {
      const body = JSON.parse(err.responseBody) as unknown
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        brief = briefFromBody(body as Record<string, unknown>)
      }
    } catch {
      // 非 JSON 响应体：仅取纯文本前缀，脱敏后使用
      brief = err.responseBody
    }
    const clean = redactSecrets(brief).slice(0, BRIEF_LIMIT).trim()
    return `HTTP ${status}${clean ? `：${clean}` : ''}`
  }
  return redactSecrets(errorMessage(error)).slice(0, BRIEF_LIMIT)
}
