/**
 * Interface ① PricePill (PLAN §6.1 + v3.1 §2): session-header state pill —
 * status dot · one-line state (闲时/忙时/执行中) · queue count badge.
 *
 * v3.1: the price number is gone from the pill — a static "¥1.5/M" reads as
 * noise, not an action signal; pricing belongs to the intercept card where
 * the decision happens. The tooltip keeps the full price detail.
 * (The "starts at" countdown was removed — no action value for the user.)
 * Click toggles the queue dock. All copy rides the `t` seat (i18n).
 *
 * v0.2.2 (bug fix): the displayed 闲时/忙时 comes from the LOCAL tier clock
 * (`store.tier`, derived from the host's windows + this machine's clock), not
 * from the last pushed snapshot. A silently stalled SSE stream used to freeze
 * this indicator forever; now it keeps following the clock and the pill says
 * how stale the pushed data is.
 */
import { useState } from 'react'
import { Pill, Tooltip, IconQueueOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { LevelDot, Money, type LevelState } from './atoms.tsx'
import { SSE_STALE_MS, useLowtide } from '../store.ts'
import { type NsTranslate } from '../i18n.ts'
import { WindowEditorModal } from './WindowEditorModal.tsx'
import styles from './PricePill.module.css'

export type PricePillProps = PropsRuntime<'conversation.session.header.utilities'> & { t: NsTranslate }

export function PricePill({ t }: PricePillProps): React.JSX.Element {
  const state = useLowtide((s) => s.host)
  const connected = useLowtide((s) => s.connected)
  const tier = useLowtide((s) => s.tier)
  const tierAt = useLowtide((s) => s.tierAt)
  const lastFrameAt = useLowtide((s) => s.lastFrameAt)
  const sseHealthy = useLowtide((s) => s.sseHealthy)
  const [editorOpen, setEditorOpen] = useState(false)

  if (state === null) return <Pill>{connected ? t('pill.loading') : t('pill.disconnected')}</Pill>

  // Display source: the locally derived tier (clock-accurate). Before the
  // first host frame the clock has nothing to evaluate — fall back to the
  // host's own snapshot so the pill is never blank.
  const shownLevel = tierAt > 0 ? tier.level : state.price.tier
  const shownMultiplier = tierAt > 0 ? tier.multiplier : state.price.multiplier
  const isPeak = shownLevel === 'peak'
  const isCustom = shownLevel === 'custom'
  const isRunning = state.batch.running
  const staleMs = lastFrameAt > 0 ? Date.now() - lastFrameAt : 0
  const stale = !sseHealthy && staleMs > SSE_STALE_MS
  const dotState: LevelState = isRunning ? 'running' : stale ? 'ending' : isPeak || isCustom ? 'peak' : 'off'

  const pending = state.queue.pendingReview
  const todo = state.queue.queued + pending + state.queue.running
  const tierText = isPeak
    ? t('pill.peak')
    : isCustom
      ? t('pill.custom', { multiplier: shownMultiplier })
      : t('pill.off')

  // One-line state: running → "执行中 1/3"; tasks waiting → tier + queue
  // count; nothing to do → just the tier word. (The "starts at" countdown
  // was removed — it carried no action value for the user.)
  let label: React.JSX.Element
  if (isRunning) {
    label = <>{t('pill.running', { running: state.queue.running, total: state.queue.queued + state.queue.running })}</>
  } else if (todo > 0) {
    label = <>{tierText} · {todo} {t('pill.queued')}</>
  } else {
    label = <>{tierText}</>
  }

  const shownWindow = tierAt > 0 ? tier.window : state.level?.window ?? null
  const windowHint = shownWindow !== null ? `${shownWindow.start}–${shownWindow.end}` : ''
  const tooltipLines: string[] = []
  // Line 1: time tier + window
  tooltipLines.push(
    windowHint !== ''
      ? t('tooltip.time', { tier: tierText, window: windowHint })
      : t('tooltip.timeNoWindow', { tier: tierText }),
  )
  // Line 2: queue status (with or without running count)
  if (state.queue.running > 0) {
    tooltipLines.push(t('tooltip.queueRunning', { total: state.queue.total, pending: state.queue.pendingReview, running: state.queue.running }))
  } else {
    tooltipLines.push(t('tooltip.queue', { total: state.queue.total, pending: state.queue.pendingReview }))
  }
  // Line 3: today's ledger
  const spent = state.ledger.spentToday
  const saved = state.ledger.savedToday
  if (spent > 0 && saved > 0) {
    tooltipLines.push(t('tooltip.ledger', { spent: spent.toFixed(2), saved: saved.toFixed(2) }))
  } else if (saved > 0) {
    tooltipLines.push(t('tooltip.ledgerSaved', { saved: saved.toFixed(2) }))
  } else if (spent > 0) {
    tooltipLines.push(t('tooltip.ledgerSpent', { spent: spent.toFixed(2) }))
  }
  // Line 4 (only when the pushed data stopped arriving): staleness is stated,
  // never silent — the local clock keeps the tier itself correct.
  if (stale) {
    const minutes = Math.max(1, Math.round(staleMs / 60_000))
    tooltipLines.push(t('pill.stale', { minutes }))
  }

  return (
    <>
      <Tooltip label={tooltipLines.join('\n')} side="bottom">
        <Pill
          className={stale ? `${styles.pill} ${styles.pillStale}` : styles.pill}
          active={editorOpen}
          onClick={() => setEditorOpen(true)}
        >
          <span className={styles.dot}><LevelDot state={dotState} /></span>
          <span className={styles.label}>{label}</span>
          {todo > 0 && (
            <>
              <IconQueueOutline14 className={styles.queueIcon} />
              <span className={styles.count}>{state.queue.total}</span>
            </>
          )}
          {pending > 0 && <span className={styles.badge} />}
        </Pill>
      </Tooltip>
      <WindowEditorModal open={editorOpen} onClose={() => setEditorOpen(false)} t={t} />
    </>
  )
}

/** Saved-today number for the tooltip (reused by the dock footer). */
export function SavedToday(): React.JSX.Element {
  const saved = useLowtide((s) => s.host?.ledger.savedToday ?? 0)
  return <Money yuan={saved} className={styles.saved} />
}
