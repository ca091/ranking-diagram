import { describe, expect, it } from 'vitest'
import { DEFAULT_PROVIDER, listProviders, makeLlmModel, resolveBaseUrl, resolveModelIds, resolvePlugin } from '../server/utils/llm'
import { checkGenerationConfig, ConfigError, type ServerConfig } from '../server/utils/config'

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    llmProvider: 'anthropic',
    llmBaseUrl: '',
    llmApiKey: 'test-key',
    modelRanking: '',
    modelGate: '',
    tavilyApiKey: 'tavily-key',
    useFixture: false,
    llmTimeoutMs: 0,
    llmThinking: false,
    ...overrides,
  }
}

describe('LLM provider 注册表', () => {
  it('内置 anthropic 与 qwen', () => {
    expect(listProviders()).toEqual(expect.arrayContaining(['anthropic', 'qwen']))
  })

  it('未知 provider 报错并列出可选值', () => {
    expect(() => resolvePlugin('glm')).toThrowError(ConfigError)
    try {
      resolvePlugin('glm')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('anthropic')
      expect(message).toContain('qwen')
    }
  })

  it('provider 留空 = 缺省厂商（默认值只存在于注册表一处）', () => {
    expect(DEFAULT_PROVIDER).toBe('anthropic')
    expect(makeLlmModel(makeConfig({ llmProvider: '' }), 'ranking')).toBeTruthy()
  })

  it('缺 key 时 makeLlmModel 快速失败', () => {
    expect(() => makeLlmModel(makeConfig({ llmApiKey: '' }), 'ranking')).toThrowError('NUXT_LLM_API_KEY')
  })

  it('两个 provider 均能按用途构造模型实例（默认模型解析）', () => {
    expect(makeLlmModel(makeConfig(), 'ranking')).toBeTruthy()
    expect(makeLlmModel(makeConfig(), 'gate')).toBeTruthy()
    expect(makeLlmModel(makeConfig({ llmProvider: 'qwen' }), 'ranking')).toBeTruthy()
    expect(makeLlmModel(makeConfig({ llmProvider: 'qwen', llmBaseUrl: 'https://custom.example/v1' }), 'gate')).toBeTruthy()
  })

  it('defaultBaseUrl 契约：空/纯空白回落到插件默认，显式配置优先（评审：曾是死字段）', () => {
    const qwen = resolvePlugin('qwen')
    expect(resolveBaseUrl('', qwen.defaultBaseUrl)).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(resolveBaseUrl('   ', qwen.defaultBaseUrl)).toBe(qwen.defaultBaseUrl)
    expect(resolveBaseUrl('https://intl.example/v1', qwen.defaultBaseUrl)).toBe('https://intl.example/v1')
    expect(resolvePlugin('anthropic').defaultBaseUrl).toBe('https://api.anthropic.com/v1')
  })

  it('resolveModelIds：留空回落插件默认，显式配置优先；不要求 apiKey（评审：零覆盖）', () => {
    const noKey = { llmApiKey: '' }
    expect(resolveModelIds(makeConfig({ llmProvider: '', ...noKey })))
      .toEqual({ provider: 'anthropic', ranking: 'claude-sonnet-5', gate: 'claude-haiku-4-5-20251001' })
    expect(resolveModelIds(makeConfig({ llmProvider: 'qwen', ...noKey })))
      .toEqual({ provider: 'qwen', ranking: 'qwen3.8-flash', gate: 'qwen3.8-flash' })
    expect(resolveModelIds(makeConfig({ llmProvider: 'qwen', modelRanking: 'custom-x', ...noKey })).ranking)
      .toBe('custom-x')
    expect(() => resolveModelIds(makeConfig({ llmProvider: 'nope', ...noKey }))).toThrowError(ConfigError)
    // makeLlmModel 与 resolveModelIds 同源：解析出的模型名与实际构造一致
    expect(resolveModelIds(makeConfig()).ranking).toBe('claude-sonnet-5')
  })

  it('checkGenerationConfig 校验新变量名', () => {
    expect(checkGenerationConfig(makeConfig({ llmApiKey: '' })).missing).toEqual(['NUXT_LLM_API_KEY'])
    expect(checkGenerationConfig(makeConfig({ tavilyApiKey: '' })).missing).toEqual(['NUXT_TAVILY_API_KEY'])
    // fixture 只豁免 Tavily；LLM key 缺失依然拒绝（fixture 分支在路由里先于本校验短路）
    expect(checkGenerationConfig(makeConfig({ llmApiKey: '', tavilyApiKey: '', useFixture: true })).missing).toEqual(['NUXT_LLM_API_KEY'])
    expect(checkGenerationConfig(makeConfig({ tavilyApiKey: '', useFixture: true })).ok).toBe(true)
    expect(checkGenerationConfig(makeConfig()).ok).toBe(true)
  })
})
