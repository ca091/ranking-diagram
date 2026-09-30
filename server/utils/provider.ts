import { createAnthropic } from '@ai-sdk/anthropic'
import type { ServerConfig } from './config'

/** 统一构造 Anthropic provider：baseURL 仅在显式配置时传入（保留 SDK 默认端点）。 */
export function makeAnthropic(config: ServerConfig) {
  return createAnthropic({
    ...(config.anthropicBaseUrl ? { baseURL: config.anthropicBaseUrl } : {}),
    apiKey: config.anthropicApiKey,
  })
}
