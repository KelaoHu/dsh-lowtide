/**
 * Lowtide runner (PLAN T1.4 / §7.2 + v2 execution strategies): preflight →
 * unattended execution (single / iterative / sampling) → collection → retry.
 * Built from the spike-1 route A template with all rc.7 findings applied
 * (D4 preset mount, D5 setup shape, D6 message location, turn/end completion
 * signal, no silence event) and the round-1 fixes (B1 crash→failed, B2 empty
 * batch, B4 listener cleanup, B5 gitRef preflight, batch model pinning).
 *
 * Strategy semantics (PLAN v2 §1):
 *  - single:    one turn, like a normal harness prompt;
 *  - iterative: one session, N turns; each later turn reviews and improves
 *               the previous output; early-stop when two consecutive turns
 *               converge (cheap bigram-Jaccard similarity);
 *  - sampling:  N independent fresh sessions of the same prompt; N candidates
 *               are produced at night — the USER picks the best the next
 *               morning (no auto-selection, no synthesis).
 */
import type { Context } from '@deepseek-ai/cordis'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import {
  cost,
  costAtRow,
  hasPriceEntry,
  MAX_ROUNDS,
  OFFICIAL_PEAK_WINDOWS,
  tierFor,
  type CandidateResult,
  type MorningReport,
  type ReasoningEffort,
  type ReportTaskRow,
  type Task,
  type TaskRun,
  type UsageLike,
  type WindowCfg,
} from 'lowtide-core'
import { gitDiffStat, gitRef, gitUntrackedFiles } from './git.ts'
import { LowtideStore, snapshotFile } from './store.ts'
import { buildPrompt, executeTurns, resolveBatchModel, sleep, sumTurns, sumUsage, type NextMessage, type TurnResult } from './turns.ts'
import { runSmartIterative } from './strategies/smart-iterative.ts'

const RETRY_DELAY_MS = 30_000
const RETRY_MAX = 1
/** Sampling candidate excerpt cap — enough to judge, keeps the state file sane.
 *  Reads from config.batch.candidateExcerptChars when present, otherwise 4000. */
function candidateExcerptChars(store: LowtideStore): number {
  const cfg = (store.config.batch as { candidateExcerptChars?: number }).candidateExcerptChars
  return typeof cfg === 'number' && cfg > 0 ? cfg : 4000
}

// ── Strategy execution primitives ──────────────────────────────────────────

/** Review-mode second-opinion prompt: critique, never rewrite. */
function reviewPromptOf(instruction: string, resultText: string, hint: string | undefined): string {
  const lens = hint !== undefined && hint.trim() !== ''
    ? `\n用户特别要求：${hint.trim()}`
    : ''
  return `以下是刚完成的任务结果。请以挑剔的第二视角审查它：指出事实错误、逻辑漏洞、遗漏与可改进之处，并给出具体建议。不要重写结果。\n\n` +
    `任务指令：${instruction.slice(0, 1000)}\n\n执行结果：\n${resultText.slice(0, 4000)}${lens}`
}

/** Price table from the store (undefined = official defaults; tierFor falls back). */
type PriceTable = Record<string, { peak: { input: number; inputCached: number; output: number }; off: { input: number; inputCached: number; output: number } }>

function priceTableOf(store: LowtideStore): PriceTable | undefined {
  return store.config.prices && Object.keys(store.config.prices).length > 0
    ? store.config.prices as PriceTable
    : undefined
}

function costOf(usage: UsageLike, modelId: string, windows: WindowCfg[], prices: PriceTable | undefined): number {
  // Unknown-price models (non-deepseek providers) are NOT costed — the UI
  // shows "价格未知" instead of a made-up flash-tier number.
  if (!hasPriceEntry(modelId, prices)) return 0
  return prices === undefined ? cost(usage, modelId, new Date(), windows) : cost(usage, modelId, new Date(), windows, prices)
}

/** Hypothetical peak-hour cost of a usage — the "what you saved" baseline.
 *  Only models with a real price entry (official table incl.
 *  deepseek-v4-flash-vision-exp, or a user price override) get a baseline;
 *  anything else yields 0 so no fake savings are ever reported. */
export function peakCostOf(usage: UsageLike, modelId: string, prices: PriceTable | undefined): number {
  if (!hasPriceEntry(modelId, prices)) return 0
  return costAtRow(usage, tierFor(modelId, prices).peak)
}

interface StrategyOutcome {
  final: 'done' | 'failed' | 'timeout' | 'aborted'
  elapsedMs: number
  costYuan: number
  usage?: UsageLike
  peakYuan: number
  error?: string
  assistantExcerpt?: string
  roundsRun: number
  candidates?: CandidateResult[]
  reviewExcerpt?: string
  /** True when the run CONTINUED the requested conversation in place. */
  resumed?: boolean
  /** True when the run ran in a NEW session seeded with the source's full
   *  history (fork-style continuation). */
  forked?: boolean
  /** Set when the requested conversation resume failed and a fresh session was used. */
  resumeNote?: string
}

/** Retrying a quota/balance rejection is pointless (and costly): the account
 *  state cannot change inside one batch. Matches deepseek's 402 payload. */
export function isQuotaError(error: string | undefined): boolean {
  if (error === undefined) return false
  return /402|insufficient[_ ]?balance|quota/i.test(error)
}

/** Run the task's configured strategy once (no retry). */
async function executeStrategy(ctx: Context, store: LowtideStore, task: Task, timeoutMs: number): Promise<StrategyOutcome> {
  const strategy = task.strategy ?? 'single'
  const reasoning = task.reasoning
  const rounds = strategy === 'single' || strategy === 'review' ? 1 : Math.min(Math.max(task.rounds ?? 1, 1), MAX_ROUNDS)
  // Continuation: sampling produces N independent candidates — no single
  // conversation to resume, so it never carries continuesFromSession.
  const resumeSessionId = strategy === 'sampling' ? undefined : task.continuesFromSession
  const prompt = buildPrompt(task)
  const started = Date.now()
  // Tracks whether the requested conversation resume failed anywhere in this
  // run (falls back to a fresh session); surfaced to the UI so a silent
  // context loss can never pass unnoticed.
  let resumeNote: string | undefined
  // Tracks whether the run genuinely CONTINUED the requested conversation.
  let resumed = false
  // Tracks whether the run ran in a fork-style continuation session.
  let forked = false
  const windows = store.config.windows.length > 0 ? store.config.windows : OFFICIAL_PEAK_WINDOWS
  const prices = priceTableOf(store)
  const modelId = resolveBatchModel(ctx.agentDefaultModel.currentSelection(), reasoning, task.model, task.modelProvider).model

  // Sampling: N independent fresh sessions; produce candidates ONLY — the
  // user picks the best the next morning (no selection turn, no synthesis).
  if (strategy === 'sampling') {
    const candidates: CandidateResult[] = []
    let totalUsage: UsageLike = { input: 0, output: 0, cacheRead: 0 }
    let lastError: string | undefined
    for (let k = 0; k < rounds; k++) {
      const res = await executeTurns(ctx, task, (index) => (index === 0 ? prompt : null), timeoutMs, reasoning, resumeSessionId)
      if (res.resumeNote !== undefined) resumeNote = res.resumeNote
      if (res.resumed) resumed = true
      if (res.forked) forked = true
      // A user hitting "stop generating" aborts the whole sampling run — no
      // point producing candidates the user walked away from.
      if (res.status === 'aborted') {
        return {
          final: 'aborted',
          elapsedMs: res.elapsedMs,
          costYuan: 0,
          peakYuan: 0,
          error: res.error ?? '用户停止了生成',
          roundsRun: k + 1,
          ...(resumeNote !== undefined ? { resumeNote } : {}),
          ...(resumed ? { resumed: true } : {}),
          ...(forked ? { forked: true } : {}),
        }
      }
      if (res.status === 'done' && res.turns.length > 0) {
        const turn = res.turns[0]
        const usage = turn.usage ?? { input: 0, output: 0, cacheRead: 0 }
        totalUsage = sumUsage(totalUsage, usage)
        candidates.push({
          excerpt: turn.text.slice(0, candidateExcerptChars(store)),
          costYuan: Number(costOf(usage, modelId, windows, prices).toFixed(6)),
          elapsedMs: res.elapsedMs,
        })
      } else {
        lastError = res.error ?? 'round failed'
      }
    }
    if (candidates.length === 0) {
      return {
        final: 'failed',
        elapsedMs: Date.now() - started,
        costYuan: 0,
        peakYuan: 0,
        error: lastError ?? 'all sampling rounds failed',
        roundsRun: rounds,
        ...(resumeNote !== undefined ? { resumeNote } : {}),
        ...(resumed ? { resumed: true } : {}),
      ...(forked ? { forked: true } : {}),
      }
    }
    return {
      final: 'done',
      elapsedMs: Date.now() - started,
      costYuan: Number(costOf(totalUsage, modelId, windows, prices).toFixed(6)),
      usage: totalUsage,
      peakYuan: Number(peakCostOf(totalUsage, modelId, prices).toFixed(6)),
      roundsRun: rounds,
      candidates,
      assistantExcerpt: candidates[0].excerpt.slice(0, 200),
      ...(resumeNote !== undefined ? { resumeNote } : {}),
      ...(resumed ? { resumed: true } : {}),
      ...(forked ? { forked: true } : {}),
    }
  }

  // Review: one execution, then ONE independent fresh session critiques the
  // result (second opinion). A failed review does not fail the task — the
  // excerpt records what happened.
  if (strategy === 'review') {
    const res = await executeTurns(ctx, task, (index) => (index === 0 ? prompt : null), timeoutMs, reasoning, resumeSessionId)
    if (res.resumeNote !== undefined) resumeNote = res.resumeNote
    if (res.status !== 'done') {
      return {
        final: res.status,
        elapsedMs: res.elapsedMs,
        costYuan: 0,
        peakYuan: 0,
        ...(res.error !== undefined ? { error: res.error } : {}),
        roundsRun: 1,
        ...(resumeNote !== undefined ? { resumeNote } : {}),
        ...(resumed ? { resumed: true } : {}),
      ...(forked ? { forked: true } : {}),
      }
    }
    const resultText = res.turns[0]?.text ?? ''
    const reviewPrompt = reviewPromptOf(task.prompt, resultText, task.strategyHint)
    const rev = await executeTurns(ctx, task, (index) => (index === 0 ? reviewPrompt : null), timeoutMs, reasoning, resumeSessionId)
    if (rev.resumeNote !== undefined) resumeNote = rev.resumeNote
    if (rev.resumed) resumed = true
    if (rev.forked) forked = true
    const totalUsage = sumUsage(sumTurns(res.turns), sumTurns(rev.turns))
    const reviewExcerpt = rev.status === 'done' && rev.turns.length > 0
      ? rev.turns[0].text.slice(0, 2000)
      : `（审查未完成：${rev.error ?? 'review turn failed'}）`
    return {
      final: 'done',
      elapsedMs: res.elapsedMs + rev.elapsedMs,
      costYuan: Number(costOf(totalUsage, modelId, windows, prices).toFixed(6)),
      usage: totalUsage,
      peakYuan: Number(peakCostOf(totalUsage, modelId, prices).toFixed(6)),
      roundsRun: 1,
      assistantExcerpt: resultText.slice(0, 200),
      reviewExcerpt,
      ...(resumeNote !== undefined ? { resumeNote } : {}),
      ...(resumed ? { resumed: true } : {}),
      ...(forked ? { forked: true } : {}),
    }
  }

  // iterative → Smart Iterative (structured dimension review + issue-driven
  // fix; see strategies/smart-iterative.ts).
  if (strategy === 'iterative') {
    const smart = await runSmartIterative(ctx, task, timeoutMs, reasoning, resumeSessionId)
    if (smart.resumeNote !== undefined) resumeNote = smart.resumeNote
    if (smart.resumed) resumed = true
    if (smart.forked) forked = true
    const totalUsage = sumTurns(smart.turns)
    const lastText = smart.turns.length > 0 ? smart.turns[smart.turns.length - 1].text : ''
    return {
      final: smart.final,
      elapsedMs: smart.elapsedMs,
      costYuan: Number(costOf(totalUsage, modelId, windows, prices).toFixed(6)),
      ...(smart.turns.length > 0 ? { usage: totalUsage } : {}),
      peakYuan: Number(peakCostOf(totalUsage, modelId, prices).toFixed(6)),
      ...(lastText !== '' ? { assistantExcerpt: lastText.slice(0, 200) } : {}),
      ...(smart.reviewExcerpt !== undefined ? { reviewExcerpt: smart.reviewExcerpt } : {}),
      roundsRun: smart.roundsRun,
      ...(resumeNote !== undefined ? { resumeNote } : {}),
      ...(resumed ? { resumed: true } : {}),
      ...(forked ? { forked: true } : {}),
    }
  }

  // single
  const next: NextMessage = (index) => (index === 0 ? prompt : null)
  const res = await executeTurns(ctx, task, next, timeoutMs, reasoning, resumeSessionId)
  if (res.resumeNote !== undefined) resumeNote = res.resumeNote
  const totalUsage = sumTurns(res.turns)
  const finalText = res.turns.length > 0 ? res.turns[res.turns.length - 1].text : ''
  return {
    final: res.status,
    elapsedMs: res.elapsedMs,
    costYuan: Number(costOf(totalUsage, modelId, windows, prices).toFixed(6)),
    ...(res.turns.length > 0 ? { usage: totalUsage } : {}),
    peakYuan: Number(peakCostOf(totalUsage, modelId, prices).toFixed(6)),
    ...(res.error !== undefined ? { error: res.error } : {}),
    ...(res.turns.length > 0 ? { assistantExcerpt: finalText.slice(0, 200) } : {}),
    roundsRun: res.turns.length,
    ...(resumeNote !== undefined ? { resumeNote } : {}),
    ...(resumed ? { resumed: true } : {}),
      ...(forked ? { forked: true } : {}),
  }
}

interface Preflight {
  ok: boolean
  status?: 'stale' | 'deferred'
  note?: string
}

/**
 * Preflight four steps (PLAN §7.2): ① snapshot ② cwd ③ window fit ④ budget.
 * ① includes the gitRef HEAD check (review round 1, B5): a moved HEAD makes
 * the task stale — "上下文过期不盲跑" must cover git state too.
 */
async function preflight(ctx: Context, store: LowtideStore, task: Task, windowEndAt: Date): Promise<Preflight> {
  // ① snapshot: every recorded file must still match sha256+size.
  for (const file of task.files) {
    if (!existsSync(file.path)) return { ok: false, status: 'stale', note: `文件缺失: ${file.path}` }
    if (file.sha256 !== undefined) {
      try {
        const snap = await snapshotFile(file.path)
        if (snap.sha256 !== file.sha256 || (file.size !== undefined && snap.size !== file.size)) {
          return { ok: false, status: 'stale', note: `文件已变化: ${basename(file.path)}` }
        }
      } catch (error) {
        return { ok: false, status: 'stale', note: `文件不可读: ${file.path}` }
      }
    }
  }

  // ② cwd must exist.
  if (!existsSync(task.workspace)) {
    return { ok: false, status: 'stale', note: `工作区不存在: ${task.workspace}` }
  }

  // ②b git HEAD must still match the snapshot (best-effort: a non-git
  // workspace now yields null and is treated as unchanged — the snapshot
  // only recorded a ref when one existed at intake).
  if (task.gitRef !== undefined) {
    const current = await gitRef(task.workspace)
    if (current !== null && current.sha !== task.gitRef.sha) {
      return { ok: false, status: 'stale', note: `git HEAD 已变化: ${task.gitRef.sha} → ${current.sha}` }
    }
  }

  // ③ window fit: estimated duration must fit the remaining off-peak time.
  const now = new Date()
  const remainingMs = windowEndAt.getTime() - now.getTime()
  const estMs = (task.estimateMinutes ?? 30) * 60_000
  if (remainingMs > 0 && estMs > remainingMs) {
    return { ok: false, status: 'deferred', note: `预估 ${task.estimateMinutes ?? 30}min 超出剩余窗口，顺延下一窗口` }
  }

  // ④ budget: daily cap defers the task (MVP policy; knobs land in T2.7).
  const budget = store.config.budgetDailyYuan
  if (budget > 0) {
    const spent = store.ledgerToday(now).yuan
    if (spent + (task.estimateYuan ?? 0) > budget) {
      return { ok: false, status: 'deferred', note: `今日预算将超限（已花 ¥${spent.toFixed(2)} / 上限 ¥${budget.toFixed(2)}）` }
    }
  }

  return { ok: true }
}

/** Result of running one task through the batch pipeline. */
export interface RunTaskResult {
  row: ReportTaskRow
  /** This task's peak-price counterfactual savings (0 when skipped). */
  savedYuan: number
  /** Preflight skipped the task (stale / deferred) — excluded from the report list. */
  skipped: boolean
  /** Preflight deferred it (window fit / budget) — counts toward deferredCount. */
  deferred: boolean
}

/** Run one task through preflight + strategy execution + one retry. */
export async function runTask(ctx: Context, store: LowtideStore, task: Task, windowEndAt: Date): Promise<RunTaskResult> {
  // The queue is a snapshot: the task may have been deleted/triaged while we
  // waited. Never execute a task that is no longer queued (Kimi review H4).
  const live = store.taskById(task.id)
  if (live === undefined || live.status !== 'queued') {
    return {
      row: { taskId: task.id, prompt: task.prompt, workspace: task.workspace, status: 'stale', error: '任务已不在队列中，跳过执行' },
      savedYuan: 0,
      skipped: true,
      deferred: false,
    }
  }
  const current = live

  const check = await preflight(ctx, store, current, windowEndAt)
  if (!check.ok) {
    if (check.status === 'stale') {
      store.setStatus(current.id, 'stale', { lastError: check.note })
      return {
        row: { taskId: current.id, prompt: current.prompt, workspace: current.workspace, status: 'stale', error: check.note },
        savedYuan: 0,
        skipped: true,
        deferred: false,
      }
    }
    // deferred: count the deferral; recoverDeferred() re-queues it next window.
    store.setStatus(current.id, 'deferred', {
      lastError: check.note,
      deferCount: (current.deferCount ?? 0) + 1,
    })
    return {
      row: { taskId: current.id, prompt: current.prompt, workspace: current.workspace, status: 'failed', error: check.note },
      savedYuan: 0,
      skipped: true,
      deferred: true,
    }
  }

  store.setStatus(current.id, 'running')
  let result: StrategyOutcome
  try {
    // 单任务每轮超时由配置 batch.maxDurationMin 控制(分钟),未配置时回退 20 分钟硬编码。
    const timeoutMs = Math.max(store.config.batch.maxDurationMin || 20, 1) * 60_000
    result = await executeStrategy(ctx, store, current, timeoutMs)
  } catch (error) {
    // B1: a crashed attempt is a FAILURE, not a requeue — requeueing here
    // would re-run the task every 30s tick inside the window (crash loop).
    console.error(`[lowtide] attempt crashed for ${current.id}:`, error)
    store.setStatus(current.id, 'failed', { lastError: `执行崩溃：${error instanceof Error ? error.message : String(error)}` })
    return {
      row: {
        taskId: current.id,
        prompt: current.prompt,
        workspace: current.workspace,
        status: 'failed',
        error: `attempt crashed: ${error instanceof Error ? error.message : String(error)}`,
      },
      savedYuan: 0,
      skipped: false,
      deferred: false,
    }
  }
  let retries = 0
  // No retry when the user deliberately stopped generation (aborted), nor on
  // quota/balance rejections (the account state cannot change mid-batch).
  while (result.final !== 'done' && result.final !== 'aborted' && !isQuotaError(result.error) && retries < RETRY_MAX) {
    retries += 1
    // Re-read before retrying: the user may have deleted the task or changed
    // its config during the retry delay — never spend another LLM call on it.
    const retryTask = store.taskById(current.id)
    if (retryTask === undefined || retryTask.status !== 'running') break
    // Re-run preflight: the window may have ended or the budget may have
    // been exhausted while we slept — retrying blindly wastes money (review).
    const retryCheck = await preflight(ctx, store, retryTask, windowEndAt)
    if (!retryCheck.ok) {
      ctx.logger('lowtide').info('task %s retry preflight failed (%s) — aborting retry', current.id, retryCheck.status)
      if (retryCheck.status === 'stale') {
        store.setStatus(current.id, 'stale', { lastError: retryCheck.note })
        result = { final: 'failed', elapsedMs: 0, costYuan: 0, peakYuan: 0, error: retryCheck.note, roundsRun: 0, ...(result.resumeNote !== undefined ? { resumeNote: result.resumeNote } : {}), ...(result.resumed ? { resumed: true } : {}), ...(result.forked ? { forked: true } : {}) }
      } else {
        store.setStatus(current.id, 'deferred', {
          lastError: retryCheck.note,
          deferCount: (retryTask.deferCount ?? 0) + 1,
        })
        result = { final: 'failed', elapsedMs: 0, costYuan: 0, peakYuan: 0, error: retryCheck.note, roundsRun: 0, ...(result.resumeNote !== undefined ? { resumeNote: result.resumeNote } : {}), ...(result.resumed ? { resumed: true } : {}), ...(result.forked ? { forked: true } : {}) }
      }
      break
    }
    ctx.logger('lowtide').info('task %s failed (%s) — retry %d/%d', current.id, result.final, retries, RETRY_MAX)
    await sleep(RETRY_DELAY_MS)
    try {
      result = await executeStrategy(ctx, store, retryTask, Math.max(store.config.batch.maxDurationMin || 20, 1) * 60_000)
    } catch (error) {
      console.error(`[lowtide] retry attempt crashed for ${current.id}:`, error)
      result = {
        final: 'failed',
        elapsedMs: 0,
        costYuan: 0,
        peakYuan: 0,
        error: `attempt crashed: ${error instanceof Error ? error.message : String(error)}`,
        roundsRun: 0,
        ...(result.resumeNote !== undefined ? { resumeNote: result.resumeNote } : {}),
        ...(result.resumed ? { resumed: true } : {}),
        ...(result.forked ? { forked: true } : {}),
      }
    }
  }

  // Workspace evidence captured once, AFTER the whole strategy (the working
  // tree has evolved through all rounds).
  const diffStat = await gitDiffStat(task.workspace)
  const untracked = await gitUntrackedFiles(task.workspace)

  const run: TaskRun = {
    at: new Date().toISOString(),
    // 'aborted' is a deliberate user stop — persist it as a failed run so the
    // task/report states stay within the documented vocabulary.
    status: result.final === 'aborted' ? 'failed' : result.final,
    elapsedMs: result.elapsedMs,
    costYuan: result.costYuan,
    ...(result.usage !== undefined ? { usage: result.usage } : {}),
    diffStat,
    untracked,
    ...(result.error !== undefined ? { error: result.error } : {}),
    ...(result.assistantExcerpt !== undefined ? { assistantExcerpt: result.assistantExcerpt } : {}),
    strategy: task.strategy ?? 'single',
    roundsRun: result.roundsRun,
    ...(result.candidates !== undefined ? { candidates: result.candidates } : {}),
    ...(result.reviewExcerpt !== undefined ? { reviewExcerpt: result.reviewExcerpt } : {}),
    ...(result.resumeNote !== undefined ? { resumeNote: result.resumeNote } : {}),
    ...(result.resumed ? { resumed: true } : {}),
        ...(result.forked ? { forked: true } : {}),
  }

  store.recordRun(task.id, run, result.final === 'aborted' ? 'failed' : result.final)
  const saved = Math.max(0, result.peakYuan - result.costYuan)
  store.addSavings(saved)
  return {
    row: {
      taskId: task.id,
      prompt: task.prompt,
      workspace: task.workspace,
      status: result.final === 'aborted' ? 'failed' : result.final,
      costYuan: run.costYuan,
      elapsedMs: run.elapsedMs,
      diffStat: run.diffStat ?? null,
      ...(run.error !== undefined ? { error: run.error } : {}),
      strategy: task.strategy ?? 'single',
      roundsRun: run.roundsRun,
      ...(run.candidates !== undefined ? { candidates: run.candidates } : {}),
      ...(run.reviewExcerpt !== undefined ? { reviewExcerpt: run.reviewExcerpt } : {}),
    },
    savedYuan: saved,
    skipped: false,
    deferred: false,
  }
}

/** Local calendar date (the report belongs to the day the batch finished). */
function localDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/**
 * Schedule workspace groups through the batch runner with a concurrency cap.
 * Each group is a SERIAL queue (same-workspace tasks must not overlap — git
 * index locks and shared cwd state); different groups run in parallel, at
 * most `maxConcurrency` groups at once (Kimi refactor plan §2, corrected:
 * no agent-session reuse — every task keeps its own isolated session).
 * Returns results in the input order.
 */
export async function scheduleGroups<T>(
  items: T[],
  keyOf: (item: T) => string,
  maxConcurrency: number,
  runOne: (item: T) => Promise<{ skipped: boolean; deferred: boolean }>,
): Promise<void> {
  // Group by key, preserving first-seen order within each group.
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [item])
    else list.push(item)
  }
  const groupLists = [...groups.values()]
  let next = 0
  async function pump(): Promise<void> {
    for (;;) {
      const index = next
      next += 1
      if (index >= groupLists.length) return
      // Serial within the group; stop launching past the window is the
      // caller's runOne concern (windowEndAt checked per task inside).
      for (const item of groupLists[index]) {
        await runOne(item)
      }
    }
  }
  const runners = Array.from({ length: Math.min(maxConcurrency, groupLists.length) }, () => pump())
  await Promise.all(runners)
}

/**
 * Assemble the report rows in the ORIGINAL queue order (priority, then
 * createdAt — the same sort runBatch applied when picking the queue).
 * scheduleGroups finishes workspace groups in arbitrary order, so results
 * are collected into a Map and re-ordered here; otherwise the morning
 * report would list tasks in completion order (post-refactor review H-001).
 * Deferred (preflight-skipped) tasks count toward deferredCount but never
 * enter the report's task list.
 */
export function assembleReportRows(
  queue: Task[],
  results: Map<string, RunTaskResult>,
): { rows: ReportTaskRow[]; savedTotal: number; deferredCount: number } {
  const rows: ReportTaskRow[] = []
  let savedTotal = 0
  let deferredCount = 0
  for (const task of queue) {
    const result = results.get(task.id)
    if (result === undefined) continue
    if (result.deferred) deferredCount += 1
    if (result.skipped) continue
    rows.push(result.row)
    savedTotal += result.savedYuan
  }
  return { rows, savedTotal, deferredCount }
}

/**
 * Run the queued set with per-workspace serialization and cross-workspace
 * concurrency (`batch.maxConcurrency`, default 3). Stops launching new tasks
 * past windowEndAt but never interrupts a running task (PLAN §7.2). Returns
 * null when nothing executed — no empty execution reports (review round 1, B2).
 */
export async function runBatch(ctx: Context, store: LowtideStore, windowEndAt: Date, forced = false): Promise<MorningReport | null> {
  const startedAt = new Date()
  const queue = [...store.tasks]
    .filter((t) => t.status === 'queued')
    .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt))
    .slice(0, store.config.batch.maxTasksPerNight)

  // Results are collected into a Map because scheduleGroups runs groups in
  // parallel: completion order is arbitrary. assembleReportRows() restores
  // the queue order afterwards (H-001).
  const results = new Map<string, RunTaskResult>()

  await scheduleGroups(
    queue,
    (t) => t.workspace,
    Math.min(Math.max(store.config.batch.maxConcurrency ?? 3, 1), 8),
    async (task) => {
      if (!forced && new Date().getTime() >= windowEndAt.getTime()) {
        return { skipped: true, deferred: false }
      }
      const result = await runTask(ctx, store, task, windowEndAt)
      results.set(task.id, result)
      return result
    },
  )

  const { rows, savedTotal, deferredCount } = assembleReportRows(queue, results)

  // Nothing executed (empty queue or everything deferred): no report.
  if (rows.length === 0) {
    ctx.logger('lowtide').info('batch skipped: nothing executed (%d deferred)', deferredCount)
    return null
  }

  const totalCostYuan = rows.reduce((sum, row) => sum + (row.costYuan ?? 0), 0)
  const doneCount = rows.filter((r) => r.status === 'done').length
  const failCount = rows.length - doneCount
  const deferredNote = deferredCount > 0 ? ` · ${deferredCount} 顺延` : ''

  const report: MorningReport = {
    id: `rpt-${Date.now()}`,
    date: localDateKey(new Date()),
    window: store.config.batch.window,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    tasks: rows,
    totalCostYuan: Number(totalCostYuan.toFixed(4)),
    savedYuan: Number(savedTotal.toFixed(4)),
    ...(deferredCount > 0 ? { deferredCount } : {}),
    summary: `${rows.length} 项任务 · ${doneCount} 成功 ${failCount} 异常${deferredNote} · 实花 ¥${totalCostYuan.toFixed(2)}`,
  }
  store.addReport(report)
  return report
}

/** Helper for the /state aggregate: yesterday-style formatting for the report header. */
export function reportDateLabel(dateIso: string): string {
  const d = new Date(`${dateIso}T08:00:00`)
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${weekdays[d.getDay()]}`
}
