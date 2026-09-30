/**
 * LLM Provider 注册表：业务层不感知厂商，只按用途取模型。
 *
 * 扩展新 provider 三步：
 * 1. 新建 ./xxx.ts，导出一个 LlmProviderPlugin（默认模型 + create 工厂）；
 * 2. 在下方 plugins 注册一行；
 * 3. .env.example 的 NUXT_LLM_PROVIDER 注释里补上取值。
 * 任何 createOpenAICompatible 风格的端点（DeepSeek/GLM/Kimi/vLLM…）都适用。
 */
import type { LanguageModel } from 'ai'
import type { ServerConfig } from '../config'
import { ConfigError } from '../config'
import { anthropicPlugin } from './anthropic'
import { qwenPlugin } from './qwen'

/** 给定 modelId 返回可调用的模型实例，AI SDK 各 provider 形状一致。 */
export type ModelFactory = (modelId: string) => LanguageModel

export interface LlmProviderPlugin {
  /** NUXT_LLM_PROVIDER 的取值 */
  name: string
  /** 未显式配置 NUXT_MODEL_RANKING / NUXT_MODEL_GATE 时的兜底模型 */
  defaultModels: { ranking: string; gate: string }
  /** 厂商默认端点；用户配置了 NUXT_LLM_BASE_URL 时以用户为准（兜底解析在 makeLlmModel 统一完成） */
  defaultBaseUrl: string
  create(options: { apiKey: string; baseUrl: string }): ModelFactory
}

const plugins: Record<string, LlmProviderPlugin> = {
  [anthropicPlugin.name]: anthropicPlugin,
  [qwenPlugin.name]: qwenPlugin,
}

/** 未配置 NUXT_LLM_PROVIDER 时的缺省厂商（全项目唯一出现处） */
export const DEFAULT_PROVIDER = anthropicPlugin.name

export function listProviders(): string[] {
  return Object.keys(plugins)
}

export function resolvePlugin(name: string): LlmProviderPlugin {
  const plugin = plugins[name]
  if (!plugin) {
    throw new ConfigError(
      `未知的 NUXT_LLM_PROVIDER="${name}"，可选：${listProviders().join(' | ')}`,
    )
  }
  return plugin
}

export type ModelPurpose = keyof LlmProviderPlugin['defaultModels']

/** 端点解析契约：用户配置（含纯空白视为未配置）优先，否则用插件默认。 */
export function resolveBaseUrl(configured: string, pluginDefault: string): string {
  return configured.trim() || pluginDefault
}

/** 配置 → 模型实例的唯一入口（gate/agent 都用它，保证行为一致）。 */
export function makeLlmModel(config: ServerConfig, purpose: ModelPurpose): LanguageModel {
  const plugin = resolvePlugin(config.llmProvider.trim() || DEFAULT_PROVIDER)
  const apiKey = config.llmApiKey
  if (!apiKey) {
    throw new ConfigError('NUXT_LLM_API_KEY 未配置')
  }
  const factory = plugin.create({
    apiKey,
    baseUrl: resolveBaseUrl(config.llmBaseUrl, plugin.defaultBaseUrl),
  })
  const configured = purpose === 'ranking' ? config.modelRanking : config.modelGate
  return factory(configured.trim() || plugin.defaultModels[purpose])
}
