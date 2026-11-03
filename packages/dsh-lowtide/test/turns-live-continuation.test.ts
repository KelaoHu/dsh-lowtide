/**
 * Continuation through the LIVE source: when the requested conversation is
 * still in memory (the desktop runtime keeps every opened conversation live),
 * `agents.resume` cannot prepare it, so the run must drive the running agent
 * instead of silently falling back to a forked copy.
 */
import { describe, expect, test, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { executeTurns } from '../src/turns.ts'
import type { Task } from 'lowtide-core'

const task: Task = {
  id: 't-live',
  prompt: 'continue it',
  files: [],
  workspace: '',
  priority: 1,
  permissionPreset: 'lt-standard',
  status: 'queued',
  createdAt: '2026-11-03T00:00:00.000Z',
}

type Handler = (session: { id: string }, event: Record<string, unknown>) => void

/** Minimal harness: a live source agent (idle or busy) plus the services
 *  executeTurns touches before and after the turn loop. */
function makeCtx(options: { idle: boolean; preset?: string }) {
  const listeners = new Set<Handler>()
  const setPreset = vi.fn()
  const followup = vi.fn((_message: unknown) => {
    for (const handler of listeners) {
      handler({ id: 's-1' }, {
        type: 'assistant/message',
        seq: 1,
        data: { message: { content: [{ type: 'text', text: 'done in place' }] } },
      })
      handler({ id: 's-1' }, { type: 'turn/end', seq: 2, data: { reason: { kind: 'completed' } } })
    }
  })
  // The idle probe and the run body both wait on the source: only the probe
  // sees it busy, so the run that degrades afterwards can still proceed.
  let idleCalls = 0
  const agent = {
    session: { id: 's-1', seq: 0 },
    whenIdle: () => {
      idleCalls += 1
      return options.idle || idleCalls > 1 ? Promise.resolve() : new Promise<void>(() => {})
    },
    followup,
    cancel: vi.fn(),
  }
  const resume = vi.fn(async () => ({ agent, dispose: async () => {} }))
  const ctx = {
    get: (name: string) => (name === 'sessions' ? { flush: async () => true } : undefined),
    on: (_event: string, handler: Handler) => {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4' }) },
    agents: { get: () => agent, resume, create: vi.fn() },
    permissionPresets: {
      current: () => options.preset ?? 'lt-readonly',
      set: setPreset,
    },
    agentPresets: { mount: vi.fn() },
  }
  return { ctx: ctx as unknown as Context, agent, resume, setPreset, followup }
}

describe('executeTurns — live source conversation', () => {
  test('drives the running agent instead of forking a copy', async () => {
    const { ctx, resume, setPreset } = makeCtx({ idle: true })
    const result = await executeTurns(ctx, task, (index) => (index === 0 ? 'go' : null), 5_000, undefined, 's-1')

    expect(result.status).toBe('done')
    expect(result.resumed).toBe(true)
    expect(result.forked).toBeUndefined()
    expect(result.resumeNote).toBeUndefined()
    expect(result.turns[0]?.text).toBe('done in place')
    // The live path must not try to prepare — and therefore fork — the session.
    expect(resume).not.toHaveBeenCalled()
    // Borrowed conversation: the task preset applies, the user's own comes back.
    expect(setPreset.mock.calls.map((call) => call[1])).toEqual(['lt-standard', 'lt-readonly'])
  })

  test('a busy source waits, then says in the run result that it fell back', async () => {
    const { ctx, resume } = makeCtx({ idle: false })
    const result = await executeTurns(ctx, task, (index) => (index === 0 ? 'go' : null), 50, undefined, 's-1')

    expect(resume).toHaveBeenCalled()
    expect(result.resumeNote).toContain('原会话仍在执行中')
  })
})
