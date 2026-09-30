import { createAnthropic } from '@ai-sdk/anthropic'
import type { LlmProviderPlugin } from './index'

export const anthropicPlugin: LlmProviderPlugin = {
  name: 'anthropic',
  defaultModels: {
    ranking: 'claude-sonnet-5',
    gate: 'claude-haiku-4-5-20251001',
  },
  defaultBaseUrl: 'https://api.anthropic.com/v1',
  create: ({ apiKey, baseUrl }) =>
    createAnthropic({ baseURL: baseUrl, apiKey }),
}
