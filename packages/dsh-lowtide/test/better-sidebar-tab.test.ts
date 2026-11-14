/**
 * fake-host tests for the optional dsh-better-sidebar bridge.
 *
 * The host lives in the browser half of the *other* plugin, so these tests
 * stand a small structural double in its place and drive the states the review
 * called out: a tab the user switched off, a descriptor the host does not
 * know, no session in view, a registration that throws, and no host at all.
 * Rendering is mocked out — only the wiring is under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../client/components/QueueDock.tsx', () => ({ QueueDockView: (): null => null }))
vi.mock('../client/lib/icons.tsx', () => ({ Icon: (): null => null }))

const { QUEUE_TAB_ID, hostedNow, installQueueTab, openQueueTab } = await import('../client/better-sidebar.tsx')
const { lowtideStore, resetUiState } = await import('../client/store.ts')

interface FakeTab {
  id: string
  title: string | (() => string)
  icon?: unknown
  order?: number
  single?: boolean
  badge?: () => string | number | null
  component: () => unknown
}

interface FakeHost {
  registerTab(tab: FakeTab): () => void
  openTab(seed: { type: string }): void
  isTabEnabled(id: string): boolean
  subscribe(listener: () => void): () => void
  getTab?: (id: string) => FakeTab | undefined
  getSnapshot?: () => { sessionId: string | undefined }
  subscribeState?: (listener: () => void) => () => void
}

/** Host double that records what the bridge asks of it. */
function makeHost(options: {
  enabled?: boolean
  session?: string | undefined
  withExtended?: boolean
  registerThrows?: boolean
} = {}) {
  const enabled = { value: options.enabled ?? true }
  const session = { value: 'session' in options ? options.session : 's-1' }
  const registered: FakeTab[] = []
  const opened: Array<{ type: string }> = []
  const listeners: Array<() => void> = []
  const stateListeners: Array<() => void> = []
  const disposed: string[] = []
  const host: FakeHost = {
    registerTab(tab) {
      if (options.registerThrows === true) throw new Error('registry closed')
      registered.push(tab)
      return () => {
        const at = registered.indexOf(tab)
        if (at >= 0) registered.splice(at, 1)
        disposed.push(tab.id)
      }
    },
    openTab(seed) { opened.push(seed) },
    isTabEnabled(id: string) { return enabled.value && registered.some((t) => t.id === id) },
    subscribe(listener) { listeners.push(listener); return () => {} },
  }
  if (options.withExtended !== false) {
    host.getTab = (id: string) => registered.find((t) => t.id === id)
    host.getSnapshot = () => ({ sessionId: session.value })
    host.subscribeState = (listener: () => void) => { stateListeners.push(listener); return () => {} }
  }
  return {
    host, registered, opened, disposed, listeners, stateListeners,
    setEnabled: (next: boolean) => { enabled.value = next; for (const l of stateListeners) l() },
    setSession: (next: string | undefined) => { session.value = next; for (const l of stateListeners) l() },
    fireSubscribers: () => { for (const l of listeners) l() },
  }
}

/** Teardowns of every ctx made in a test, drained after it. */
const liveTeardowns: Array<() => void> = []

/** Minimal `ctx` double: `inject(names, cb)` + an `effect` that runs now. */
function makeCtx(service: FakeHost | undefined) {
  const disposers: Array<() => void> = []
  const injected = {
    get: (name: string): unknown => (name === 'betterSidebar' ? service : undefined),
    get betterSidebar() { return service },
    effect: (fn: () => (() => void) | undefined): (() => void) => {
      const dispose = fn()
      const disposer = typeof dispose === 'function' ? dispose : () => {}
      disposers.push(disposer)
      return () => {
        const index = disposers.indexOf(disposer)
        if (index >= 0) disposers.splice(index, 1)
        disposer()
      }
    },
  }
  const ctx = {
    inject: (_names: string[], body: (scope: typeof injected) => void): void => { body(injected) },
  }
  const teardown = (): void => { for (const dispose of disposers.splice(0)) dispose() }
  liveTeardowns.push(teardown)
  return { ctx: ctx as unknown as Parameters<typeof installQueueTab>[0], teardown, disposers }
}

const snapshot = () => lowtideStore.getSnapshot()

beforeEach(() => {
  resetUiState()
})

afterEach(() => {
  for (const teardown of liveTeardowns.splice(0)) teardown()
})

describe('queue tab registration', () => {
  it('registers one plain descriptor: id, order, single, function icon, localized title', () => {
    const fake = makeHost()
    const { ctx } = makeCtx(fake.host)
    installQueueTab(ctx)

    expect(fake.registered).toHaveLength(1)
    const tab = fake.registered[0]!
    expect(tab.id).toBe(QUEUE_TAB_ID)
    expect(tab.id).toBe('dsh-lowtide:queue')
    expect(tab.order).toBe(45)
    expect(tab.single).toBe(true)
    // Plain descriptor: the host lists it in the native sidebar + menu and in
    // its own bottom workbench + menu. Neither opt-out may be set, and there
    // is no `description` field to drift out of sync with the i18n dict.
    expect('hidden' in tab).toBe(false)
    expect('bottomOnly' in tab).toBe(false)
    expect('description' in tab).toBe(false)
    expect(typeof tab.icon).toBe('function')
    expect(tab.title).toBeTypeOf('function')
    expect((tab.title as () => string)()).toBe('闲时队列')
    expect(tab.badge?.()).toBeNull()
  })

  it('hands the dock over and opens the tab once installed', () => {
    const fake = makeHost()
    const { ctx } = makeCtx(fake.host)
    installQueueTab(ctx)

    expect(snapshot().sidebarHosted).toBe(true)
    openQueueTab()
    expect(fake.opened).toEqual([{ type: QUEUE_TAB_ID }])
    expect(snapshot().queueOpen).toBe(false)
  })

  it('reads the badge live instead of caching it at registration', () => {
    const fake = makeHost()
    const { ctx } = makeCtx(fake.host)
    installQueueTab(ctx)
    const badge = fake.registered[0]!.badge!

    expect(badge()).toBeNull()
    lowtideStore.update((s) => {
      s.host = { queue: { total: 3, pendingReview: 3, queued: 3, running: 0 } } as unknown as typeof s.host
    })
    expect(badge()).toBe(3)
  })
})

describe('a tab the user switched off falls back to the dock', () => {
  it('drops the hand-over and reopens the dock', () => {
    const fake = makeHost()
    const { ctx } = makeCtx(fake.host)
    installQueueTab(ctx)
    expect(snapshot().sidebarHosted).toBe(true)

    fake.setEnabled(false)
    expect(snapshot().sidebarHosted).toBe(false)
    openQueueTab()
    expect(fake.opened).toEqual([])
    expect(snapshot().queueOpen).toBe(true)
  })

  it('restores the hand-over when the tab comes back', () => {
    const fake = makeHost()
    const { ctx } = makeCtx(fake.host)
    installQueueTab(ctx)
    fake.setEnabled(false)
    fake.setEnabled(true)
    expect(snapshot().sidebarHosted).toBe(true)
  })

  it('re-evaluates on plain `subscribe` too, not only on `subscribeState`', () => {
    const fake = makeHost({ withExtended: false })
    const { ctx } = makeCtx(fake.host)
    installQueueTab(ctx)
    expect(snapshot().sidebarHosted).toBe(true)

    // Older host: no subscribeState, so registry events are the only signal.
    fake.setEnabled(false)
    expect(snapshot().sidebarHosted).toBe(true)
    fake.fireSubscribers()
    expect(snapshot().sidebarHosted).toBe(false)
  })
})

describe('host states that make openTab a silent no-op', () => {
  it('falls back when the host has no session in view', () => {
    const fake = makeHost({ session: undefined })
    const { ctx } = makeCtx(fake.host)
    installQueueTab(ctx)

    expect(snapshot().sidebarHosted).toBe(false)
    openQueueTab()
    expect(fake.opened).toEqual([])
    expect(snapshot().queueOpen).toBe(true)
  })

  it('follows the session appearing and disappearing', () => {
    const fake = makeHost({ session: undefined })
    const { ctx } = makeCtx(fake.host)
    installQueueTab(ctx)
    expect(snapshot().sidebarHosted).toBe(false)

    fake.setSession('s-2')
    expect(snapshot().sidebarHosted).toBe(true)
    fake.setSession(undefined)
    expect(snapshot().sidebarHosted).toBe(false)
  })

  it('falls back when the descriptor is not the one the host knows', () => {
    const fake = makeHost()
    fake.host.getTab = () => undefined
    const { ctx } = makeCtx(fake.host)
    installQueueTab(ctx)

    expect(hostedNow(fake.host)).toBe(false)
    openQueueTab()
    expect(fake.opened).toEqual([])
    expect(snapshot().queueOpen).toBe(true)
  })

  it('treats an older host without the optional checks as enabled', () => {
    const fake = makeHost({ withExtended: false })
    const { ctx } = makeCtx(fake.host)
    installQueueTab(ctx)

    expect(hostedNow(fake.host)).toBe(true)
    expect(snapshot().sidebarHosted).toBe(true)
  })
})

describe('a failing registration never steals the dock', () => {
  it('keeps the dock when registerTab throws', () => {
    const fake = makeHost({ registerThrows: true })
    const { ctx } = makeCtx(fake.host)
    // The bridge reports the failure; keep the test output clean about it.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    installQueueTab(ctx)
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()

    expect(fake.registered).toHaveLength(0)
    expect(snapshot().sidebarHosted).toBe(false)
    openQueueTab()
    expect(fake.opened).toEqual([])
    // The dock really is visible again: expanded, not merely "not handed over".
    expect(snapshot().queueOpen).toBe(true)
  })
})

describe('teardown', () => {
  it('gives the dock back when the host goes away', () => {
    const fake = makeHost()
    const { ctx, teardown } = makeCtx(fake.host)
    installQueueTab(ctx)
    expect(snapshot().sidebarHosted).toBe(true)

    teardown()
    expect(snapshot().sidebarHosted).toBe(false)
    openQueueTab()
    expect(fake.opened).toEqual([])
    expect(snapshot().queueOpen).toBe(true)
    expect(fake.disposed).toEqual([QUEUE_TAB_ID])
  })

  it('only clears its own handle, not a newer installation\'s', () => {
    // Two different service instances: the second one wins the handle, so the
    // first one's teardown must not hand the dock back behind its back.
    const first = makeHost()
    const second = makeHost()
    const a = makeCtx(first.host)
    installQueueTab(a.ctx)
    const b = makeCtx(second.host)
    installQueueTab(b.ctx)
    expect(snapshot().sidebarHosted).toBe(true)

    a.teardown()
    expect(snapshot().sidebarHosted).toBe(true)
    openQueueTab()
    expect(second.opened).toEqual([{ type: QUEUE_TAB_ID }])
    expect(first.opened).toEqual([])

    b.teardown()
    expect(snapshot().sidebarHosted).toBe(false)
  })
})

describe('without better-sidebar', () => {
  it('installs nothing and still opens the dock', () => {
    const { ctx } = makeCtx(undefined)
    installQueueTab(ctx)

    expect(snapshot().sidebarHosted).toBe(false)
    openQueueTab()
    expect(snapshot().queueOpen).toBe(true)
  })
})
