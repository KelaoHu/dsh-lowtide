/**
 * Work-order model: platform-agnostic task schema (PLAN §7.4 v1 increments).
 * The zod validation schema lives in the dsh store adapter; this module keeps
 * the wire/UI-facing types dependency-free for both platform shells.
 */

import type { PriceTier } from './pricing.ts'
import { OFFICIAL_PEAK_WINDOWS } from './pricing.ts'
import type { WindowCfg } from './windows.ts'

export type TaskStatus =
  | 'pending-review'
  | 'queued'
  | 'deferred'
  | 'dropped'
  | 'preflight'
  | 'running'
  | 'done'
  | 'failed'
  | 'stale'
  | 'timeout'
  | 'cancelled'

export type Autonomy = 'l1' | 'l2' | 'l3'

export type PermissionPreset = 'lt-readonly' | 'lt-standard' | 'lt-trusted'

/**
 * Execution strategy (PLAN v2 §1 + v3.1):
 *  - single:    one shot, exactly like a normal harness prompt;
 *  - iterative: one session, N turns — each later turn reviews and improves
 *               the previous output ("反思型迭代");
 *  - sampling:  N independent fresh sessions of the same prompt — N
 *               candidates are generated at night and the USER picks the best
 *               the next morning (no auto-selection, no synthesis);
 *  - review:    one execution + one INDEPENDENT fresh session that critiques
 *               the result (second-opinion review, PLAN v3.1 §7).
 */
export type TaskStrategy = 'single' | 'iterative' | 'sampling' | 'review'

export const MAX_ROUNDS = 5

/** Reasoning effort levels across harness adapters. DeepSeek ships
 *  off/low/high/max; llm-pi-ai providers may additionally expose
 *  minimal/medium/xhigh. The union covers every level any adapter can offer
 *  so per-model reasoning stays provider-agnostic. */
export type ReasoningEffort = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** The two models with official price entries (used as deepseek defaults). */
export const OFFICIAL_MODELS: readonly string[] = ['deepseek-v4-flash', 'deepseek-v4-pro']

export interface FileRef {
  path: string
  sha256?: string
  size?: number
}

export interface Task {
  id: string
  prompt: string
  files: FileRef[]
  workspace: string
  gitRef?: { sha: string; branch: string }
  priority: number
  deadline?: string
  permissionPreset: PermissionPreset
  status: TaskStatus
  createdAt: string
  triagedAt?: string
  triagedBy?: 'user' | 'auto-l3'
  estimateYuan?: number
  estimateMinutes?: number
  /** Execution strategy (single by default; optional for persisted v1 tasks). */
  strategy?: TaskStrategy
  /** Rounds for iterative/sampling (1 for single; capped at MAX_ROUNDS). */
  rounds?: number
  /** Per-task reasoning effort override (absent = follow the global default). */
  reasoning?: ReasoningEffort
  /** Task-level batch model (any provider/model from this machine's dsh
   *  configuration; absent = deepseek-v4-flash default). */
  model?: string
  /** Provider for the task-level model override (absent = deepseek-official). */
  modelProvider?: string
  /** User guidance injected into iterative / sampling / review prompts (≤500). */
  strategyHint?: string
  /** Per-task autonomy override (new-task modal); absent = followed global. */
  autonomy?: Autonomy
  /** User-marked best candidate of a sampling task (set via choose-candidate). */
  chosenCandidateIndex?: number
  /** A historical dsh session id — this task resumes that conversation and
   *  continues from its full context (agents.resume at execution time). */
  continuesFromSession?: string
  /** How many times preflight deferred this task (window fit / budget). */
  deferCount?: number
  lastError?: string
  lastRun?: TaskRun
  /** Last in-place edit timestamp (edit keeps the task id/status). */
  editedAt?: string
  /** Number of in-place edits applied to this task. */
  editCount?: number
}

/** One sampling candidate: enough excerpt for the user to judge the next
 * morning (worker sessions are disposed; full outputs are not retained). */
export interface CandidateResult {
  excerpt: string
  costYuan: number
  elapsedMs: number
}

/** One execution attempt record (cost/diff evidence for the execution report). */
export interface TaskRun {
  at: string
  status: 'done' | 'failed' | 'timeout'
  elapsedMs: number
  costYuan: number
  usage?: { input: number; output: number; cacheRead: number; reasoning?: number }
  diffStat?: string | null
  untracked?: string[] | null
  error?: string
  assistantExcerpt?: string
  /** Strategy that produced this run (for display: "迭代 3 轮"). */
  strategy?: TaskStrategy
  /** Actual rounds executed (early-stop may run fewer than configured). */
  roundsRun?: number
  /** Sampling candidates (present only for strategy=sampling). */
  candidates?: CandidateResult[]
  /** Review-mode second-opinion critique excerpt (strategy=review). */
  reviewExcerpt?: string
  /** True when the run CONTINUED the requested conversation in place. */
  resumed?: boolean
  /** True when the run ran in a NEW session seeded with the source's full
   *  history (fork-style continuation). */
  forked?: boolean
  /** Set when the requested conversation resume failed and a fresh session was used. */
  resumeNote?: string
}

export interface MorningReport {
  id: string
  date: string
  /** Batch window that ran, e.g. "19:00-23:30". */
  window: string
  startedAt: string
  finishedAt: string
  tasks: ReportTaskRow[]
  totalCostYuan: number
  savedYuan: number
  /** Tasks preflight-deferred to a later window during this batch. */
  deferredCount?: number
  summary: string
}

export interface ReportTaskRow {
  taskId: string
  prompt: string
  workspace: string
  status: 'done' | 'failed' | 'timeout' | 'stale'
  costYuan?: number
  elapsedMs?: number
  diffStat?: string | null
  error?: string
  /** Strategy that produced this row (for "迭代 3 轮 / 采样 3 份 / 已复核"). */
  strategy?: TaskStrategy
  roundsRun?: number
  candidates?: CandidateResult[]
  reviewExcerpt?: string
}

export interface LowtideConfig {
  autonomy: Autonomy
  batch: {
    window: string
    tz?: string
    gateLeadMin: number
    maxTasksPerNight: number
    maxDurationMin: number
    paused: boolean
    /** Concurrent workspace groups in one batch (1–8, default 3). */
    maxConcurrency?: number
  }
  windows: WindowCfg[]
  prices: Record<string, PriceTier>
  /** Daily budget in ¥; 0 = unlimited (T2.7 fills the policy knobs). */
  budgetDailyYuan: number
  /** Report history kept in state (0 = unlimited). Default 60. */
  maxReportHistory: number
}

export const DEFAULT_BATCH_WINDOW = '19:00-23:30'
export const DEFAULT_GATE_LEAD_MIN = 30
export const DEFAULT_ESTIMATE_MINUTES = 30
export const DEFAULT_MAX_CONCURRENCY = 3
export const DEFAULT_MAX_REPORT_HISTORY = 60

export function defaultConfig(): LowtideConfig {
  return {
    autonomy: 'l2',
    batch: {
      window: DEFAULT_BATCH_WINDOW,
      gateLeadMin: DEFAULT_GATE_LEAD_MIN,
      maxTasksPerNight: 10,
      maxDurationMin: 240,
      paused: false,
      maxConcurrency: DEFAULT_MAX_CONCURRENCY,
    },
    // A fresh install follows the OFFICIAL DeepSeek peak/valley windows
    // (weekdays 09:00–12:00 & 14:00–18:00 Beijing; weekends always off-peak).
    // Explicit rather than empty: visible in the UI, exportable, and identical
    // to the "adopt official" state. Empty arrays are still honored as
    // "official fallback" for pre-existing configs.
    windows: OFFICIAL_PEAK_WINDOWS.map((w) => ({ ...w })),
    prices: {},
    budgetDailyYuan: 0,
    maxReportHistory: DEFAULT_MAX_REPORT_HISTORY,
  }
}
