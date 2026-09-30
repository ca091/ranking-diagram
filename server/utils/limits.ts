/** 单次生成的成本与时延硬顶（设计共识 Q16/Q20）。 */
export const MAX_SEARCHES = 12
export const MAX_STEPS = 25
export const TOTAL_TIMEOUT_MS = 120_000
export const TAVILY_TIMEOUT_MS = 15_000
export const IMAGE_FETCH_TIMEOUT_MS = 10_000
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024

export const RESULT_CACHE_TTL_MS = 30 * 60 * 1000
export const RESULT_CACHE_MAX = 50
export const IMAGE_CACHE_TTL_MS = 60 * 60 * 1000
export const IMAGE_CACHE_MAX = 200
