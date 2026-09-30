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
    tavilyApiKey: '',
    // '1' 时整条管线用内置样例数据，无需任何密钥即可验收前端/动效
    useFixture: '',
  },
})
