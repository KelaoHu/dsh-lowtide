/**
 * Optional dsh-better-sidebar bridge: contributes the queue panel as a tab, so
 * the same panel can live in the native right sidebar and in the host's bottom
 * workbench instead of (or alongside) the composer dock.
 *
 * A plain descriptor (no `hidden`, no `bottomOnly`) is listed by BOTH "+" menus
 * — DSH's native right sidebar guide and better-sidebar's own bottom workbench
 * — so one registration serves the sidebar and the bottom bar.
 *
 * better-sidebar is optional and its service lives in the browser half only
 * (`ctx.provide('betterSidebar', …)`). Cordis has no "optional inject", so a
 * static `inject` entry would keep this whole client half dormant on installs
 * without the host; `ctx.inject` waits for the service instead and re-runs when
 * it appears or disappears (HMR / disable), which is the pattern the host's own
 * client code uses for its tab registries.
 *
 * The host API used here (0.28.x): `registerTab` returns a disposer;
 * `openTab` silently no-ops for an unregistered type or a session-less
 * snapshot; `isTabEnabled` reports the user's per-type switch; `subscribe`
 * fires on registry changes and `subscribeState` on enablement/session changes.
 * Nothing from the host package is imported — the service is described by a
 * local structural interface so the plugin adds no dependency.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { DICTS, fill, type NsKey } from './i18n.ts'
import { Icon } from './lib/icons.tsx'
import { lowtideStore, useLowtide } from './store.ts'
import { QueueDockView } from './components/QueueDock.tsx'

/** Structural view of the host's tab descriptor. */
interface SidebarTab {
  id: string
  title: string | (() => string)
  icon?: React.ReactNode | ((size: number) => React.ReactNode)
  order?: number
  single?: boolean
  badge?: () => string | number | null
  component: () => React.JSX.Element
}

/** The slice of the host's client service this plugin uses. Declared locally,
 *  like the other optional host services read here, so the integration adds no
 *  dependency and the plugin still loads on installs without the host.
 *  `getTab` / `getSnapshot` / `subscribeState` are newer and optional: an older
 *  host simply makes those checks fall back to `isTabEnabled`. */
interface SidebarHost {
  registerTab(tab: SidebarTab): () => void
  openTab(seed: { type: string }): void
  isTabEnabled(type: string): boolean
  subscribe(listener: () => void): () => void
  getTab?(id: string): SidebarTab | undefined
  getSnapshot?(): { sessionId: string | undefined }
  subscribeState?(listener: () => void): () => void
}

/** The injection scope `ctx.inject` hands the callback. */
interface InjectionScope {
  effect(fn: () => (() => void) | void): () => void
  betterSidebar?: unknown
  get?(name: string): unknown
}

/** Tab type of the queue panel (also its `SidebarTab.id`). */
export const QUEUE_TAB_ID = 'dsh-lowtide:queue'

/** Live host handle; null while better-sidebar is absent (or its registration
 *  failed — `openQueueTab` then keeps using the dock). */
let host: SidebarHost | null = null

/** Locale-bound translate for the off-slot seats (tab title / tab body), which
 *  get no framework-injected `t`. Reads the live locale at call time. */
function translate(key: NsKey, params?: Record<string, unknown>): string {
  const locale = lowtideStore.getSnapshot().activeLocale
  const dict = locale === 'en' ? DICTS.en : DICTS.zh
  return fill(dict[key], params)
}

/**
 * True when the host would actually put this tab on screen: the type is
 * registered, the user has not switched it off, and a session is in view.
 * Anything else means `openTab` is a silent no-op, so the dock has to stay.
 */
export function hostedNow(sidebar: SidebarHost): boolean {
  if (!sidebar.isTabEnabled(QUEUE_TAB_ID)) return false
  if (sidebar.getTab !== undefined && sidebar.getTab(QUEUE_TAB_ID) === undefined) return false
  if (sidebar.getSnapshot !== undefined && sidebar.getSnapshot().sessionId === undefined) return false
  return true
}

/** Open (or focus) the queue tab. Falls back to expanding the composer dock
 *  when no sidebar host is present or the host would not show the tab, so
 *  "enqueued" always lands somewhere visible. */
export function openQueueTab(): void {
  const sidebar = host
  // `openTab` refuses silently (no throw) for an unregistered type or a
  // session-less snapshot, so check those before trusting it.
  if (sidebar !== null && hostedNow(sidebar)) {
    try {
      sidebar.openTab({ type: QUEUE_TAB_ID })
      return
    } catch (error) {
      console.error('[dsh-lowtide] openQueueTab failed', error)
    }
  }
  // Dock fallback: expand it AND drop the hand-over, otherwise a stale
  // `sidebarHosted` would keep the dock unmounted and nothing would show.
  lowtideStore.update((s) => {
    s.queueOpen = true
    s.sidebarHosted = false
  })
}

/** Tab body: the queue panel, always expanded and filling the tab. */
function LowtideQueueTab(): React.JSX.Element {
  const locale = useLowtide((s) => s.activeLocale)
  const dict = locale === 'en' ? DICTS.en : DICTS.zh
  return (
    <QueueDockView
      t={(key, params) => fill(dict[key], params)}
      seat="panel"
    />
  )
}

/** Icon: lowtide's `Icon` probes the shell's own icon set, and the 14/16/20/24
 *  suffix is the legacy name it resolves (`IconQueueOutline14` → …Regular). */
function queueTabIcon(size: number): React.JSX.Element {
  const token = size === 16 || size === 20 || size === 24 ? size : 14
  return <Icon name={`IconQueueOutline${token}`} size={size} />
}

/** Tab badge: pending-review count (the number that needs a human). Evaluated
 *  when the host reads it, so it tracks the host's render pass — best effort,
 *  not a promised live counter. */
function queueTabBadge(): number | null {
  const pending = lowtideStore.getSnapshot().host?.queue.pendingReview ?? 0
  return pending > 0 ? pending : null
}

function queueTabDescriptor(): SidebarTab {
  return {
    id: QUEUE_TAB_ID,
    title: () => translate('dock.tabTitle'),
    icon: queueTabIcon,
    // After editor(10) / git(20) / subagent(30) / sidechat(35) / terminal(40),
    // ahead of the default 100 — the queue is a first-class working surface.
    order: 45,
    single: true,
    badge: queueTabBadge,
    component: LowtideQueueTab,
  }
}

/** Read the host service through either scope shape (property or `get`). */
function readSidebar(injected: InjectionScope): SidebarHost | undefined {
  const direct = injected.betterSidebar
  if (direct !== undefined && direct !== null) return direct as SidebarHost
  if (typeof injected.get === 'function') {
    const viaGet = injected.get('betterSidebar')
    if (viaGet !== undefined && viaGet !== null) return viaGet as SidebarHost
  }
  return undefined
}

/** Wire the queue tab into better-sidebar when — and only when — it is there. */
export function installQueueTab(ctx: ClientContext): void {
  ctx.inject(['betterSidebar'], (injected: unknown) => {
    const scope = injected as InjectionScope
    const sidebar = readSidebar(scope)
    if (sidebar === undefined) return
    // The dock yields only while the host will actually render the tab. Track
    // enablement (a type the user disabled in the Side card settings) AND the
    // session: with no session in view the host's sidebar is gone too, so the
    // dock has to take over or the queue would have no surface at all.
    const sync = (): void => {
      const hosted = hostedNow(sidebar)
      lowtideStore.update((s) => { if (s.sidebarHosted !== hosted) s.sidebarHosted = hosted })
    }
    scope.effect(() => {
      try {
        const dispose = sidebar.registerTab(queueTabDescriptor())
        // Publish the handle only once the tab really exists: a failed (or
        // racing) registration must leave the dock in charge.
        host = sidebar
        sync()
        return dispose
      } catch (error) {
        console.error('[dsh-lowtide] registerTab failed', error)
        return () => {}
      }
    })
    // `subscribe` only fires on register/dispose; preference and session
    // changes come through `subscribeState` (newer hosts). Without it an older
    // host keeps syncing on registry changes only.
    scope.effect(() => sidebar.subscribe(sync))
    if (typeof sidebar.subscribeState === 'function') {
      const subscribeState = sidebar.subscribeState
      scope.effect(() => subscribeState.call(sidebar, sync))
    }
    // Teardown (HMR, host disable/uninstall): give the dock back, never leave
    // the queue with no surface at all. Guarded by identity so a newer
    // installation's handle is not cleared by an older disposer.
    scope.effect(() => () => {
      if (host !== sidebar) return
      host = null
      lowtideStore.update((s) => { s.sidebarHosted = false })
    })
  })
}
