/**
 * Smart Iterative strategy (Kimi refactor plan §3, corrected):
 *
 *  Round 0 (generate)  → the task prompt, one turn.
 *  Round k (review)    → structured review prompt (per inferred task type),
 *                        strict-JSON issue list; parse with a degraded
 *                        fallback.
 *  Stop when           → no `high` issues and ≤1 `medium` (quality gate),
 *                        OR bigram convergence with the previous round
 *                        (cheap, deterministic), OR `rounds` exhausted.
 *  Round k (fix)       → issue-driven repair prompt (fix listed issues only).
 *
 * Corrections vs the plan: same model throughout (no pro tier), no extra
 * LLM convergence call (the quality gate + bigram cover it), cost is ~2
 * calls per round and is accounted in the intake estimate.
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  buildPrompt,
  executeTurns,
  isConverged,
  sumTurns,
  type TurnResult,
} from '../turns.ts'
import { DIMENSIONS, inferTaskType, type ReviewDimension } from './review-dimensions.ts'
import type { Task, ReasoningEffort, UsageLike } from 'lowtide-core'

export interface ReviewIssue {
  dim?: string
  severity?: string
  location?: string
  issue?: string
  suggestion?: string
}

export interface ReviewReport {
  issues: ReviewIssue[]
  summary: string
  overallScore: number
}

export interface SmartIterativeOutcome {
  final: 'done' | 'failed' | 'timeout' | 'aborted'
  turns: TurnResult[]
  roundsRun: number
  elapsedMs: number
  reviewExcerpt?: string
  /** True when the draft round CONTINUED the requested conversation in place. */
  resumed?: boolean
  /** True when the draft round ran in a NEW session seeded with the source's
   *  full history (fork-style continuation). */
  forked?: boolean
  /** Set when the requested conversation resume failed and a fresh session was used. */
  resumeNote?: string
}

/** Extract the first JSON object from a model answer (degraded on failure).
 *  Tries markdown code blocks first, then uses a depth-limited brace match
 *  to avoid swallowing multiple objects or trailing prose (review fix). */
export function parseReviewReport(text: string): ReviewReport {
  try {
    // 1. Try fenced json code block first (most common model output).
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenced !== null) {
      const candidate = fenced[1].trim()
      if (candidate.startsWith('{')) {
        const parsed = JSON.parse(candidate) as unknown
        return normalizeReport(parsed)
      }
    }
    // 2. Fall back to the first balanced brace object (depth-capped at 3).
    const jsonMatch = extractFirstJsonObject(text)
    if (jsonMatch !== null) {
      const parsed = JSON.parse(jsonMatch) as unknown
      return normalizeReport(parsed)
    }
  } catch {
    /* fall through to the degraded report */
  }
  return { issues: [], summary: '审查输出格式异常，无法解析', overallScore: 50 }
}

/** Walk `text` and return the first substring that starts with '{' and has
 *  balanced braces (depth ≤ 3 to avoid runaway matching on huge outputs). */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  const limit = Math.min(text.length, start + 50_000) // bounded scan
  for (let i = start; i < limit; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
      if (depth < 0) return null // malformed
    }
  }
  return null
}

function normalizeReport(parsed: unknown): ReviewReport {
  const p = parsed as { issues?: unknown; summary?: unknown; overallScore?: unknown }
  const issues = Array.isArray(p.issues)
    ? (p.issues as ReviewIssue[]).filter((i) => i !== null && typeof i === 'object')
    : []
  return {
    issues,
    summary: typeof p.summary === 'string' ? p.summary : '无总结',
    overallScore: typeof p.overallScore === 'number' ? p.overallScore : 50,
  }
}

/** Quality gate: stop when no high-severity issues and ≤1 medium. */
export function qualityMet(report: ReviewReport): boolean {
  const high = report.issues.filter((i) => i.severity === 'high').length
  const medium = report.issues.filter((i) => i.severity === 'medium').length
  return high === 0 && medium <= 1
}

function reviewPromptOf(task: Task, content: string, dimensions: ReviewDimension[]): string {
  const dimList = dimensions.map((d) => `- ${d.name}：${d.prompt}`).join('\n')
  const lens = task.strategyHint !== undefined && task.strategyHint.trim() !== ''
    ? `\n用户特别要求：${task.strategyHint.trim()}`
    : ''
  return `你是严格的质量审查员。请对以下内容做结构化审查。审查维度：\n${dimList}\n\n` +
    `输出严格 JSON（不要 markdown 代码块）：\n` +
    `{"issues":[{"dim":"维度ID","severity":"high|medium|low","location":"位置","issue":"问题描述","suggestion":"修改建议"}],"summary":"总体评价100字内","overallScore":0-100整数}\n` +
    `某一维度没有问题就不输出该维度的条目。${lens}\n\n待审查内容：\n---\n${content.slice(0, 8000)}\n---`
}

function fixPromptOf(content: string, report: ReviewReport): string {
  const issues = report.issues
    .filter((i) => i.severity !== 'low')
    .map((i, idx) => `${idx + 1}. [${i.dim ?? '?'}] ${i.issue ?? ''}\n   建议：${i.suggestion ?? ''}`)
    .join('\n')
  return `请修复以下内容中的问题。只修复列出的问题，不要改变其他部分。\n\n需要修复的问题：\n${issues}\n\n原始内容：\n---\n${content}\n---\n\n请输出修复后的完整内容。`
}

function formatReviewHistory(history: ReviewReport[]): string {
  return history.map((h, i) =>
    `第 ${i + 1} 轮审查（评分 ${h.overallScore}）：${h.summary}\n` +
    h.issues.map((iss) => `- [${iss.severity ?? '?'}] ${iss.dim ?? '?'}: ${iss.issue ?? ''}`).join('\n'),
  ).join('\n\n')
}

/**
 * Smart iterative: generate → review → fix until the quality gate or
 * convergence, capped at `task.rounds` total turns (user-controlled).
 */
export async function runSmartIterative(
  ctx: Context,
  task: Task,
  timeoutMs: number,
  reasoning?: ReasoningEffort,
  /** Session to resume for Round 0 (generate). Subsequent review/fix rounds
   *  always use fresh sessions — only the draft continues the conversation. */
  resumeSessionId?: string,
): Promise<SmartIterativeOutcome> {
  const started = Date.now()
  const rounds = Math.max(task.rounds ?? 1, 1)
  const dimensions = DIMENSIONS[inferTaskType(task.prompt)]
  const prompt = buildPrompt(task)

  // Round 0: generate the draft (resume the original conversation if requested).
  const gen = await executeTurns(ctx, task, (index) => (index === 0 ? prompt : null), timeoutMs, reasoning, resumeSessionId)
  if (gen.status !== 'done' || gen.turns.length === 0) {
    return { final: gen.status, turns: gen.turns, roundsRun: 1, elapsedMs: Date.now() - started, ...(gen.resumed ? { resumed: true } : {}), ...(gen.forked ? { forked: true } : {}), ...(gen.resumeNote !== undefined ? { resumeNote: gen.resumeNote } : {}) }
  }

  const turns: TurnResult[] = [...gen.turns]
  const history: ReviewReport[] = []
  let currentText = gen.turns[0].text
  let final = 'done' as 'done' | 'failed' | 'timeout' | 'aborted'

  for (let round = 1; round < rounds; round++) {
    // Review turn.
    const reviewResult = await executeTurns(
      ctx,
      task,
      (index) => (index === 0 ? reviewPromptOf(task, currentText, dimensions) : null),
      timeoutMs,
      reasoning,
    )
    if (reviewResult.status === 'aborted') {
      // User hit "stop generating" mid-review — stop the whole task, do not
      // pass an unreviewed result off as done.
      final = 'aborted'
      break
    }
    if (reviewResult.status !== 'done' || reviewResult.turns.length === 0) {
      // A failed review does not fail the task — keep the current best, but
      // record the failure VISIBLY so the morning report cannot pass an
      // unreviewed result off as reviewed (post-refactor review L-001).
      history.push({
        issues: [],
        summary: `审查轮失败（${reviewResult.error ?? reviewResult.status}），返回未审查版本`,
        overallScore: 50,
      })
      break
    }
    turns.push(...reviewResult.turns)
    const report = parseReviewReport(reviewResult.turns[0].text)
    history.push(report)

    // Quality gate: no high-severity issues and ≤1 medium → stop.
    if (qualityMet(report)) break

    // Fix turn (issue-driven).
    const beforeFix = currentText
    const fixResult = await executeTurns(
      ctx,
      task,
      (index) => (index === 0 ? fixPromptOf(currentText, report) : null),
      timeoutMs,
      reasoning,
    )
    if (fixResult.status !== 'done' || fixResult.turns.length === 0) {
      final = fixResult.status
      break
    }
    turns.push(...fixResult.turns)
    currentText = fixResult.turns[0].text

    // Bigram convergence: a fix that barely changed the output means the
    // model has nothing left to improve — stop early (cheap, deterministic).
    if (isConverged(
      { text: beforeFix, usage: null, kind: 'completed' },
      { text: currentText, usage: null, kind: 'completed' },
    )) break
  }

  return {
    final,
    turns,
    roundsRun: turns.length,
    elapsedMs: Date.now() - started,
    ...(history.length > 0 ? { reviewExcerpt: formatReviewHistory(history) } : {}),
    ...(gen.resumed ? { resumed: true } : {}),
    ...(gen.forked ? { forked: true } : {}),
    ...(gen.resumeNote !== undefined ? { resumeNote: gen.resumeNote } : {}),
  }
}

/** Usage summed across all turns of a smart-iterative run. */
export function smartUsage(turns: TurnResult[]): UsageLike {
  return sumTurns(turns)
}