/**
 * Optional dsh-better-sidebar bridge: contributes the queue panel as a tab,
 * replacing the composer dock whenever the host is installed.
 *
 * A plain descriptor (no `hidden`, no `bottomOnly`) is listed by BOTH "+"
 * menus — DSH's native right Sidebar guide and better-sidebar's own bottom
 * workbench — so one registration serves the sidebar and the bottom bar.
 *
 * better-sidebar is optional and its service lives in the browser half only
 * (`ctx.provide('betterSidebar', …)`). Cordis has no "optional inject", so a
 * static `inject` entry would keep this whole client half dormant on installs
 * without the host; `ctx.inject` waits for the service instead and re-runs when
 * it appears or disappears (HMR / disable), which is the pattern the host's own
 * `src/client/native/index.ts` uses for `sidebarRightTabs`.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { translateFor } from './i18n.ts'
import { Icon } from './lib/icons.tsx'
import { lowtideStore, useLowtide } from './store.ts'
import { QueueDockView } from './components/QueueDock.tsx'

/** Structural view of the host's tab descriptor (dsh-better-sidebar ≥0.12). */
interface SidebarTab {
  id: string
  title: string | (() => string)
  description?: string | (() => string)
  icon?: React.ReactNode | ((size: number) => React.ReactNode)
  order?: number
  single?: boolean
  badge?: () => string | number | null
  component: () => React.JSX.Element
}

/** The slice of the host's client service this plugin uses. Declared locally,
 *  like the other optional host services read here, so the integration adds no
 *  dependency and the plugin still loads on installs without the host. */
interface SidebarHost {
  registerTab(tab: SidebarTab): () => void
  openTab(seed: { type: string }): void
  isTabEnabled(type: string): boolean
  subscribe(listener: () => void): () => void
}

/** Tab type of the queue panel (also its `SidebarTab.type`). */
export const QUEUE_TAB_ID = 'dsh-lowtide:queue'

/** Live host handle; null while better-sidebar is absent. */
let host: SidebarHost | null = null

/** Open (or focus) the queue tab. Falls back to expanding the composer dock
 *  when no sidebar host is present, so "enqueued" always lands somewhere
 *  visible. */
export function openQueueTab(): void {
  // A disabled tab type must fall back to the dock, not to a dead click, and a
  // host without a session scope must not break the enqueue that called us.
  if (host !== null && host.isTabEnabled(QUEUE_TAB_ID)) {
    try {
      host.openTab({ type: QUEUE_TAB_ID })
      return
    } catch (error) {
      console.error('[dsh-lowtide] openQueueTab failed', error)
    }
  }
  lowtideStore.update((s) => { s.queueOpen = true })
}

/** Tab body: the queue panel, always expanded and filling the tab. */
function LowtideQueueTab(): React.JSX.Element {
  const locale = useLowtide((s) => s.activeLocale)
  return (
    <QueueDockView
      t={(key, params) => translateFor(locale, key, params)}
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

/** Tab badge: pending-review count (the number that needs a human). */
function queueTabBadge(): number | null {
  const pending = lowtideStore.getSnapshot().host?.queue.pendingReview ?? 0
  return pending > 0 ? pending : null
}

function queueTabDescriptor(): SidebarTab {
  const locale = (): string => lowtideStore.getSnapshot().activeLocale
  return {
    id: QUEUE_TAB_ID,
    title: () => translateFor(locale(), 'dock.tabTitle'),
    description: () => translateFor(locale(), 'dock.tabDesc'),
    icon: queueTabIcon,
    // After editor(10) / git(20) / subagent(30) / sidechat(35) / terminal(40),
    // ahead of the default 100 — the queue is a first-class working surface.
    order: 45,
    single: true,
    badge: queueTabBadge,
    component: LowtideQueueTab,
  }
}

/** Wire the queue tab into better-sidebar when — and only when — it is there. */
export function installQueueTab(ctx: ClientContext): void {
  ctx.inject(['betterSidebar'], (injected) => {
    // Read through ctx.get: the augmentation for an optional peer is absent
    // here, and this matches how the other optional host services are read.
    const sidebar = (injected as { get(name: string): unknown }).get('betterSidebar') as SidebarHost | undefined
    if (sidebar === undefined) return
    host = sidebar
    injected.effect(() => sidebar.registerTab(queueTabDescriptor()))
    // The dock yields only while the host will actually render the tab: a type
    // the user disabled in the Side card settings must not cost them the queue
    // UI entirely, so the flag tracks enablement (not just service presence).
    const sync = (): void => {
      const hosted = sidebar.isTabEnabled(QUEUE_TAB_ID)
      lowtideStore.update((s) => { if (s.sidebarHosted !== hosted) s.sidebarHosted = hosted })
    }
    sync()
    injected.effect(() => sidebar.subscribe(sync))
    // Teardown (HMR, host disable/uninstall): give the dock back, never leave
    // the queue with no surface at all.
    injected.effect(() => () => {
      host = null
      lowtideStore.update((s) => { s.sidebarHosted = false })
    })
  })
}
