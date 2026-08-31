/**
 * Interface ② InterceptCard (PLAN §6.2 + G0 directive + review rounds):
 * busy-hour send interception. Claims the composer chain while it is a priced
 * window (peak, or custom ×multiplier>1) ∧ not dismissed today ∧ a live
 * session exists ∧ the draft is non-empty. Carries its OWN input surface
 * (the native bar stays mounted but hidden — draft preserved) via the shared
 * TaskForm (intercept variant). Decision set ≤3: [现在就跑] sends the draft,
 * [投递到闲时队列] queues it for off-peak, [今日不再提醒] dismisses for the
 * day, ✕ exempts this message.
 *
 * The workspace is explicit: an empty one falls back to the last used path,
 * and the warning tells the user the server default directory will be used —
 * a task must never silently run in the server's cwd (review B8).
 *
 * Dismissal mechanics (hooks/useInterceptDraft.ts): the chain re-runs
 * selectors only on owner re-renders, so ✕ sets the session flag and toggles
 * the draft once (append + restore, batched into one render) to force the
 * native composer back with the draft intact.
 */
import { useEffect, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button, IconCloseOutline16, IconQueueOutline14, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { dismissPeakToday, estimate, rememberWorkspace, submitTask, lastWorkspace } from '../api.ts'
import { lowtideStore, refreshNow, showToast, useLowtide } from '../store.ts'
import { dismissInterceptSession, isInterceptSessionDismissed, readInterceptDraft } from '../hooks/useInterceptDraft.ts'
import { type NsTranslate } from '../i18n.ts'
import { TaskForm, type TaskFormValues } from './TaskForm.tsx'
import styles from './InterceptCard.module.css'

export interface InterceptMatched {
  kind: 'lt-intercept'
}

/**
 * Pure chain routing: priced window ∧ not dismissed ∧ session present ∧
 * draft non-empty. The draft condition keeps the native bar (and the queue
 * dock) visible until the user actually starts typing (PLAN §6.2).
 */
export function selectIntercept(owner: ComposerChainProps): InterceptMatched | null {
  const host = lowtideStore.getSnapshot().host
  if (host === null) return null
  const priced = host.price.tier === 'peak'
    || (host.price.tier === 'custom' && host.price.multiplier > 1)
  if (!priced) return null
  if (host.dismissedPeakToday) return null
  if (readInterceptDraft().trim() === '') return null
  if (isInterceptSessionDismissed()) return null
  if (owner.session === undefined) return null
  return { kind: 'lt-intercept' }
}

export type InterceptCardProps = PropsRuntime<'conversation.composer'> & { matched: InterceptMatched; t: NsTranslate }

export function InterceptCard(props: InterceptCardProps): React.JSX.Element {
  const { t } = props
  const draft = props.useInput((input) => input.draft)
  const host = useLowtide((s) => s.host)
  const [workspace, setWorkspace] = useState(() => lastWorkspace())
  const [submitting, setSubmitting] = useState(false)
  // Price estimate: peak = now (current UI model), off = batch model (user's
  // choice or default). Fetched debounced as the draft changes.
  const [estimateResult, setEstimateResult] = useState<{ peak: number; off: number } | null>(null)

  const peakWindow = host?.level !== null && host?.level !== undefined
    ? `${host.level.window.start}–${host.level.window.end}`
    : ''
  const customMultiplier = host?.price.tier === 'custom' ? host.price.multiplier : null
  const tierText = customMultiplier !== null && customMultiplier > 1
    ? t('intercept.tierCustom', { multiplier: customMultiplier })
    : t('intercept.tierPeak')

  const formValues: TaskFormValues = {
    prompt: draft,
    workspace,
    strategy: 'single',
    rounds: 1,
    priority: 1,
    files: '',
    reasoning: 'follow',
    model: host?.price.model ?? 'deepseek-v4-flash',
    modelProvider: '',
    strategyHint: '',
    // Intercept submissions always follow the global autonomy level.
    autonomy: host?.autonomy === 'l1' || host?.autonomy === 'l3' ? host.autonomy : 'l2',
    sessionMode: 'new',
  }

  // Debounced price estimate as the draft changes.
  useEffect(() => {
    if (draft.trim() === '') {
      setEstimateResult(null)
      return
    }
    const timer = setTimeout(() => {
      const nowModel = host?.price.model
      if (nowModel === undefined) return
      void estimate(draft, [], nowModel, formValues.model).then((res) => {
        if (res.ok) setEstimateResult({ peak: res.peak, off: res.off })
      }).catch(() => { /* ignore failed estimates */ })
    }, 400)
    return () => clearTimeout(timer)
  }, [draft, host?.price.model, formValues.model])

  function onFormChange(patch: Partial<TaskFormValues>): void {
    if (patch.prompt !== undefined) props.inputActions.setDraft(patch.prompt)
    if (patch.workspace !== undefined) setWorkspace(patch.workspace)
  }

  function closeAndKeepDraft(): void {
    dismissInterceptSession()
    // Force one owner re-render so the chain re-runs its selectors: append a
    // transient space and restore — both updates batch into a single render
    // whose final draft equals the original, and the selectors see the flag.
    props.inputActions.setDraft(draft + ' ')
    props.inputActions.setDraft(draft)
  }

  async function queueTonight(): Promise<void> {
    if (draft.trim() === '') return
    setSubmitting(true)
    const result = await submitTask({
      prompt: draft,
      files: [],
      workspace: workspace.trim() !== '' ? workspace.trim() : lastWorkspace(),
      priority: 1,
      permissionPreset: 'lt-standard',
      model: formValues.model,
    })
    setSubmitting(false)
    if (result.ok) {
      if (workspace.trim() !== '') rememberWorkspace(workspace.trim())
      props.inputActions.setDraft('')
      showToast(t('toast.enqueued'))
      lowtideStore.update((s) => { s.queueOpen = true })
    } else {
      showToast(t('toast.submitFailed', { error: result.error ?? 'unknown' }))
    }
  }

  function dismiss(): void {
    void dismissPeakToday().then(() => refreshNow()).then(() => {
      // After the poll confirms the server-side dismissal, force the owner
      // re-render so the selectors drop the card immediately.
      props.inputActions.setDraft(draft + ' ')
      props.inputActions.setDraft(draft)
    })
  }

  const priceKnown = host?.price.priceKnown ?? false
  const peakLabel = estimateResult !== null && priceKnown
    ? `¥${estimateResult.peak.toFixed(2)}`
    : priceKnown ? t('intercept.priceNowPeak') : t('intercept.priceUnknown')
  const offLabel = estimateResult !== null && priceKnown
    ? `¥${estimateResult.off.toFixed(2)}`
    : priceKnown ? t('intercept.priceTonight') : t('intercept.priceUnknown')

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title}>
          <span className={styles.dot}><StateDot state="error" /></span>
          {t('intercept.title', { tier: tierText, window: peakWindow })}
        </span>
        <button type="button" className={styles.close} title={t('intercept.closeTitle')} onClick={closeAndKeepDraft}>
          <IconCloseOutline16 />
        </button>
      </div>
      <TaskForm variant="intercept" t={t} values={formValues} onChange={onFormChange} />
      <div className={styles.compare}>
        <span className={styles.priceLabel}>
          {customMultiplier !== null && customMultiplier > 1
            ? t('intercept.priceNowCustom', { multiplier: customMultiplier })
            : t('intercept.priceNowPeak')}
          <span className={styles.priceValue}>{peakLabel}</span>
        </span>
        <span className={styles.arrow}>→</span>
        <span className={styles.priceLabel}>
          {t('intercept.priceTonight')}
          <span className={styles.priceValue}>{offLabel}</span>
        </span>
      </div>
      {host !== null && host !== undefined && (
        <div className={styles.queueStatus}>
          <IconQueueOutline14 className={styles.queueIcon} />
          {t('intercept.queueStatus', { total: host.queue.total, pending: host.queue.pendingReview })}
        </div>
      )}
      <div className={styles.row}>
        <Button variant="outline" size="md" onClick={() => props.inputActions.submit()}>{t('intercept.runNow')}</Button>
        <Button variant="primary" size="md" disabled={submitting || draft.trim() === ''} onClick={() => void queueTonight()}>
          {t('intercept.enqueue')}
        </Button>
        <button type="button" className={styles.dismiss} onClick={dismiss}>{t('intercept.dismiss')}</button>
      </div>
    </div>
  )
}
