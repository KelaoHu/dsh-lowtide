/**
 * Live-conversation continuation (PR#8 review, the maintainer's five points):
 * the source conversation is LIVE in this runtime, so instead of forking it the
 * runner drives it in place — but only when everything it would touch
 * (permission preset, cwd, model route, reasoning, pending inbox) is provably
 * safe, and the preset restore always lands BEFORE the flush.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ReasoningEffort, Task } from 'lowtide-core'
import { executeTurns, waitIdleFor } from '../src/turns.ts'

const SESSION_ID = 'sess-live-1'
const PROVIDER = 'deepseek-official'
const MODEL = 'deepseek-v4'
/** Mirrors LIVE_WAIT_MAX_MS — the ceiling a long task timeout cannot exceed. */
const WAIT_CAP_MS = 30_000

const roots: string[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lt-live-'))
  roots.push(dir)
  return dir
}

interface FakeEvent {
  type: string
  seq: number
  data?: unknown
}
type Handler = (session: { id: string }, event: FakeEvent) => void

interface AgentCfg {
  id?: string
  cwd?: string
  provider?: string
  model?: string
  reasoningEffort?: string
  nextTurn?: unknown[]
  nextStep?: unknown[]
  /** false = never idle (a busy conversation). */
  idle?: boolean
  /** turn/end reason kind; null = never emit (drives the timeout path). */
  turn?: string | null
}

/** A turn-emitting fake agent: followup emits assistant/message + turn/end. */
function fakeAgent(emit: Handler, cfg: AgentCfg = {}) {
  const session = { id: cfg.id ?? SESSION_ID, seq: 0, header: cfg.cwd === undefined ? {} : { cwd: cfg.cwd } }
  const followup = vi.fn((): void => {
    if (cfg.turn === null) return
    const kind = cfg.turn ?? 'completed'
    session.seq += 1
    emit(session, {
      type: 'assistant/message',
      seq: session.seq,
      data: { message: { content: [{ type: 'text', text: 'done' }] }, usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0 } },
    })
    session.seq += 1
    emit(session, {
      type: 'turn/end',
      seq: session.seq,
      data: { reason: { kind, ...(kind === 'failed' ? { message: 'boom' } : {}) } },
    })
  })
  const agent = {
    session,
    options: { provider: cfg.provider, model: cfg.model, reasoningEffort: cfg.reasoningEffort },
    inbox: { nextTurn: cfg.nextTurn ?? [], nextStep: cfg.nextStep ?? [] },
    whenIdle: async (): Promise<void> => {
      if (cfg.idle === false) await new Promise<void>(() => {})
    },
    followup,
    cancel: vi.fn(),
  }
  return { agent, followup }
}

interface HarnessOpts {
  live?: AgentCfg | false
  /** The preset the live conversation currently reports ('custom' = unrestorable). */
  preset?: string | (() => string)
  presetNames?: string[]
  resume?: 'ok' | 'throw'
  create?: 'ok' | 'throw'
  /** Source event log for the fork tier; null = no live source session at all. */
  sourceEvents?: Array<{ type: string; seq: number }> | null
  /** Make permissionPresets.set throw (forces the exception path). */
  setThrows?: boolean
  /** Preset per session id; overrides `preset` (defaults to lt-readonly). */
  presetFor?: (sessionId: string) => string
  /** Install a workspace registry whose attachSession is spied on. */
  withWorkspace?: boolean
}

function harness(opts: HarnessOpts = {}) {
  const handlers: Handler[] = []
  /** Chronology of the calls the finally block must order (preset → flush). */
  const order: string[] = []
  const emit: Handler = (session, event) => {
    for (const handler of handlers.slice()) handler(session, event)
  }
  const live = opts.live === undefined || opts.live === false ? undefined : fakeAgent(emit, opts.live)
  const resumedAgent = fakeAgent(emit, { id: 'sess-resumed', provider: PROVIDER, model: MODEL })
  const forkedAgent = fakeAgent(emit, { id: 'lt-forked', provider: PROVIDER, model: MODEL })

  const setPreset = vi.fn((_session: unknown, name: string): void => {
    order.push(`set:${name}`)
    if (opts.setThrows === true) throw new Error('unknown preset')
  })
  const flush = vi.fn(async (): Promise<void> => {
    order.push('flush')
  })
  const basePreset = typeof opts.preset === 'function' ? opts.preset : (): string => opts.preset ?? 'lt-readonly'
  const currentPreset = (session: { id: string }): string => (opts.presetFor !== undefined ? opts.presetFor(session.id) : basePreset())
  /** Spy on workspace attach: a borrowed conversation must never be attached. */
  const attachSession = vi.fn(async (_sid: string): Promise<void> => {
    order.push('attach')
  })
  const workspaceRegistry = opts.withWorkspace === true
    ? { create: async (path: string) => ({ path, attachSession }) }
    : undefined
  const resume = vi.fn(async () => {
    order.push('resume')
    if (opts.resume === 'throw') throw new Error(`cannot prepare session ${SESSION_ID} while it is live`)
    return { agent: resumedAgent.agent, dispose: async (): Promise<void> => {} }
  })
  const create = vi.fn(async () => {
    order.push('create')
    if (opts.create === 'throw') throw new Error('create failed')
    return { agent: forkedAgent.agent, dispose: async (): Promise<void> => {} }
  })
  const source = opts.sourceEvents === null
    ? undefined
    : {
        header: {},
        snapshotEvents: () => opts.sourceEvents ?? [{ type: 'turn/start', seq: 0 }, { type: 'turn/end', seq: 1 }],
      }

  const ctx = {
    get: (name: string) => (name === 'sessions' ? { flush } : undefined),
    on: (_event: string, handler: Handler) => {
      handlers.push(handler)
      return () => {
        const index = handlers.indexOf(handler)
        if (index >= 0) handlers.splice(index, 1)
      }
    },
    sessions: { get: () => source },
    workspaceRegistry,
    agentDefaultModel: { currentSelection: () => ({ provider: PROVIDER, model: MODEL }) },
    agents: {
      get: (id: unknown) => (live !== undefined && String(id) === live.agent.session.id ? live.agent : undefined),
      resume,
      create,
    },
    permissionPresets: {
      current: currentPreset,
      set: setPreset,
      names: opts.presetNames ?? ['lt-readonly', 'lt-standard'],
    },
    agentPresets: { mount: async (): Promise<void> => {} },
  } as unknown as Context

  return { ctx, order, live, resumedAgent, forkedAgent, setPreset, flush, resume, create, attachSession }
}

function makeTask(extra: Partial<Task> = {}): Task {
  return {
    id: 't-1',
    prompt: '继续昨天的重构',
    files: [],
    workspace: '',
    priority: 1,
    permissionPreset: 'lt-standard',
    status: 'queued',
    createdAt: '2026-11-11T00:00:00.000Z',
    ...extra,
  }
}

const oneShot = (index: number): string | null => (index === 0 ? '继续' : null)

describe('waitIdleFor', () => {
  test('an idle agent resolves true and leaves no pending timer', async () => {
    vi.useFakeTimers()
    const { agent } = fakeAgent(() => {}, { idle: true })
    await expect(waitIdleFor(agent as never, WAIT_CAP_MS)).resolves.toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('a busy agent resolves false once the timeout fires, timer still cleaned up', async () => {
    vi.useFakeTimers()
    const { agent } = fakeAgent(() => {}, { idle: false })
    const waiting = waitIdleFor(agent as never, 1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(waiting).resolves.toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('a rejecting whenIdle counts as "not idle" instead of throwing', async () => {
    const agent = { whenIdle: async (): Promise<void> => { throw new Error('disposed') } }
    await expect(waitIdleFor(agent as never, 50)).resolves.toBe(false)
  })
})

describe('idle live conversation is driven in place', () => {
  test('same session id, resumed=true, permission restored before flush', async () => {
    const h = harness({ live: { cwd: 'C:\\ws', provider: PROVIDER, model: MODEL, reasoningEffort: 'high' } })
    const res = await executeTurns(h.ctx, makeTask({ workspace: 'C:\\ws' }), oneShot, 60_000, 'high', SESSION_ID)

    expect(res.status).toBe('done')
    expect(res.resumed).toBe(true)
    expect(res.forked).toBeUndefined()
    expect(res.resumeNote).toBeUndefined()
    // The task ran on the SOURCE conversation: no resume, no fork, no second session.
    expect(h.live?.followup).toHaveBeenCalledTimes(1)
    expect(h.resume).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
    // The borrowed session got the task preset, then its own preset back.
    expect(h.setPreset.mock.calls[0]).toEqual([h.live?.agent.session, 'lt-standard'])
    expect(h.setPreset.mock.calls[1]).toEqual([h.live?.agent.session, 'lt-readonly'])
    expect(h.order).toEqual(['set:lt-standard', 'set:lt-readonly', 'flush'])
  })
})

describe('busy live conversation is never seized', () => {
  test('bounded short wait, then fork with an honest note', async () => {
    const h = harness({
      live: { cwd: 'C:\\ws', provider: PROVIDER, model: MODEL, idle: false },
      resume: 'throw',
    })
    const started = Date.now()
    const res = await executeTurns(h.ctx, makeTask({ workspace: 'C:\\ws' }), oneShot, 40, undefined, SESSION_ID)
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(res.resumed).toBeUndefined()
    expect(res.forked).toBe(true)
    expect(res.resumeNote).toContain('仍在执行中')
    expect(h.live?.followup).not.toHaveBeenCalled()
  })

  test('the wait is capped at 30s even when the task timeout is 10min', async () => {
    vi.useFakeTimers()
    const h = harness({
      live: { cwd: 'C:\\ws', provider: PROVIDER, model: MODEL, idle: false },
      resume: 'throw',
    })
    let settled = false
    const run = executeTurns(h.ctx, makeTask({ workspace: 'C:\\ws' }), oneShot, 10 * 60_000, undefined, SESSION_ID)
      .then((result) => {
        settled = true
        return result
      })
    // Let the wait timer be scheduled, then advance exactly the cap.
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(WAIT_CAP_MS)
    await vi.advanceTimersByTimeAsync(0)
    // A 10min wait would still be pending here.
    expect(settled).toBe(true)
    const res = await run
    expect(res.forked).toBe(true)
    expect(res.resumeNote).toContain('30s')
  })
})

describe('permission-preset guard', () => {
  test('a custom preset refuses the live path (it cannot be restored)', async () => {
    const h = harness({ live: { cwd: 'C:\\ws', provider: PROVIDER, model: MODEL }, preset: 'custom', resume: 'throw' })
    const res = await executeTurns(h.ctx, makeTask({ workspace: 'C:\\ws' }), oneShot, 60_000, undefined, SESSION_ID)
    expect(res.resumed).toBeUndefined()
    expect(res.forked).toBe(true)
    expect(res.resumeNote).toContain('自定义档')
    expect(h.live?.followup).not.toHaveBeenCalled()
  })

  test('an unreadable preset refuses the live path', async () => {
    const h = harness({
      live: { cwd: 'C:\\ws', provider: PROVIDER, model: MODEL },
      preset: () => { throw new Error('no table entry for this session') },
      resume: 'throw',
    })
    const res = await executeTurns(h.ctx, makeTask({ workspace: 'C:\\ws' }), oneShot, 60_000, undefined, SESSION_ID)
    expect(res.resumed).toBeUndefined()
    expect(res.resumeNote).toContain('无法读取')
    expect(h.live?.followup).not.toHaveBeenCalled()
  })

  test('an empty/unknown preset refuses the live path', async () => {
    const empty = harness({ live: { cwd: 'C:\\ws', provider: PROVIDER, model: MODEL }, preset: '', resume: 'throw' })
    const resEmpty = await executeTurns(empty.ctx, makeTask({ workspace: 'C:\\ws' }), oneShot, 60_000, undefined, SESSION_ID)
    expect(resEmpty.resumeNote).toContain('无法确定')

    const gone = harness({
      live: { cwd: 'C:\\ws', provider: PROVIDER, model: MODEL },
      preset: 'removed-preset',
      presetNames: ['lt-readonly'],
      resume: 'throw',
    })
    const resGone = await executeTurns(gone.ctx, makeTask({ workspace: 'C:\\ws' }), oneShot, 60_000, undefined, SESSION_ID)
    expect(resGone.resumeNote).toContain('不在预设表里')
  })
})

describe('consistency guards', () => {
  const cases: Array<{ name: string; live: AgentCfg; reasoning?: ReasoningEffort; note: string }> = [
    { name: 'cwd', live: { cwd: 'C:\\other', provider: PROVIDER, model: MODEL }, note: '工作目录' },
    { name: 'provider', live: { cwd: 'C:\\ws', provider: 'other-provider', model: MODEL }, note: '线路' },
    { name: 'model', live: { cwd: 'C:\\ws', provider: PROVIDER, model: 'other-model' }, note: '模型' },
    { name: 'reasoning', live: { cwd: 'C:\\ws', provider: PROVIDER, model: MODEL, reasoningEffort: 'low' }, reasoning: 'high', note: '推理档' },
    { name: 'inbox', live: { cwd: 'C:\\ws', provider: PROVIDER, model: MODEL, nextTurn: [{ kind: 'user' }] }, note: '排队' },
  ]

  for (const item of cases) {
    test(`${item.name} mismatch degrades to the fork with a real reason`, async () => {
      const h = harness({ live: item.live, resume: 'throw' })
      const res = await executeTurns(h.ctx, makeTask({ workspace: 'C:\\ws' }), oneShot, 60_000, item.reasoning, SESSION_ID)
      expect(res.resumed).toBeUndefined()
      expect(res.forked).toBe(true)
      expect(res.resumeNote).toContain(item.note)
      expect(h.live?.followup).not.toHaveBeenCalled()
    })
  }

  test('cwd comparison canonicalizes realpath (sub/.. spelling still matches)', async () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'sub'))
    const h = harness({ live: { cwd: dir, provider: PROVIDER, model: MODEL } })
    const res = await executeTurns(h.ctx, makeTask({ workspace: join(dir, 'sub', '..') }), oneShot, 60_000, undefined, SESSION_ID)
    expect(res.resumed).toBe(true)
  })

  test.skipIf(process.platform !== 'win32')('cwd comparison is case-insensitive on Windows', async () => {
    const h = harness({ live: { cwd: 'c:\\LT-CASE-WS', provider: PROVIDER, model: MODEL } })
    const res = await executeTurns(h.ctx, makeTask({ workspace: 'C:\\lt-case-ws' }), oneShot, 60_000, undefined, SESSION_ID)
    expect(res.resumed).toBe(true)
  })
})

describe('preset restore on every exit path', () => {
  const exits: Array<{ status: string; turn: string | null }> = [
    { status: 'done', turn: 'completed' },
    { status: 'failed', turn: 'failed' },
    { status: 'aborted', turn: 'aborted' },
    { status: 'timeout', turn: null },
  ]

  for (const exit of exits) {
    test(`${exit.status}: restore runs before the flush`, async () => {
      const h = harness({
        live: {
          provider: PROVIDER,
          model: MODEL,
          ...(exit.turn === null ? { turn: null } : { turn: exit.turn }),
        },
      })
      const res = await executeTurns(h.ctx, makeTask(), oneShot, exit.turn === null ? 15 : 60_000, undefined, SESSION_ID)
      expect(res.status).toBe(exit.status)
      expect(h.order).toEqual(['set:lt-standard', 'set:lt-readonly', 'flush'])
    })
  }

  test('a throwing run still restores before the flush', async () => {
    const h = harness({ live: { provider: PROVIDER, model: MODEL }, setThrows: true })
    await expect(executeTurns(h.ctx, makeTask(), oneShot, 60_000, undefined, SESSION_ID)).rejects.toThrow('unknown preset')
    expect(h.order).toEqual(['set:lt-standard', 'set:lt-readonly', 'flush'])
  })
})

describe('resume tier and the no-false-note rule', () => {
  test('a successful cold resume reports resumed and no fallback note', async () => {
    const h = harness({ live: false, resume: 'ok' })
    const res = await executeTurns(h.ctx, makeTask(), oneShot, 60_000, undefined, SESSION_ID)
    expect(res.resumed).toBe(true)
    expect(res.resumed).toBe(true)
    expect(res.forked).toBeUndefined()
    expect(res.resumeNote).toBeUndefined()
    expect(h.create).not.toHaveBeenCalled()
  })

  test('a cold resume that fails forks losslessly, with no live-tier note', async () => {
    const h = harness({ live: false, resume: 'throw' })
    const res = await executeTurns(h.ctx, makeTask(), oneShot, 60_000, undefined, SESSION_ID)
    expect(res.forked).toBe(true)
    expect(res.resumed).toBeUndefined()
    expect(res.resumeNote).toBeUndefined()
    expect(h.order).toContain('create')
  })

  test('a busy live attempt followed by a successful resume leaves no false note', async () => {
    const h = harness({ live: { provider: PROVIDER, model: MODEL, idle: false }, resume: 'ok' })
    const res = await executeTurns(h.ctx, makeTask(), oneShot, 40, undefined, SESSION_ID)
    expect(res.resumed).toBe(true)
    expect(res.forked).toBeUndefined()
    expect(res.resumeNote).toBeUndefined()
  })
})

describe('cold resume borrows the user session too', () => {
  test('restores the borrowed preset before the flush and never attaches', async () => {
    const h = harness({ live: false, resume: 'ok', withWorkspace: true })
    const res = await executeTurns(h.ctx, makeTask({ workspace: tempDir() }), oneShot, 60_000, undefined, SESSION_ID)

    expect(res.status).toBe('done')
    expect(res.resumed).toBe(true)
    expect(res.forked).toBeUndefined()
    expect(res.resumeNote).toBeUndefined()
    // Same session id both times: task preset in, the user's own preset back.
    expect(h.setPreset.mock.calls[0]).toEqual([h.resumedAgent.agent.session, 'lt-standard'])
    expect(h.setPreset.mock.calls[1]).toEqual([h.resumedAgent.agent.session, 'lt-readonly'])
    expect(h.order).toEqual(['resume', 'set:lt-standard', 'set:lt-readonly', 'flush'])
    // The user's conversation is borrowed, not filed into the task workspace.
    expect(h.attachSession).not.toHaveBeenCalled()
  })

  test('custom preset: never driven, unrestorable, forks with an honest note', async () => {
    const h = harness({
      live: false,
      resume: 'ok',
      presetFor: (id) => (id === 'sess-resumed' ? 'custom' : 'lt-readonly'),
    })
    const res = await executeTurns(h.ctx, makeTask(), oneShot, 60_000, undefined, SESSION_ID)

    expect(res.forked).toBe(true)
    expect(res.resumed).toBeUndefined()
    expect(res.resumeNote).toContain('不能原地续接')
    // The user's session never got the task preset (no set on it at all).
    for (const [session] of h.setPreset.mock.calls) expect(session).not.toBe(h.resumedAgent.agent.session)
  })

  test('a preset outside the catalog is refused the same way', async () => {
    const h = harness({
      live: false,
      resume: 'ok',
      presetNames: ['lt-readonly'],
      presetFor: (id) => (id === 'sess-resumed' ? 'lt-weird' : 'lt-readonly'),
    })
    const res = await executeTurns(h.ctx, makeTask(), oneShot, 60_000, undefined, SESSION_ID)

    expect(res.forked).toBe(true)
    expect(res.resumed).toBeUndefined()
    expect(res.resumeNote).toContain('不能原地续接')
    for (const [session] of h.setPreset.mock.calls) expect(session).not.toBe(h.resumedAgent.agent.session)
  })

  test('an unreadable preset is refused instead of guessed', async () => {
    const h = harness({ live: false, resume: 'ok' })
    ;(h.ctx as unknown as { permissionPresets: { current: (session: unknown) => string } }).permissionPresets.current = () => {
      throw new Error('host too old')
    }
    const res = await executeTurns(h.ctx, makeTask(), oneShot, 60_000, undefined, SESSION_ID)

    expect(res.forked).toBe(true)
    expect(res.resumeNote).toContain('不能原地续接')
    for (const [session] of h.setPreset.mock.calls) expect(session).not.toBe(h.resumedAgent.agent.session)
  })
})

describe('a borrowed live conversation is never attached', () => {
  test('zero attach calls on both the initial and the finally path', async () => {
    const dir = tempDir()
    const h = harness({ live: { cwd: dir, provider: PROVIDER, model: MODEL }, withWorkspace: true })
    const res = await executeTurns(h.ctx, makeTask({ workspace: dir }), oneShot, 60_000, undefined, SESSION_ID)

    expect(res.status).toBe('done')
    expect(res.resumed).toBe(true)
    expect(h.order).not.toContain('attach')
    expect(h.attachSession).not.toHaveBeenCalled()
  })
})
