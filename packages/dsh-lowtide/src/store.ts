/**
 * State file: $DSH_HOME/lowtide.json (DSH_HOME defaults to ~/.dsh).
 * When the running dsh process exposes a profile name (DSH_PROFILE), the
 * file is scoped per profile ($DSH_HOME/profiles/<profile>/lowtide.json)
 * so parallel instances (e.g. the desktop app and a dev `dsh web`) do not
 * fight over one file. Without the env var we fall back to the shared path
 * and rely on the README's single-instance note.
 */
import { createHash } from 'node:crypto'
import { chmodSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { defaultConfig, type MorningReport, type LowtideConfig, type Task, type TaskRun, type TaskStatus } from 'lowtide-core'

const fileRefSchema = z.object({
  path: z.string(),
  sha256: z.string().optional(),
  size: z.number().optional(),
})

const candidateSchema = z.object({
  excerpt: z.string(),
  costYuan: z.number(),
  elapsedMs: z.number(),
})

const taskRunSchema = z.object({
  at: z.string(),
  status: z.enum(['done', 'failed', 'timeout']),
  elapsedMs: z.number(),
  costYuan: z.number(),
  usage: z.object({
    input: z.number(), output: z.number(), cacheRead: z.number(), reasoning: z.number().optional(),
  }).optional(),
  diffStat: z.string().nullable().optional(),
  untracked: z.array(z.string()).nullable().optional(),
  error: z.string().optional(),
  assistantExcerpt: z.string().optional(),
  strategy: z.enum(['single', 'iterative', 'sampling', 'review']).optional(),
  roundsRun: z.number().optional(),
  candidates: z.array(candidateSchema).optional(),
  reviewExcerpt: z.string().optional(),
  /** Full assistant output stored to the outputs side dir (continuation). */
})

const taskSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  files: z.array(fileRefSchema),
  workspace: z.string(),
  gitRef: z.object({ sha: z.string(), branch: z.string() }).optional(),
  priority: z.number().min(0).max(9),
  deadline: z.string().optional(),
  permissionPreset: z.enum(['lt-readonly', 'lt-standard', 'lt-trusted']),
  status: z.enum(['pending-review', 'queued', 'deferred', 'dropped', 'preflight', 'running', 'done', 'failed', 'stale', 'timeout', 'cancelled']),
  createdAt: z.string(),
  triagedAt: z.string().optional(),
  triagedBy: z.enum(['user', 'auto-l3']).optional(),
  estimateYuan: z.number().optional(),
  estimateMinutes: z.number().optional(),
  strategy: z.enum(['single', 'iterative', 'sampling', 'review']).optional(),
  rounds: z.number().min(1).max(5).optional(),
  reasoning: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  /** Task-level batch model (any provider/model; absent = default flash). */
  model: z.string().optional(),
  /** Provider for the task-level model (absent = deepseek-official). */
  modelProvider: z.string().optional(),
  strategyHint: z.string().max(500).optional(),
  /** Per-task autonomy override (new-task modal); absent = followed global. */
  autonomy: z.enum(['l1', 'l2', 'l3']).optional(),
  /** Historical dsh session id to resume (agents.resume at execution). */
  continuesFromSession: z.string().optional(),
  chosenCandidateIndex: z.number().min(0).optional(),
  deferCount: z.number().optional(),
  lastError: z.string().optional(),
  lastRun: taskRunSchema.optional(),
  /** Last in-place edit timestamp (edit keeps the task id/status). */
  editedAt: z.string().optional(),
  /** Number of in-place edits applied to this task. */
  editCount: z.number().int().min(0).optional(),
})

const reportRowSchema = z.object({
  taskId: z.string(),
  prompt: z.string(),
  workspace: z.string(),
  status: z.enum(['done', 'failed', 'timeout', 'stale']),
  costYuan: z.number().optional(),
  elapsedMs: z.number().optional(),
  diffStat: z.string().nullable().optional(),
  error: z.string().optional(),
  strategy: z.enum(['single', 'iterative', 'sampling', 'review']).optional(),
  roundsRun: z.number().optional(),
  candidates: z.array(candidateSchema).optional(),
  reviewExcerpt: z.string().optional(),
})

const reportSchema = z.object({
  id: z.string(),
  date: z.string(),
  window: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  tasks: z.array(reportRowSchema),
  totalCostYuan: z.number(),
  savedYuan: z.number(),
  deferredCount: z.number().optional(),
  summary: z.string(),
})

/** "HH:MM" clock bounds (00:00–23:59). */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** IANA timezone validation: constructing a formatter with it must not throw. */
function isIanaTz(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

// Persistence schemas stay LENIENT (old state files must keep loading even if
// they carry values the API now rejects); the write path validates strictly.
const windowSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  level: z.enum(['peak', 'off', 'custom']),
  start: z.string(),
  end: z.string(),
  days: z.array(z.number()).optional(),
  tz: z.string().optional(),
  multiplier: z.number().optional(),
})

const batchSchema = z.object({
  window: z.string(),
  /** Multi-window list (issue #5); absent in pre-0.2.4 state files = [window]. */
  windows: z.array(z.string()).optional(),
  tz: z.string().optional(),
  gateLeadMin: z.number(),
  maxTasksPerNight: z.number(),
  maxDurationMin: z.number(),
  paused: z.boolean(),
  maxConcurrency: z.number().int().min(1).max(8).optional(),
})

// Strict variants for PUT /config: reject malformed times, timezones and
// out-of-range numbers before they can reach localParts/parseWindowRange and
// crash the scheduler (pentest P5: negative budgets/prices, zero multipliers,
// absurd batch bounds). NOTE: `days` is ISO weekdays 1=Mon … 7=Sun (see
// WindowCfg in lowtide-core), so the range is 1–7, NOT 0–6.
const strictWindowSchema = windowSchema.extend({
  start: z.string().regex(HHMM, '时间须为 HH:MM（00:00–23:59）'),
  end: z.string().regex(HHMM, '时间须为 HH:MM（00:00–23:59）'),
  tz: z.string().refine(isIanaTz, '非法时区').optional(),
  days: z.array(z.number().int().min(1).max(7)).optional(),
  multiplier: z.number().gt(0, '倍率必须大于 0').optional(),
})

const strictBatchSchema = batchSchema.extend({
  window: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, '窗口须为 HH:MM-HH:MM'),
  windows: z.array(
    z.string().regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, '窗口须为 HH:MM-HH:MM'),
  ).min(1, '至少保留一个运行窗口').max(6, '运行窗口最多 6 个').optional(),
  tz: z.string().refine(isIanaTz, '非法时区').optional(),
  gateLeadMin: z.number().min(0).max(120),
  maxTasksPerNight: z.number().int().min(1),
  maxDurationMin: z.number().min(1),
})

const configSchema = z.object({
  autonomy: z.enum(['l1', 'l2', 'l3']),
  batch: batchSchema,
  windows: z.array(windowSchema),
  prices: z.record(z.string(), z.record(z.string(), z.object({ input: z.number(), inputCached: z.number(), output: z.number() }))),
  budgetDailyYuan: z.number(),
  // Optional on load: pre-rename state files lack the field; addReport falls
  // back to the default (60). Rejecting here would reset the state file.
  maxReportHistory: z.number().int().min(0).optional(),
})

/**
 * Partial config update accepted by PUT /ds-lowtide/config.
 * Removed `.strict()` so older clients with extra fields don't break
 * forward-compatibility (unknown keys are silently stripped by zod default).
 */
export const configUpdateSchema = z.object({
  autonomy: z.enum(['l1', 'l2', 'l3']).optional(),
  batch: strictBatchSchema.partial().optional(),
  windows: z.array(strictWindowSchema).optional(),
  prices: z.record(z.string(), z.object({
    peak: z.object({ input: z.number().min(0), inputCached: z.number().min(0), output: z.number().min(0) }),
    off: z.object({ input: z.number().min(0), inputCached: z.number().min(0), output: z.number().min(0) }),
  })).optional(),
  budgetDailyYuan: z.number().min(0).optional(),
  maxReportHistory: z.number().int().min(0).optional(),
})

export type ConfigUpdate = z.infer<typeof configUpdateSchema>

/**
 * Keep `batch.window` and `batch.windows` consistent (issue #5): a patch
 * carrying `windows` is authoritative and mirrors its first entry into the
 * legacy `window` field (so a downgrade keeps running window #1); a patch
 * carrying only `window` (single-window client) collapses the list to it.
 * Patches touching neither leave both untouched.
 */
function normalizeBatchWindows(
  merged: LowtideConfig['batch'],
  patch: NonNullable<ConfigUpdate['batch']>,
): LowtideConfig['batch'] {
  if (patch.windows !== undefined) {
    const list = [...patch.windows]
    return { ...merged, window: list[0] ?? merged.window, windows: list }
  }
  if (patch.window !== undefined) {
    return { ...merged, windows: [patch.window] }
  }
  return merged
}

const stateSchema = z.object({
  version: z.literal(1),
  config: configSchema,
  tasks: z.array(taskSchema),
  reports: z.array(reportSchema),
  ledger: z.record(z.string(), z.object({ yuan: z.number(), savedYuan: z.number() })),
  dismissedPeakDay: z.string().optional(),
})

export interface LedgerDay {
  yuan: number
  savedYuan: number
}

export interface StoreState {
  version: 1
  config: LowtideConfig
  tasks: Task[]
  reports: MorningReport[]
  ledger: Record<string, LedgerDay>
  dismissedPeakDay?: string
}

export function stateFilePath(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const profile = process.env.DSH_PROFILE
  return profile === undefined || profile === ''
    ? join(home, 'lowtide.json')
    : join(home, 'profiles', profile, 'lowtide.json')
}

/** The pre-rename state file (old name dsh-nightshift) for the same\n * directory. The legacy filename is FUNCTIONAL — migration reads it. */
function legacyStateFilePath(file: string): string {
  return join(dirname(file), 'nightshift.json')
}

/** Pre-rename permission preset values (ns-* → lt-*). */
const LEGACY_PRESET_MAP: Record<string, string> = {
  'ns-readonly': 'lt-readonly',
  'ns-standard': 'lt-standard',
  'ns-trusted': 'lt-trusted',
}

/** Recursively rewrite legacy `permissionPreset: "ns-*"` values so the new
 *  strict schema accepts the migrated state (rename migration, LOWTIDE plan). */
function convertLegacyState(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convertLegacyState)
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'permissionPreset' && typeof value === 'string' && value in LEGACY_PRESET_MAP) {
        out[key] = LEGACY_PRESET_MAP[value]
      } else {
        out[key] = convertLegacyState(value)
      }
    }
    return out
  }
  return node
}

/** Hard cap for locked-file snapshots: bigger files are refused (pentest P8).
 *  Hashing streams, but a multi-hundred-MB locked file is almost certainly a
 *  mistake and would stall the batch. */
export const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024

/**
 * File snapshot: sha256 + size via a STREAM (readFileSync would load a
 * multi-GB file fully into memory — Kimi review H3). The size cap is checked
 * via stat BEFORE opening the stream so an oversized file is rejected without
 * reading a single byte.
 */
export async function snapshotFile(path: string): Promise<{ sha256: string; size: number }> {
  const { size: statSize } = statSync(path)
  if (statSize > MAX_SNAPSHOT_BYTES) {
    throw new Error(`文件过大（>${Math.floor(MAX_SNAPSHOT_BYTES / 1024 / 1024)}MB），不适合作为锁定文件`)
  }
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
    size += chunk.length
    // Backstop: the file grew between stat and read.
    if (size > MAX_SNAPSHOT_BYTES) {
      throw new Error(`文件过大（>${Math.floor(MAX_SNAPSHOT_BYTES / 1024 / 1024)}MB），不适合作为锁定文件`)
    }
  }
  return { sha256: hash.digest('hex'), size }
}

/** Round to micro-yuan (1e-6) — ledger additions must not accumulate drift. */
function roundMicro(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function localDateKey(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export class LowtideStore {
  private state: StoreState
  private readonly file: string

  constructor(file: string, seed: StoreState) {
    this.file = file
    this.state = this.recover(seed)
  }

  static load(file: string): LowtideStore {
    // Rename migration: the new lowtide.json is absent but the pre-rename
    // nightshift.json exists — convert (permissionPreset ns-* → lt-*), write
    // the new file, keep the legacy one as a .migrated backup. Never drop
    // the user's queue/ledger/reports on a rename.
    if (!existsSync(file) && existsSync(legacyStateFilePath(file))) {
      try {
        const legacy = legacyStateFilePath(file)
        const raw = JSON.parse(readFileSync(legacy, 'utf8')) as unknown
        const converted = convertLegacyState(raw)
        const parsed = stateSchema.safeParse(converted)
        if (parsed.success) {
          mkdirSync(dirname(file), { recursive: true })
          writeFileSync(file, JSON.stringify(parsed.data, null, 2), 'utf8')
          renameSync(legacy, `${legacy}.migrated`)
          return new LowtideStore(file, parsed.data as StoreState)
        }
      } catch {
        // Unparsable legacy file: fall through to a fresh state (the legacy
        // file stays untouched for manual recovery).
      }
    }
    if (existsSync(file)) {
      try {
        const parsed = stateSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
        if (parsed.success) return new LowtideStore(file, parsed.data as StoreState)
      } catch {
        // Unparsable JSON falls through to the backup path below.
      }
      // Corrupt/older schema: back it up rather than silently dropping it.
      const backup = `${file}.bak-${Date.now()}`
      try {
        renameSync(file, backup)
      } catch {
        rmSync(file, { force: true })
      }
      return new LowtideStore(file, defaultState())
    }
    return new LowtideStore(file, defaultState())
  }

  /** Startup scan: a dead process leaves running/preflight behind — requeue them. */
  private recover(state: StoreState): StoreState {
    let changed = false
    for (const task of state.tasks) {
      if (task.status === 'running' || task.status === 'preflight') {
        task.status = 'queued'
        task.lastError = 'overdue recovery: host restarted while executing'
        changed = true
      }
    }
    return changed ? { ...state, tasks: [...state.tasks] } : state
  }

  snapshot(): StoreState {
    return this.state
  }

  /** Atomic-ish write: tmp in the same directory, then rename over.
   *  tmp is cleaned up in every path (including crashes during rename). */
  save(): void {
    const tmp = `${this.file}.tmp-${Date.now()}`
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8')
      try {
        renameSync(tmp, this.file)
      } catch {
        rmSync(this.file, { force: true })
        renameSync(tmp, this.file)
      }
      // The state file carries full task prompts and paths — keep it
      // owner-only on posix (Windows ACLs make chmod a no-op there, skip it).
      if (process.platform !== 'win32') {
        try { chmodSync(this.file, 0o600) } catch { /* best-effort */ }
      }
    } finally {
      // Always attempt to remove the tmp file — it may have been left behind
      // by a failed write or a crashed rename (second rename also failed).
      try { rmSync(tmp, { force: true }) } catch { /* absent or permission — ignore */ }
    }
  }

  private mutate<T>(fn: () => T): T {
    const result = fn()
    this.save()
    return result
  }

  get tasks(): readonly Task[] {
    return this.state.tasks
  }

  get config(): LowtideConfig {
    return this.state.config
  }

  get reports(): readonly MorningReport[] {
    return this.state.reports
  }

  setConfig(config: LowtideConfig): void {
    this.mutate(() => { this.state.config = config })
  }

  /** Merge a validated partial update into the live config (deep-merge batch). */
  updateConfig(patch: ConfigUpdate): LowtideConfig {
    return this.mutate(() => {
      this.state.config = {
        ...this.state.config,
        ...(patch.autonomy !== undefined ? { autonomy: patch.autonomy } : {}),
        ...(patch.budgetDailyYuan !== undefined ? { budgetDailyYuan: patch.budgetDailyYuan } : {}),
        ...(patch.maxReportHistory !== undefined ? { maxReportHistory: patch.maxReportHistory } : {}),
        ...(patch.windows !== undefined ? { windows: patch.windows } : {}),
        ...(patch.prices !== undefined ? { prices: patch.prices } : {}),
        batch: patch.batch === undefined
          ? this.state.config.batch
          : normalizeBatchWindows({ ...this.state.config.batch, ...patch.batch }, patch.batch),
      }
      return this.state.config
    })
  }

  addTask(task: Task): Task {
    return this.mutate(() => {
      this.state.tasks.push(task)
      return task
    })
  }

  taskById(id: string): Task | undefined {
    return this.state.tasks.find((t) => t.id === id)
  }

  /**
   * Hard-delete a task: removes it from the persisted state for good
   * (user-level "投错/不要了" path). Reports and the ledger are history
   * snapshots and stay untouched; the route layer guards running tasks.
   */
  deleteTask(id: string): boolean {
    return this.mutate(() => {
      const index = this.state.tasks.findIndex((t) => t.id === id)
      if (index === -1) return false
      this.state.tasks.splice(index, 1)
      return true
    })
  }

  setStatus(id: string, status: TaskStatus, patch?: Partial<Task>): Task | undefined {
    return this.mutate(() => {
      const task = this.state.tasks.find((t) => t.id === id)
      if (task === undefined) return undefined
      task.status = status
      if (patch !== undefined) Object.assign(task, patch)
      return task
    })
  }

  /**
   * Edit a task IN PLACE: the id, createdAt, status and triage records are
   * untouched; every content field (prompt/files/workspace/gitRef/strategy/
   * model/estimates/…) is replaced from the validated patch, the stale
   * lastError is cleared, and the edit audit counters are bumped. The route
   * layer must guard statuses via canEdit() before calling this.
   */
  editTask(id: string, patch: Partial<Task>): Task | undefined {
    return this.mutate(() => {
      const task = this.state.tasks.find((t) => t.id === id)
      if (task === undefined) return undefined
      const editedAt = new Date().toISOString()
      // Content-only merge: never touch identity, lifecycle or triage fields.
      const { id: _id, createdAt: _createdAt, status: _status, triagedAt: _triagedAt, triagedBy: _triagedBy, editedAt: _editedAt, editCount: _editCount, ...content } = patch
      Object.assign(task, content)
      task.lastError = undefined
      task.editedAt = editedAt
      task.editCount = (task.editCount ?? 0) + 1
      return task
    })
  }

  recordRun(id: string, run: TaskRun, finalStatus: TaskStatus): Task | undefined {
    return this.mutate(() => {
      const task = this.state.tasks.find((t) => t.id === id)
      if (task === undefined) return undefined
      task.lastRun = run
      task.status = finalStatus
      if (run.error !== undefined) task.lastError = run.error
      const key = localDateKey(new Date())
      const day = this.state.ledger[key] ?? { yuan: 0, savedYuan: 0 }
      // Round each addition to micro-yuan so drift never accumulates (Kimi review).
      day.yuan = roundMicro(day.yuan + run.costYuan)
      this.state.ledger[key] = day
      return task
    })
  }

  addSavings(savedYuan: number): void {
    this.mutate(() => {
      const key = localDateKey(new Date())
      const day = this.state.ledger[key] ?? { yuan: 0, savedYuan: 0 }
      day.savedYuan = roundMicro(day.savedYuan + savedYuan)
      this.state.ledger[key] = day
    })
  }

  ledgerToday(now: Date): LedgerDay {
    return this.state.ledger[localDateKey(now)] ?? { yuan: 0, savedYuan: 0 }
  }

  dismissPeakToday(): void {
    this.mutate(() => { this.state.dismissedPeakDay = localDateKey(new Date()) })
  }

  isPeakDismissedToday(now: Date): boolean {
    return this.state.dismissedPeakDay === localDateKey(now)
  }

  addReport(report: MorningReport): void {
    this.mutate(() => {
      this.state.reports.unshift(report)
      const limit = this.state.config.maxReportHistory ?? 60
      if (limit > 0 && this.state.reports.length > limit) {
        this.state.reports.length = limit
      }
    })
  }

  /** Delete a single report by id (ledger and tasks are untouched evidence). */
  deleteReport(reportId: string): boolean {
    return this.mutate(() => {
      const index = this.state.reports.findIndex((r) => r.id === reportId)
      if (index === -1) return false
      this.state.reports.splice(index, 1)
      return true
    })
  }

  /** Clear all reports (keep ledger and tasks untouched). Returns removed count. */
  clearReports(): number {
    return this.mutate(() => {
      const count = this.state.reports.length
      this.state.reports = []
      return count
    })
  }
}

export function defaultState(): StoreState {
  return {
    version: 1,
    config: defaultConfig(),
    tasks: [],
    reports: [],
    ledger: {},
  }
}
