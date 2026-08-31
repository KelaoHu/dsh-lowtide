/**
 * Client entry store: the host state aggregate mirror + UI state.
 * Plain snapshot store from the runtime engine; components subscribe with
 * useSyncExternalStore. Polling every 4s drives it (SSE arrives in T2.1).
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

export interface HostState {
  ok: boolean
  time: string
  autonomy: string
  level: { level: string; multiplier: number; window: { id: string; label?: string; start: string; end: string } } | null
  price: {
    model: string
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
  nextBatchAt: number
  countdownMs: number
  nextOffPeakAt: number | null
  /** System IANA timezone + official peak windows converted to local clock
   *  (settings explainer + one-click adopt). */
  systemTz: string
  officialInLocal: Array<{ label: string; start: string; end: string; crossesDay: boolean }>
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

/** Poll the host aggregate every 4s; returns the stop function. */
let pollNow: (() => Promise<void>) | null = null

/** Trigger one immediate poll (used after write actions for fast refresh). */
export function refreshNow(): void {
  if (pollNow !== null) void pollNow()
}

function applyState(state: HostState): void {
  lowtideStore.update((draft) => {
    const previous = draft.host
    draft.host = state
    draft.connected = true
    draft.error = null
    const latestId = state.latestReport?.id ?? null
    if (latestId !== null && latestId !== draft.lastReportId) {
      draft.reportUnread = true
    }
    if (latestId !== null && latestId !== draft.lastReportId && previous !== null) {
      draft.reportUnread = true
    }
    draft.lastReportId = latestId ?? draft.lastReportId
  })
}

export function startPolling(): () => void {
  let stopped = false
  let esOk = false
  let es: EventSource | null = null

  async function poll(): Promise<void> {
    if (stopped || esOk) return // SSE 健康时跳过轮询(降级路径)
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

  function connectSSE(): void {
    if (stopped || typeof EventSource === 'undefined') return
    const source = new EventSource('/ds-lowtide/events')
    es = source
    source.addEventListener('state', (event) => {
      try {
        applyState(JSON.parse((event as MessageEvent).data) as HostState)
      } catch {
        /* 忽略坏帧,等下一个事件 */
      }
    })
    source.onopen = () => {
      esOk = true
      lowtideStore.update((draft) => { draft.connected = true; draft.error = null })
    }
    source.onerror = () => {
      // 断线:停止实时,回落到 4s 轮询;EventSource 自带重连,恢复后 onopen 重新置 esOk。
      esOk = false
      lowtideStore.update((draft) => {
        draft.connected = false
        draft.error = '实时连接断开，已切换轮询重连…'
      })
    }
  }

  pollNow = poll
  void poll()
  const timer = setInterval(() => { void poll() }, 4000)
  connectSSE()
  return () => {
    stopped = true
    esOk = false
    pollNow = null
    clearInterval(timer)
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
