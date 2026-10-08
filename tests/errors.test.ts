import { describe, expect, it } from 'vitest'
import { describeLlmError, errorMessage } from '../server/utils/errors'

/** APICallError 的形似结构：provider 抛错时 statusCode + responseBody 就是这么带的。 */
function apiLike(statusCode: number, responseBody: unknown) {
  return Object.assign(new Error(`HTTP ${statusCode}`), { statusCode, responseBody })
}

describe('errorMessage', () => {
  it('Error 取 message，非 Error 字符串化', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
    expect(errorMessage('plain')).toBe('plain')
    expect(errorMessage(null)).toBe('null')
  })
})

describe('describeLlmError 白名单提取 + 脱敏（评审 (b)2 / 标准 #4）', () => {
  it('openai 形：取 error.message', () => {
    const body = JSON.stringify({ error: { message: 'model not found', type: 'invalid_request_error' } })
    expect(describeLlmError(apiLike(400, body))).toBe('HTTP 400：model not found')
  })

  it('中转形：取顶层 code', () => {
    expect(describeLlmError(apiLike(429, JSON.stringify({ code: 'Throttling' }))))
      .toBe('HTTP 429：Throttling')
  })

  it('白名单外字段（如 echo 进来的请求头/keys 数组）不进 UI 文案', () => {
    const body = JSON.stringify({
      headers: { authorization: 'Bearer sk-abcdefghijklmnop' },
      detail: 'internal trace line 1\nline 2',
    })
    const out = describeLlmError(apiLike(400, body))
    expect(out).toBe('HTTP 400')
    expect(out).not.toContain('sk-')
    expect(out).not.toContain('internal')
  })

  it('非 JSON body 也脱敏后截断，不回显密钥', () => {
    const raw = 'quota exhausted for key sk-supersecretvalue123 and token=abcdefghijkl'
    const out = describeLlmError(apiLike(403, raw))
    expect(out).toContain('quota exhausted')
    expect(out).not.toContain('sk-supersecretvalue123')
    expect(out).not.toContain('abcdefghijkl')
  })

  it('message 里夹带密钥的厂商 JSON 同样被打码', () => {
    const body = JSON.stringify({ error: { message: 'bad authorization: Bearer sk-abcdefghij1234' } })
    const out = describeLlmError(apiLike(401, body))
    expect(out).toContain('[redacted]')
    expect(out).not.toContain('sk-abcdefghij1234')
  })

  it('无 statusCode 时退回普通 message（同样脱敏+限长）', () => {
    const err = new Error(`upstream said sk-leakedsecretvalue123456 ${'x'.repeat(300)}`)
    const out = describeLlmError(err)
    expect(out).not.toContain('sk-leakedsecretvalue123456')
    expect(out.length).toBeLessThanOrEqual(200)
  })

  it('statusCode 非整数（外部伪造形）不进厂商分支', () => {
    expect(describeLlmError(apiLike('400' as unknown as number, '{"error":{"message":"x"}}')))
      .toBe('HTTP 400')
  })
})
