/**
 * Lowtide HTTP API (PLAN T1.3 / §7.3, Phase 1 subset) under /ds-lowtide.
 * The Host/Origin trust fence (T2.8/B2) IS mounted — every request passes
 * isTrustedApiRequest first (loopback Host + same-origin). The server binds
 * loopback only and the README deployment guidance (SSH tunnel) is Phase 4.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import {
  digest,
  estimate,
  hasPriceEntry,
  levelAt,
  minutesUntil,
  nextBatchAt,
  nextOffPeakStart,
  OFFICIAL_PEAK_WINDOWS,
  parseWindowRange,
  rowForLevel,
  systemTimeZone,
  tierFor,
  windowsInTz,
  type PriceRow,
} from 'lowtide-core'
import { intake } from './intake.ts'
import { reportDateLabel } from './runner.ts'
import { isTrustedApiRequest } from './api-trust.ts'
import type { Scheduler } from './scheduler.ts'
import { canTransition, canEdit, type TriageAction } from './state-machine.ts'
import { configUpdateSchema, type ConfigUpdate, LowtideStore } from './store.ts'
import { listWorkspaceSessions } from './session-picker.ts'
import { listAvailableModels } from './models.ts'

export type { TriageAction } from './state-machine.ts'
export { canTransition } from './state-machine.ts'

export interface Routes {
  store: LowtideStore
  scheduler: Scheduler
}

/** 活跃的 SSE 客户端;每次状态变更或心跳时推送 state 事件(PLAN §5.3/§7.3)。 */
const sseClients = new Set<ServerResponse>()

/** Hard cap on concurrent SSE connections (pentest P7). */
const MAX_SSE_CLIENTS = 16

async function broadcastState(ctx: Context, routes: Routes): Promise<void> {
  if (sseClients.size === 0) return
  const payload = JSON.stringify(await statePayload(ctx, routes))
  const frame = `event: state\ndata: ${payload}\n\n`
  // Snapshot the set before iterating — a failed write may delete the client,
  // and modifying a Set while iterating it, though safe per ES6, is clearer
  // when done on a copy (review: avoid for...of + delete on the same Set).
  for (const client of Array.from(sseClients)) {
    try {
      client.write(frame)
    } catch {
      sseClients.delete(client)
    }
  }
}

const MAX_BODY_BYTES = 1024 * 1024
const BODY_TIMEOUT_MS = 15_000

/** Error carrying an HTTP status — the catch-all replies with it verbatim
 *  (message is our own controlled copy) instead of a generic 500. */
class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

function jsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = ''
    let bytesReceived = 0
    let settled = false
    const fail = (error: Error): void => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(error)
      }
    }
    const timer = setTimeout(() => fail(new Error('请求体读取超时')), BODY_TIMEOUT_MS)
    req.on('data', (chunk: Buffer) => {
      if (settled) return
      // Byte-accurate cap: string length undercounts multibyte characters.
      bytesReceived += chunk.length
      if (bytesReceived > MAX_BODY_BYTES) {
        fail(new HttpError(413, '请求体过大（>1MB）'))
        req.destroy()
        return
      }
      raw += chunk.toString('utf8')
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        resolve(raw === '' ? {} : JSON.parse(raw) as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', (error) => fail(error))
    req.on('aborted', () => fail(new Error('请求被中止')))
  })
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function methodNotAllowed(res: ServerResponse, methods: string): void {
  res.writeHead(405, { allow: methods, 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: false, error: '不支持的请求方法' }))
}

export function registerRoutes(ctx: Context, routes: Routes): void {
  const { store, scheduler } = routes

  const heartbeat = setInterval(() => {
    void broadcastState(ctx, routes)
  }, 15_000)
  ctx.effect(() => () => {
    clearInterval(heartbeat)
    for (const client of sseClients) {
      try { client.end() } catch { /* already closed */ }
    }
    sseClients.clear()
  })

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        // Host/Origin 信任围栏(PLAN B2):loopback + 同源;跨站一律 403。
        if (!isTrustedApiRequest(req.headers)) {
          reply(res, 403, { ok: false, error: '请求来源不受信任' })
          return
        }
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const path = url.pathname

        if (path === '/ds-lowtide/health' && req.method === 'GET') {
          reply(res, 200, { ok: true, service: 'dsh-lowtide', time: Date.now() })
          return
        }

        if (path === '/ds-lowtide/events' && req.method === 'GET') {
          // Connection cap (pentest P7): each SSE client holds a socket and a
          // broadcast slot forever — refuse beyond 16 instead of letting a
          // local process exhaust the host.
          if (sseClients.size >= MAX_SSE_CLIENTS) {
            reply(res, 429, { ok: false, error: '事件流连接数已达上限' })
            return
          }
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          })
          res.write(': connected\n\n')
          sseClients.add(res)
          req.on('close', () => { sseClients.delete(res) })
          res.on('close', () => { sseClients.delete(res) })
          void broadcastState(ctx, routes)
          return
        }

        if (path === '/ds-lowtide/config' && req.method === 'GET') {
          reply(res, 200, { ok: true, config: store.config })
          return
        }

        if (path === '/ds-lowtide/config' && req.method === 'PUT') {
          const body = await jsonBody(req)
          const parsed = configUpdateSchema.safeParse(body)
          if (!parsed.success) {
            const detail = parsed.error.issues.map((issue) =>
              `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
            reply(res, 400, { ok: false, error: `配置无效：${detail}` })
            return
          }
          const validationError = validateConfigUpdate(parsed.data)
          if (validationError !== null) {
            reply(res, 400, { ok: false, error: validationError })
            return
          }
          const config = store.updateConfig(parsed.data)
          void broadcastState(ctx, routes)
          reply(res, 200, { ok: true, config })
          return
        }

        if (path === '/ds-lowtide/state' && req.method === 'GET') {
          reply(res, 200, await statePayload(ctx, routes))
          return
        }

        if (path === '/ds-lowtide/reports' && req.method === 'GET') {
          reply(res, 200, {
            ok: true,
            reports: store.reports,
            total: store.reports.length,
            limit: store.config.maxReportHistory ?? 60,
          })
          return
        }

        if (path === '/ds-lowtide/reports/clear' && req.method === 'POST') {
          const count = store.clearReports()
          void broadcastState(ctx, routes)
          reply(res, 200, { ok: true, cleared: count })
          return
        }

        // Real user conversations per workspace, for the "continue from a
        // conversation" picker (read-only scan of $DSH_HOME/sessions).
        if (path === '/ds-lowtide/sessions' && req.method === 'GET') {
          reply(res, 200, { ok: true, workspaces: listWorkspaceSessions() })
          return
        }

        // All registered DSH workspaces (for the task form workspace picker).
        if (path === '/ds-lowtide/workspaces' && req.method === 'GET') {
          const registry = ctx.get('workspaceRegistry') as {
            list(): Array<{ id: string; path: string; title?: string }>
          } | undefined
          const workspaces = registry !== undefined
            ? registry.list().map((ws) => ({ path: ws.path, title: ws.title ?? null }))
            : []
          reply(res, 200, { ok: true, workspaces })
          return
        }

        // All models configured on this machine (deepseek + any llm-pi-ai /
        // custom providers) — enumerated from the llm service catalog.
        if (path === '/ds-lowtide/models' && req.method === 'GET') {
          reply(res, 200, { ok: true, providers: await listAvailableModels(ctx, store.config.prices) })
          return
        }

        const reportDelete = /^\/ds-lowtide\/reports\/([^/]+)$/.exec(path)
        if (reportDelete !== null && req.method === 'DELETE') {
          const ok = store.deleteReport(reportDelete[1])
          void broadcastState(ctx, routes)
          reply(res, ok ? 200 : 404, { ok, deleted: ok ? reportDelete[1] : undefined })
          return
        }

        if (path === '/ds-lowtide/tasks' && req.method === 'GET') {
          reply(res, 200, { ok: true, tasks: store.tasks, digest: digest([...store.tasks]) })
          return
        }

        if (path === '/ds-lowtide/tasks' && req.method === 'POST') {
          const body = await jsonBody(req)
          // Continuation: reject obviously malformed session ids up front
          // (a missing/deleted conversation degrades to a fresh session in
          // the runner, so no hard existence check here).
          if (typeof body?.continuesFromSession === 'string' && body.continuesFromSession !== '') {
            if (!/^[A-Za-z0-9._-]+$/.test(body.continuesFromSession)) {
              reply(res, 400, { ok: false, error: '会话标识不合法' })
              return
            }
          }
          // The task-level provider must be a registered route — a typo would
          // otherwise fail at execution time with a confusing adapter error.
          // Only reject when the service IS available and the provider is
          // unknown; if the service isn't ready (empty list), allow the
          // submission — execution will surface the real error.
          if (typeof body?.modelProvider === 'string' && body.modelProvider !== '') {
            const knownProviders = ctx.llm?.listProviders() ?? []
            if (knownProviders.length > 0 && !knownProviders.some((p) => p.id === body.modelProvider)) {
              reply(res, 400, { ok: false, error: `模型提供方不存在：${body.modelProvider}` })
              return
            }
          }
          // Use the user-selected batch model if provided; otherwise the live UI
          // selection, so estimates match what will actually run.
          const batchModel = typeof body.model === 'string' && body.model !== ''
            ? body.model
            : ctx.agentDefaultModel.currentSelection().model
          const result = await intake(body, process.cwd(), {
            autonomy: store.config.autonomy,
            modelId: batchModel,
            prices: store.config.prices,
          })
          if (!result.ok || result.task === undefined) {
            reply(res, 400, { ok: false, error: result.error ?? '投递失败' })
            return
          }
          store.addTask(result.task)
          void broadcastState(ctx, routes)
          reply(res, 200, { ok: true, task: result.task })
          return
        }

        if (path === '/ds-lowtide/tasks/approve-all' && req.method === 'POST') {
          let count = 0
          for (const task of store.tasks) {
            if (task.status === 'pending-review') {
              store.setStatus(task.id, 'queued', { triagedAt: new Date().toISOString(), triagedBy: 'user' })
              count += 1
            }
          }
          void broadcastState(ctx, routes)
          reply(res, 200, { ok: true, approved: count })
          return
        }

        if (path === '/ds-lowtide/tasks/clear-finished' && req.method === 'POST') {
          // 清空已完成:只删 done(报告历史是快照,保留证据);failed/stale/timeout
          // 仍可操作,不在此列。遍历快照避免 splice 跳过。
          let count = 0
          for (const task of [...store.tasks]) {
            if (task.status === 'done') {
              store.deleteTask(task.id)
              count += 1
            }
          }
          void broadcastState(ctx, routes)
          reply(res, 200, { ok: true, cleared: count })
          return
        }

        if (path === '/ds-lowtide/estimate' && req.method === 'POST') {
          const body = await jsonBody(req)
          const prompt = typeof body.prompt === 'string' ? body.prompt : ''
          const files = Array.isArray(body.files) ? body.files.filter((f): f is { size: number } => {
            return typeof f === 'object' && f !== null
              && typeof (f as { size?: unknown }).size === 'number'
              && (f as { size: number }).size >= 0
          }) : []
          // Peak side = the user's current UI model ("run now").
          const nowModel = typeof body.model === 'string' && body.model !== '' ? body.model : ctx.agentDefaultModel.currentSelection().model
          // Off side = the explicitly chosen batch model, or the same model if
          // none specified (useful when the user wants to compare within one
          // provider, e.g. flash vs pro). Never hard-code deepseek-v4-flash.
          const batchModel = typeof body.batchModel === 'string' && body.batchModel !== ''
            ? body.batchModel
            : nowModel
          // Models without a price entry (non-official providers) get 0 — the
          // client shows "价格未知" instead of a fake flash-tier estimate.
          const peak = hasPriceEntry(nowModel, store.config.prices)
            ? estimate(prompt, files, nowModel, store.config.prices).peak
            : 0
          const off = hasPriceEntry(batchModel, store.config.prices)
            ? estimate(prompt, files, batchModel, store.config.prices).off
            : 0
          reply(res, 200, { ok: true, peak, off, model: nowModel, batchModel })
          return
        }

        if (path === '/ds-lowtide/batch/run-now' && req.method === 'POST') {
          void scheduler.runNow()
          void broadcastState(ctx, routes)
          reply(res, 200, { ok: true, started: true })
          return
        }

        if (path === '/ds-lowtide/dismiss' && req.method === 'POST') {
          store.dismissPeakToday()
          void broadcastState(ctx, routes)
          reply(res, 200, { ok: true })
          return
        }

        // /tasks/:id/edit — edit a task IN PLACE (status preserved). Kept
        // separate from the :action regex below because edit carries a body
        // and is not a triage transition. Allowed statuses: pending-review,
        // queued, deferred (canEdit).
        const editMatch = /^\/ds-lowtide\/tasks\/([^/]+)\/edit$/.exec(path)
        if (editMatch !== null && req.method === 'POST') {
          const id = editMatch[1]
          const task = store.taskById(id)
          if (task === undefined) {
            reply(res, 404, { ok: false, error: '任务不存在' })
            return
          }
          if (!canEdit(task.status)) {
            reply(res, 409, { ok: false, error: `任务状态 ${task.status} 不允许编辑` })
            return
          }
          const body = await jsonBody(req)
          // Re-run the full intake pipeline (schema, workspace, file
          // snapshots, git ref, estimate) against the edited form, then merge
          // the fresh content onto the existing task. Continuation sessions
          // are re-validated like on create (a malformed id is rejected).
          if (typeof body?.continuesFromSession === 'string' && body.continuesFromSession !== '') {
            if (!/^[A-Za-z0-9._-]+$/.test(body.continuesFromSession)) {
              reply(res, 400, { ok: false, error: '会话标识不合法' })
              return
            }
          }
          if (typeof body?.modelProvider === 'string' && body.modelProvider !== '') {
            const knownProviders = ctx.llm?.listProviders() ?? []
            if (knownProviders.length > 0 && !knownProviders.some((p) => p.id === body.modelProvider)) {
              reply(res, 400, { ok: false, error: `模型提供方不存在：${body.modelProvider}` })
              return
            }
          }
          const result = await intake(body, process.cwd(), {
            autonomy: store.config.autonomy,
            modelId: typeof body.model === 'string' && body.model !== ''
              ? body.model
              : ctx.agentDefaultModel.currentSelection().model,
            prices: store.config.prices,
          })
          if (!result.ok || result.task === undefined) {
            reply(res, 400, { ok: false, error: result.error ?? '编辑失败' })
            return
          }
          // Merge the re-intaken content onto the existing task: the id,
          // createdAt, status, triage records and edit audit fields survive
          // (editTask strips them from the patch); everything content-related
          // is refreshed. Workspace changes re-anchor the task, so the new
          // gitRef/file snapshots from intake are what the preflight will
          // check against.
          const edited = store.editTask(id, result.task)
          void broadcastState(ctx, routes)
          reply(res, 200, { ok: true, task: edited })
          return
        }

        // /tasks/:id/:action
        const match = /^\/ds-lowtide\/tasks\/([^/]+)\/(approve|defer|drop|cancel|delete|retry|restore|choose-candidate)$/.exec(path)
        if (match !== null && req.method === 'POST') {
          const [, id, action] = match
          const task = store.taskById(id)
          if (task === undefined) {
            reply(res, 404, { ok: false, error: '任务不存在' })
            return
          }
          if (!canTransition(task.status, action as TriageAction)) {
            reply(res, 409, { ok: false, error: `任务状态 ${task.status} 不允许执行 ${action}` })
            return
          }
          if (action === 'choose-candidate') {
            // 采样任务的次日择优:仅 done + strategy=sampling + 有候选 + index 合法。
            const body = await jsonBody(req)
            const index = typeof body.index === 'number' ? body.index : -1
            const candidates = task.lastRun?.candidates ?? []
            if (task.strategy !== 'sampling') {
              reply(res, 409, { ok: false, error: '只有采样任务可以选候选' })
              return
            }
            if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
              reply(res, 400, { ok: false, error: `候选序号不合法（0-${Math.max(candidates.length - 1, 0)}）` })
              return
            }
            store.setStatus(id, task.status, { chosenCandidateIndex: index })
            void broadcastState(ctx, routes)
            reply(res, 200, { ok: true, task: store.taskById(id) })
            return
          }
          if (action === 'delete') {
            store.deleteTask(id)
            void broadcastState(ctx, routes)
            reply(res, 200, { ok: true, deleted: id })
            return
          }
          if (action === 'retry') {
            // 今晚重试:清错误、重新入队(执行时 preflight 会按最新快照复检 stale)。
            store.setStatus(id, 'queued', {
              lastError: undefined,
              lastRun: undefined,
              triagedAt: new Date().toISOString(),
              triagedBy: 'user',
            })
            void broadcastState(ctx, routes)
            reply(res, 200, { ok: true, task: store.taskById(id) })
            return
          }
          if (action === 'restore') {
            // 已放弃恢复:回到待裁定,由用户重新决定(兑现"软删除可恢复")。
            store.setStatus(id, 'pending-review', {
              lastError: undefined,
              triagedAt: new Date().toISOString(),
              triagedBy: 'user',
            })
            void broadcastState(ctx, routes)
            reply(res, 200, { ok: true, task: store.taskById(id) })
            return
          }
          if (action === 'approve') {
            store.setStatus(id, 'queued', { triagedAt: new Date().toISOString(), triagedBy: 'user' })
          } else if (action === 'defer') {
            store.setStatus(id, 'deferred', { triagedAt: new Date().toISOString(), triagedBy: 'user' })
          } else if (action === 'drop') {
            store.setStatus(id, 'dropped', { triagedAt: new Date().toISOString(), triagedBy: 'user' })
          } else {
            store.setStatus(id, 'cancelled')
          }
          void broadcastState(ctx, routes)
          reply(res, 200, { ok: true, task: store.taskById(id) })
          return
        }

        if (path === '/ds-lowtide/tasks' && req.method === 'PUT') {
          methodNotAllowed(res, 'GET, POST')
          return
        }

        reply(res, 404, { ok: false, error: `unknown route ${req.method} ${path}` })
      } catch (error) {
        if (error instanceof HttpError) {
          reply(res, error.status, { ok: false, error: error.message })
          return
        }
        // Never echo internal error text to the client (it may carry paths /
        // stack fragments); details stay in the host log.
        ctx.logger('lowtide').warn('request failed: %s', error instanceof Error ? error.message : String(error))
        reply(res, 500, { ok: false, error: '服务器内部错误' })
      }
    })()
  }

  ctx.webServer.register({ kind: 'prefix', path: '/ds-lowtide', handler })
}

/** Semantic validation for a config update beyond zod shape checks. */
function validateConfigUpdate(patch: ConfigUpdate): string | null {
  const { batch, windows } = patch
  if (batch?.window !== undefined) {
    try {
      parseWindowRange(batch.window)
    } catch (error) {
      return `运行窗口格式不对：${error instanceof Error ? error.message : String(error)}`
    }
  }
  if (windows !== undefined) {
    const seen = new Set<string>()
    for (const window of windows) {
      if (seen.has(window.id)) return `窗口 ID 重复：${window.id}`
      seen.add(window.id)
      try {
        parseWindowRange(`${window.start}-${window.end}`)
      } catch (error) {
        return `窗口时间不对（${window.id}）：${error instanceof Error ? error.message : String(error)}`
      }
      if (window.multiplier !== undefined && window.multiplier <= 0) {
        return `窗口倍率必须大于 0（${window.id}）`
      }
    }
  }
  return null
}

async function statePayload(ctx: Context, routes: Routes): Promise<Record<string, unknown>> {
  const { store, scheduler } = routes
  const now = new Date()
  const config = store.config
  const windows = config.windows.length > 0 ? config.windows : OFFICIAL_PEAK_WINDOWS

  const match = levelAt(now, windows)
  const modelId = ctx.agentDefaultModel.currentSelection().model
  // Price overrides ride on top of the official table (tierFor falls back).
  const tier = tierFor(modelId, store.config.prices)
  // Surface the REAL level ('peak' | 'off' | 'custom') + multiplier so the UI
  // shows the same price the ledger charges (custom = off × multiplier).
  const activeLevel = match?.level ?? 'off'
  const multiplier = match?.multiplier ?? 1
  const row: PriceRow = rowForLevel(tier, activeLevel, multiplier)

  const nextBatch = nextBatchAt(now, { window: config.batch.window, tz: config.batch.tz, gateLeadMin: config.batch.gateLeadMin })
  const nextOff = nextOffPeakStart(now, windows)

  const activeTasks = store.tasks.filter((t) => t.status !== 'dropped' && t.status !== 'cancelled')
  const ledger = store.ledgerToday(now)
  const latestReport = store.reports[0] ?? null

  // 傍晚确认门(PLAN §6.4):窗口 T-gateLeadMin 内 ∧ 有待裁定 ∧ ≤L2 自治 ∧ 未暂停。
  const pendingReviewCount = activeTasks.filter((t) => t.status === 'pending-review').length
  const leadMs = (config.batch.gateLeadMin ?? 30) * 60_000
  const gateActive = !config.batch.paused
    && config.autonomy !== 'l3'
    && pendingReviewCount > 0
    && nextBatch.getTime() - now.getTime() <= leadMs
    && nextBatch.getTime() > now.getTime()

  return {
    ok: true,
    time: now.toISOString(),
    autonomy: config.autonomy,
    level: match === null ? null : { level: match.level, multiplier: match.multiplier, window: { id: match.window.id, label: match.window.label, start: match.window.start, end: match.window.end } },
    price: {
      model: modelId,
      input: row.input,
      inputCached: row.inputCached,
      output: row.output,
      tier: activeLevel,
      multiplier,
      priceKnown: hasPriceEntry(modelId, store.config.prices),
      peakInput: tier.peak.input,
      peakOutput: tier.peak.output,
      offInput: tier.off.input,
      offOutput: tier.off.output,
    },
    nextBatchAt: nextBatch.getTime(),
    countdownMs: minutesUntil(now, nextBatch) * 60_000,
    nextOffPeakAt: nextOff === null ? null : nextOff.getTime(),
    // 时区人性化:系统时区 + 官方忙时段换算到本地(供设置页展示/一键采用)。
    systemTz: systemTimeZone(),
    officialInLocal: windowsInTz(OFFICIAL_PEAK_WINDOWS, systemTimeZone(), now),
    batch: {
      window: config.batch.window,
      paused: config.batch.paused,
      running: scheduler.isRunning(),
      startedAt: scheduler.batchStartedAt()?.toISOString() ?? null,
      maxConcurrency: config.batch.maxConcurrency ?? 3,
    },
    queue: {
      total: activeTasks.length,
      pendingReview: pendingReviewCount,
      queued: activeTasks.filter((t) => t.status === 'queued').length,
      running: activeTasks.filter((t) => t.status === 'running' || t.status === 'preflight').length,
    },
    gate: gateActive ? { windowStartAt: nextBatch.getTime(), pendingReview: pendingReviewCount } : null,
    digest: digest([...activeTasks]),
    tasks: [...store.tasks],
    latestReport: latestReport === null ? null : {
      ...latestReport,
      dateLabel: reportDateLabel(latestReport.date),
    },
    dismissedPeakToday: store.isPeakDismissedToday(now),
    ledger: { spentToday: ledger.yuan, savedToday: ledger.savedYuan },
  }
}
