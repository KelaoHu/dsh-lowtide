/**
 * HTTP helpers for the /ds-lowtide API (same-origin fetch).
 * Optimistic-write callers handle rollback; these helpers just carry the wire.
 */
export interface EstimateResponse {
  ok: boolean
  peak: number
  off: number
  model: string
  batchModel?: string
}

export interface TaskResponse {
  ok: boolean
  task?: import('./store.ts').HostTask
  error?: string
}

export async function estimate(prompt: string, files: { size: number }[], model?: string, batchModel?: string): Promise<EstimateResponse> {
  const res = await fetch('/ds-lowtide/estimate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, files, model, batchModel }),
  })
  return await res.json() as EstimateResponse
}

export async function submitTask(input: {
  prompt: string
  files: string[]
  workspace: string
  priority: number
  permissionPreset: string
  strategy?: 'single' | 'iterative' | 'sampling' | 'review'
  rounds?: number
  reasoning?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** Task-level batch model override (advanced window; absent = follows default). */
  model?: string
  /** Provider for the task-level model override (absent = follows the live selection). */
  modelProvider?: string
  strategyHint?: string
  /** Per-task autonomy override (new-task modal); absent = follow global. */
  autonomy?: 'l1' | 'l2' | 'l3'
}): Promise<TaskResponse> {
  const res = await fetch('/ds-lowtide/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return await res.json() as TaskResponse
}

/**
 * Edit an existing task IN PLACE (status preserved — a pending-review task
 * stays pending-review, a queued one stays queued). The request body is the
 * same full form used by submitTask; the server re-runs intake and refreshes
 * the content fields, keeping id/createdAt/status/triage records.
 */
export async function editTask(id: string, input: Parameters<typeof submitTask>[0]): Promise<TaskResponse> {
  const res = await fetch(`/ds-lowtide/tasks/${encodeURIComponent(id)}/edit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return await res.json() as TaskResponse
}

export async function triage(id: string, action: 'approve' | 'defer' | 'drop' | 'cancel'): Promise<unknown> {
  const res = await fetch(`/ds-lowtide/tasks/${id}/${action}`, { method: 'POST' })
  return await res.json() as unknown
}

/** 采样任务的次日择优:记录用户选定的候选序号。 */
export async function chooseCandidate(id: string, index: number): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/ds-lowtide/tasks/${id}/choose-candidate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ index }),
  })
  return await res.json() as { ok: boolean; error?: string }
}

/** Hard-delete a task for good (as opposed to the soft `drop` triage). */
export async function deleteTask(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/ds-lowtide/tasks/${id}/delete`, { method: 'POST' })
  return await res.json() as { ok: boolean; error?: string }
}

/** 重新执行:清错误重新入队,下次窗口或「立即开跑」时执行。 */
export async function retryTask(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/ds-lowtide/tasks/${id}/retry`, { method: 'POST' })
  return await res.json() as { ok: boolean; error?: string }
}

/** 恢复已放弃:dropped → pending-review,由用户重新裁定。 */
export async function restoreTask(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/ds-lowtide/tasks/${id}/restore`, { method: 'POST' })
  return await res.json() as { ok: boolean; error?: string }
}

export async function approveAll(): Promise<{ ok: boolean; approved: number }> {
  const res = await fetch('/ds-lowtide/tasks/approve-all', { method: 'POST' })
  return await res.json() as { ok: boolean; approved: number }
}

/** 清空已完成:删除全部 done 任务(执行报告历史保留证据)。 */
export async function clearFinished(): Promise<{ ok: boolean; cleared?: number; error?: string }> {
  const res = await fetch('/ds-lowtide/tasks/clear-finished', { method: 'POST' })
  return await res.json() as { ok: boolean; cleared?: number; error?: string }
}

export async function runNow(): Promise<{ ok: boolean }> {
  const res = await fetch('/ds-lowtide/batch/run-now', { method: 'POST' })
  return await res.json() as { ok: boolean }
}

export async function dismissPeakToday(): Promise<{ ok: boolean }> {
  const res = await fetch('/ds-lowtide/dismiss', { method: 'POST' })
  return await res.json() as { ok: boolean }
}

export interface ConfigResponse {
  ok: boolean
  config?: Record<string, unknown>
  error?: string
}

import type { HostReport } from './store.ts'

export interface ReportsResponse {
  ok: boolean
  reports?: HostReport[]
  total?: number
  /** maxReportHistory (0 = unlimited) — for the "showing latest N" label. */
  limit?: number
  error?: string
}

/** Morning-report history (newest first). */
export async function getReports(): Promise<ReportsResponse> {
  const res = await fetch('/ds-lowtide/reports', { cache: 'no-store' })
  return await res.json() as ReportsResponse
}

/** Delete a single report by id (ledger and tasks are untouched). */
export async function deleteReport(reportId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/ds-lowtide/reports/${encodeURIComponent(reportId)}`, { method: 'DELETE' })
  return await res.json() as { ok: boolean; error?: string }
}

/** Clear all reports. Returns how many were removed. */
export async function clearReports(): Promise<{ ok: boolean; cleared?: number; error?: string }> {
  const res = await fetch('/ds-lowtide/reports/clear', { method: 'POST' })
  return await res.json() as { ok: boolean; cleared?: number; error?: string }
}

/** Real user conversations per workspace (for the "continue from a
 *  conversation" picker). Read-only scan of the dsh storage files. */
export interface WorkspaceSessionEntry {
  id: string
  title: string | null
  lastModified: number
}

export interface WorkspaceSessionsEntry {
  cwd: string
  label: string | null
  sessions: WorkspaceSessionEntry[]
}

export interface SessionsResponse {
  ok: boolean
  workspaces?: WorkspaceSessionsEntry[]
  error?: string
}

export async function getSessions(): Promise<SessionsResponse> {
  const res = await fetch('/ds-lowtide/sessions', { cache: 'no-store' })
  return await res.json() as SessionsResponse
}

/** All registered DSH workspaces (for the task form workspace picker). */
export interface WorkspaceEntry {
  path: string
  title: string | null
}

export interface WorkspacesResponse {
  ok: boolean
  workspaces?: WorkspaceEntry[]
  error?: string
}

export async function getWorkspaces(): Promise<WorkspacesResponse> {
  const res = await fetch('/ds-lowtide/workspaces', { cache: 'no-store' })
  return await res.json() as WorkspacesResponse
}

/** All models available on this machine (deepseek + any llm-pi-ai). */
export interface AvailableModel {
  id: string
  name: string
  priceKnown: boolean
  inputModalities?: string[]
  reasoningEfforts?: ReadonlyArray<{ id: string; name: string; description?: string }>
  defaultReasoningEffort?: string
}

export interface AvailableProvider {
  provider: string
  displayName: string
  models: AvailableModel[]
}

export interface ModelsResponse {
  ok: boolean
  providers?: AvailableProvider[]
  error?: string
}

export async function getModels(): Promise<ModelsResponse> {
  const res = await fetch('/ds-lowtide/models', { cache: 'no-store' })
  return await res.json() as ModelsResponse
}

/** Read the full lowtide config (settings page seed). */
export async function getConfig(): Promise<ConfigResponse> {
  const res = await fetch('/ds-lowtide/config', { cache: 'no-store' })
  return await res.json() as ConfigResponse
}

/** Settings-page meta from the live state: system timezone + official peak
 *  windows converted to the local clock (explainer + one-click adopt), plus
 *  whether the saved windows drifted from the official schedule. */
export async function getStateMeta(): Promise<{
  ok: boolean
  systemTz?: string
  officialInLocal?: Array<{ label: string; start: string; end: string; crossesDay: boolean; days?: number[] }>
  officialDrift?: boolean
  error?: string
}> {
  try {
    const res = await fetch('/ds-lowtide/state', { cache: 'no-store' })
    const body = await res.json() as Record<string, unknown>
    if (!res.ok || body.ok !== true) return { ok: false, error: String(body.error ?? res.status) }
    return {
      ok: true,
      systemTz: typeof body.systemTz === 'string' ? body.systemTz : '',
      officialInLocal: Array.isArray(body.officialInLocal)
        ? (body.officialInLocal as Array<{ label: string; start: string; end: string; crossesDay: boolean; days?: number[] }>)
        : [],
      officialDrift: body.officialDrift === true,
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Persist a partial config update; takes effect immediately (next scheduler tick). */
export async function updateConfig(patch: Record<string, unknown>): Promise<ConfigResponse> {
  const res = await fetch('/ds-lowtide/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return await res.json() as ConfigResponse
}

/** Remember the last used workspace (client-local, per §MVP intake default). */
const WORKSPACE_KEY = 'dsh-lowtide:last-workspace'

export function lastWorkspace(): string {
  try {
    return localStorage.getItem(WORKSPACE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function rememberWorkspace(path: string): void {
  try {
    localStorage.setItem(WORKSPACE_KEY, path)
  } catch {
    /* storage unavailable — non-fatal */
  }
}
