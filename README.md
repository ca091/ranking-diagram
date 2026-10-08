# Ranking Stage · 排行舞台

输入符合排行语义的 prompt → 联网检索取证 → 生成带来源的数据化排行 → 3D 舞台从左到右逐条入场。

## 管线

1. **Gate**（轻量模型）：校验可排行性 + 规范化请求（条数 clamp 3~50，默认 15）；不合格直接拦截并给改写建议
2. **Ranking agent**（主力模型，Vercel AI SDK）：`web_search` 工具接 Tavily，硬顶搜索 ≤4 次 / 8 步 / 120s（`NUXT_LLM_TIMEOUT_MS` 可调）；结构化输出经 zod + 单调性/去重/连续性校验，机械小错由 `coerceRanking` 确定性整形，修不了的才自动修复 1 次
3. **SSE** 分阶段推送进度（校验 → 检索排行 → 定稿）；结果进内存 TTL/LRU 缓存，"重新生成"可强制绕过

## Provider 配置

**切换模型只需要改 `.env` 一个文件**（`NUXT_` 前缀，见 `.env.example`）。三处相关文件的分工：

| 位置 | 角色 | 你要动它吗 |
| --- | --- | --- |
| `.env` | 实际取值：provider / key / baseUrl / 模型 | ✅ 唯一配置点 |
| `nuxt.config.ts` runtimeConfig | Nuxt 要求的环境变量**声明骨架**（保持空串） | ❌ |
| `server/utils/llm/*.ts` | 厂商**插件**：默认模型/端点/构造器（代码） | 仅新增厂商时 |

| Provider | 默认模型（ranking / gate） | 默认端点 |
| --- | --- | --- |
| `anthropic`（缺省） | claude-sonnet-5 / claude-haiku-4-5-20251001 | api.anthropic.com（可 `NUXT_LLM_BASE_URL` 覆盖走中转） |
| `qwen` | qwen3.8-flash / qwen3.8-flash | DashScope 国内站 compatible-mode |

`NUXT_LLM_PROVIDER` 留空 = anthropic；`NUXT_MODEL_RANKING` / `NUXT_MODEL_GATE` 留空 = 当前 provider 的默认模型。用千问只需三行：`NUXT_LLM_PROVIDER=qwen` + `NUXT_LLM_API_KEY=sk-…` + 重启。

### 扩展新 Provider

注册表在 `server/utils/llm/index.ts`，三步：

1. 新建 `server/utils/llm/<name>.ts`，导出一个 `LlmProviderPlugin`（`name` + `defaultModels` + `defaultBaseUrl` + `create` 工厂）。OpenAI 兼容端点（DeepSeek / GLM / Kimi / vLLM…）直接复用 `createOpenAICompatible`；
2. 在 `index.ts` 的 `plugins` 注册；
3. `.env.example` 的 `NUXT_LLM_PROVIDER` 注释补取值。

`gate.ts` / `agent.ts` 只调 `makeLlmModel(config, 'gate' | 'ranking')`，无需任何改动。

## 头像代理

条目 `avatarUrl` 经 `/api/img?url=` 代理（伪装 Referer、仅放行 image/\*、8MB 上限、逐跳重定向 SSRF 校验、TTL 缓存）；失败降级为首字母+名次色占位。

## 本地开发

```bash
pnpm install
cp .env.example .env   # 填 NUXT_LLM_API_KEY、NUXT_TAVILY_API_KEY

pnpm dev               # 真实管线
NUXT_USE_FIXTURE=1 pnpm dev   # 无密钥演示模式（内置 30 条样例走完整 SSE+动效）

pnpm test              # vitest（管线纯逻辑 + provider 注册表 + 时间线）
pnpm typecheck
```

## 可观测性与排查

每次生成结束时，服务端打**一行结构化日志**（Node stdout）：

```
[generation] {"durationMs":36481,"outcome":"ok","prompt":"…","searches":4,
  "stages":[{"label":"判断可排行性…","durationMs":1268}, …]}
```

- `stages[].durationMs` = 该 stage 事件出现到下一事件的间隔——哪个环节吃掉多少时间一眼可见；
- `outcome`：`ok / reject / error / timeout / incomplete`（客户端中途断开）；
- 开关：`NUXT_LOG_GENERATION=0` 关闭；实现与**剥离方法**（删 1 文件 + 4 处 `[generation-log]` 标记）见 `server/utils/run-log.ts` 头注释。

两个性能相关开关：

- `NUXT_LLM_THINKING`：留空=关闭思考模式（qwen3.8-flash 默认开思考，是整链时延大头）；置 `1` 恢复思维链；
- 修复循环：日志里出现「模型输出不合结构，进入修复…」= 主输出未过 zod 校验走了 1 次修复调用；出现即说明该端点结构化输出保真度在退化，值得留意。

## 测试

`tests/` 覆盖：数量护栏、结构校验（名次连续/分数单调/去重）与确定性整形 `coerceRanking`、gate 归一化与容错 schema、`parseModelJson` 剥围栏、TTL/LRU 缓存、SSRF 守卫、搜索预算、入场时间线、LLM provider 注册表（含 `resolveModelIds`）、终稿守卫（MockLanguageModelV4 闭环）、厂商错误脱敏、任务日志旁路。3D 动效为浏览器人工验收。