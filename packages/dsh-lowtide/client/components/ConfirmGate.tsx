/**
 * Interface ④ ConfirmGate (PLAN §6.4 + review round 1): evening batch
 * confirmation floating card. Appears T-gateLeadMin before the batch window
 * when pending-review tasks exist and autonomy ≤ L2. Subtract-only rows
 * (✕ = 本批不跑), one primary release button with the start time, and a
 * "推迟到下一窗口" action that ACTUALLY defers every pending task (the MVP
 * only hid the card — a semantic bug). Fail-safe: the card auto-collapses
 * after 30 minutes of no action and unreleased tasks never run.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { approveAll, triage } from '../api.ts'
import { lowtideStore, refreshNow, showToast, useLowtide, type HostTask } from '../store.ts'
import { type NsTranslate } from '../i18n.ts'
import { ClockTime } from './atoms.tsx'
import styles from './ConfirmGate.module.css'

export type ConfirmGateProps = PropsRuntime<'shell.overlay'> & { t: NsTranslate }

const AUTO_COLLAPSE_MS = 30 * 60_000

/** Stable empty array for selectors — a fresh literal would trip
 * useSyncExternalStore's snapshot-change check into a render loop (#185). */
const NO_TASKS: HostTask[] = []

export function ConfirmGate({ t }: ConfirmGateProps): React.JSX.Element {
  const gate = useLowtide((s) => s.host?.gate ?? null)
  const tasks = useLowtide((s) => s.host?.tasks ?? NO_TASKS)
  const [dismissed, setDismissed] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fail-safe: 30 minutes without interaction auto-collapses the card.
  // Unreleased tasks stay pending-review and never run (PLAN §6.4).
  useEffect(() => {
    if (gate === null) {
      setDismissed(false)
      setCollapsed(false)
      if (collapseTimer.current !== null) clearTimeout(collapseTimer.current)
      return
    }
    if (collapsed) return
    collapseTimer.current = setTimeout(() => setCollapsed(true), AUTO_COLLAPSE_MS)
    return () => {
      if (collapseTimer.current !== null) clearTimeout(collapseTimer.current)
    }
  }, [gate === null, collapsed])

  if (gate === null || dismissed || collapsed) return <></>

  const pending = tasks.filter((t2) => t2.status === 'pending-review')

  function releaseAll(): void {
    void approveAll().then(() => {
      showToast(t('toast.gateApproved'))
      refreshNow()
      setDismissed(true)
    })
  }

  async function deferAll(): Promise<void> {
    // 推迟到下一窗口 = 把全部待裁定任务真实顺延(之前只隐藏卡片,语义错误)。
    // allSettled: one failing request must not silently drop the rest (Kimi review).
    const results = await Promise.allSettled(pending.map((task) => triage(task.id, 'defer')))
    const failures = results.filter((r) => r.status === 'rejected').length
    refreshNow()
    setDismissed(true)
    showToast(failures > 0 ? t('toast.deferFailed', { count: failures }) : t('toast.gateDeferred'))
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title}>{t('gate.title')} · <ClockTime ms={gate.windowStartAt} /> {t('gate.startsAt')}</span>
        <button type="button" className={styles.close} title={t('gate.closeTitle')} onClick={() => setDismissed(true)}>
          <IconCloseOutline16 />
        </button>
      </div>
      <div className={styles.meta}>{t('gate.meta', { count: pending.length })}</div>
      <div className={styles.list}>
        {pending.slice(0, 6).map((task) => (
          <GateRow key={task.id} task={task} t={t} />
        ))}
        {pending.length > 6 && <div className={styles.more}>{t('gate.more', { count: pending.length - 6 })}</div>}
      </div>
      <div className={styles.footer}>
        <Button variant="primary" size="sm" onClick={releaseAll}>
          <span className={styles.releaseLabel}>{t('gate.approveAll')} · <ClockTime ms={gate.windowStartAt} /> {t('gate.startsAt')}</span>
        </Button>
        <button type="button" className={styles.defer} onClick={() => { void deferAll() }}>{t('gate.defer')}</button>
      </div>
    </div>
  )
}

function GateRow({ task, t }: { task: HostTask; t: NsTranslate }): React.JSX.Element {
  const [removed, setRemoved] = useState(false)

  function remove(): void {
    setRemoved(true)
    // Optimistic hide with rollback: a failed defer must not leave the row
    // silently missing until the next refresh (Kimi review).
    void triage(task.id, 'defer').then(() => refreshNow()).catch(() => {
      setRemoved(false)
      showToast(t('toast.deferFailed', { count: 1 }))
    })
  }

  if (removed) return <></>
  return (
    <div className={styles.row}>
      <span className={styles.prompt}>{task.prompt.slice(0, 44)}{task.prompt.length > 44 ? '…' : ''}</span>
      <button type="button" className={styles.remove} title={t('gate.removeTitle')} onClick={remove}>
        <IconCloseOutline16 />
      </button>
    </div>
  )
}
