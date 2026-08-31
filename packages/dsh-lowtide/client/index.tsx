/**
 * dsh-lowtide browser half (Phase 1 assembly + review round 1 polish).
 * Six-surface registrations: ① PricePill (header utilities), ② InterceptCard
 * (composer chain), ③ QueueDock (input dock), ⑤ MorningReport (shell overlay).
 * ④ ConfirmGate and ⑥ Settings land in the same overlay/settings slots.
 * Polling drives the entry store (SSE is the live path, polling the fallback).
 *
 * Locale: the `dsh-lowtide` namespace registers zh/en dictionaries through
 * the host locale service; every slot entry declares `locale: NS` so the
 * framework injects the typed `t` seat into component props.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ReactElement } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { DICTS, NS } from './i18n.ts'
import { PricePill } from './components/PricePill.tsx'
import { InterceptCard, selectIntercept } from './components/InterceptCard.tsx'
import { QueueDock } from './components/QueueDock.tsx'
import { MorningReport } from './components/MorningReport.tsx'
import { ConfirmGate } from './components/ConfirmGate.tsx'
import { LowtideSettings } from './settings.tsx'
import { clearToast, lowtideStore, startPolling, useLowtide, wireLocale } from './store.ts'

/** Required services before this client module materializes. */
export const inject = ['slots', 'locale']

/** Toasts for optimistic-write feedback (PLAN §3.4). */
function LowtideToast(): ReactElement {
  const toast = useLowtide((s) => s.toast)
  if (toast === null) return <></>
  return <Toast key={toast.seq} text={toast.text} onDone={clearToast} />
}

export function apply(ctx: ClientContext): void {
  console.log('[dsh-lowtide] client half loaded')

  // Register the bilingual dictionary namespace (zh is the lookup fallback).
  ctx.locale.register(NS, DICTS)

  // Wire the host locale service so the plugin's language toggle can switch
  // the entire harness UI between zh and en.
  wireLocale(
    (id: string) => ctx.locale.setLocale(id),
    ctx.locale.getLocale().active,
  )
  ctx.on('locale/change', (snapshot: { active: string }) => {
    lowtideStore.update((d) => { d.activeLocale = snapshot.active })
  })

  const stop = startPolling()

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
    { name: 'conversation.session.header.utilities', id: 'lt-price-pill', order: 100, locale: NS },
    PricePill,
  ))

  // The select keys off the live draft (intercept-draft.ts): an empty draft
  // keeps the native bar + queue dock visible; typing claims the composer.
  ctx.slots.inject('conversation.composer', () => ctx.slots.register(
    { name: 'conversation.composer', select: selectIntercept, locale: NS },
    InterceptCard,
  ))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    { name: 'conversation.input.dock', id: 'lt-queue-dock', order: 100, locale: NS },
    QueueDock,
  ))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'lt-morning-report', order: 100, locale: NS },
    MorningReport,
  ))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'lt-confirm-gate', order: 80, locale: NS },
    ConfirmGate,
  ))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'lt-toast', order: 90 },
    LowtideToast,
  ))

  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'lowtide', order: 20, locale: NS, label: () => ctx.locale.bind(NS)('settings.title') },
    LowtideSettings as (props: SettingsSectionOwnerProps) => ReactElement,
  ))

  ctx.effect(() => () => {
    stop()
    lowtideStore.set({
      host: null,
      connected: false,
      error: null,
      queueOpen: false,
      reportOpen: false,
      reportHistoryOpen: false,
      reportUnread: false,
      toast: null,
      lastReportId: null,
      activeLocale: 'zh',
    })
  })
}
