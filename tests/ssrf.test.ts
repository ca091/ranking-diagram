import { describe, expect, it } from 'vitest'
import { isSafeImageUrl } from '../server/utils/ssrf'

describe('isSafeImageUrl SSRF 守卫', () => {
  it('放行公网 http(s) 图片地址', () => {
    expect(isSafeImageUrl('https://static.wikia.nocookie.net/x/a.png')).toBe(true)
    expect(isSafeImageUrl('http://img.example.com/a.webp')).toBe(true)
  })

  it('拦截非 http(s) 协议与垃圾输入', () => {
    expect(isSafeImageUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeImageUrl('ftp://example.com/a.png')).toBe(false)
    expect(isSafeImageUrl('data:image/png;base64,AAAA')).toBe(false)
    expect(isSafeImageUrl('')).toBe(false)
    expect(isSafeImageUrl(undefined)).toBe(false)
    expect(isSafeImageUrl(123)).toBe(false)
    expect(isSafeImageUrl('not a url')).toBe(false)
  })

  it('拦截内网与元数据地址', () => {
    expect(isSafeImageUrl('http://localhost/a.png')).toBe(false)
    expect(isSafeImageUrl('http://127.0.0.1/a.png')).toBe(false)
    expect(isSafeImageUrl('http://0.0.0.0/a.png')).toBe(false)
    expect(isSafeImageUrl('http://169.254.169.254/latest/meta-data/')).toBe(false)
    expect(isSafeImageUrl('http://10.1.2.3/a.png')).toBe(false)
    expect(isSafeImageUrl('http://192.168.1.1/a.png')).toBe(false)
    expect(isSafeImageUrl('http://172.16.0.1/a.png')).toBe(false)
    expect(isSafeImageUrl('http://172.32.0.1/a.png')).toBe(true) // 私有段之外
    expect(isSafeImageUrl('http://100.64.0.1/a.png')).toBe(false) // CGNAT
  })

  it('拦截内网 IPv6 与凭据注入', () => {
    expect(isSafeImageUrl('http://[::1]/a.png')).toBe(false)
    expect(isSafeImageUrl('http://[fe80::1]/a.png')).toBe(false)
    expect(isSafeImageUrl('http://[fd00::1]/a.png')).toBe(false)
    expect(isSafeImageUrl('http://[::ffff:127.0.0.1]/a.png')).toBe(false)
    expect(isSafeImageUrl('https://user:pass@example.com/a.png')).toBe(false)
    expect(isSafeImageUrl('http://foo.internal/a.png')).toBe(false)
    expect(isSafeImageUrl('http://host.local/a.png')).toBe(false)
  })

  it('拒绝超长 URL', () => {
    expect(isSafeImageUrl(`https://example.com/${'a'.repeat(3000)}`)).toBe(false)
  })
})
