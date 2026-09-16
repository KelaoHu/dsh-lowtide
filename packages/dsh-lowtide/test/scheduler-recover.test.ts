/**
 * Scheduler decisions (review round 1, B3/B9): once-per-window identity for
 * midnight-crossing windows, deferred auto-recovery semantics, window math.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LowtideStore } from '../src/store.ts'
import { batchWindowEnd, currentWindowKey, inBatchWindow, recoverDeferred } from '../src/scheduler.ts'
import type { Task } from 'lowtide-core'

const TZ = 'Asia/Shanghai'
const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lt-sched-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function storeWith(tasks: Task[]): LowtideStore {
  const file = join(tempDir(), 'lowtide.json')
  const store = LowtideStore.load(file)
  for (const task of tasks) store.addTask(task)
  return store
}

function task(id: string, status: Task['status'], deferCount?: number): Task {
  return {
    id,
    prompt: 't',
    files: [],
    workspace: 'E:/x',
    priority: 1,
    permissionPreset: 'lt-standard',
    status,
    createdAt: new Date().toISOString(),
    ...(deferCount !== undefined ? { deferCount } : {}),
  }
}

function at(hour: number, minute: number, day = 20): Date {
  // 2026-08-20 in Shanghai tz (UTC+8).
  return new Date(Date.UTC(2026, 7, day, hour - 8, minute))
}

describe('inBatchWindow', () => {
  test('normal window: inside, before, after', () => {
    expect(inBatchWindow(at(19, 30), '19:00-23:30', TZ)).toBe(true)
    expect(inBatchWindow(at(18, 59), '19:00-23:30', TZ)).toBe(false)
    expect(inBatchWindow(at(23, 30), '19:00-23:30', TZ)).toBe(false) // half-open end
    expect(inBatchWindow(at(23, 29), '19:00-23:30', TZ)).toBe(true)
  })

  test('midnight-crossing window', () => {
    expect(inBatchWindow(at(23, 30), '23:00-01:00', TZ)).toBe(true)
    expect(inBatchWindow(at(0, 30), '23:00-01:00', TZ)).toBe(true)
    expect(inBatchWindow(at(1, 30), '23:00-01:00', TZ)).toBe(false)
  })
})

describe('currentWindowKey', () => {
  test('null outside the window', () => {
    expect(currentWindowKey(at(10, 0), '19:00-23:30', TZ)).toBeNull()
  })

  test('normal window keys by the start day', () => {
    const a = currentWindowKey(at(19, 30), '19:00-23:30', TZ)
    const b = currentWindowKey(at(22, 0), '19:00-23:30', TZ)
    expect(a).not.toBeNull()
    expect(a).toBe(b)
    // Next day is a different window identity.
    expect(currentWindowKey(at(19, 30, 21), '19:00-23:30', TZ)).not.toBe(a)
  })

  test('midnight-crossing window keeps ONE identity across midnight', () => {
    const beforeMidnight = currentWindowKey(at(23, 30), '23:00-01:00', TZ) // Aug 20 23:30 → window of Aug 20
    const afterMidnight = currentWindowKey(at(0, 30, 21), '23:00-01:00', TZ) // Aug 21 00:30 → same window
    expect(beforeMidnight).not.toBeNull()
    expect(afterMidnight).not.toBeNull()
    expect(beforeMidnight).toBe(afterMidnight)
    // The NEXT night is a different window.
    expect(currentWindowKey(at(23, 30, 21), '23:00-01:00', TZ)).not.toBe(beforeMidnight)
  })

  test('config change inside the window starts a new identity', () => {
    expect(currentWindowKey(at(20, 0), '19:00-23:30', TZ)).not.toBe(currentWindowKey(at(20, 0), '20:00-23:30', TZ))
  })
})

describe('multi-window batch (issue #5)', () => {
  const WINS = ['12:00-13:30', '19:00-23:30']

  test('inBatchWindow: any covering window counts', () => {
    expect(inBatchWindow(at(12, 30), WINS, TZ)).toBe(true)
    expect(inBatchWindow(at(20, 0), WINS, TZ)).toBe(true)
    expect(inBatchWindow(at(15, 0), WINS, TZ)).toBe(false)
    // Legacy single-string signature unchanged.
    expect(inBatchWindow(at(12, 30), '12:00-13:30', TZ)).toBe(true)
  })

  test('each window latches its own identity — noon and evening differ', () => {
    const noon = currentWindowKey(at(12, 30), WINS, TZ)
    const evening = currentWindowKey(at(20, 0), WINS, TZ)
    expect(noon).not.toBeNull()
    expect(evening).not.toBeNull()
    expect(noon).not.toBe(evening)
    // Same window, same day → stable key (the once-per-window latch).
    expect(currentWindowKey(at(13, 0), WINS, TZ)).toBe(noon)
    // Next day's noon window is a fresh identity.
    expect(currentWindowKey(at(12, 30, 21), WINS, TZ)).not.toBe(noon)
    // Between windows → null (latch clears, next window may run).
    expect(currentWindowKey(at(15, 0), WINS, TZ)).toBeNull()
  })

  test('batchWindowEnd follows the ACTIVE window', () => {
    // Inside the noon window the end is 13:30 today; inside the evening
    // window it is 23:30 today.
    expect(batchWindowEnd(at(12, 30), WINS, TZ).getTime()).toBe(at(13, 30).getTime())
    expect(batchWindowEnd(at(20, 0), WINS, TZ).getTime()).toBe(at(23, 30).getTime())
    // Legacy single-string signature unchanged.
    expect(batchWindowEnd(at(20, 0), '19:00-23:30', TZ).getTime()).toBe(at(23, 30).getTime())
  })

  test('overlapping windows: the first covering range owns the latch', () => {
    const overlap = ['12:00-14:00', '13:00-15:00']
    const keyA = currentWindowKey(at(12, 30), overlap, TZ)
    const keyInside = currentWindowKey(at(13, 30), overlap, TZ)
    expect(keyA).not.toBeNull()
    expect(keyInside).toBe(keyA) // first-in-list wins while both cover now
    const keyB = currentWindowKey(at(14, 30), overlap, TZ)
    expect(keyB).not.toBeNull()
    expect(keyB).not.toBe(keyA) // past 14:00 only the second window covers
  })
})

describe('recoverDeferred', () => {
  test('preflight-deferred tasks re-queue (deferCount > 0)', () => {
    const store = storeWith([
      task('a', 'deferred', 1),
      task('b', 'deferred', 2),
    ])
    recoverDeferred(store)
    expect(store.taskById('a')?.status).toBe('queued')
    expect(store.taskById('b')?.status).toBe('queued')
  })

  test('user-triaged deferrals reappear in pending-review (deferCount 0)', () => {
    const store = storeWith([task('c', 'deferred')])
    recoverDeferred(store)
    expect(store.taskById('c')?.status).toBe('pending-review')
  })

  test('exhausted deferrals are failed with a note', () => {
    const store = storeWith([task('d', 'deferred', 3)])
    recoverDeferred(store)
    expect(store.taskById('d')?.status).toBe('failed')
    expect(store.taskById('d')?.lastError).toContain('顺延')
  })

  test('non-deferred tasks are untouched', () => {
    const store = storeWith([task('q', 'queued'), task('p', 'pending-review')])
    recoverDeferred(store)
    expect(store.taskById('q')?.status).toBe('queued')
    expect(store.taskById('p')?.status).toBe('pending-review')
  })
})
