/**
 * TaskDetail (Phase D split): the task drill-down modal — full prompt,
 * snapshots, strategy, sampling candidates, last run, errors.
 */
import { Modal, Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { type HostTask } from '../store.ts'
import { type NsTranslate } from '../i18n.ts'
import { statusLabel, strategyLabel } from '../lib/taskMeta.ts'
import { CandidatesView } from './CandidatesView.tsx'
import { Money } from './atoms.tsx'
import styles from './TaskDetail.module.css'

export function TaskDetail({ task, t, onClose, onEdit }: {
  task: HostTask
  t: NsTranslate
  onClose: () => void
  /** Opens the in-place edit modal (wired when the status allows editing). */
  onEdit?: (task: HostTask) => void
}): React.JSX.Element {
  const strat = strategyLabel(t, task.lastRun?.strategy ?? task.strategy, task.lastRun?.roundsRun)
  // pending-review / queued / deferred can be edited in place.
  const editable = task.status === 'pending-review' || task.status === 'queued' || task.status === 'deferred'
  return (
    <Modal open onClose={onClose} title={t('detail.title')} description={`${statusLabel(t, task.status)} · ${task.id}`}
      footer={
        <div className={styles.modalFooter}>
          {editable && onEdit !== undefined && (
            <Button variant="outline" size="md" onClick={() => onEdit(task)}>{t('action.edit')}</Button>
          )}
          <Button variant="primary" size="md" onClick={onClose}>{t('detail.close')}</Button>
        </div>
      }>
      <div className={styles.modalBody}>
        <div className={styles.detailPrompt}>{task.prompt}</div>
        <div className={styles.detailGrid}>
          <span className={styles.detailItem}>{t('detail.workspace')} <span className={styles.detailValue}>{task.workspace}</span></span>
          <span className={styles.detailItem}>{t('detail.priority')} <span className={styles.detailValue}>P{task.priority}</span></span>
          <span className={styles.detailItem}>{t('detail.permission')} <span className={styles.detailValue}>{task.permissionPreset}</span></span>
          <span className={styles.detailItem}>{t('detail.created')} <span className={styles.detailValue}>{new Date(task.createdAt).toLocaleString()}</span></span>
          {(task.editCount ?? 0) > 0 && (
            <span className={styles.detailItem}>{t('detail.edited')} <span className={styles.detailValue}>{t('detail.editedCount', { count: task.editCount ?? 0 })}</span></span>
          )}
          {task.model !== undefined && (
            <span className={styles.detailItem}>{t('detail.model')} <span className={styles.detailValue}>{task.modelProvider !== undefined ? `${task.modelProvider} / ${task.model}` : task.model}</span></span>
          )}
          {task.model !== undefined && (
            <span className={styles.detailItem}>
              {task.estimateYuan !== undefined
                ? t('detail.estimateKnown', { yuan: task.estimateYuan.toFixed(2), tier: strat, minutes: task.estimateMinutes ?? 30 })
                : t('detail.estimateUnknown')
              }
            </span>
          )}
          {task.strategy !== undefined && task.strategy !== 'single' && (
            <span className={styles.detailItem}>{t('modal.strategy')} <span className={styles.detailValue}>{strat}</span></span>
          )}
          {task.triagedBy !== undefined && (
            <span className={styles.detailItem}>{t('detail.triaged')} <span className={styles.detailValue}>{task.triagedBy === 'auto-l3' ? t('detail.triagedAuto') : t('detail.triagedUser')}{task.triagedAt !== undefined ? ` · ${new Date(task.triagedAt).toLocaleString()}` : ''}</span></span>
          )}
          {task.continuesFromSession !== undefined && (
            <span className={styles.detailItem}>{t('detail.continuesFromSession')} <span className={styles.detailValue}>{task.continuesFromSession}</span></span>
          )}
        </div>
        {task.files.length > 0 && (
          <div className={styles.detailSection}>
            <span className={styles.detailLabel}>{t('detail.files')}</span>
            {task.files.map((f) => (
              <div key={f.path} className={styles.detailFile}>{f.path}{f.size !== undefined ? t('detail.bytes', { size: f.size }) : ''}</div>
            ))}
          </div>
        )}
        {task.lastRun !== undefined && (
          <div className={styles.detailSection}>
            <span className={styles.detailLabel}>{t('detail.lastRun')}</span>
            <div className={styles.detailRun}>
              {statusLabel(t, task.lastRun.status)}
              {strat !== '' && <> · {strat}</>}
              {' · '}{t('detail.minutes', { minutes: Math.round((task.lastRun.elapsedMs ?? 0) / 60000) })}
              {/* Cost is only meaningful for models with a price entry
                  (estimateYuan is undefined for unknown-price models). */}
              {task.estimateYuan !== undefined
                ? <> · <Money yuan={task.lastRun.costYuan ?? 0} /></>
                : <> · {t('report.priceUnknown')}</>}
              {task.lastRun.diffStat !== null && task.lastRun.diffStat !== undefined && <> · {task.lastRun.diffStat}</>}
            </div>
            {task.lastRun.error !== undefined && <div className={styles.detailError}>{task.lastRun.error}</div>}
            {task.lastRun.resumed === true && <div className={styles.detailResumed}>{t('detail.resumed')}</div>}
            {task.lastRun.forked === true && <div className={styles.detailResumed}>{t('detail.forked')}</div>}
            {task.lastRun.resumeNote !== undefined && <div className={styles.detailResumeWarn}>{task.lastRun.resumeNote}</div>}
            {task.lastRun.candidates !== undefined && task.lastRun.candidates.length > 0 && (
              <CandidatesView candidates={task.lastRun.candidates} chosenIndex={task.chosenCandidateIndex} taskId={task.id} t={t} />
            )}
            {task.lastRun.reviewExcerpt !== undefined && (
              <details className={styles.detailReview}>
                <summary>{t('report.reviewExcerpt')}</summary>
                <div className={styles.detailReviewBody}>{task.lastRun.reviewExcerpt}</div>
              </details>
            )}
          </div>
        )}
        {task.lastError !== undefined && (
          <div className={styles.detailSection}>
            <span className={styles.detailLabel}>{t('detail.error')}</span>
            <div className={styles.detailError}>{task.lastError}</div>
          </div>
        )}
      </div>
    </Modal>
  )
}
