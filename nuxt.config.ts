// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      title: 'Ranking Stage · 排行舞台',
    },
  },
  // 全部密钥走环境变量（NUXT_ 前缀），源码零硬编码。见 .env.example
  runtimeConfig: {
    anthropicBaseUrl: '',
    anthropicApiKey: '',
    modelRanking: 'claude-sonnet-5',
    modelGate: 'claude-haiku-4-5-20251001',
    tavilyApiKey: '',
    // '1' 时整条管线用内置样例数据，无需任何密钥即可验收前端/动效
    useFixture: '',
  },
})
