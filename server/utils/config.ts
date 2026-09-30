export interface ServerConfig {
  anthropicBaseUrl: string
  anthropicApiKey: string
  modelRanking: string
  modelGate: string
  tavilyApiKey: string
  useFixture: boolean
}

export interface ConfigCheck {
  ok: boolean
  missing: string[]
}

/** 生成所需配置的最小校验：缺 key 就快速失败，绝不静默降级。 */
export function checkGenerationConfig(config: ServerConfig): ConfigCheck {
  const missing: string[] = []
  if (!config.anthropicApiKey) missing.push('NUXT_ANTHROPIC_API_KEY')
  if (!config.tavilyApiKey && !config.useFixture) missing.push('NUXT_TAVILY_API_KEY')
  return { ok: missing.length === 0, missing }
}
