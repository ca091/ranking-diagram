/** 单次生成的成本与时延硬顶（设计共识 Q16/Q20）。 */
/** 与系统提示「2-4 次批量检索」严格对齐：此前 6 会诱导模型多轮检索，逼近步数顶后无终稿（No output generated） */
export const MAX_SEARCHES = 4
/** 每次模型调用 = 一个 step；prepareStep 会提前收走工具保证有终稿步，这里只作失控保险丝 */
export const MAX_STEPS = 8
/** 缺省总超时；推理型模型可用 NUXT_LLM_TIMEOUT_MS 放宽（见 server/utils/config） */
export const DEFAULT_TOTAL_TIMEOUT_MS = 120_000
export const TAVILY_TIMEOUT_MS = 15_000
export const IMAGE_FETCH_TIMEOUT_MS = 10_000
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024

export const RESULT_CACHE_TTL_MS = 30 * 60 * 1000
export const RESULT_CACHE_MAX = 50
export const IMAGE_CACHE_TTL_MS = 60 * 60 * 1000
export const IMAGE_CACHE_MAX = 200
/** 代理取图失败的负缓存 TTL：短窗口，既灭 404 风暴又给临时故障留恢复余地 */
export const IMAGE_FAIL_CACHE_TTL_MS = 120_000
