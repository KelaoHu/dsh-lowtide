/**
 * Interface ① PricePill (PLAN §6.1 + v3.1 §2): session-header state pill —
 * status dot · one-line state (闲时/忙时/执行中) · queue count badge.
 *
 * v3.1: the price number is gone from the pill — a static "¥1.5/M" reads as
 * noise, not an action signal; pricing belongs to the intercept card where
 * the decision happens. The tooltip keeps the full price detail.
 * (The "starts at" countdown was removed — no action value for the user.)
 * Click toggles the queue dock. All copy rides the `t` seat (i18n).
 */
import { useState } from 'react'
import { Pill, Tooltip, IconQueueOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { LevelDot, Money, type LevelState } from './atoms.tsx'
import { useLowtide } from '../store.ts'
import { type NsTranslate } from '../i18n.ts'
import { WindowEditorModal } from './WindowEditorModal.tsx'
import styles from './PricePill.module.css'

export type PricePillProps = PropsRuntime<'conversation.session.header.utilities'> & { t: NsTranslate }

export function PricePill({ t }: PricePillProps): React.JSX.Element {
  const state = useLowtide((s) => s.host)
  const connected = useLowtide((s) => s.connected)
  const [editorOpen, setEditorOpen] = useState(false)

  if (state === null) return <Pill>{connected ? t('pill.loading') : t('pill.disconnected')}</Pill>

  const isPeak = state.price.tier === 'peak'
  const isCustom = state.price.tier === 'custom'
  const isRunning = state.batch.running
  const dotState: LevelState = isRunning ? 'running' : isPeak || isCustom ? 'peak' : 'off'

  const pending = state.queue.pendingReview
  const todo = state.queue.queued + pending + state.queue.running
  const tierText = isPeak
    ? t('pill.peak')
    : isCustom
      ? t('pill.custom', { multiplier: state.price.multiplier })
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

  const windowHint = state.level?.window !== undefined
    ? `${state.level.window.start}–${state.level.window.end}`
    : ''
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

  return (
    <>
      <Tooltip label={tooltipLines.join('\n')} side="bottom">
        <Pill
          className={styles.pill}
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
