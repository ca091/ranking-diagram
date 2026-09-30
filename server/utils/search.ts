/**
 * Tavily 联网搜索工具（设计共识 Q19b/Q20）：
 * runner 是可注入 fetch 的纯逻辑（预算计数在此，单测直接打 runner）；
 * tool() 只做 AI SDK 参数桥接。
 */
import { tool } from 'ai'
import { z } from 'zod'
import { MAX_SEARCHES, TAVILY_TIMEOUT_MS } from './limits'

const TAVILY_ENDPOINT = 'https://api.tavily.com/search'

export interface TavilyResultItem {
  title: string
  url: string
  content: string
}

export interface SearchOutcome {
  ok: boolean
  query: string
  error?: string
  results: TavilyResultItem[]
  pageImages: string[]
}

export interface SearchRunnerDeps {
  apiKey: string
  maxSearches?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
  onUse?: (used: number, query: string) => void
}

export interface SearchRunner {
  run: (query: string, wantImages: boolean) => Promise<SearchOutcome>
  usedCount: () => number
}

interface TavilyResponseShape {
  results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>
  images?: unknown
}

export function createSearchRunner(deps: SearchRunnerDeps): SearchRunner {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  const maxSearches = deps.maxSearches ?? MAX_SEARCHES
  const timeoutMs = deps.timeoutMs ?? TAVILY_TIMEOUT_MS
  let used = 0

  const failure = (query: string, error: string): SearchOutcome => ({
    ok: false,
    query,
    error,
    results: [],
    pageImages: [],
  })

  const run = async (rawQuery: string, wantImages: boolean): Promise<SearchOutcome> => {
    const query = rawQuery.trim()
    if (!query) return failure(query, '搜索词不能为空')
    if (used >= maxSearches) {
      return failure(query, `已达单次生成搜索预算上限（${maxSearches} 次），请基于已检索到的资料完成排行`)
    }
    used += 1
    deps.onUse?.(used, query)

    try {
      const response = await fetchImpl(TAVILY_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${deps.apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: 6,
          search_depth: 'basic',
          include_answer: false,
          include_raw_content: false,
          include_images: wantImages,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        return failure(query, `Tavily 返回 HTTP ${response.status}`)
      }
      const data = (await response.json()) as TavilyResponseShape
      const results: TavilyResultItem[] = (data.results ?? [])
        .map((item) => ({
          title: String(item.title ?? '').slice(0, 200),
          url: String(item.url ?? ''),
          content: String(item.content ?? '').slice(0, 600),
        }))
        .filter((item) => item.url.length > 0)
      const pageImages = wantImages && Array.isArray(data.images)
        ? data.images.slice(0, 10).map(String)
        : []
      return { ok: true, query, results, pageImages }
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知搜索错误'
      return failure(query, `搜索失败：${message}`)
    }
  }

  return { run, usedCount: () => used }
}

export function buildSearchTool(runner: SearchRunner) {
  return tool({
    description:
      '联网搜索公开资料用于排行取证。一次查询一个明确问题，优先批量查询整体榜单（如 "One Piece power level tier list"），' +
      '预算有限：先粗排、只对存疑的头部名次补查。需要头像/配图候选时置 wantImages=true。',
    inputSchema: z.object({
      query: z.string().min(1).max(300).describe('完整搜索短语'),
      wantImages: z.boolean().optional().describe('是否同时返回页面图片候选'),
    }),
    execute: async ({ query, wantImages }) => runner.run(query, wantImages ?? false),
  })
}
