/**
 * TaskRow (Phase D split): one queue row with per-status inline actions
 * (✓ 批准 / ⏸ 顺延 / ✕ 放弃 / ↻ 重新执行 / 🗑 两段式删除) and a left color
 * bar by status. Shared by the 待执行 and 已结束 sections.
 */
import { useState } from 'react'
import { IconCheckOutline16, IconCloseOutline16, IconEditOutline16, IconPauseOutline16, IconRefreshOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { deleteTask, retryTask, triage } from '../api.ts'
import { refreshNow, showToast, type HostTask } from '../store.ts'
import { type NsTranslate } from '../i18n.ts'
import { statusLabel } from '../lib/taskMeta.ts'
import { ModelBadge } from './atoms.tsx'
import styles from './TaskRow.module.css'

function statusClass(status: string): string {
  if (status === 'pending-review' || status === 'deferred' || status === 'stale') return styles.amber
  if (status === 'queued' || status === 'done') return styles.green
  if (status === 'running' || status === 'preflight') return styles.blue
  if (status === 'failed' || status === 'timeout') return styles.red
  return ''
}

/** Icons for the per-row actions (16px outline set, currentColor). */
function RowActionIcon({ kind }: { kind: 'approve' | 'defer' | 'drop' | 'retry' | 'delete' | 'edit' }): React.JSX.Element {
  if (kind === 'approve') return <IconCheckOutline16 />
  if (kind === 'defer') return <IconPauseOutline16 />
  if (kind === 'drop') return <IconCloseOutline16 />
  if (kind === 'retry') return <IconRefreshOutline16 />
  if (kind === 'edit') return <IconEditOutline16 />
  return <IconTrashOutline16 />
}

export function TaskRow({ task, t, onOpenDetail, onEdit }: {
  task: HostTask
  t: NsTranslate
  onOpenDetail: (task: HostTask) => void
  /** Opens the in-place edit modal (only wired for editable statuses). */
  onEdit?: (task: HostTask) => void
}): React.JSX.Element {
  const pending = task.status === 'pending-review'
  const deferred = task.status === 'deferred'
  const locked = task.status === 'running' || task.status === 'preflight'
  const failed = task.status === 'failed' || task.status === 'timeout' || task.status === 'stale'
  // pending-review / queued / deferred can be edited in place.
  const editable = (pending || deferred || task.status === 'queued') && !locked
  const [confirming, setConfirming] = useState(false)

  async function handleDelete(): Promise<void> {
    if (!confirming) {
      // Two-step confirm: first click arms (turns red), second click within
      // 3s actually deletes — hard delete is not recoverable.
      setConfirming(true)
      setTimeout(() => setConfirming(false), 3000)
      return
    }
    const result = await deleteTask(task.id)
    if (result.ok) {
      showToast(t('toast.deleted'))
      refreshNow()
    } else {
      showToast(t('toast.deleteFailed', { error: result.error ?? 'unknown' }))
    }
  }

  const actions: React.JSX.Element[] = []
  if (editable && onEdit !== undefined) {
    actions.push(
      <button key="edit" type="button" className={styles.iconBtn} title={t('action.edit')} onClick={() => onEdit(task)}>
        <RowActionIcon kind="edit" />
      </button>,
    )
  }
  if (pending || deferred) {
    actions.push(
      <button key="approve" type="button" className={styles.iconBtn} title={t('action.approve')} onClick={() => { void triage(task.id, 'approve').then(refreshNow) }}>
        <RowActionIcon kind="approve" />
      </button>,
      <button key="defer" type="button" className={styles.iconBtn} title={t('action.defer')} onClick={() => { void triage(task.id, 'defer').then(refreshNow) }}>
        <RowActionIcon kind="defer" />
      </button>,
      <button key="drop" type="button" className={styles.iconBtn} title={t('action.drop')} onClick={() => { void triage(task.id, 'drop').then(refreshNow) }}>
        <RowActionIcon kind="drop" />
      </button>,
    )
  }
  if (failed) {
    actions.push(
      <button
        key="retry"
        type="button"
        className={styles.iconBtn}
        title={t('action.retry')}
        onClick={() => { void retryTask(task.id).then(() => { showToast(t('toast.requeued')); refreshNow() }) }}
      >
        <RowActionIcon kind="retry" />
      </button>,
    )
  }
  actions.push(
    <button
      key="delete"
      type="button"
      className={confirming ? `${styles.iconBtn} ${styles.confirming}` : styles.iconBtn}
      title={confirming ? t('action.deleteConfirm') : t('action.delete')}
      disabled={locked}
      onClick={() => { void handleDelete() }}
    >
      {confirming ? t('action.deleteConfirmShort') : <RowActionIcon kind="delete" />}
    </button>,
  )

  return (
    <div className={`${styles.taskRow} ${statusClass(task.status)}`}>
      <div className={styles.taskMain} onClick={() => onOpenDetail(task)}>
        <span className={styles.taskPrompt}>{task.prompt.slice(0, 60)}{task.prompt.length > 60 ? '…' : ''}</span>
        <span className={styles.taskMeta}>
          <ModelBadge model={task.model} />
          {statusLabel(t, task.status)}
          {task.files.length > 0 && <> · {t('detail.fileCount', { count: task.files.length })}</>}
          {task.lastError !== undefined && <> · {task.lastError}</>}
        </span>
      </div>
      <div className={styles.rowActions}>{actions}</div>
    </div>
  )
}
