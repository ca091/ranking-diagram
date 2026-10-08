// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      title: 'Ranking Stage',
    },
  },
  // 全部密钥走环境变量（NUXT_ 前缀），源码零硬编码。见 .env.example
  /**
   * 这里只是"环境变量声明骨架"（Nuxt 要求先声明才能映射 NUXT_*），不是配置处。
   * 一切实际取值只发生在 .env：provider/apiKey/baseUrl/model 的默认与兜底
   * 统一下沉到 server/utils/llm 注册表（DEFAULT_PROVIDER / 插件 defaultModels / defaultBaseUrl）。
   */
  runtimeConfig: {
    llm: {
      provider: '',
      baseUrl: '',
      apiKey: '',
    },
    /** 留空则用当前 provider 插件的默认模型 */
    modelRanking: '',
    modelGate: '',
    /** 单次生成总超时(ms)；0/留空 = 缺省 120000。推理型模型（如 qwen3.8 带思维链）建议 240000+ */
    llmTimeoutMs: 0,
    tavilyApiKey: '',
    // '1' 时整条管线用内置样例数据，无需任何密钥即可验收前端/动效
    useFixture: '',
    /** [generation-log] 任务级结构化日志开关（NUXT_LOG_GENERATION=0 关闭；见 server/utils/run-log.ts） */
    logGeneration: true,
    /** 思考模式：默认关（qwen3.8-flash 默认开思考，整链时延数倍）；NUXT_LLM_THINKING=1 恢复 */
    llmThinking: false,
  },
})
