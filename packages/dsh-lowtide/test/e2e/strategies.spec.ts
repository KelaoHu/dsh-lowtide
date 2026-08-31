/**
 * Execution strategies e2e (PLAN v2 §1, real API): iterative multi-round runs
 * with accumulated cost, sampling candidates + user choice, and the
 * clear-finished maintenance action. Runs against a live `dsh web`.
 *
 * Uses its OWN temp git workspace so it never collides with full-loop.spec
 * (which runs in parallel on the shared e2e workspace and holds git locks).
 */
import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ID = `st-${Date.now().toString(36)}`
const WORKSPACE = mkdtempSync(join(tmpdir(), 'lt-strat-e2e-'))

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: WORKSPACE, stdio: 'pipe' })
}

test.afterAll(() => {
  try { rmSync(WORKSPACE, { recursive: true, force: true }) } catch { /* temp cleanup is best-effort */ }
})

async function api(request: APIRequestContext, method: string, path: string, data?: unknown): Promise<any> {
  const res = await request.fetch(path, { method, data })
  const body = await res.json().catch(() => ({}))
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()}: ${JSON.stringify(body)}`)
  return body
}

async function pollState(request: APIRequestContext, taskId: string, timeoutMs: number): Promise<any> {
  const start = Date.now()
  let last: any = null
  while (Date.now() - start < timeoutMs) {
    last = await api(request, 'GET', '/ds-lowtide/state')
    const task = last.tasks.find((t: any) => t.id === taskId)
    if (task !== undefined && (task.status === 'done' || task.status === 'failed' || task.status === 'timeout')) return task
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`pollState timeout; task=${taskId}`)
}

test('strategies: iterative rounds + sampling candidates + review + clear-finished', async ({ request }) => {
  test.setTimeout(560_000)

  // Fresh git workspace with one commit so gitRef/intake works.
  git('init')
  git('config', 'user.email', 'e2e@localhost')
  git('config', 'user.name', 'e2e')
  git('commit', '--allow-empty', '-m', `init ${ID}`)

  // ── iterative: 2 rounds, one session, accumulated cost ───────────────
  const iter = await api(request, 'POST', '/ds-lowtide/tasks', {
    prompt: `在 ${WORKSPACE} 创建文件 iter-${ID}.txt，内容为 iter-ok，不要写其他文件`,
    files: [],
    workspace: WORKSPACE,
    priority: 0,
    permissionPreset: 'lt-standard',
    strategy: 'iterative',
    rounds: 2,
  })
  expect(iter.task.strategy).toBe('iterative')
  expect(iter.task.rounds).toBe(2)
  expect(iter.task.estimateYuan).toBeGreaterThan(0)
  await api(request, 'POST', `/ds-lowtide/tasks/${iter.task.id}/approve`)
  await api(request, 'POST', '/ds-lowtide/batch/run-now')
  const iterDone = await pollState(request, iter.task.id, 240_000)
  expect(iterDone.status).toBe('done')
  expect(iterDone.lastRun.strategy).toBe('iterative')
  expect(iterDone.lastRun.roundsRun).toBeGreaterThanOrEqual(2)
  expect(iterDone.lastRun.costYuan).toBeGreaterThan(0)

  // ── sampling: 2 independent candidates + user choice ─────────────────
  const samp = await api(request, 'POST', '/ds-lowtide/tasks', {
    prompt: `列出 ${WORKSPACE} 目录下的文件清单并写入 sample-${ID}.txt`,
    files: [],
    workspace: WORKSPACE,
    priority: 0,
    permissionPreset: 'lt-standard',
    strategy: 'sampling',
    rounds: 2,
  })
  expect(samp.task.strategy).toBe('sampling')
  await api(request, 'POST', `/ds-lowtide/tasks/${samp.task.id}/approve`)
  await api(request, 'POST', '/ds-lowtide/batch/run-now')
  const sampDone = await pollState(request, samp.task.id, 240_000)
  expect(sampDone.status).toBe('done')
  expect(sampDone.lastRun.strategy).toBe('sampling')
  expect(sampDone.lastRun.candidates.length).toBe(2)
  for (const c of sampDone.lastRun.candidates) {
    expect(c.excerpt.length).toBeGreaterThan(0)
    expect(c.costYuan).toBeGreaterThan(0)
  }
  // user picks candidate #2; out-of-range index rejected.
  const pick = await api(request, 'POST', `/ds-lowtide/tasks/${samp.task.id}/choose-candidate`, { index: 1 })
  expect(pick.task.chosenCandidateIndex).toBe(1)
  const bad = await request.post(`/ds-lowtide/tasks/${samp.task.id}/choose-candidate`, { data: { index: 9 } })
  expect(bad.status()).toBe(400)

  // ── review: 1 execution + 1 independent critique session ─────────────
  const rev = await api(request, 'POST', '/ds-lowtide/tasks', {
    prompt: `在 ${WORKSPACE} 创建文件 review-${ID}.txt，内容为 review-ok，不要写其他文件`,
    files: [],
    workspace: WORKSPACE,
    priority: 0,
    permissionPreset: 'lt-standard',
    strategy: 'review',
  })
  expect(rev.task.strategy).toBe('review')
  expect(rev.task.rounds).toBe(1)
  expect(rev.task.estimateYuan).toBeGreaterThan(0)
  await api(request, 'POST', `/ds-lowtide/tasks/${rev.task.id}/approve`)
  await api(request, 'POST', '/ds-lowtide/batch/run-now')
  const revDone = await pollState(request, rev.task.id, 240_000)
  expect(revDone.status).toBe('done')
  expect(revDone.lastRun.strategy).toBe('review')
  expect(revDone.lastRun.reviewExcerpt).toBeTruthy()
  expect(revDone.lastRun.reviewExcerpt.length).toBeGreaterThan(0)

  // ── clear-finished: done tasks removed, reports keep the record ──────
  const before = await api(request, 'GET', '/ds-lowtide/state')
  const doneBefore = before.tasks.filter((t: any) => t.status === 'done').length
  const hadReport = before.latestReport !== null
  const cleared = await api(request, 'POST', '/ds-lowtide/tasks/clear-finished')
  expect(cleared.cleared).toBeGreaterThanOrEqual(1)
  const after = await api(request, 'GET', '/ds-lowtide/state')
  expect(after.tasks.filter((t: any) => t.status === 'done').length).toBe(0)
  // reports snapshot still exists (evidence retained).
  expect(after.latestReport !== null).toBe(hadReport)
  expect(doneBefore).toBeGreaterThanOrEqual(1)
})
