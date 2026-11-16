/**
 * Continuation flags must survive the runner (PR#8 review, point 5):
 * the single strategy reports resumed/forked into the run record, the review
 * strategy keeps the EXECUTION call's flags, and the critique is always an
 * independent fresh session (never a continuation of the reviewed one).
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Task } from 'lowtide-core'
import { LowtideStore } from '../src/store.ts'
import { runTask } from '../src/runner.ts'

const SESSION_ID = 'sess-live-1'
const PROVIDER = 'deepseek-official'
const MODEL = 'deepseek-v4'

const roots: string[] = []

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lt-runner-'))
  roots.push(dir)
  return dir
}

interface FakeEvent {
  type: string
  seq: number
  data?: unknown
}
type Handler = (session: { id: string }, event: FakeEvent) => void

function fakeAgent(emit: Handler, id: string, cwd?: string) {
  const session = { id, seq: 0, header: cwd === undefined ? {} : { cwd } }
  const followup = vi.fn((message: unknown): void => {
    // Echo the prompt back so tests can tell which turn asked what.
    const text = JSON.stringify(message)
    session.seq += 1
    emit(session, {
      type: 'assistant/message',
      seq: session.seq,
      data: { message: { content: [{ type: 'text', text: text.includes('第二视角') ? 'reviewed' : 'done' }] }, usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0 } },
    })
    session.seq += 1
    emit(session, { type: 'turn/end', seq: session.seq, data: { reason: { kind: 'completed' } } })
  })
  const agent = {
    session,
    options: { provider: PROVIDER, model: MODEL },
    inbox: { nextTurn: [], nextStep: [] },
    whenIdle: async (): Promise<void> => {},
    followup,
    cancel: vi.fn(),
  }
  return { agent, followup }
}

interface HarnessOpts {
  /** Live source conversation present (continuation can be lived in). */
  live: boolean
  /** The live conversation's cwd (must match the task workspace for in-place). */
  cwd?: string
  resume?: 'ok' | 'throw'
  preset?: string
}

function harness(opts: HarnessOpts) {
  const handlers: Handler[] = []
  const emit: Handler = (session, event) => {
    for (const handler of handlers.slice()) handler(session, event)
  }
  const live = opts.live ? fakeAgent(emit, SESSION_ID, opts.cwd) : undefined
  const resumedAgent = fakeAgent(emit, 'sess-resumed', opts.cwd)
  const forkedAgent = fakeAgent(emit, 'lt-forked', opts.cwd)
  const resumeFn = vi.fn(async () => {
    if (opts.resume === 'throw') throw new Error(`cannot prepare session ${SESSION_ID} while it is live`)
    return { agent: resumedAgent.agent, dispose: async (): Promise<void> => {} }
  })
  const createFn = vi.fn(async () => ({ agent: forkedAgent.agent, dispose: async (): Promise<void> => {} }))
  const ctx = {
    get: (name: string) => (name === 'sessions' ? { flush: async (): Promise<void> => {} } : undefined),
    on: (_event: string, handler: Handler) => {
      handlers.push(handler)
      return () => {
        const index = handlers.indexOf(handler)
        if (index >= 0) handlers.splice(index, 1)
      }
    },
    sessions: { get: () => ({ header: {}, snapshotEvents: () => [{ type: 'turn/start', seq: 0 }, { type: 'turn/end', seq: 1 }] }) },
    agentDefaultModel: { currentSelection: () => ({ provider: PROVIDER, model: MODEL }) },
    agents: {
      get: (id: unknown) => (live !== undefined && String(id) === SESSION_ID ? live.agent : undefined),
      resume: resumeFn,
      create: createFn,
    },
    permissionPresets: {
      current: () => opts.preset ?? 'lt-readonly',
      set: vi.fn(),
      names: ['lt-readonly', 'lt-standard'],
    },
    agentPresets: { mount: async (): Promise<void> => {} },
    logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  } as unknown as Context
  return { ctx, live, forkedAgent, resumeFn, createFn }
}

function setup(workspace: string, extra: Partial<Task> = {}) {
  const store = LowtideStore.load(join(tempDir(), 'lowtide.json'))
  const task: Task = {
    id: 't-1',
    prompt: '继续昨天的重构',
    files: [],
    workspace,
    priority: 1,
    permissionPreset: 'lt-standard',
    status: 'queued',
    createdAt: new Date().toISOString(),
    estimateMinutes: 5,
    continuesFromSession: SESSION_ID,
    ...extra,
  }
  store.addTask(task)
  return { store, task }
}

function lastRun(store: LowtideStore, taskId: string) {
  const run = store.taskById(taskId)?.lastRun
  expect(run).toBeDefined()
  return run!
}

describe('single strategy keeps the continuation flags', () => {
  test('resumed in place: the run record says so', async () => {
    const workspace = tempDir()
    const { store, task } = setup(workspace)
    const h = harness({ live: true, cwd: workspace })
    const result = await runTask(h.ctx, store, task, new Date(Date.now() + 3_600_000))

    expect(result.row.status).toBe('done')
    const run = lastRun(store, task.id)
    expect(run.resumed).toBe(true)
    expect(run.forked).toBeUndefined()
    expect(run.resumeNote).toBeUndefined()
    expect(h.live?.followup).toHaveBeenCalledTimes(1)
    expect(h.createFn).not.toHaveBeenCalled()
  })

  test('forked continuation: the run record says forked', async () => {
    const workspace = tempDir()
    const { store, task } = setup(workspace)
    // A dead source session (agents.get → undefined) plus a failing resume
    // forces the fork tier.
    const h = harness({ live: false, cwd: workspace, resume: 'throw' })
    const result = await runTask(h.ctx, store, task, new Date(Date.now() + 3_600_000))

    expect(result.row.status).toBe('done')
    const run = lastRun(store, task.id)
    expect(run.forked).toBe(true)
    expect(run.resumed).toBeUndefined()
  })
})

describe('review strategy', () => {
  test('keeps the execution call flags and critiques in an independent session', async () => {
    const workspace = tempDir()
    const { store, task } = setup(workspace, { strategy: 'review' })
    const h = harness({ live: true, cwd: workspace })
    const result = await runTask(h.ctx, store, task, new Date(Date.now() + 3_600_000))

    expect(result.row.status).toBe('done')
    const run = lastRun(store, task.id)
    // The flags belong to the execution call (which lived in the source).
    expect(run.resumed).toBe(true)
    expect(run.forked).toBeUndefined()
    // The execution turn drove the live conversation exactly once…
    expect(h.live?.followup).toHaveBeenCalledTimes(1)
    // …and the critique went to a NEW session that received the review prompt,
    // i.e. the second call did NOT get resumeSessionId.
    expect(h.createFn).toHaveBeenCalledTimes(1)
    expect(h.forkedAgent.followup).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(h.forkedAgent.followup.mock.calls[0]?.[0])).toContain('第二视角')
    expect(run.reviewExcerpt).toBe('reviewed')
  })
})
