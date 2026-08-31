/**
 * DroppedRow (Phase D split): a soft-deleted task inside the 已放弃 section,
 * with 恢复 (back to review) and 彻底删除 actions.
 */
import { IconRefreshOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { deleteTask, restoreTask } from '../api.ts'
import { refreshNow, showToast, type HostTask } from '../store.ts'
import { type NsTranslate } from '../i18n.ts'
import { statusLabel } from '../lib/taskMeta.ts'
import styles from './TaskRow.module.css'

export function DroppedRow({ task, t }: { task: HostTask; t: NsTranslate }): React.JSX.Element {
  return (
    <div className={`${styles.taskRow} ${styles.droppedRow}`}>
      <div className={styles.taskMain}>
        <span className={styles.taskPrompt}>{task.prompt.slice(0, 60)}{task.prompt.length > 60 ? '…' : ''}</span>
        <span className={styles.taskMeta}>{statusLabel(t, task.status)} · {new Date(task.createdAt).toLocaleString()}</span>
      </div>
      <div className={styles.rowActions}>
        <button
          type="button"
          className={styles.iconBtn}
          title={t('action.restore')}
          onClick={() => { void restoreTask(task.id).then(() => { showToast(t('toast.restored')); refreshNow() }) }}
        >
          <IconRefreshOutline16 />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          title={t('action.delete')}
          onClick={() => { void deleteTask(task.id).then(() => { showToast(t('toast.deleted')); refreshNow() }) }}
        >
          <IconTrashOutline16 />
        </button>
      </div>
    </div>
  )
}
