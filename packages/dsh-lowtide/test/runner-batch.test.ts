/**
 * Runner batch decisions (review round 1, B1/B2/B3): empty batches produce no
 * report, crashed attempts mark the task failed instead of re-queueing it
 * (crash-loop guard), preflight window-fit defers with a counter, and the
 * gitRef preflight degrades safely on non-git workspaces.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { LowtideStore } from '../src/store.ts'
import { assembleReportRows, runBatch, runTask, scheduleGroups, type RunTaskResult } from '../src/runner.ts'
import type { ReportTaskRow, Task } from 'lowtide-core'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lt-runner-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Fake ctx: the crash path only needs a logger and absent agent services. */
function fakeCtx(): Context {
  const logger = (): { info: () => void; warn: () => void } => ({ info: () => {}, warn: () => {} })
  return {
    logger,
    get: () => undefined,
    on: () => () => {},
  } as unknown as Context
}

function storeWith(tasks: Task[], overrides: Partial<ConstructorParameters<typeof LowtideStore>[1]> = {}): { store: LowtideStore; file: string } {
  const file = join(tempDir(), 'lowtide.json')
  const store = LowtideStore.load(file)
  for (const task of tasks) store.addTask(task)
  if (Object.keys(overrides).length > 0) {
    // Config patches go through the update path (validated).
    store.updateConfig({ batch: overrides.batch })
  }
  return { store, file }
}

function task(id: string, status: Task['status'], workspace: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    prompt: '测试任务',
    files: [],
    workspace,
    priority: 1,
    permissionPreset: 'lt-standard',
    status,
    createdAt: new Date().toISOString(),
    estimateMinutes: 10,
    ...extra,
  }
}

describe('runBatch', () => {
  test('empty queue returns null and creates no report', async () => {
    const dir = tempDir()
    const { store } = storeWith([task('t1', 'pending-review', dir)])
    const report = await runBatch(fakeCtx(), store, new Date(Date.now() + 3600_000))
    expect(report).toBeNull()
    expect(store.reports).toHaveLength(0)
  })

  test('a crashed attempt marks the task failed, never queued (B1)', async () => {
    const dir = tempDir()
    const { store } = storeWith([task('t1', 'queued', dir)])
    const result = await runTask(fakeCtx(), store, store.taskById('t1')!, new Date(Date.now() + 3600_000))
    // fakeCtx has no agent services → attempt throws → failed (not re-queued).
    expect(result.row.status).toBe('failed')
    expect(store.taskById('t1')?.status).toBe('failed')
  })

  test('window-fit deferral counts up and yields no report for the batch (B3)', async () => {
    const dir = tempDir()
    const longTask = task('t1', 'queued', dir, { estimateMinutes: 120 })
    const { store } = storeWith([longTask])
    const report = await runBatch(fakeCtx(), store, new Date(Date.now() + 60_000))
    expect(report).toBeNull()
    const after = store.taskById('t1')
    expect(after?.status).toBe('deferred')
    expect(after?.deferCount).toBe(1)
    expect(after?.lastError).toContain('超出')
  })

  test('exhausted deferral (≥3) is failed by recovery, not looped forever', async () => {
    const dir = tempDir()
    const exhausted = task('t1', 'deferred', dir, { deferCount: 3 })
    const { store } = storeWith([exhausted])
    // Simulate the scheduler's window-start recovery.
    const { recoverDeferred } = await import('../src/scheduler.ts')
    recoverDeferred(store)
    expect(store.taskById('t1')?.status).toBe('failed')
  })
})

describe('preflight gitRef (B5)', () => {
  test('gitRef snapshot on a non-git workspace is treated as unchanged (safe)', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.txt'), 'hello', 'utf8')
    const t = task('t1', 'queued', dir, { gitRef: { sha: 'abc123', branch: 'master' } })
    const { store } = storeWith([t])
    // No agent services → attempt crashes → failed, but NOT stale: the
    // preflight passed, proving the git check did not false-positive.
    const result = await runTask(fakeCtx(), store, store.taskById('t1')!, new Date(Date.now() + 3600_000))
    expect(result.row.status).toBe('failed')
    expect(store.taskById('t1')?.status).toBe('failed')
    expect(store.taskById('t1')?.lastError).not.toContain('git')
  })
})

describe('runTask queue snapshot guard (Kimi review)', () => {
  test('a task deleted before execution is skipped without running', async () => {
    const dir = tempDir()
    const { store } = storeWith([task('t1', 'queued', dir)])
    store.deleteTask('t1')
    const result = await runTask(fakeCtx(), store, task('t1', 'queued', dir), new Date(Date.now() + 3600_000))
    expect(result.skipped).toBe(true)
    expect(store.taskById('t1')).toBeUndefined()
  })

  test('a task that is no longer queued (already triaged) is skipped', async () => {
    const dir = tempDir()
    const { store } = storeWith([task('t1', 'queued', dir)])
    store.setStatus('t1', 'pending-review') // user changed their mind before the batch
    const result = await runTask(fakeCtx(), store, store.taskById('t1')!, new Date(Date.now() + 3600_000))
    expect(result.skipped).toBe(true)
    expect(store.taskById('t1')?.status).toBe('pending-review')
  })
})

describe('assembleReportRows (H-001: report rows follow the queue order)', () => {
  function rowResult(id: string, status: ReportTaskRow['status'], extra: Partial<RunTaskResult> = {}): RunTaskResult {
    return {
      row: { taskId: id, prompt: '', workspace: '', status },
      savedYuan: 0,
      skipped: false,
      deferred: false,
      ...extra,
    }
  }

  test('restores the queue order from an out-of-order result map', () => {
    const queue = [task('a', 'queued', 'ws1'), task('b', 'queued', 'ws2'), task('c', 'queued', 'ws3')]
    // scheduleGroups completes groups in arbitrary order — insert reversed.
    const results = new Map<string, RunTaskResult>([
      ['c', rowResult('c', 'done', { savedYuan: 1 })],
      ['a', rowResult('a', 'done', { savedYuan: 1 })],
      ['b', rowResult('b', 'failed', { savedYuan: 1 })],
    ])
    const { rows, savedTotal, deferredCount } = assembleReportRows(queue, results)
    expect(rows.map((r) => r.taskId)).toEqual(['a', 'b', 'c'])
    expect(savedTotal).toBe(3)
    expect(deferredCount).toBe(0)
  })

  test('counts deferred tasks but keeps them out of the rows', () => {
    const queue = [task('a', 'queued', 'ws1'), task('b', 'queued', 'ws2')]
    const results = new Map<string, RunTaskResult>([
      ['a', rowResult('a', 'failed', { savedYuan: 0, skipped: true, deferred: true, row: { taskId: 'a', prompt: '', workspace: '', status: 'failed', error: '预算顺延' } })],
      ['b', rowResult('b', 'done', { savedYuan: 2 })],
    ])
    const { rows, savedTotal, deferredCount } = assembleReportRows(queue, results)
    expect(rows.map((r) => r.taskId)).toEqual(['b'])
    expect(savedTotal).toBe(2)
    expect(deferredCount).toBe(1)
  })

  test('runBatch report rows follow the queue order (integration)', async () => {
    const dir1 = tempDir()
    const dir2 = tempDir()
    const t1 = task('t1', 'queued', dir1, { priority: 1, createdAt: '2026-01-01T00:00:00.000Z' })
    const t2 = task('t2', 'queued', dir2, { priority: 2, createdAt: '2026-01-01T00:00:00.000Z' })
    const { store } = storeWith([t1, t2])
    const report = await runBatch(fakeCtx(), store, new Date(Date.now() + 3600_000))
    // fakeCtx has no agent services → both attempts crash-fail; the report
    // must still list them in queue order (H-001 regression guard).
    expect(report).not.toBeNull()
    expect(report!.tasks.map((r) => r.taskId)).toEqual(['t1', 't2'])
  })
})

describe('scheduleGroups (concurrent batch dispatch, Kimi plan §2 corrected)', () => {
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  test('same-workspace tasks never overlap; cross-workspace may', async () => {
    const active = new Map<string, number>() // workspace → running count
    const overlaps: string[] = []
    const runOne = async (item: { id: string; ws: string }): Promise<{ skipped: boolean; deferred: boolean }> => {
      const cur = active.get(item.ws) ?? 0
      active.set(item.ws, cur + 1)
      if (cur > 0) overlaps.push(item.id)
      await sleep(30)
      active.set(item.ws, (active.get(item.ws) ?? 1) - 1)
      return { skipped: false, deferred: false }
    }
    const items = [
      { id: 'a', ws: 'ws1' },
      { id: 'b', ws: 'ws1' },
      { id: 'c', ws: 'ws2' },
      { id: 'd', ws: 'ws3' },
    ]
    await scheduleGroups(items, (i) => i.ws, 3, runOne)
    expect(overlaps).toEqual([]) // no same-workspace overlap
  })

  test('maxConcurrency=1 serializes everything', async () => {
    let running = 0
    let maxRunning = 0
    const runOne = async (item: { id: string; ws: string }): Promise<{ skipped: boolean; deferred: boolean }> => {
      running += 1
      maxRunning = Math.max(maxRunning, running)
      await sleep(20)
      running -= 1
      return { skipped: false, deferred: false }
    }
    const items = [
      { id: 'a', ws: 'ws1' },
      { id: 'b', ws: 'ws2' },
      { id: 'c', ws: 'ws3' },
    ]
    await scheduleGroups(items, (i) => i.ws, 1, runOne)
    expect(maxRunning).toBe(1)
  })

  test('maxConcurrency=3 runs three workspaces in parallel', async () => {
    let running = 0
    let maxRunning = 0
    const runOne = async (item: { id: string; ws: string }): Promise<{ skipped: boolean; deferred: boolean }> => {
      running += 1
      maxRunning = Math.max(maxRunning, running)
      await sleep(40)
      running -= 1
      return { skipped: false, deferred: false }
    }
    const items = [
      { id: 'a', ws: 'ws1' },
      { id: 'b', ws: 'ws2' },
      { id: 'c', ws: 'ws3' },
    ]
    await scheduleGroups(items, (i) => i.ws, 3, runOne)
    expect(maxRunning).toBe(3)
  })
})
