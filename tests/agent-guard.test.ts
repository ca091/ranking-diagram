/**
 * 终稿守卫回归测试（评审 (c)1）：证明 prepareStep 的 activeTools:[] 能在
 * 「模型执意每步都调工具」的场景下强制产出终稿，且守卫不带 toolChoice
 * （toolChoice:'none' 可能解除 anthropic jsonTool 模式的强制调用，跨 provider 有风险）。
 */
import { describe, expect, it } from 'vitest'
import { generateText, isStepCount, Output, tool } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import { finalStepGuard } from '../server/utils/agent'
import { MAX_SEARCHES, MAX_STEPS } from '../server/utils/limits'

const validRanking = {
  title: 'T',
  entries: [{ rank: 1, name: 'a', score: 9, oneLiner: 'x', sources: [{ title: 't', url: 'https://e.com' }] }],
}
const schema = z.object({
  title: z.string(),
  entries: z.array(z.object({
    rank: z.number(),
    name: z.string(),
    score: z.number(),
    oneLiner: z.string(),
    sources: z.array(z.object({ title: z.string(), url: z.string() })),
  })),
})

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, reasoningTokens: 0, cachedInputTokens: 0 }

/** 只要请求里还有用户工具就永远回 tool-call；工具被收走才产出终稿 JSON。 */
function stubbornToolModel() {
  let n = 0
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      n += 1
      const hasTools = (options.tools ?? []).length > 0
      if (hasTools) {
        return {
          content: [{ type: 'tool-call' as const, toolCallId: `tc-${n}`, toolName: 'web_search', input: { query: `q${n}` } }],
          finishReason: 'tool-calls' as const,
          usage,
          warnings: [],
        }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(validRanking) }],
        finishReason: 'stop' as const,
        usage,
        warnings: [],
      }
    },
  })
}

function searchTool() {
  return {
    web_search: tool({
      description: 's',
      inputSchema: z.object({ query: z.string() }),
      execute: async () => ({ ok: true, query: 'x', results: [], pageImages: [] }),
    }),
  }
}

describe('finalStepGuard', () => {
  it('最后一步或搜索预算耗尽 → 收走工具', () => {
    expect(finalStepGuard(MAX_STEPS - 1, 0)).toEqual({ activeTools: [] })
    expect(finalStepGuard(2, MAX_SEARCHES)).toEqual({ activeTools: [] })
  })

  it('预算内的早期步骤 → 不干预', () => {
    expect(finalStepGuard(1, 1)).toEqual({})
    expect(finalStepGuard(MAX_STEPS - 2, MAX_SEARCHES - 1)).toEqual({})
  })

  it('守卫只动 activeTools、绝不设 toolChoice（评审 (c)1）', () => {
    const guard = finalStepGuard(MAX_STEPS, MAX_SEARCHES)
    expect(guard).not.toHaveProperty('toolChoice')
  })
})

describe('守卫下的工具循环闭环', () => {
  it('stubborn 模型 + 守卫：循环必然以终稿结束，末次请求不带用户工具', async () => {
    const model = stubbornToolModel()
    const result = await generateText({
      model,
      prompt: '排行任务',
      tools: searchTool(),
      output: Output.object({ schema }),
      stopWhen: isStepCount(MAX_STEPS),
      prepareStep: ({ stepNumber }) => finalStepGuard(stepNumber, 0),
    })
    expect(result.output).toEqual(validRanking)
    const lastCall = model.doGenerateCalls[model.doGenerateCalls.length - 1]
    expect((lastCall?.tools ?? []).length).toBe(0)
  })

  it('对照组：没有守卫时正是 S5 故障形态——步数耗尽拿不到 output', async () => {
    const model = stubbornToolModel()
    const result = await generateText({
      model,
      prompt: '排行任务',
      tools: searchTool(),
      output: Output.object({ schema }),
      stopWhen: isStepCount(3),
    })
    expect(() => result.output).toThrowError(/No output generated/)
  })
})
