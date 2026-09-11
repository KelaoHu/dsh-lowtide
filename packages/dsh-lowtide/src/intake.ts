/**
 * Task intake (PLAN T1.3): schema validation, path absolutization, file
 * snapshots (sha256/size), gitRef capture, cost estimate. All intake paths
 * land the task in pending-review — the human adjudication gate (PLAN §2.1).
 */
import { randomUUID } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'
import { z } from 'zod'
import {
  DEFAULT_ESTIMATE_MINUTES,
  DEFAULT_MODEL_ID,
  estimate as coreEstimate,
  FALLBACK_TIER,
  hasPriceEntry,
  MAX_ROUNDS,
  OFFICIAL_PRICES,
  type PermissionPreset,
  type PriceRow,
  type PriceTier,
  type Task,
} from 'lowtide-core'
import { gitRef } from './git.ts'
import { snapshotFile } from './store.ts'

export const taskInputSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  files: z.array(z.union([z.string(), z.object({ path: z.string() })])).default([]),
  workspace: z.string().optional().default(''),
  priority: z.number().int().min(0).max(9).optional().default(3),
  deadline: z.string().optional(),
  permissionPreset: z.enum(['lt-readonly', 'lt-standard', 'lt-trusted']).optional().default('lt-standard'),
  strategy: z.enum(['single', 'iterative', 'sampling', 'review']).optional().default('single'),
  rounds: z.number().int().min(1).max(MAX_ROUNDS).optional().default(1),
  reasoning: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  /** Task-level batch model (any provider/model; absent = default flash). */
  model: z.string().optional(),
  /** Provider for the task-level model (absent = deepseek-official). */
  modelProvider: z.string().optional(),
  strategyHint: z.string().max(500).optional(),
  /** Per-task autonomy override (new-task modal button group). Absent =
   *  follow the global config; only explicit overrides are persisted. */
  autonomy: z.enum(['l1', 'l2', 'l3']).optional(),
  /** A historical dsh session id to resume — the task continues that
   *  conversation's context (agents.resume at execution time). */
  continuesFromSession: z.string().optional(),
})

export type TaskInput = z.infer<typeof taskInputSchema>

export interface IntakeResult {
  ok: boolean
  task?: Task
  error?: string
}

export async function intake(
  input: unknown,
  defaultWorkspace: string,
  options?: {
    autonomy?: 'l1' | 'l2' | 'l3'
    /** Model used for the estimate (defaults to flash). */
    modelId?: string
    /** Price overrides; merged over the official table. */
    prices?: Record<string, unknown>
  },
): Promise<IntakeResult> {
  const parsed = taskInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: `任务信息不合法：${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}` }
  }
  const data = parsed.data

  const workspaceRaw = data.workspace === '' ? defaultWorkspace : data.workspace
  const workspace = isAbsolute(workspaceRaw) ? resolve(workspaceRaw) : resolve(defaultWorkspace, workspaceRaw)
  if (!existsSync(workspace)) {
    return { ok: false, error: `工作区不存在：${workspace}` }
  }

  // File snapshot: absolutize against the workspace, hash + size, refuse missing files.
  // Confinement (pentest P3/P4): the REAL path (symlinks resolved) must stay
  // inside the real workspace root — `../../outside` and in-workspace symlinks
  // pointing outside are both rejected. The workspace itself stays "exists is
  // enough" — picking any local directory as workspace is by design.
  const workspaceRoot = realpathSync(workspace)
  const files: Task['files'] = []
  for (const entry of data.files) {
    const raw = typeof entry === 'string' ? entry : entry.path
    const abs = isAbsolute(raw) ? resolve(raw) : resolve(workspace, raw)
    if (!existsSync(abs)) return { ok: false, error: `文件不存在：${abs}` }
    const real = realpathSync(abs)
    if (real !== workspaceRoot && !real.startsWith(workspaceRoot + sep)) {
      return { ok: false, error: `文件路径越界（须位于工作区内）：${raw}` }
    }
    try {
      const snap = await snapshotFile(abs)
      files.push({ path: abs, sha256: snap.sha256, size: snap.size })
    } catch (error) {
      return { ok: false, error: `无法读取文件 ${abs}：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  const ref = await gitRef(workspace)

  // Input-bound estimate against the batch model and any price overrides
  // (review round 1, B7 — the estimate must match what the UI charges),
  // scaled by the strategy's cost factor (PLAN v2 §1: 迭代/采样 = N× 单次;
  // 复核 = 2× 单次:执行 + 独立审查)。
  const sizes = files.map((f) => ({ size: f.size ?? 0 }))
  // Task-level model wins, then the route's default (the live Harness
  // selection), then the current official flash id — the estimate must match
  // the model that actually runs (pro costs more).
  const modelId = data.model ?? options?.modelId ?? DEFAULT_MODEL_ID
  const prices = mergePrices(options?.prices)
  const priced = coreEstimate(data.prompt, sizes, modelId, prices)
  // Unknown-price models (non-deepseek providers) get NO estimate — the UI
  // shows "价格未知" instead of a made-up flash-tier number.
  const priceKnown = hasPriceEntry(modelId, prices)
  const strategy = data.strategy
  const rounds = strategy === 'single' || strategy === 'review' ? 1 : Math.min(Math.max(data.rounds, 1), MAX_ROUNDS)
  // 调用次数估算:单次=1;迭代=生成 1 + (rounds-1) 轮 × (审查+修复 2 次)
  // (Smart Iterative, v4);采样=rounds 份;复核=执行+审查 2 次。
  const costFactor = strategy === 'review'
    ? 2
    : strategy === 'iterative'
      ? 1 + (rounds - 1) * 2
      : strategy === 'sampling'
        ? rounds
        : 1

  // 自治档位(PLAN §2.3):任务级覆盖优先,否则跟随全局;L3 投递即 queued
  // (auto-l3 审计),L1/L2 落 pending-review 人工裁定。
  const autonomy = data.autonomy ?? options?.autonomy ?? 'l2'
  const autoQueued = autonomy === 'l3'
  const now = new Date().toISOString()

  const task: Task = {
    id: `lt-${randomUUID().slice(0, 8)}`,
    prompt: data.prompt,
    files,
    workspace,
    ...(ref !== null ? { gitRef: ref } : {}),
    priority: data.priority,
    ...(data.deadline !== undefined ? { deadline: data.deadline } : {}),
    permissionPreset: data.permissionPreset as PermissionPreset,
    status: autoQueued ? 'queued' : 'pending-review',
    ...(autoQueued ? { triagedAt: now, triagedBy: 'auto-l3' as const } : {}),
    ...(data.autonomy !== undefined ? { autonomy: data.autonomy } : {}),
    ...(data.model !== undefined ? { model: data.model } : {}),
    ...(data.modelProvider !== undefined ? { modelProvider: data.modelProvider } : {}),
    ...(data.continuesFromSession !== undefined ? { continuesFromSession: data.continuesFromSession } : {}),
    createdAt: now,
    strategy,
    rounds,
    ...(data.reasoning !== undefined ? { reasoning: data.reasoning } : {}),
    ...(data.strategyHint !== undefined && data.strategyHint.trim() !== '' ? { strategyHint: data.strategyHint.trim() } : {}),
    estimateYuan: priceKnown ? Number((priced.off * costFactor).toFixed(6)) : undefined,
    estimateMinutes: DEFAULT_ESTIMATE_MINUTES * costFactor,
  }
  return { ok: true, task }
}

/** Merge price overrides over the official table (deep, per-model). */
function mergePrices(overrides: Record<string, unknown> | undefined): Record<string, PriceTier> {
  if (overrides === undefined) return OFFICIAL_PRICES
  const merged: Record<string, PriceTier> = { ...OFFICIAL_PRICES }
  for (const [model, tier] of Object.entries(overrides)) {
    const t = tier as { peak?: Partial<PriceRow>; off?: Partial<PriceRow> }
    const base = merged[model] ?? FALLBACK_TIER
    merged[model] = {
      peak: { ...base.peak, ...(t.peak ?? {}) },
      off: { ...base.off, ...(t.off ?? {}) },
    }
  }
  return merged
}
