/**
 * Phase 1 full-loop acceptance (PLAN Phase 1 DoD, G1 evidence):
 * intake → pending-review with sha256 snapshots → triage (approve ×2, drop ×1)
 * → run-now → unattended serial execution → done + workspace artifacts
 * → morning report + ledger bookkeeping. Pure API drive, runs against a
 * live `dsh web` (baseURL in playwright.config.ts).
 *
 * The e2e workspace (LOWTIDE_E2E_WORKSPACE, default a temp dir, its own git
 * repo) is the task target; the test commits pending changes before and
 * artifacts after, so the workspace is left clean.
 */
import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { E2E_WORKSPACE } from './workspace.ts'

const WORKSPACE = E2E_WORKSPACE
const ID = `fl-${Date.now().toString(36)}`

function git(...args: string[]): void {
  // execFileSync: no shell, args pass through verbatim (commit messages
  // contain spaces — a joined shell string would split them).
  execFileSync('git', args, { cwd: WORKSPACE, stdio: 'pipe' })
}

async function api(request: APIRequestContext, method: string, path: string, data?: unknown): Promise<any> {
  const res = await request.fetch(path, { method, data })
  const body = await res.json().catch(() => ({}))
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()}: ${JSON.stringify(body)}`)
  return body
}

async function pollState(request: APIRequestContext, pred: (s: any) => boolean, timeoutMs: number): Promise<any> {
  const start = Date.now()
  let last: any = null
  while (Date.now() - start < timeoutMs) {
    last = await api(request, 'GET', '/ds-lowtide/state')
    if (pred(last)) return last
    await new Promise((r) => setTimeout(r, 2000))
  }
  const seen = (last?.tasks ?? []).map((t: any) => `${t.id}:${t.status}`).join(', ')
  throw new Error(`pollState timeout after ${timeoutMs}ms; tasks=${seen}`)
}

test('Phase 1 full loop: intake → triage → run-now → done → report', async ({ request }) => {
  test.setTimeout(360_000)

  // 0. Workspace must start clean — commit whatever is pending (PLAN: 若已有改动先提交).
  git('add', '-A')
  git('commit', '-m', `e2e: pre-loop cleanup ${ID}`, '--allow-empty')

  // 1. Snapshot targets: two committed input files (sha256 anchors).
  const inputA = join(WORKSPACE, `loop-a-${ID}.txt`)
  const inputB = join(WORKSPACE, `loop-b-${ID}.txt`)
  writeFileSync(inputA, `alpha input ${ID}`)
  writeFileSync(inputB, `beta input ${ID}`)
  git('add', '-A')
  git('commit', '-m', `e2e: loop inputs ${ID}`)

  // 2. Intake: 3 tasks — two to execute (each with a file snapshot), one
  //    extra to drop (模板: approve 两个、drop 一个多余任务).
  const promptA = `在 ${WORKSPACE} 创建文件 alpha-${ID}.txt，文件内容为 alpha-ok，不要写其他文件`
  const promptB = `在 ${WORKSPACE} 创建文件 beta-${ID}.txt，文件内容为 beta-ok，不要写其他文件`
  const makeTask = (prompt: string, files: string[]) =>
    api(request, 'POST', '/ds-lowtide/tasks', {
      prompt,
      files,
      workspace: WORKSPACE,
      priority: 0,
      permissionPreset: 'lt-standard',
    })

  const a = await makeTask(promptA, [inputA])
  const b = await makeTask(promptB, [inputB])
  const c = await makeTask(`多余任务 ${ID}：不应被执行`, [])

  // 3. Pending-review with sha256 snapshots.
  expect(a.ok).toBe(true)
  expect(a.task.status).toBe('pending-review')
  expect(a.task.files).toHaveLength(1)
  expect(a.task.files[0].path).toBe(inputA)
  expect(a.task.files[0].sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(a.task.files[0].size).toBeGreaterThan(0)
  expect(b.task.status).toBe('pending-review')
  expect(c.task.status).toBe('pending-review')

  // 4. Triage: approve A+B, drop C.
  const approvedA = await api(request, 'POST', `/ds-lowtide/tasks/${a.task.id}/approve`)
  const approvedB = await api(request, 'POST', `/ds-lowtide/tasks/${b.task.id}/approve`)
  const droppedC = await api(request, 'POST', `/ds-lowtide/tasks/${c.task.id}/drop`)
  expect(approvedA.task.status).toBe('queued')
  expect(approvedB.task.status).toBe('queued')
  expect(droppedC.task.status).toBe('dropped')

  // 5. Force the batch now (不要等 19:00 窗口).
  await api(request, 'POST', '/ds-lowtide/batch/run-now')

  // 6. Poll until both executed tasks finish (longest 5 min).
  const final = await pollState(
    request,
    (s) => {
      const ta = s.tasks.find((t: any) => t.id === a.task.id)
      const tb = s.tasks.find((t: any) => t.id === b.task.id)
      return ta !== undefined && tb !== undefined
        && (ta.status === 'done' || ta.status === 'failed')
        && (tb.status === 'done' || tb.status === 'failed')
    },
    300_000,
  )

  const doneA = final.tasks.find((t: any) => t.id === a.task.id)
  const doneB = final.tasks.find((t: any) => t.id === b.task.id)
  const droppedC2 = final.tasks.find((t: any) => t.id === c.task.id)
  expect(doneA.status, `A lastError=${doneA.lastError ?? ''} run=${JSON.stringify(doneA.lastRun ?? null)}`).toBe('done')
  expect(doneB.status, `B lastError=${doneB.lastError ?? ''} run=${JSON.stringify(doneB.lastRun ?? null)}`).toBe('done')
  expect(droppedC2.status).toBe('dropped')

  // 7. Workspace artifacts actually landed.
  const outA = join(WORKSPACE, `alpha-${ID}.txt`)
  const outB = join(WORKSPACE, `beta-${ID}.txt`)
  expect(readFileSync(outA, 'utf8')).toContain('alpha-ok')
  expect(readFileSync(outB, 'utf8')).toContain('beta-ok')

  // 8. Morning report + ledger bookkeeping.
  expect(final.latestReport).not.toBeNull()
  expect(final.latestReport.totalCostYuan).toBeGreaterThan(0)
  expect(final.latestReport.tasks.map((t: any) => t.taskId).sort()).toEqual([a.task.id, b.task.id].sort())
  expect(final.ledger.spentToday).toBeGreaterThan(0)

  // 9. Leave the workspace clean: commit artifacts + inputs.
  git('add', '-A')
  git('commit', '-m', `e2e: loop artifacts ${ID}`, '--allow-empty')
})
