/**
 * Client-side tier clock (v0.2.2): derives the displayed 闲时/忙时 from the
 * CONFIGURED windows and the LOCAL clock, using the very same pure `levelAt`
 * the host uses (imported from lowtide-core, which is inlined into the client
 * bundle — it is not a `@deepseek-ai/*` platform module).
 *
 * Why this exists — the reported bug:
 *   The price pill used to be a pure mirror of the host's pushed state. The
 *   client disables its 4s polling as soon as the EventSource reports `open`
 *   and had no freshness check, so ONE silently stalled stream (host restart
 *   leaving a half-open socket, a hidden/frozen Electron window, system sleep,
 *   a swapped SSE client) froze 闲时/忙时 forever — and `connected === false`
 *   was invisible while a host snapshot existed. The pill simply stopped
 *   following the clock.
 *
 * This module makes the tier a function of time, never of stream liveness:
 *   - recomputed on every state frame (host config may change),
 *   - recomputed on a 30s heartbeat (covers suspend/resume and clock jumps),
 *   - recomputed exactly at the next window boundary (+1s), so a 12:00 or
 *     18:00 flip is visible even with zero server traffic.
 */
import { levelAt, nextLevelChangeAt, systemTimeZone, type WindowCfg, type WindowLevel } from 'lowtide-core'

/** Longest timeout we ever arm (24.8 days is the setTimeout ceiling). */
const MAX_TIMEOUT_MS = 2_147_483_647

/**
 * How long the UI tolerates silence from the push stream before it stops
 * trusting it. The host heartbeats every 15s, so 45s = three missed frames.
 */
export const SSE_STALE_MS = 45_000

/**
 * Freshness predicate for the live state stream: an OPEN EventSource is not a
 * HEALTHY one. `lastFrameAt === 0` means no frame has ever arrived.
 */
export function isStreamFresh(lastFrameAt: number, nowMs: number, staleMs: number = SSE_STALE_MS): boolean {
  return lastFrameAt > 0 && nowMs - lastFrameAt <= staleMs
}

export interface TierSnapshot {
  /** Effective level right now; 'off' when no window matches (off-peak base). */
  level: WindowLevel
  /** Window multiplier over the off-peak row (1 for official peak/off). */
  multiplier: number
  /** The matching window's boundaries, for the tooltip (null = off-peak). */
  window: { id: string; label?: string; start: string; end: string } | null
}

/** The off-peak fallback snapshot (also used before the first host frame). */
export const OFF_TIER: TierSnapshot = { level: 'off', multiplier: 1, window: null }

/**
 * Derive the tier at `now` from raw windows (own `tz`/`days` preserved — the
 * host sends them verbatim precisely so this stays timezone-correct for
 * west-hemisphere users with day-shifted windows).
 */
export function deriveTier(windows: WindowCfg[], tz: string, now: Date): TierSnapshot {
  const match = levelAt(now, windows, tz)
  if (match === null) return OFF_TIER
  return {
    level: match.level,
    multiplier: match.multiplier,
    window: {
      id: match.window.id,
      ...(match.window.label !== undefined ? { label: match.window.label } : {}),
      start: match.window.start,
      end: match.window.end,
    },
  }
}

/** Epoch ms of the next boundary that can change the level (null = none). */
export function nextBoundaryAt(windows: WindowCfg[], tz: string, now: Date): number | null {
  const next = nextLevelChangeAt(now, windows, tz)
  return next === null ? null : next.getTime()
}

/** Resolve the timezone to evaluate windows in (host-provided wins). */
export function tierTimeZone(hostTz?: string | null): string {
  if (typeof hostTz === 'string' && hostTz !== '') return hostTz
  return systemTimeZone()
}

function sameTier(a: TierSnapshot, b: TierSnapshot): boolean {
  return a.level === b.level
    && a.multiplier === b.multiplier
    && (a.window?.id ?? '') === (b.window?.id ?? '')
    && (a.window?.start ?? '') === (b.window?.start ?? '')
    && (a.window?.end ?? '') === (b.window?.end ?? '')
}

export interface TierClockOptions {
  /** Current windows (null/empty before the first host frame → keep the last tier). */
  getWindows: () => WindowCfg[] | null
  /** Current tz (host-provided, falling back to the browser's own). */
  getTimeZone: () => string
  /** Called only when the derived tier actually changes. */
  onChange: (tier: TierSnapshot) => void
  /** Heartbeat period in ms (default 30s). */
  tickMs?: number
  /** Injectable clock (tests). */
  now?: () => number
}

export interface TierClock {
  /** Recompute immediately (called on every host frame and on demand). */
  refresh(): TierSnapshot
  /** Last derived snapshot. */
  current(): TierSnapshot
  stop(): void
}

/**
 * Start the tier clock. Returns a handle whose `refresh()` is called whenever a
 * host frame arrives; `stop()` clears both timers (wired into `ctx.effect`).
 */
export function startTierClock(options: TierClockOptions): TierClock {
  const tickMs = options.tickMs ?? 30_000
  const now = options.now ?? (() => Date.now())
  let last: TierSnapshot = OFF_TIER
  let boundaryTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  function armBoundary(): void {
    if (boundaryTimer !== null) {
      clearTimeout(boundaryTimer)
      boundaryTimer = null
    }
    const windows = options.getWindows()
    if (windows === null || windows.length === 0) return
    const at = nextBoundaryAt(windows, options.getTimeZone(), new Date(now()))
    if (at === null) return
    // +1s so the boundary itself is already behind us when we wake up.
    const delay = Math.min(Math.max(at - now() + 1_000, 250), MAX_TIMEOUT_MS)
    boundaryTimer = setTimeout(() => {
      boundaryTimer = null
      refresh()
    }, delay)
  }

  function refresh(): TierSnapshot {
    if (stopped) return last
    const windows = options.getWindows()
    if (windows === null || windows.length === 0) {
      armBoundary()
      return last
    }
    const next = deriveTier(windows, options.getTimeZone(), new Date(now()))
    if (!sameTier(next, last)) {
      last = next
      if (!stopped) options.onChange(next)
    }
    armBoundary()
    return last
  }

  const heartbeat = setInterval(() => { refresh() }, tickMs)
  refresh()

  return {
    refresh,
    current: () => last,
    stop() {
      stopped = true
      clearInterval(heartbeat)
      if (boundaryTimer !== null) {
        clearTimeout(boundaryTimer)
        boundaryTimer = null
      }
    },
  }
}
