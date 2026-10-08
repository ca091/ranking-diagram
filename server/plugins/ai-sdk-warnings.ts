/**
 * AI SDK 告警过滤器。
 *
 * 背景：openai-compatible 端点若未声明 supportsStructuredOutputs，AI SDK 每次调用
 * 都会打一条 responseFormat 不支持的告警（schema 不发往服务端，降级为客户端 zod
 * 校验 + repairOnce 兜底，见 server/utils/agent.ts）。qwen 插件已实测端点执行
 * json_schema 并打开 supportsStructuredOutputs（见 llm/qwen.ts），此告警不再触发；
 * 过滤器保留，兜住其他不支持 json_schema 的兼容端点（DeepSeek/GLM/老中转）。
 *
 * 只吞这一条已知噪音，其余告警（topK 不支持、废弃字段等）仍原样打印。
 */
import type { Warning } from 'ai'

/** 本项目已知且有意接受的告警：兼容端点缺少服务端 schema 强校验。 */
function isExpectedJsonFallback(warning: Warning): boolean {
  return warning.type === 'unsupported' && warning.feature === 'responseFormat'
}

function formatWarning(warning: Warning): string {
  switch (warning.type) {
    case 'unsupported':
      return `The feature "${warning.feature}" is not supported${warning.details ? `. ${warning.details}` : ''}`
    case 'compatibility':
      return `The feature "${warning.feature}" has compatibility notes${warning.details ? `. ${warning.details}` : ''}`
    case 'deprecated':
      return `Deprecated (${warning.setting}): ${warning.message}`
    default:
      return warning.message
  }
}

export default defineNitroPlugin(() => {
  globalThis.AI_SDK_LOG_WARNINGS = ({ warnings, provider, model }) => {
    const rest = warnings.filter((warning) => !isExpectedJsonFallback(warning))
    if (rest.length === 0) return
    const scope = provider && model ? ` (${provider} / ${model})` : ''
    for (const warning of rest) {
      console.warn(`AI SDK Warning${scope}: ${formatWarning(warning)}`)
    }
  }
})
