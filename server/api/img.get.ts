/**
 * GET /api/img?url=... —— 头像代理（设计共识 Q14/Q26）。
 * 伪装 UA/Referer 绕常见防盗链，仅放行 image/*，限体积、TTL+LRU 缓存。
 * SSRF 守卫复用 ssrf.ts（demo 级：IP 字面量与内网主机名黑名单）。
 */
import { defineEventHandler, getQuery, createError } from 'h3'
import { isSafeImageUrl } from '../utils/ssrf'
import { createTtlCache } from '../utils/cache'
import { IMAGE_CACHE_MAX, IMAGE_CACHE_TTL_MS, IMAGE_FETCH_TIMEOUT_MS, IMAGE_MAX_BYTES } from '../utils/limits'

interface CachedImage {
  body: ArrayBuffer
  contentType: string
}

const imageCache = createTtlCache<CachedImage>({ ttlMs: IMAGE_CACHE_TTL_MS, maxEntries: IMAGE_CACHE_MAX })

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const MAX_REDIRECTS = 5

/**
 * 手动跟随重定向并对每一跳重跑 SSRF 守卫（代码评审发现：redirect:'follow'
 * 会让攻击者公共域名 302 到 169.254.169.254 之类内网目标，绕过入口校验）。
 */
async function fetchWithValidatedRedirects(url: string): Promise<Response> {
  let currentUrl = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(currentUrl, {
      headers: {
        'user-agent': DESKTOP_UA,
        referer: new URL(currentUrl).origin,
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) {
        throw createError({ statusCode: 502, statusMessage: 'redirect without location' })
      }
      let next: string
      try {
        next = new URL(location, currentUrl).toString()
      } catch {
        throw createError({ statusCode: 400, statusMessage: 'invalid redirect target' })
      }
      if (!isSafeImageUrl(next)) {
        throw createError({ statusCode: 400, statusMessage: 'redirect target blocked' })
      }
      currentUrl = next
      continue
    }
    return response
  }
  throw createError({ statusCode: 502, statusMessage: 'too many redirects' })
}

async function readWithCap(response: Response): Promise<ArrayBuffer> {
  if (!response.body) return new ArrayBuffer(0)
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > IMAGE_MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'image too large' })
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    size += value.byteLength
    if (size > IMAGE_MAX_BYTES) {
      await reader.cancel()
      throw createError({ statusCode: 413, statusMessage: 'image too large' })
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged.buffer
}

export default defineEventHandler(async (event) => {
  const raw = getQuery(event).url
  if (!isSafeImageUrl(raw)) {
    throw createError({ statusCode: 400, statusMessage: 'unacceptable image url' })
  }
  const url = raw

  const cached = imageCache.get(url)
  if (cached) {
    return new Response(cached.body, {
      status: 200,
      headers: imageHeaders(cached.contentType, 'public, max-age=3600'),
    })
  }

  let upstream: Response
  try {
    upstream = await fetchWithValidatedRedirects(url)
  } catch (error) {
    if (error instanceof Error && error.name === 'H3Error') throw error
    throw createError({ statusCode: 502, statusMessage: 'upstream fetch failed' })
  }

  if (!upstream.ok) {
    throw createError({ statusCode: 404, statusMessage: `upstream returned ${upstream.status}` })
  }
  const contentType = upstream.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    throw createError({ statusCode: 415, statusMessage: 'not an image' })
  }

  const body = await readWithCap(upstream)
  imageCache.set(url, { body, contentType })
  return new Response(body, { status: 200, headers: imageHeaders(contentType, 'public, max-age=3600') })
})

function imageHeaders(contentType: string, cacheControl: string): HeadersInit {
  return {
    'content-type': contentType,
    'cache-control': cacheControl,
    'access-control-allow-origin': '*',
  }
}
