export interface ServerConfig {
  /** LLM provider 注册表键（llm/index.ts），如 anthropic | qwen */
  llmProvider: string
  /** 空串 = 用各 provider 插件的 defaultBaseUrl */
  llmBaseUrl: string
  llmApiKey: string
  /** 空串 = 用 provider 插件的默认模型 */
  modelRanking: string
  modelGate: string
  tavilyApiKey: string
  useFixture: boolean
  /** 单次生成总超时；<=0 用 DEFAULT_TOTAL_TIMEOUT_MS。推理型模型建议放宽 */
  llmTimeoutMs: number
  /** 思考模式开关（仅对支持的厂商生效）：qwen 默认关闭以砍掉思维链时延，NUXT_LLM_THINKING=1 恢复 */
  llmThinking: boolean
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export interface ConfigCheck {
  ok: boolean
  missing: string[]
}

/** 生成所需配置的最小校验：缺 key 就快速失败，绝不静默降级。 */
export function checkGenerationConfig(config: ServerConfig): ConfigCheck {
  const missing: string[] = []
  if (!config.llmApiKey) missing.push('NUXT_LLM_API_KEY')
  if (!config.tavilyApiKey && !config.useFixture) missing.push('NUXT_TAVILY_API_KEY')
  return { ok: missing.length === 0, missing }
}
