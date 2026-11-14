/**
 * Busy-hour prompt in the input dock. The native composer remains resident
 * and is the only text editor; this card offers explicit run/queue actions.
 * It appears for peak or custom >1x windows while the live draft is non-empty.
 */
import { useEffect, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { Icon } from '../lib/icons.tsx'
import { dismissPeakToday, estimate, rememberWorkspace, submitTask, lastWorkspace } from '../api.ts'
import { openQueueTab } from '../better-sidebar.tsx'
import { refreshNow, showToast, useLowtide } from '../store.ts'
import { type NsTranslate } from '../i18n.ts'
import { TaskForm, type TaskFormValues } from './TaskForm.tsx'
import styles from './InterceptCard.module.css'

export type InterceptCardProps = PropsRuntime<'conversation.input.dock'> & { t: NsTranslate }

export function InterceptCard(props: InterceptCardProps): React.JSX.Element | null {
  const { t } = props
  const draft = props.useInput((input) => input.draft)
  const host = useLowtide((s) => s.host)
  const tier = useLowtide((s) => s.tier)
  const tierAt = useLowtide((s) => s.tierAt)
  const [workspace, setWorkspace] = useState(() => lastWorkspace())
  const [submitting, setSubmitting] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [estimateResult, setEstimateResult] = useState<{ peak: number; off: number } | null>(null)

  useEffect(() => {
    if (draft.trim() === '') setDismissed(false)
  }, [draft])

  const shownLevel = tierAt > 0 ? tier.level : host?.price.tier ?? 'off'
  const shownMultiplier = tierAt > 0 ? tier.multiplier : host?.price.multiplier ?? 1
  const shownWindow = tierAt > 0 ? tier.window : host?.level?.window ?? null
  const peakWindow = shownWindow !== null ? `${shownWindow.start}–${shownWindow.end}` : ''
  const customMultiplier = shownLevel === 'custom' ? shownMultiplier : null
  const priced = shownLevel === 'peak' || (shownLevel === 'custom' && shownMultiplier > 1)
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
    model: host?.price.model ?? '',
    modelProvider: '',
    strategyHint: '',
    autonomy: host?.autonomy === 'l1' || host?.autonomy === 'l3' ? host.autonomy : 'l2',
    sessionMode: 'new',
  }

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
    if (patch.workspace !== undefined) setWorkspace(patch.workspace)
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
      // Open the sidebar tab when the host really shows it; otherwise expand
      // the composer dock (the bridge drops a stale hand-over for us).
      openQueueTab()
    } else {
      showToast(t('toast.submitFailed', { error: result.error ?? 'unknown' }))
    }
  }

  function dismiss(): void {
    void dismissPeakToday().then(() => refreshNow())
  }

  if (host === null || !priced || host.dismissedPeakToday || draft.trim() === '' || dismissed) return null

  const priceKnown = host.price.priceKnown
  const peakLabel = estimateResult !== null && priceKnown
    ? `¥${estimateResult.peak.toFixed(2)}`
    : priceKnown ? t('intercept.priceNowPeak') : t('intercept.priceUnknown')
  const offLabel = estimateResult !== null && priceKnown
    ? `¥${estimateResult.off.toFixed(2)}`
    : priceKnown ? t('intercept.priceTonight') : t('intercept.priceUnknown')

  return (
    <div className={styles.card} data-lowtide-peak-prompt>
      <div className={styles.header}>
        <span className={styles.title}>
          <span className={styles.dot}><StateDot state="error" /></span>
          {t('intercept.title', { tier: tierText, window: peakWindow })}
        </span>
        <button type="button" className={styles.close} title={t('intercept.closeTitle')} onClick={() => setDismissed(true)}>
          <Icon name="IconCloseOutline16" />
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
      <div className={styles.queueStatus}>
        <Icon name="IconQueueOutline14" className={styles.queueIcon} />
        {t('intercept.queueStatus', { total: host.queue.total, pending: host.queue.pendingReview })}
      </div>
      <div className={styles.row}>
        <Button variant="outline" size="md" onClick={() => props.inputActions.submit()}>{t('intercept.runNow')}</Button>
        <Button variant="primary" size="md" disabled={submitting} onClick={() => void queueTonight()}>
          {t('intercept.enqueue')}
        </Button>
        <button type="button" className={styles.dismiss} onClick={dismiss}>{t('intercept.dismiss')}</button>
      </div>
    </div>
  )
}
