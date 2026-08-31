/**
 * Strategy mechanics: convergence early-stop, smart-iterative review parsing,
 * review-failure transparency (L-001), and intake validation of
 * strategy/rounds.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { isConverged, type TurnResult } from '../src/turns.ts'
import { intake } from '../src/intake.ts'
import { inferTaskType, DIMENSIONS } from '../src/strategies/review-dimensions.ts'
import { parseReviewReport, qualityMet, runSmartIterative } from '../src/strategies/smart-iterative.ts'

// L-001: drive runSmartIterative through a FAILED review round without any
// agent services — partial mock keeps isConverged/buildPrompt real.
vi.mock('../src/turns.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/turns.ts')>()
  return { ...actual, executeTurns: vi.fn() }
})

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lt-strategy-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function turn(text: string): TurnResult {
  return { text, usage: null, kind: 'completed' }
}

const TASK = {
  id: 't1',
  prompt: '指令',
  files: [],
  workspace: 'E:/x',
  priority: 1,
  permissionPreset: 'lt-standard',
  status: 'queued',
  createdAt: new Date().toISOString(),
} as const

describe('isConverged', () => {
  test('identical texts converge', () => {
    expect(isConverged(turn('结果 A 结果 A 结果 A 内容足够长'), turn('结果 A 结果 A 结果 A 内容足够长'))).toBe(true)
  })

  test('substantially different texts do not converge', () => {
    expect(isConverged(turn('第一份结果：完成了 A 和 B 与 C 的改造'), turn('第二份结果：完全重写了 D 和 E 并删除了 F 模块'))).toBe(false)
  })

  test('short texts require exact equality', () => {
    expect(isConverged(turn('abc'), turn('abc'))).toBe(true)
    expect(isConverged(turn('abc'), turn('abd'))).toBe(false)
  })

  test('huge outputs stay bounded (bigram cap — no OOM, Kimi review)', () => {
    const big = '结果 ' + 'x'.repeat(2_000_000)
    const a = turn(big)
    const b = turn(big + ' 结尾相同')
    expect(isConverged(a, b)).toBe(true)
  })
})

describe('smart-iterative review parsing', () => {
  test('inferTaskType classifies by keywords (zh + en)', () => {
    expect(inferTaskType('写测试用例')).toBe('test-generation')
    expect(inferTaskType('写 readme 文档')).toBe('doc-generation')
    expect(inferTaskType('重构这个模块')).toBe('refactoring')
    expect(inferTaskType('review 这段代码')).toBe('code-review')
    expect(inferTaskType('帮我总结这段文字')).toBe('general')
    expect(DIMENSIONS[inferTaskType('review 这段代码')].length).toBeGreaterThan(0)
  })

  test('parseReviewReport extracts JSON issues', () => {
    const text = '好的：\n{"issues":[{"dim":"correctness","severity":"high","location":"L12","issue":"空指针","suggestion":"判空"}],"summary":"有一个问题","overallScore":60}'
    const report = parseReviewReport(text)
    expect(report.issues).toHaveLength(1)
    expect(report.issues[0].severity).toBe('high')
    expect(report.issues[0].issue).toBe('空指针')
    expect(report.overallScore).toBe(60)
  })

  test('parseReviewReport degrades on non-JSON output', () => {
    const report = parseReviewReport('我没有发现问题，内容很好。')
    expect(report.issues).toEqual([])
    expect(report.summary).toContain('异常')
  })

  test('qualityMet stops on no high issues and ≤1 medium', () => {
    expect(qualityMet({ issues: [{ severity: 'low' }, { severity: 'medium' }], summary: '', overallScore: 90 })).toBe(true)
    expect(qualityMet({ issues: [{ severity: 'high' }], summary: '', overallScore: 40 })).toBe(false)
    expect(qualityMet({ issues: [{ severity: 'medium' }, { severity: 'medium' }], summary: '', overallScore: 70 })).toBe(false)
  })
})

describe('smart-iterative review failure visibility (L-001)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  test('a failed review round keeps the draft but records the failure in reviewExcerpt', async () => {
    const { executeTurns } = await import('../src/turns.ts')
    const mockExecute = vi.mocked(executeTurns)
    mockExecute
      .mockResolvedValueOnce({
        status: 'done',
        turns: [turn('第一版初稿内容足够长'), turn('生成轮辅助轮')],
        elapsedMs: 10,
      })
      .mockResolvedValueOnce({
        status: 'failed',
        turns: [],
        elapsedMs: 5,
        error: 'review turn crashed: boom',
      })

    const outcome = await runSmartIterative(
      {} as unknown as Context,
      { ...TASK, rounds: 2, strategy: 'iterative' },
      60_000,
    )

    // The draft survives — a failed review must not fail the task…
    expect(outcome.final).toBe('done')
    expect(outcome.turns).toHaveLength(2)
    expect(outcome.roundsRun).toBe(2)
    // …but the report must not pass it off as reviewed.
    expect(outcome.reviewExcerpt).toBeDefined()
    expect(outcome.reviewExcerpt).toContain('审查轮失败')
    expect(outcome.reviewExcerpt).toContain('boom')
    expect(outcome.reviewExcerpt).toContain('未审查')
    // Only the generate round ran; no review/fix follow-ups.
    expect(mockExecute).toHaveBeenCalledTimes(2)
  })
})

describe('intake strategy/rounds', () => {
  test('single forces rounds=1 regardless of input', async () => {
    const dir = tempDir()
    const result = await intake({ prompt: 'x', strategy: 'single', rounds: 4 }, dir)
    expect(result.ok).toBe(true)
    expect(result.task?.strategy).toBe('single')
    expect(result.task?.rounds).toBe(1)
  })

  test('sampling keeps rounds and scales the estimate', async () => {
    const dir = tempDir()
    const single = await intake({ prompt: '测试指令内容', strategy: 'single' }, dir)
    const sampling = await intake({ prompt: '测试指令内容', strategy: 'sampling', rounds: 3 }, dir)
    expect(single.ok && sampling.ok).toBe(true)
    expect(sampling.task?.strategy).toBe('sampling')
    expect(sampling.task?.rounds).toBe(3)
    expect(sampling.task?.estimateYuan).toBeCloseTo((single.task?.estimateYuan ?? 0) * 3, 9)
    expect(sampling.task?.estimateMinutes).toBe((single.task?.estimateMinutes ?? 0) * 3)
  })

  test('rejects rounds beyond the cap', async () => {
    const dir = tempDir()
    const result = await intake({ prompt: 'x', strategy: 'iterative', rounds: 6 }, dir)
    expect(result.ok).toBe(false)
  })
})

describe('intake priority / reasoning / strategyHint (v3.1)', () => {
  test('priority accepts 0 and 9, defaults to 3', async () => {
    const dir = tempDir()
    const urgent = await intake({ prompt: 'x', priority: 0 }, dir)
    const relaxed = await intake({ prompt: 'x', priority: 9 }, dir)
    const plain = await intake({ prompt: 'x' }, dir)
    expect(urgent.task?.priority).toBe(0)
    expect(relaxed.task?.priority).toBe(9)
    expect(plain.task?.priority).toBe(3)
  })

  test('priority rejects 10 and negatives', async () => {
    const dir = tempDir()
    expect((await intake({ prompt: 'x', priority: 10 }, dir)).ok).toBe(false)
    expect((await intake({ prompt: 'x', priority: -1 }, dir)).ok).toBe(false)
  })

  test('reasoning passes through; unknown values rejected', async () => {
    const dir = tempDir()
    const low = await intake({ prompt: 'x', reasoning: 'low' }, dir)
    expect(low.ok).toBe(true)
    expect(low.task?.reasoning).toBe('low')
    const none = await intake({ prompt: 'x', reasoning: 'off' }, dir)
    expect(none.ok).toBe(true)
    expect(none.task?.reasoning).toBe('off')
    // pi-ai adapters expose more effort levels than deepseek — all must pass.
    const medium = await intake({ prompt: 'x', reasoning: 'medium' }, dir)
    expect(medium.ok).toBe(true)
    expect(medium.task?.reasoning).toBe('medium')
    const omitted = await intake({ prompt: 'x' }, dir)
    expect(omitted.ok).toBe(true)
    expect(omitted.task?.reasoning).toBeUndefined()
    expect((await intake({ prompt: 'x', reasoning: 'extreme' }, dir)).ok).toBe(false)
  })

  test('strategyHint capped at 500 chars, trimmed', async () => {
    const dir = tempDir()
    const ok = await intake({ prompt: 'x', strategyHint: '  以苛刻眼光挑毛病  ' }, dir)
    expect(ok.ok).toBe(true)
    expect(ok.task?.strategyHint).toBe('以苛刻眼光挑毛病')
    const tooLong = await intake({ prompt: 'x', strategyHint: '字'.repeat(501) }, dir)
    expect(tooLong.ok).toBe(false)
    const blank = await intake({ prompt: 'x', strategyHint: '   ' }, dir)
    expect(blank.ok).toBe(true)
    expect(blank.task?.strategyHint).toBeUndefined()
  })

  test('review strategy: rounds forced to 1, estimate ×2', async () => {
    const dir = tempDir()
    const single = await intake({ prompt: '测试指令内容', strategy: 'single' }, dir)
    const review = await intake({ prompt: '测试指令内容', strategy: 'review', rounds: 4 }, dir)
    expect(single.ok && review.ok).toBe(true)
    expect(review.task?.strategy).toBe('review')
    expect(review.task?.rounds).toBe(1)
    expect(review.task?.estimateYuan).toBeCloseTo((single.task?.estimateYuan ?? 0) * 2, 9)
    expect(review.task?.estimateMinutes).toBe((single.task?.estimateMinutes ?? 0) * 2)
  })
})
