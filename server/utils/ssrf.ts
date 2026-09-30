/**
 * /api/img 代理的 URL 安全守卫（SSRF 防线，设计共识 Q14/Q26）。
 * 纯函数。demo 级缓解：协议/凭据/内网主机名/IP 字面量黑名单。
 * 已知残余风险：普通域名 DNS 解析到内网 IP（需 DNS-pin 才能根治，demo 不引入）。
 */

const BLOCKED_SUFFIXES = ['.localhost', '.internal', '.local', '.lan', '.home.arpa']

const PRIVATE_V4_PATTERNS: RegExp[] = [
  /^0\./, // 本机网段
  /^10\./, // 私有 A
  /^127\./, // 回环
  /^169\.254\./, // 链路本地（含云元数据 169.254.169.254）
  /^192\.168\./, // 私有 C
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // 私有 B
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // CGNAT 100.64/10
]

function isPrivateIpv4Literal(host: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false
  return PRIVATE_V4_PATTERNS.some((pattern) => pattern.test(host))
}

/** 图片 URL 几乎不存在合法 IPv6 字面量场景；保守起见全部拒绝（含 [::1]、[::ffff:…] 变体）。 */
function isIpv6Literal(host: string): boolean {
  return host.startsWith('[')
}

export function isSafeImageUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username || url.password) return false

  const host = url.hostname.toLowerCase()
  if (host.length === 0) return false
  if (host === 'localhost') return false
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false
  if (isIpv6Literal(host)) return false
  if (isPrivateIpv4Literal(host)) return false
  return true
}
