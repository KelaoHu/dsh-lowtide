/**
 * In-place task edit semantics (queue edit feature): editTask() must refresh
 * every content field while preserving identity (id), lifecycle (createdAt,
 * status) and triage records; it must clear the stale lastError and bump the
 * edit audit counters. The route layer additionally guards canEdit().
 */
import { describe, expect, test, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { intake } from '../src/intake.ts'
import { LowtideStore } from '../src/store.ts'
import { canEdit } from '../src/state-machine.ts'
import type { Task } from 'lowtide-core'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lt-edit-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Create a pending-review task through the real intake pipeline. */
async function seedTask(dir: string, prompt = '原始任务描述'): Promise<{ store: LowtideStore; task: Task }> {
  const store = LowtideStore.load(join(dir, 'lowtide.json'))
  const result = await intake({ prompt, workspace: dir, priority: 3 }, dir)
  if (!result.ok || result.task === undefined) throw new Error('seed failed')
  store.addTask(result.task)
  return { store, task: result.task }
}

describe('editTask', () => {
  test('updates content fields and keeps id/createdAt/status/triage', async () => {
    const dir = tempDir()
    const { store, task } = await seedTask(dir)
    store.setStatus(task.id, 'queued', { triagedAt: '2026-08-31T10:00:00.000Z', triagedBy: 'user' })

    const edited = store.editTask(task.id, {
      prompt: '改过的任务描述',
      priority: 0,
      model: 'deepseek-v4-pro',
      modelProvider: 'deepseek-official',
      strategy: 'iterative',
      rounds: 3,
    })!

    expect(edited.id).toBe(task.id)
    expect(edited.createdAt).toBe(task.createdAt)
    expect(edited.status).toBe('queued') // status preserved, not re-triaged
    expect(edited.triagedAt).toBe('2026-08-31T10:00:00.000Z')
    expect(edited.triagedBy).toBe('user')
    expect(edited.prompt).toBe('改过的任务描述')
    expect(edited.priority).toBe(0)
    expect(edited.model).toBe('deepseek-v4-pro')
    expect(edited.strategy).toBe('iterative')
    expect(edited.rounds).toBe(3)
    // Audit counters bumped; lastError cleared.
    expect(edited.editCount).toBe(1)
    expect(edited.editedAt).toBeDefined()
    expect(edited.lastError).toBeUndefined()
  })

  test('editCount accumulates and edits persist across reload', async () => {
    const dir = tempDir()
    const file = join(dir, 'lowtide.json')
    const { store, task } = await seedTask(dir)
    store.editTask(task.id, { prompt: '第一次修改' })
    store.editTask(task.id, { prompt: '第二次修改' })
    const reloaded = LowtideStore.load(file)
    const t = reloaded.taskById(task.id)!
    expect(t.prompt).toBe('第二次修改')
    expect(t.editCount).toBe(2)
    expect(t.editedAt).toBeDefined()
  })

  test('intake re-runs file snapshots and estimate on edit (route-style flow)', async () => {
    const dir = tempDir()
    const file = join(dir, 'note.txt')
    writeFileSync(file, 'v1 content', 'utf8')
    const { store, task } = await seedTask(dir)
    // The route layer re-runs intake() against the edited form, then merges
    // the fresh content with editTask — the snapshots/estimate are produced
    // by intake, exactly like on create.
    const re = await intake({ prompt: '改', files: ['note.txt'], workspace: dir }, dir)
    expect(re.ok).toBe(true)
    const edited = store.editTask(task.id, re.task!)!
    expect(edited.files).toHaveLength(1)
    expect(edited.files[0].path).toBe(file)
    expect(edited.files[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(edited.files[0].size).toBe(10)
    expect(edited.prompt).toBe('改')
  })

  test('lastError is cleared and unknown statuses are guarded by canEdit', async () => {
    const dir = tempDir()
    const { store, task } = await seedTask(dir)
    store.setStatus(task.id, 'failed', { lastError: '旧错误' })
    expect(canEdit(task.status)).toBe(false) // failed is not editable
    expect(canEdit('pending-review')).toBe(true)
    expect(canEdit('queued')).toBe(true)
    expect(canEdit('deferred')).toBe(true)
    expect(canEdit('running')).toBe(false)
    expect(canEdit('preflight')).toBe(false)
    expect(canEdit('dropped')).toBe(false)
    expect(canEdit('done')).toBe(false)

    // Even if called on a non-editable status, editTask only merges content
    // (the route layer rejects it first; here we verify the merge is safe).
    const edited = store.editTask(task.id, { prompt: 'x', lastError: 'should-not-survive' })
    expect(edited?.lastError).toBeUndefined()
    expect(edited?.status).toBe('failed')
  })

  test('editing does not resurrect lastRun history', async () => {
    const dir = tempDir()
    const { store, task } = await seedTask(dir)
    store.recordRun(task.id, {
      at: '2026-08-30T12:00:00.000Z',
      status: 'done',
      elapsedMs: 1000,
      costYuan: 0.01,
    }, 'done')
    // A done task is not editable; put it back in a queued-like state via a
    // fresh store-level task to verify lastRun survives an edit.
    store.setStatus(task.id, 'queued')
    const edited = store.editTask(task.id, { prompt: '改' })!
    expect(edited.lastRun?.status).toBe('done')
    expect(edited.prompt).toBe('改')
  })
})
