/**
 * Lossless-continuation round: forkSeedBoundary computes the exclusive cut
 * index for seeding a continuation session from a source event log — through
 * the LAST completed turn (turn/end), skipping residual between-turn events,
 * mirroring the harness's own session.fork boundary.
 */
import { describe, expect, test } from 'vitest'
import { forkSeedBoundary, taskSessionTitle } from '../src/turns.ts'
import type { Task } from 'lowtide-core'

const task = (prompt: string): Task => ({
  id: 't-1',
  prompt,
  files: [],
  workspace: 'C:\\ws',
  priority: 1,
  permissionPreset: 'lt-standard',
  status: 'queued',
  createdAt: '2026-08-23T00:00:00.000Z',
})

/** Minimal event-shaped record: type + contiguous seq (index === seq). */
function ev(type: string, seq: number): { type: string; seq: number } {
  return { type, seq }
}

/** Build a small completed-turn event sequence ending at `endSeq`. */
function completedTurn(startSeq: number, endSeq: number): Array<{ type: string; seq: number }> {
  const out: Array<{ type: string; seq: number }> = [ev('turn/start', startSeq)]
  for (let s = startSeq + 1; s < endSeq; s++) out.push(ev('message/sent', s))
  out.push(ev('turn/end', endSeq))
  return out
}

describe('forkSeedBoundary', () => {
  test('null on an empty log (nothing to inherit)', () => {
    expect(forkSeedBoundary([])).toBeNull()
  })

  test('null when no turn ever completed (blank conversation)', () => {
    expect(forkSeedBoundary([ev('turn/start', 0), ev('message/sent', 1)])).toBeNull()
  })

  test('single completed turn cuts right after turn/end', () => {
    const events = completedTurn(0, 4) // turn/start..turn/end (5 events)
    expect(forkSeedBoundary(events)).toBe(5)
  })

  test('multiple turns cut through the LAST turn/end only', () => {
    const events = [
      ...completedTurn(0, 4),
      ...completedTurn(5, 9),
    ]
    expect(forkSeedBoundary(events)).toBe(10)
  })

  test('residual events after the last turn/end are skipped (open turn tail)', () => {
    // Second turn started but never finished: the seed must stop before it.
    const events = [
      ...completedTurn(0, 4),
      ev('turn/start', 5),
      ev('message/sent', 6),
      ev('tool/call', 7),
    ]
    expect(forkSeedBoundary(events)).toBe(5)
  })

  test('tail events after the last turn/end are included when no turn/start follows (harness-fork parity)', () => {
    // e.g. message/received or session/title landing after the last turn/end,
    // with NO new turn opened: the harness's own session.fork runs the same
    // while-loop to the end of the log, so the seed includes them.
    const events = [
      ...completedTurn(0, 4),
      ev('message/received', 5),
      ev('session/title', 6),
    ]
    expect(forkSeedBoundary(events)).toBe(7)
  })

  test('an OPEN next turn is excluded: seed stops before its turn/start', () => {
    // A new turn already started after the tail events: the seed must stop
    // before that turn/start (harness-fork parity — the while-loop lands on
    // the first turn/start after the last turn/end and excludes it).
    const events = [
      ...completedTurn(0, 4),
      ev('message/received', 5),
      ev('session/title', 6),
      ev('turn/start', 7),
      ev('message/sent', 8),
    ]
    expect(forkSeedBoundary(events)).toBe(7)
  })

  test('the seed slice is always contiguous from seq 0', () => {
    const events = [
      ...completedTurn(0, 4),
      ...completedTurn(5, 9),
      ev('turn/start', 10),
    ]
    const cut = forkSeedBoundary(events)
    expect(cut).toBe(10)
    const seed = events.slice(0, cut)
    expect(seed.map((e) => e.seq)).toEqual(seed.map((_, i) => i))
    expect(seed[seed.length - 1].type).toBe('turn/end')
  })
})

describe('taskSessionTitle (session-list distinguishability)', () => {
  const NOW = new Date(2026, 7, 23, 14, 5) // 2026-08-23 14:05

  test('ordinary task sessions carry a task prefix + prompt snippet + timestamp', () => {
    expect(taskSessionTitle(task('修复登录模块的边界情况，并补全测试'), 'task', NOW))
      .toBe('闲时任务 · 修复登录模块的边界情况，并补全测试 · 08-23 14:05')
  })

  test('continuation sessions use a distinct prefix so they never look identical to the source', () => {
    expect(taskSessionTitle(task('继续处理昨天的重构'), 'forked', NOW)).toBe('续接会话 · 继续处理昨天的重构 · 08-23 14:05')
    expect(taskSessionTitle(task('继续处理昨天的重构'), 'resumed', NOW)).toBe('续接会话 · 继续处理昨天的重构 · 08-23 14:05')
  })

  test('repeated runs of one task differ by timestamp (no duplicate titles)', () => {
    const a = taskSessionTitle(task('检查插件英文用词'), 'task', NOW)
    const b = taskSessionTitle(task('检查插件英文用词'), 'task', new Date(2026, 7, 23, 15, 20))
    expect(a).not.toBe(b)
    expect(b).toContain('15:20')
  })

  test('long prompts are truncated to a readable snippet', () => {
    const long = '这是一个特别特别特别特别特别特别特别特别特别特别特别特别长的任务提示词'
    const title = taskSessionTitle(task(long), 'task', NOW)
    expect(title.length).toBeLessThan(60)
    expect(title).toContain('…')
  })
})
