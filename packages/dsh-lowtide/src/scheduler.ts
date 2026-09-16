/**
 * Lowtide scheduler (PLAN T1.4): minute-aligned tick driving the batch
 * runner inside the configured window. The window end stops new launches but
 * never interrupts a running task. `runNow` is the manual/test path.
 *
 * Fixes over the MVP tick (2026-08 review round 1):
 *  - once-per-window guard: a window (start-day keyed, midnight-crossing
 *    safe) runs the batch at most once even when the host restarts inside it;
 *  - deferred auto-recovery: at window start, preflight-deferred tasks
 *    (deferCount > 0) go back to queued (retry next window), user-triaged
 *    deferred tasks (deferCount === 0) reappear in pending-review — the
 *    "下一个裁定周期再出现" promise of PLAN §2.1;
 *  - skip the batch entirely when nothing is queued (no empty reports).
 */
import type { Context } from '@deepseek-ai/cordis'
import { addDaysInTz, batchWindowList, dayStartInTz, localParts, parseWindowRange, systemTimeZone } from 'lowtide-core'
import { LowtideStore } from './store.ts'
import { runBatch } from './runner.ts'

export interface Scheduler {
  stop(): void
  runNow(): Promise<void>
  isRunning(): boolean
  batchStartedAt(): Date | null
}

/** Maximum consecutive preflight deferrals before a task is marked failed. */
export const MAX_PREFLIGHT_DEFER = 3

/** Ranges covering `now`, in list order (midnight-crossing aware). */
function activeWindows(now: Date, windows: string[], tz?: string): string[] {
  const { minutes } = localParts(now, tz ?? systemTimeZone())
  return windows.filter((range) => {
    const { start, end } = parseWindowRange(range)
    if (end > start) return minutes >= start && minutes < end
    if (end < start) return minutes >= start || minutes < end
    return true
  })
}

/** Whether `now` is inside any of the batch windows (local tz). Accepts the
 *  legacy single-range string or the multi-window list (issue #5). */
export function inBatchWindow(now: Date, window: string | string[], tz?: string): boolean {
  const list = Array.isArray(window) ? window : [window]
  return activeWindows(now, list, tz).length > 0
}

/** The end of the ACTIVE batch window as an absolute Date (today's or the
 *  next occurrence). With multiple windows the first covering range wins —
 *  overlapping windows are a user choice the once-per-window latch and the
 *  running guard absorb (documented in README/CHANGELOG). */
export function batchWindowEnd(now: Date, window: string | string[], tz?: string): Date {
  const list = Array.isArray(window) ? window : [window]
  const active = activeWindows(now, list, tz)
  const range = active.length > 0 ? active[0] : list[0]
  const { end } = parseWindowRange(range)
  const resolvedTz = tz ?? systemTimeZone()
  // Calendar-day arithmetic: fixed 24h deltas drift across DST transitions.
  const dayStart = dayStartInTz(now, resolvedTz)
  let target = new Date(dayStart.getTime() + end * 60_000)
  if (target.getTime() <= now.getTime()) {
    target = new Date(addDaysInTz(now, resolvedTz, 1).getTime() + end * 60_000)
  }
  return target
}

function localDateKey(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/**
 * Identity of the batch window currently in progress, keyed by the calendar
 * day the window STARTED (so a midnight-crossing window cannot run twice)
 * plus the window's range string — with multiple windows (issue #5) each
 * window earns its own once-per-occurrence latch. Returns null when `now`
 * is outside every window.
 */
export function currentWindowKey(now: Date, window: string | string[], tz?: string): string | null {
  const list = Array.isArray(window) ? window : [window]
  const active = activeWindows(now, list, tz)
  if (active.length === 0) return null
  const range = active[0]
  const resolvedTz = tz ?? systemTimeZone()
  const { start } = parseWindowRange(range)
  const { minutes } = localParts(now, resolvedTz)
  const anchor = minutes >= start ? now : addDaysInTz(now, resolvedTz, -1)
  return `${localDateKey(anchor, resolvedTz)}|${range}|${resolvedTz}`
}

/** Window-start recovery for deferred tasks (PLAN §2.1 + review B3). */
export function recoverDeferred(store: LowtideStore): void {
  for (const task of store.tasks) {
    if (task.status !== 'deferred') continue
    const deferrals = task.deferCount ?? 0
    if (deferrals >= MAX_PREFLIGHT_DEFER) {
      store.setStatus(task.id, 'failed', {
        lastError: `连续 ${deferrals} 次因窗口/预算顺延，已停止尝试；请手动处理`,
      })
    } else if (deferrals > 0) {
      // Preflight-deferred: retry in this window.
      store.setStatus(task.id, 'queued', { lastError: undefined })
    } else {
      // User-triaged defer (⏸ / confirm-gate): reappear for human adjudication.
      store.setStatus(task.id, 'pending-review', { lastError: undefined })
    }
  }
}

/** Whether a non-forced tick has anything to do after deferred recovery. */
function hasQueuedWork(store: LowtideStore): boolean {
  return store.tasks.some((t) => t.status === 'queued')
}

export function startScheduler(ctx: Context, store: LowtideStore, tickMs = 30_000): Scheduler {
  let running = false
  let startedAt: Date | null = null
  let lastWindowKey: string | null = null

  async function run(forced: boolean): Promise<void> {
    if (running) return
    if (!forced && store.config.batch.paused) return
    const now = new Date()
    const wins = batchWindowList(store.config.batch)
    const activeRange = forced ? undefined : activeWindows(now, wins, store.config.batch.tz)[0]
    if (!forced && activeRange === undefined) {
      // Outside every window: clear the once-per-window latch so the next
      // window (possibly the same day after a config change) may run again.
      if (lastWindowKey !== null) lastWindowKey = null
      return
    }
    const key = activeRange === undefined ? null : currentWindowKey(now, wins, store.config.batch.tz)
    if (!forced) {
      if (key !== null && key === lastWindowKey) return
      if (key !== null) lastWindowKey = key
      recoverDeferred(store)
      if (!hasQueuedWork(store)) return
    }
    running = true
    startedAt = new Date()
    try {
      const end = forced ? new Date(Date.now() + 24 * 3600_000) : batchWindowEnd(new Date(), wins, store.config.batch.tz)
      // The report records the window that actually triggered this batch
      // (forced manual runs label the first configured window, as before).
      await runBatch(ctx, store, end, forced, activeRange ?? wins[0])
    } catch (error) {
      ctx.logger('lowtide').warn('batch failed: %s', error instanceof Error ? error.message : String(error))
    } finally {
      running = false
      startedAt = null
    }
  }

  const timer = setInterval(() => {
    run(false).catch((error) => {
      ctx.logger('lowtide').error('scheduler tick error: %s', error instanceof Error ? error.message : String(error))
    })
  }, tickMs)

  return {
    stop() {
      clearInterval(timer)
    },
    runNow() {
      return run(true)
    },
    isRunning() {
      return running
    },
    batchStartedAt() {
      return startedAt
    },
  }
}
