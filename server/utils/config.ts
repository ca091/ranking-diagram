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
