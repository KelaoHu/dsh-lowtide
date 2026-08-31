/**
 * Turn execution primitives shared by the runner and the strategy engines:
 * one agent session, sequential turns, turn/end watching with listener
 * cleanup, usage normalization. Extracted so smart-iterative.ts can drive
 * turns without importing runner.ts (which imports it back — cycle).
 */
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-agent-presets'
import {
  type ReasoningEffort,
  type Task,
  type UsageLike,
} from 'lowtide-core'
import { inferProvider } from './models.ts'

export interface TurnOutcome {
  kind: string
  text: string
  usage: UsageLike | null
  reason: unknown
}

export interface TurnWatcher {
  promise: Promise<TurnOutcome>
  off(): void
}

export interface TurnResult {
  text: string
  usage: UsageLike | null
  kind: string
}

export interface SessionResult {
  turns: TurnResult[]
  elapsedMs: number
  status: 'done' | 'failed' | 'timeout' | 'aborted'
  error?: string
  /** True when the task CONTINUED the ORIGINAL conversation (resume succeeded). */
  resumed?: boolean
  /** True when a NEW session was seeded with the source conversation's FULL
   *  history (fork-style continuation — the lossless fallback when the
   *  source session is live in this runtime and cannot be resumed). */
  forked?: boolean
  /** Set when the task was asked to CONTINUE an existing conversation but the
   *  resume failed and a fresh session was used instead (lossy fallback). */
  resumeNote?: string
}

/**
 * Unique, recognizable title for a lowtide task session. The timestamp makes
 * repeated runs of the same task distinguishable in the session list, and the
 * prefix separates ordinary task sessions from continuation sessions (which
 * would otherwise inherit the source conversation's title and look identical).
 */
export function taskSessionTitle(task: Task, mode: 'task' | 'resumed' | 'forked', now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  const prefix = mode === 'task' ? '闲时任务' : '续接会话'
  const firstLine = (task.prompt.split('\n')[0] ?? '').trim()
  const snippet = firstLine.length > 24 ? `${firstLine.slice(0, 24)}…` : firstLine
  return `${prefix} · ${snippet} · ${stamp}`
}

/** Returns the next user message to send (index = round, 0-based), or null to stop. */
export type NextMessage = (index: number, turns: TurnResult[]) => string | null

/**
 * Cut index (exclusive) for seeding a continuation session from a source
 * event log: through the LAST completed turn (turn/end), skipping any
 * residual between-turn events — the same boundary the harness's own
 * session.fork uses. Returns null when the log has no completed turn (a
 * blank/unfinished conversation cannot be continued losslessly).
 */
export function forkSeedBoundary(events: readonly { type: string; seq: number }[]): number | null {
  let boundary = -1
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'turn/end') {
      boundary = i
      break
    }
  }
  if (boundary < 0) return null
  let cut = events[boundary].seq + 1
  while (cut < events.length && events[cut]?.type !== 'turn/start') cut++
  return cut
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function usageOf(raw: unknown): UsageLike {
  const u = raw as { inputTokens?: unknown; outputTokens?: unknown; cacheReadTokens?: unknown; reasoningTokens?: unknown }
  const toNum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    input: toNum(u.inputTokens),
    output: toNum(u.outputTokens),
    cacheRead: toNum(u.cacheReadTokens),
    ...(u.reasoningTokens !== undefined ? { reasoning: toNum(u.reasoningTokens) } : {}),
  }
}

/** Best-effort human-readable summary of a failed turn/end reason. */
export function summarizeReason(reason: unknown, kind: string): string {
  const r = reason as { kind?: string; error?: unknown; failure?: unknown; message?: string; detail?: string } | undefined
  if (r === undefined || r === null) return `turn ended with kind=${kind}`
  const detail = r.message ?? errorText(r.error) ?? errorText(r.failure) ?? r.detail
  return detail !== undefined ? `turn failed: ${detail}` : `turn ended with kind=${r.kind ?? kind}`
}

/** Extract a human-readable message from a nested error/failure object. */
function errorText(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (typeof error === 'object') {
    const e = error as { message?: unknown; code?: unknown }
    if (typeof e.message === 'string') {
      return typeof e.code === 'string' ? `${e.message} [${e.code}]` : e.message
    }
    try { return JSON.stringify(error) } catch { /* fall through */ }
  }
  return String(error)
}

/**
 * Resolve the model for batch execution. Trusts the user's live UI selection
 * or task-level override without forcing a DeepSeek fallback. The caller
 * (runner) is responsible for ensuring the chosen provider/model is usable in
 * headless mode.
 */
export function resolveBatchModel(
  selection: { provider: string; model: string },
  reasoning?: ReasoningEffort,
  modelOverride?: string,
  providerOverride?: string,
): { provider: string; model: string; reasoningEffort?: import('@deepseek-ai/dsh-llm').ReasoningEffortId } {
  const hasOverride = modelOverride !== undefined && modelOverride !== ''
  const base = hasOverride
    ? {
        provider: providerOverride !== undefined && providerOverride !== '' ? providerOverride : selection.provider,
        model: modelOverride,
      }
    : { provider: selection.provider, model: selection.model }
  return reasoning === undefined
    ? base
    : { ...base, reasoningEffort: ReasoningEffortId(reasoning) }
}

/**
 * Wait for the next turn/end on a session, collecting assistant text + usage.
 * Returns a watcher so the caller can detach the event listener when the
 * timeout branch wins — otherwise every timed-out task leaks a listener (B4).
 * The off is idempotent (Kimi review: double-cancel safety).
 */
export function waitTurnEnd(ctx: Context, sessionId: ReturnType<typeof SessionId>, firstSeq: number): TurnWatcher {
  let off: () => void = () => {}
  let cleaned = false
  const doOff = (): void => {
    if (cleaned) return
    cleaned = true
    off()
  }
  const promise = new Promise<TurnOutcome>((resolve) => {
    let text = ''
    let usage: UsageLike | null = null
    off = ctx.on('session/event', (session, event) => {
      if (session.id !== sessionId) return
      if (event.seq < firstSeq) return
      if (event.type === 'assistant/message') {
        const data = event.data as { message?: { content?: Array<{ type: string; text?: string }> }; usage?: unknown }
        if (data.usage !== undefined) usage = usageOf(data.usage)
        for (const part of data.message?.content ?? []) {
          if (part.type === 'text' && part.text !== undefined) text += part.text
        }
      }
      if (event.type === 'turn/end') {
        doOff()
        const reason = (event.data as { reason?: { kind?: string } }).reason
        resolve({ kind: reason?.kind ?? 'unknown', text, usage, reason })
      }
    })
  })
  return { promise, off: doOff }
}

/**
 * One session, sequential turns: create the agent once, send each message via
 * followup, wait each turn/end, collect text + usage. Timeout or a failed
 * turn aborts the session (listener detached first — B4). Every path —
 * including exceptions — releases the agent session (try/finally, Kimi review).
 */
export async function executeTurns(
  ctx: Context,
  task: Task,
  nextMessage: NextMessage,
  timeoutMs: number,
  reasoning?: ReasoningEffort,
  /** Historical session id to RESUME — the agent continues that conversation
   *  (full context). A failed resume falls back to a fresh session so the
   *  task still runs. */
  resumeSessionId?: string,
): Promise<SessionResult> {
  const started = Date.now()

  const loader = ctx.get('loader') as { await(): Promise<void> } | undefined
  await loader?.await()

  const liveSelection = ctx.agentDefaultModel.currentSelection()
  // Old persisted tasks carry `model` but no `modelProvider`: locate the
  // owning provider so the override actually executes (best-effort; falls
  // back to the live selection like before).
  let providerOverride = task.modelProvider
  if (task.model !== undefined && task.model !== '' && (providerOverride === undefined || providerOverride === '')) {
    const inferred = await inferProvider(ctx, task.model)
    if (inferred !== undefined) providerOverride = inferred
  }
  // Resolve provider/model first (without reasoning) so we can validate the
  // requested reasoning effort against THIS model's capabilities. Different
  // providers expose different effort sets (e.g. some have no "max").
  const baseSelection = resolveBatchModel(liveSelection, undefined, task.model, providerOverride)
  let effectiveReasoning = reasoning
  if (reasoning !== undefined) {
    try {
      const info = await ctx.llm.resolveModelInfo(baseSelection.provider, baseSelection.model)
      const efforts = info?.reasoning?.efforts
      const supported = Array.isArray(efforts) ? efforts.map((e) => (e as { id: string }).id) : []
      if (supported.length > 0 && !supported.includes(reasoning)) {
        console.warn(`[lowtide] ${baseSelection.provider}/${baseSelection.model} does not support reasoning "${reasoning}" — falling back to the model default`)
        effectiveReasoning = undefined
      }
    } catch {
      // Model info unresolvable — keep the requested effort; the harness will
      // surface a precise error if it is genuinely unsupported.
    }
  }
  const selection = resolveBatchModel(liveSelection, effectiveReasoning, task.model, providerOverride)
  const setup = async (agentCtx: Context): Promise<void> => {
    const selected: ModelSelectionRef = { current: selection, assembled: undefined }
    installModelSelection(agentCtx, selected)
    await ctx.agentPresets.mount(agentCtx)
  }

  // Resolve the workspace BEFORE creating the agent so the session header's
  // `cwd` is the registry's CANONICAL path (fs.realpath) — attachSession
  // compares realpath(header.cwd) against record.path, so the two must be
  // identical. Using the raw task.workspace risks symlink/casing mismatches
  // that silently fail the attach and leave the session "ungrouped".
  let workspacePath = task.workspace
  let workspaceEntity: { attachSession(sid: string): Promise<void> } | undefined
  if (task.workspace !== '') {
    const registry = (ctx as any).workspaceRegistry ?? ctx.get('workspaceRegistry')
    if (registry != null) {
      try {
        const ws = await registry.create(task.workspace)
        workspacePath = ws.path ?? task.workspace
        workspaceEntity = ws
        console.log(`[lowtide] workspace resolved for "${task.workspace}" → "${workspacePath}"`)
      } catch (error) {
        console.error(`[lowtide] workspace resolve failed for "${task.workspace}":`, error)
      }
    } else {
      console.error('[lowtide] workspaceRegistry unavailable — session may be ungrouped')
    }
  }

  // Continuation strategy — LOSSLESS, three tiers (verified against the
  // harness internals: the desktop runtime keeps every opened conversation
  // LIVE, and persistence.prepare REJECTS live sessions with "cannot prepare
  // session X while it is live", so plain resume ALWAYS fails there):
  //  1. agents.resume — continues the ORIGINAL conversation (same session id);
  //     works when the source is not live in this runtime (e.g. after a
  //     desktop restart the source was disposed+retired).
  //  2. fork-style seed — create a NEW session seeded with the live source's
  //     FULL event log (the exact mechanism of the harness's own session.fork,
  //     which is live-safe): the model sees the complete previous
  //     conversation, losslessly. The source conversation itself is never
  //     touched (no writes, no interruption).
  //  3. fresh session + resumeNote — only when the source has no completed
  //     turn to inherit from.
  let resumeNote: string | undefined
  // True when the ORIGINAL conversation was continued (same session id).
  let resumed = false
  // True when a NEW session was seeded with the full source history.
  let forked = false
  let handle: { agent: Agent; dispose(): Promise<void> }
  if (resumeSessionId !== undefined) {
    try {
      handle = await ctx.agents.resume({
        resumeSessionId: SessionId(resumeSessionId),
        agentOptions: { provider: selection.provider, model: selection.model },
        setup,
      })
      resumed = true
      console.log(`[lowtide] ✓ resumed conversation ${resumeSessionId} in place`)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.error(`[lowtide] resume ${resumeSessionId} failed (${reason}) — trying fork-style continuation`)
      // Tier 2: seed a new session with the live source's complete history.
      const live = ctx.sessions.get(SessionId(resumeSessionId))
      const cut = live === undefined ? null : forkSeedBoundary(live.events)
      if (live !== undefined && cut !== null) {
        const seed = live.events.slice(0, cut)
        handle = await ctx.agents.create({
          sessionId: SessionId(`lt-${task.id}-${Date.now()}`),
          seed,
          meta: {
            cwd: workspacePath,
            parentSession: SessionId(resumeSessionId),
            seedLength: cut,
            // Keep the source's agent preset so the seeded history's tool
            // semantics match the reassembled agent (the harness refuses to
            // replay tool history against a different composition).
            ...(live.header.agentPreset !== undefined ? { agentPreset: live.header.agentPreset } : {}),
          },
          agentOptions: { provider: selection.provider, model: selection.model },
          setup,
        })
        forked = true
        console.log(`[lowtide] ✓ continuation session ${handle.agent.session.id} seeded with ${seed.length} events from ${resumeSessionId} (lossless fork)`)
      } else {
        // Tier 3: no completed turn to inherit (or source vanished) — the
        // continuation would be lossy, so say so VISIBLY.
        resumeNote = live === undefined
          ? `会话续接失败（${reason}），且源会话不在运行中，已新建会话执行`
          : '所选会话还没有完整的对话轮次，无法续接其上下文，已新建会话执行'
        console.error(`[lowtide] fork-style continuation unavailable for ${resumeSessionId} (live=${live !== undefined}), using a fresh session:`, error)
        handle = await ctx.agents.create({
          sessionId: SessionId(`lt-${task.id}-${Date.now()}`),
          meta: { cwd: workspacePath },
          agentOptions: { provider: selection.provider, model: selection.model },
          setup,
        })
      }
    }
  } else {
    handle = await ctx.agents.create({
      sessionId: SessionId(`lt-${task.id}-${Date.now()}`),
      meta: { cwd: workspacePath },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup,
    })
  }
  const { agent } = handle
  // Attach immediately after creation so the session lands in the user's
  // chosen workspace even if execution later fails or times out.
  if (workspaceEntity !== undefined) {
    try {
      await workspaceEntity.attachSession(agent.session.id)
      console.log(`[lowtide] ✓ session ${agent.session.id} attached to workspace "${workspacePath}"`)
    } catch (error) {
      console.error(`[lowtide] ✗ attach failed for session ${agent.session.id}:`, error)
    }
  }
  // Set a UNIQUE title right away: repeated runs of one task would otherwise
  // produce identically-titled sessions, and a continuation session would
  // inherit the source conversation's title (both look like duplicates in the
  // session list). An explicit user-style rename also pins the title so the
  // auto-title service cannot overwrite it later.
  const titleService = ctx.get('sessionTitle') as { rename(session: unknown, title: string): unknown } | undefined
  if (titleService !== undefined) {
    try {
      titleService.rename(agent.session, taskSessionTitle(task, resumed ? 'resumed' : forked ? 'forked' : 'task'))
    } catch (error) {
      console.error(`[lowtide] session title set failed for ${agent.session.id}:`, error)
    }
  } else {
    console.warn('[lowtide] sessionTitle service unavailable — sessions keep auto-generated titles')
  }
  try {
    await agent.whenIdle()
    ctx.permissionPresets.set(agent.session, task.permissionPreset)

    const turns: TurnResult[] = []
    let index = 0
    for (;;) {
      const message = nextMessage(index, turns)
      if (message === null) break
      const firstSeq = agent.session.seq
      const watcher = waitTurnEnd(ctx, agent.session.id, firstSeq)
      let outcome: TurnOutcome | null = null
      try {
        agent.followup(createUserMessage({ content: [{ type: 'text', text: message }], source: { kind: 'user' } }))
        outcome = await Promise.race([watcher.promise, sleep(timeoutMs).then(() => null)])
      } catch (error) {
        // followup or race threw: detach the listener before rethrowing.
        watcher.off()
        throw error
      }
      if (outcome === null) {
        watcher.off() // detach before abandoning (B4)
        agent.cancel('lt-timeout' as never)
        return { turns, elapsedMs: Date.now() - started, status: 'timeout', error: `timeout after ${timeoutMs / 60_000}min`, ...(resumeNote !== undefined ? { resumeNote } : {}), ...(resumed ? { resumed: true } : {}), ...(forked ? { forked: true } : {}) }
      }
      turns.push({ text: outcome.text, usage: outcome.usage, kind: outcome.kind })
      if (outcome.kind !== 'completed') {
        // A user hitting "stop generating" aborts the turn — that is a
        // deliberate stop, NOT a failure: no misleading LLM error (e.g. an
        // account-balance 402 seen on a later retry), and the runner must not
        // auto-retry it.
        if (outcome.kind === 'aborted') {
          console.warn(`[lowtide] turn aborted by user (stop generating) on ${agent.session.id}`)
          return { turns, elapsedMs: Date.now() - started, status: 'aborted', error: '用户停止了生成', ...(resumeNote !== undefined ? { resumeNote } : {}), ...(resumed ? { resumed: true } : {}), ...(forked ? { forked: true } : {}) }
        }
        // Surface the full turn/end reason — the kind alone hides the failure.
        const summary = summarizeReason(outcome.reason, outcome.kind)
        console.error('[lowtide] turn failed:', summary, '| raw reason:', JSON.stringify(outcome.reason))
        return { turns, elapsedMs: Date.now() - started, status: 'failed', error: summary, ...(resumeNote !== undefined ? { resumeNote } : {}), ...(resumed ? { resumed: true } : {}), ...(forked ? { forked: true } : {}) }
      }
      index += 1
    }
    return { turns, elapsedMs: Date.now() - started, status: 'done', ...(resumeNote !== undefined ? { resumeNote } : {}), ...(resumed ? { resumed: true } : {}), ...(forked ? { forked: true } : {}) }
  } finally {
    // Flush to persist the conversation (and any execution results) to disk.
    const sessions = ctx.get('sessions') as { flush(session: unknown): Promise<void> } | undefined
    if (sessions !== undefined) {
      try { await sessions.flush(agent.session) } catch (error) { console.error('[lowtide] session flush failed:', error) }
    } else {
      console.error('[lowtide] sessions service not available — session may not persist')
    }
    // Re-attach AFTER flush: re-validates workspace membership against the
    // now-durable header so the conversation stays visible in the workspace
    // browser. Idempotent.
    if (workspaceEntity !== undefined) {
      try {
        await workspaceEntity.attachSession(agent.session.id)
      } catch (error) {
        console.error(`[lowtide] re-attach failed for session ${agent.session.id}:`, error)
      }
    }
    // DELIBERATELY NOT disposing the agent: the harness host emits
    // `host/session-removed` on `session/disposed`, which makes the GUI
    // immediately drop the conversation from the workspace browser even
    // though its log is durably on disk (it only reappears after a restart,
    // when the GUI does a full session.list refresh). Keeping the session
    // live means it stays visible while idle; on desktop restart it naturally
    // becomes a cold persisted session and still shows up.
    console.log(`[lowtide] session ${agent.session.id} kept live for workspace visibility`)
  }
}

/** The task prompt + file context (attachment paths) + user strategy hint.
 *  Continuation context comes from RESUMING a dsh conversation at execution
 *  time (executeTurns resumeSessionId), not from string injection. */
export function buildPrompt(task: Task): string {
  const fileContext = task.files.length > 0
    ? `\n\n任务附件文件（绝对路径）：\n${task.files.map((f) => `- ${f.path}`).join('\n')}`
    : ''
  const hint = task.strategyHint !== undefined && task.strategyHint.trim() !== ''
    ? `\n\n用户希望：${task.strategyHint.trim()}`
    : ''
  return task.prompt + fileContext + hint
}

export function sumUsage(a: UsageLike, b: UsageLike): UsageLike {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    ...(a.reasoning !== undefined || b.reasoning !== undefined ? { reasoning: (a.reasoning ?? 0) + (b.reasoning ?? 0) } : {}),
  }
}

export function sumTurns(turns: TurnResult[]): UsageLike {
  const empty: UsageLike = { input: 0, output: 0, cacheRead: 0 }
  return turns.reduce((acc, t) => sumUsage(acc, t.usage ?? empty), empty)
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

function bigrams(text: string): Set<string> {
  const set = new Set<string>()
  const limit = Math.min(text.length, 100_000) // bounded memory on huge outputs
  for (let i = 0; i < limit - 1; i++) set.add(text.slice(i, i + 2))
  return set
}

/** Cheap convergence check: bigram-Jaccard similarity above the threshold. */
export function isConverged(a: TurnResult, b: TurnResult): boolean {
  const na = normalizeText(a.text)
  const nb = normalizeText(b.text)
  if (na.length < 20 || nb.length < 20) return na === nb
  const sa = bigrams(na)
  const sb = bigrams(nb)
  let inter = 0
  for (const g of sa) if (sb.has(g)) inter++
  const union = sa.size + sb.size - inter
  if (union === 0) return true
  return inter / union > 0.9
}
