import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LlmProviderPlugin } from './index'

const DOMESTIC_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

/**
 * 千问走 DashScope（阿里云百炼）的 OpenAI 兼容端点。
 * 默认国内站；新加坡站设 NUXT_LLM_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
 * ranking 可升 qwen-max / qwen3-max 换更强推理。
 */
export const qwenPlugin: LlmProviderPlugin = {
  name: 'qwen',
  defaultModels: {
    ranking: 'qwen3.8-flash',
    gate: 'qwen3.8-flash',
  },
  defaultBaseUrl: DOMESTIC_BASE_URL,
  create: ({ apiKey, baseUrl }) =>
    createOpenAICompatible({
      name: 'dashscope',
      baseURL: baseUrl,
      apiKey,
    }),
}
