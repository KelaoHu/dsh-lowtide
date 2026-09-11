/**
 * Client entry store: the host state aggregate mirror + UI state.
 * Plain snapshot store from the runtime engine; components subscribe with
 * useSyncExternalStore.
 *
 * Live data path (v0.2.2): SSE first, 4s polling as a *freshness-gated*
 * fallback. `lastFrameAt` records the newest state frame from either path; a
 * watchdog demotes a silent-but-open stream back to polling and reconnects
 * with backoff, so the UI can never freeze on a half-open socket.
 *
 * The displayed 闲时/忙时 additionally comes from the local tier clock
 * (lib/tierClock.ts), so it keeps following the wall clock even if every
 * network path is down.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { WindowCfg } from 'lowtide-core'
import { isStreamFresh, OFF_TIER, SSE_STALE_MS, startTierClock, tierTimeZone, type TierClock, type TierSnapshot } from './lib/tierClock.ts'

/** Re-exported so components (the pill) share one staleness definition. */
export { SSE_STALE_MS } from './lib/tierClock.ts'

export interface HostState {
  ok: boolean
  time: string
  /** Snapshot instant (epoch ms) — lets the client spot clock skew. */
  serverNow?: number
  autonomy: string
  level: { level: string; multiplier: number; window: { id: string; label?: string; start: string; end: string } } | null
  /** Raw effective windows (own tz/days) — the client tier clock's input. */
  windows?: WindowCfg[]
  price: {
    model: string
    /** Billing id after alias/route resolution (optional on older hosts). */
    priceModel?: string
    input: number
    inputCached: number
    output: number
    /** Real current level: 'peak' | 'off' | 'custom' (display = charge). */
    tier: 'peak' | 'off' | 'custom'
    /** Window price multiplier over the off row (custom windows). */
    multiplier: number
    /** Whether the model has an explicit price entry (false = default estimate). */
    priceKnown: boolean
    peakInput: number
    peakOutput: number
    offInput: number
    offOutput: number
  }
  /** Billing notice for the selected model (e.g. V4 Pro retired → Flash). */
  priceNotice?: string | null
  nextBatchAt: number
  countdownMs: number
  nextOffPeakAt: number | null
  /** System IANA timezone + official peak windows converted to local clock
   *  (settings explainer + one-click adopt). */
  systemTz: string
  officialInLocal: Array<{ label: string; start: string; end: string; crossesDay: boolean }>
  /** True when the saved windows drifted from the official schedule. */
  officialDrift?: boolean
  batch: { window: string; paused: boolean; running: boolean; startedAt: string | null; maxConcurrency: number }
  queue: { total: number; pendingReview: number; queued: number; running: number }
  gate: { windowStartAt: number; pendingReview: number } | null
  digest: {
    groups: Array<{
      workspace: string
      tasks: unknown[]
    }>
  }
  tasks: HostTask[]
  latestReport: HostReport | null
  dismissedPeakToday: boolean
  ledger: { spentToday: number; savedToday: number }
}

export interface HostCandidate {
  excerpt: string
  costYuan: number
  elapsedMs: number
}

export interface HostTask {
  id: string
  prompt: string
  files: Array<{ path: string; sha256?: string; size?: number }>
  workspace: string
  gitRef?: { sha: string; branch: string }
  priority: number
  deadline?: string
  permissionPreset: 'lt-readonly' | 'lt-standard' | 'lt-trusted'
  status: string
  createdAt: string
  triagedAt?: string
  triagedBy?: string
  estimateYuan?: number
  estimateMinutes?: number
  strategy?: 'single' | 'iterative' | 'sampling' | 'review'
  rounds?: number
  reasoning?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** Task-level batch model override (any model id from this machine's dsh). */
  model?: string
  /** Provider for the task-level model override. */
  modelProvider?: string
  strategyHint?: string
  autonomy?: 'l1' | 'l2' | 'l3'
  continuesFromSession?: string
  chosenCandidateIndex?: number
  lastError?: string
  /** Last in-place edit timestamp (edit keeps the task id/status). */
  editedAt?: string
  /** Number of in-place edits applied to this task. */
  editCount?: number
  lastRun?: {
    at: string
    status: string
    elapsedMs: number
    costYuan: number
    diffStat?: string | null
    error?: string
    assistantExcerpt?: string
    strategy?: 'single' | 'iterative' | 'sampling' | 'review'
    roundsRun?: number
    candidates?: HostCandidate[]
    reviewExcerpt?: string
    /** True when the run CONTINUED the requested conversation in place. */
    resumed?: boolean
    /** True when the run ran in a NEW session seeded with the source's full
     *  history (fork-style continuation). */
    forked?: boolean
    /** Set when the requested conversation resume failed and a fresh session was used. */
    resumeNote?: string
  }
}

export interface HostReport {
  id: string
  date: string
  dateLabel?: string
  window: string
  startedAt: string
  finishedAt: string
  tasks: Array<{
    taskId: string
    prompt: string
    workspace: string
    status: 'done' | 'failed' | 'timeout' | 'stale'
    costYuan?: number
    elapsedMs?: number
    diffStat?: string | null
    error?: string
    strategy?: 'single' | 'iterative' | 'sampling' | 'review'
    roundsRun?: number
    candidates?: HostCandidate[]
    reviewExcerpt?: string
  }>
  totalCostYuan: number
  savedYuan: number
  deferredCount?: number
  summary: string
}

export interface ClientUiState {
  host: HostState | null
  connected: boolean
  /** Last state-fetch error message (null when the last poll succeeded). */
  error: string | null
  queueOpen: boolean
  reportOpen: boolean
  reportHistoryOpen: boolean
  reportUnread: boolean
  toast: { seq: number; text: string } | null
  lastReportId: string | null
  /** Active locale id ('zh' | 'en'), synced from the host locale service. */
  activeLocale: string
  /**
   * Tier derived from the local clock + the host's windows. This is what the
   * pill and the intercept card DISPLAY, so a stalled stream can never freeze
   * 闲时/忙时; the host's `price.tier` stays the pricing/ledger authority.
   */
  tier: TierSnapshot
  /** When `tier` was last derived (epoch ms). */
  tierAt: number
  /** Newest state frame seen from either transport (epoch ms, 0 = never). */
  lastFrameAt: number
  /** False while the live push is silent/absent and polling carries the UI. */
  sseHealthy: boolean
}

export const lowtideStore = createSnapshotStore<ClientUiState>({
  host: null,
  connected: false,
  error: null,
  queueOpen: false,
  reportOpen: false,
  reportHistoryOpen: false,
  reportUnread: false,
  toast: null,
  lastReportId: null,
  activeLocale: 'zh',
  tier: OFF_TIER,
  tierAt: 0,
  lastFrameAt: 0,
  sseHealthy: false,
})

export function showToast(text: string): void {
  lowtideStore.update((draft) => {
    draft.toast = { seq: Date.now(), text }
  })
}

export function clearToast(): void {
  lowtideStore.update((draft) => {
    draft.toast = null
  })
}

/** Reset the UI slice (plugin unload) — the full field list lives here so a
 *  new field can never be forgotten by a caller's hand-written literal. */
export function resetUiState(): void {
  lowtideStore.set({
    host: null,
    connected: false,
    error: null,
    queueOpen: false,
    reportOpen: false,
    reportHistoryOpen: false,
    reportUnread: false,
    toast: null,
    lastReportId: null,
    activeLocale: 'zh',
    tier: OFF_TIER,
    tierAt: 0,
    lastFrameAt: 0,
    sseHealthy: false,
  })
}

/** Poll the host aggregate every 4s; returns the stop function. */
let pollNow: (() => Promise<void>) | null = null

/** Trigger one immediate poll (used after write actions for fast refresh). */
export function refreshNow(): void {
  if (pollNow !== null) void pollNow()
}

/** The tier clock started by `startPolling` (module-level so actions can poke it). */
let tierClock: TierClock | null = null

/** Re-derive the displayed tier right now (after a window edit, say). */
export function refreshTier(): void {
  tierClock?.refresh()
}

/** The windows the tier clock evaluates: host payload first, else the config
 *  fetched by the caller (settings page), else nothing yet. */
let tierWindows: WindowCfg[] | null = null
let tierTz: string | null = null

/** Feed the clock from a config payload when no host frame is available yet. */
export function setTierWindows(windows: WindowCfg[] | null, tz?: string | null): void {
  tierWindows = windows
  if (tz !== undefined) tierTz = tz
  tierClock?.refresh()
}

function applyState(state: HostState): void {
  const frameAt = Date.now()
  if (Array.isArray(state.windows) && state.windows.length > 0) tierWindows = state.windows
  if (typeof state.systemTz === 'string' && state.systemTz !== '') tierTz = state.systemTz
  lowtideStore.update((draft) => {
    const previous = draft.host
    draft.host = state
    draft.connected = true
    draft.error = null
    draft.lastFrameAt = frameAt
    draft.sseHealthy = true
    const latestId = state.latestReport?.id ?? null
    if (latestId !== null && latestId !== draft.lastReportId) {
      draft.reportUnread = true
    }
    if (latestId !== null && latestId !== draft.lastReportId && previous !== null) {
      draft.reportUnread = true
    }
    draft.lastReportId = latestId ?? draft.lastReportId
  })
  // A frame may carry a new window config — re-derive immediately.
  tierClock?.refresh()
}

/** How long without a state frame before the push stream counts as stale. */
const WATCHDOG_MS = 5_000
/** Reconnect backoff bounds for the event stream. */
const RECONNECT_MIN_MS = 5_000
const RECONNECT_MAX_MS = 60_000

export function startPolling(): () => void {
  let stopped = false
  let esOk = false
  let es: EventSource | null = null
  let reconnectDelay = RECONNECT_MIN_MS
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  /** Freshness: an OPEN stream is not a HEALTHY stream. */
  function fresh(): boolean {
    return isStreamFresh(lowtideStore.getSnapshot().lastFrameAt, Date.now())
  }

  /** Whether the 4s poll fallback should carry the UI right now. */
  function shouldPoll(): boolean {
    return !esOk || !fresh()
  }

  async function poll(): Promise<void> {
    if (stopped || !shouldPoll()) return
    try {
      const res = await fetch('/ds-lowtide/state', { cache: 'no-store' })
      if (!res.ok) throw new Error(`state ${res.status}`)
      applyState(await res.json() as HostState)
    } catch {
      lowtideStore.update((draft) => {
        draft.connected = false
        draft.error = '无法连接闲时服务，正在重连…'
      })
    }
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer !== null) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS)
      connectSSE()
    }, reconnectDelay)
  }

  function connectSSE(): void {
    if (stopped || typeof EventSource === 'undefined') return
    if (es !== null) {
      // A live handle is being replaced — drop it so the browser does not keep
      // two streams (they would both count against the host's client cap).
      try { es.close() } catch { /* already closed */ }
      es = null
    }
    const source = new EventSource('/ds-lowtide/events')
    es = source
    source.addEventListener('state', (event) => {
      try {
        applyState(JSON.parse((event as MessageEvent).data) as HostState)
        reconnectDelay = RECONNECT_MIN_MS
      } catch {
        /* 忽略坏帧,等下一个事件 */
      }
    })
    source.onopen = () => {
      esOk = true
      // Only a FRAME proves freshness; the watchdog demotes a silent stream.
      lowtideStore.update((draft) => { draft.connected = true })
    }
    source.onerror = () => {
      // 断线:停止实时,回落到 4s 轮询;EventSource 自带重连,恢复后 onopen 重新置 esOk。
      esOk = false
      lowtideStore.update((draft) => {
        draft.connected = false
        draft.sseHealthy = false
        draft.error = '实时连接断开，已切换轮询重连…'
      })
      scheduleReconnect()
    }
  }

  /**
   * Watchdog: an EventSource can stay "open" forever after the peer vanished
   * (half-open socket following a host restart, sleep/resume, a frozen
   * renderer). Without this, polling stayed disabled and the pill froze —
   * the reported bug. Demote the stream, let polling carry the UI, reconnect.
   */
  function watchdog(): void {
    if (stopped) return
    if (!esOk || fresh()) return
    lowtideStore.update((draft) => {
      draft.sseHealthy = false
      draft.error = '实时推送已停止，正在重连…'
    })
    esOk = false
    if (es !== null) {
      try { es.close() } catch { /* already closed */ }
      es = null
    }
    scheduleReconnect()
  }

  pollNow = poll
  tierClock = startTierClock({
    getWindows: () => tierWindows,
    getTimeZone: () => tierTimeZone(tierTz),
    onChange: (tier) => {
      lowtideStore.update((draft) => {
        draft.tier = tier
        draft.tierAt = Date.now()
      })
    },
  })
  void poll()
  const timer = setInterval(() => { void poll() }, 4000)
  const watchdogTimer = setInterval(watchdog, WATCHDOG_MS)
  connectSSE()
  return () => {
    stopped = true
    esOk = false
    pollNow = null
    clearInterval(timer)
    clearInterval(watchdogTimer)
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    tierClock?.stop()
    tierClock = null
    // Close the EventSource — a live connection would otherwise leak and
    // accumulate on every remount (Kimi review H).
    if (es !== null) {
      es.close()
      es = null
    }
  }
}

export function useHost<T>(selector: (host: HostState) => T): T | undefined {
  return useLowtide((s) => (s.host === null ? undefined : selector(s.host)))
}

import { useSyncExternalStore } from 'react'

export function useLowtide<T>(selector: (state: ClientUiState) => T): T {
  return useSyncExternalStore(
    (onChange) => lowtideStore.subscribe(onChange),
    () => selector(lowtideStore.getSnapshot()),
  )
}

/** Set by apply(ctx) — calls the host locale service's setLocale. */
let _setLocale: ((id: string) => void) | null = null

/** Called from apply(ctx) to wire up the host locale service. */
export function wireLocale(setLocale: (id: string) => void, active: string): void {
  _setLocale = setLocale
  lowtideStore.update((d) => { d.activeLocale = active })
}

/** Toggle between zh and en. Components call this directly. */
export function switchLocale(): void {
  const current = lowtideStore.getSnapshot().activeLocale
  const next = current === 'zh' ? 'en' : 'zh'
  _setLocale?.(next)
}
