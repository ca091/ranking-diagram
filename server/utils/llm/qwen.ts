import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LlmProviderPlugin } from './index'

const DOMESTIC_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

/**
 * 千问走 DashScope（阿里云百炼）的 OpenAI 兼容端点。
 * 默认国内站；新加坡站设 NUXT_LLM_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
 * ranking 可升 qwen-max / qwen3-max 换更强推理。
 *
 * 2026-10-08 实测（当前 NUXT_LLM_BASE_URL 端点）：
 * - response_format=json_schema strict:true 被**真实执行**（minItems/maxItems 无视 prompt 强行满足）
 *   → 打开 supportsStructuredOutputs：模型在解码层看到完整结构，不再靠提示词求它守格式；
 * - qwen3.8-flash 默认开思考（reasoning_content 吃输出预算、拖慢整链）
 *   → 默认注入 enable_thinking:false；需要思维链时 NUXT_LLM_THINKING=1。
 */
export const qwenPlugin: LlmProviderPlugin = {
  name: 'qwen',
  defaultModels: {
    ranking: 'qwen3.8-flash',
    gate: 'qwen3.8-flash',
  },
  defaultBaseUrl: DOMESTIC_BASE_URL,
  create: ({ apiKey, baseUrl, thinking }) =>
    createOpenAICompatible({
      name: 'dashscope',
      baseURL: baseUrl,
      apiKey,
      supportsStructuredOutputs: true,
      ...(thinking
        ? {}
        : {
            // transformRequestBody 是 provider 级注入点：业务调用点零改动
            transformRequestBody: (args) => ({ ...args, enable_thinking: false }),
          }),
    }),
}
