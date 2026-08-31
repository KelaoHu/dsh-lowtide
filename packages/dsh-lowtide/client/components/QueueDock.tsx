/**
 * Interface ③ QueueDock (Phase D split): the dock row under the composer and
 * the expandable drawer above it — grouped queue sections (待执行 / 已结束 /
 * 已放弃), footer totals and batch controls. Rows and modals live in their
 * own files (TaskRow / DroppedRow / TaskDetail / NewTaskModal / TaskForm).
 */
import { useEffect, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button,
  IconChecklistOutline14,
  IconChevronDownOutline14,
  IconChevronUpOutline14,
  IconPlusOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { approveAll, clearFinished, runNow } from '../api.ts'
import { lowtideStore, refreshNow, showToast, useLowtide, type HostState, type HostTask } from '../store.ts'
import { useInterceptDraftTracking } from '../hooks/useInterceptDraft.ts'
import { type NsTranslate } from '../i18n.ts'
import { Money } from './atoms.tsx'
import { TaskRow } from './TaskRow.tsx'
import { DroppedRow } from './DroppedRow.tsx'
import { TaskDetail } from './TaskDetail.tsx'
import { NewTaskModal } from './NewTaskModal.tsx'
import { EditTaskModal } from './EditTaskModal.tsx'
import styles from './QueueDock.module.css'

export type QueueDockProps = PropsRuntime<'conversation.input.dock'> & { t: NsTranslate }

export function QueueDock(props: QueueDockProps): React.JSX.Element {
  const { t } = props
  const host = useLowtide((s) => s.host)
  const connected = useLowtide((s) => s.connected)
  const queueOpen = useLowtide((s) => s.queueOpen)
  const reportUnread = useLowtide((s) => s.reportUnread)
  const [modalOpen, setModalOpen] = useState(false)
  const [detailTask, setDetailTask] = useState<HostTask | null>(null)
  const [editTask, setEditTask] = useState<HostTask | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [showDropped, setShowDropped] = useState(false)
  const [clearArmed, setClearArmed] = useState(false)
  // 放行并执行 = 全部放行 + 立即开跑，一步到位、不可撤销 —— 两段式确认
  // （与删除/清空一致）：第一次点击武装（变红），3 秒内再次点击才真正执行。
  const [approveArmed, setApproveArmed] = useState(false)
  const [onboarded, setOnboarded] = useState(() => {
    try { return localStorage.getItem('dsh-lowtide:onboarded') === '1' } catch { return true }
  })

  // Keep the intercept chain's draft tracker fresh. The dock stays mounted
  // inside the overlay-kept fallback even while the intercept card is
  // elected, so the draft (and its per-message dismissal) stays accurate.
  const liveDraft = props.useInput((input) => input.draft)
  useInterceptDraftTracking(liveDraft)

  if (host === null) {
    // 断连/加载中:不整块隐身,给一行占位 + 重试(避免插件"消失"的观感)。
    return (
      <div className={styles.dock}>
        <div className={styles.dockRow}>
          <span className={styles.dockTitle}>{connected ? t('dock.loading') : t('dock.disconnected')}</span>
          {!connected && (
            <span className={styles.dockActions}>
              <Button variant="ghost" size="sm" onClick={() => refreshNow()}>{t('dock.retry')}</Button>
            </span>
          )}
        </div>
      </div>
    )
  }

  function dismissOnboarding(): void {
    try { localStorage.setItem('dsh-lowtide:onboarded', '1') } catch { /* non-fatal */ }
    setOnboarded(true)
  }

  /** 放行并执行：两段式确认。第一次点击武装（变红 + 文案切换），3 秒内
   *  再次点击才真正 approveAll + runNow —— 防止误触一步放行全部任务。 */
  function handleApproveAndRun(): void {
    if (!approveArmed) {
      setApproveArmed(true)
      setTimeout(() => setApproveArmed(false), 3000)
      return
    }
    setApproveArmed(false)
    void approveAll().then(() => {
      showToast(t('toast.gateApproved'))
      void runNow().then(() => showToast(t('toast.runStarted')))
    })
  }

  /** 清空已完成:两段式确认(执行报告历史保留证据,删除任务不丢账)。 */
  function handleClearFinished(): void {
    if (!clearArmed) {
      setClearArmed(true)
      setTimeout(() => setClearArmed(false), 3000)
      return
    }
    void clearFinished().then((r) => {
      if (r.ok) {
        showToast(t('toast.finishedCleared'))
        refreshNow()
      } else {
        showToast(t('toast.clearFailed', { error: r.error ?? 'unknown' }))
      }
      setClearArmed(false)
    })
  }

  const all = host.tasks
  const pending = host.queue.pendingReview
  const todo = all.filter((t2) => t2.status === 'pending-review' || t2.status === 'queued' || t2.status === 'deferred')
  // running/preflight are NOT "已结束" — they get their own section (Kimi review).
  const running = all.filter((t2) => t2.status === 'running' || t2.status === 'preflight')
  const done = all.filter((t2) => t2.status === 'done' || t2.status === 'failed' || t2.status === 'stale' || t2.status === 'timeout' || t2.status === 'cancelled')
  const doneOnly = done.filter((t2) => t2.status === 'done')
  const dropped = all.filter((t2) => t2.status === 'dropped')
  const isL1 = host.autonomy === 'l1'


  const onboardingBanner = !onboarded && (
    <div className={styles.onboarding}>
      <span>{t('onboarding.text')}</span>
      <button type="button" className={styles.onboardingDismiss} onClick={dismissOnboarding}>{t('onboarding.dismiss')}</button>
    </div>
  )

  const dockRow = (
    <div className={styles.dockRow}>
      <span className={styles.dockTitle}>
        {t('dock.title', { count: pending + host.queue.queued })}
        {pending > 0 && <span className={styles.pending}> · {t('dock.pending', { count: pending })}</span>}
      </span>
      <span className={styles.dockActions}>
        {host.latestReport !== null && (
          <Button variant="ghost" size="sm" onClick={() => lowtideStore.update((s) => { s.reportOpen = true; s.reportUnread = false })}>
            <span className={styles.reportBtn}><IconChecklistOutline14 />{reportUnread && <span className={styles.reportDot} />}{t('dock.report')}</span>
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setModalOpen(true)}>
          <span className={styles.reportBtn}><IconPlusOutline16 />{t('dock.new')}</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => lowtideStore.update((s) => { s.queueOpen = !s.queueOpen })}>
          {queueOpen ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}{t(queueOpen ? 'dock.collapse' : 'dock.expand')}
        </Button>
      </span>
    </div>
  )

  if (!queueOpen) return (
    <div className={styles.dock}>
      {onboardingBanner}
      {dockRow}
      <NewTaskModal open={modalOpen} t={t} defaultAutonomy={host.autonomy as 'l1' | 'l2' | 'l3'} onClose={() => setModalOpen(false)} />
      {detailTask !== null && <TaskDetail task={detailTask} t={t} onClose={() => setDetailTask(null)} onEdit={setEditTask} />}
      {editTask !== null && <EditTaskModal task={editTask} t={t} defaultAutonomy={host.autonomy as 'l1' | 'l2' | 'l3'} onClose={() => setEditTask(null)} />}
    </div>
  )

  const todoGroups = host.digest.groups
    .map((group) => ({
      ...group,
      tasks: host.tasks.filter((t2) => t2.workspace === group.workspace && (t2.status === 'pending-review' || t2.status === 'queued' || t2.status === 'deferred')),
    }))
    .filter((group) => group.tasks.length > 0)

  return (
    <div className={styles.dock}>
      {onboardingBanner}
      {dockRow}
      <div className={styles.drawer}>
        {todo.length === 0 && done.length === 0 && dropped.length === 0 ? (
          <div className={styles.empty}>
            <span>{t('empty.title')}</span>
            <Button variant="outline" size="sm" onClick={() => setModalOpen(true)}>{t('empty.cta')}</Button>
          </div>
        ) : (
          <>
            {todoGroups.map((group) => (
              <div key={group.workspace} className={styles.group}>
                <div className={styles.groupHeader}>
                  <span className={styles.groupPath}>{group.workspace}</span>
                </div>
                {group.tasks.map((task) => <TaskRow key={task.id} task={task} t={t} onOpenDetail={setDetailTask} onEdit={setEditTask} />)}
              </div>
            ))}
            {todo.length === 0 && running.length === 0 && done.length === 0 && dropped.length > 0 && (
              <div className={styles.empty}>
                <span>{t('empty.title')}</span>
                <Button variant="outline" size="sm" onClick={() => setModalOpen(true)}>{t('empty.cta')}</Button>
              </div>
            )}
            {running.length > 0 && (
              <div className={styles.group}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionToggle}>{t('section.running')} · {running.length}</span>
                </div>
                {running.map((task) => <TaskRow key={task.id} task={task} t={t} onOpenDetail={setDetailTask} />)}
              </div>
            )}
            {done.length > 0 && (
              <div className={styles.group}>
                <div className={styles.sectionHead}>
                  <button type="button" className={styles.sectionToggle} onClick={() => setShowDone(!showDone)}>
                    {showDone ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
                    {t('section.done')} · {done.length}
                  </button>
                  {doneOnly.length > 0 && (
                    <button
                      type="button"
                      className={clearArmed ? `${styles.clearBtn} ${styles.clearArmed}` : styles.clearBtn}
                      title={clearArmed ? t('action.clearFinishedConfirm') : t('action.clearFinished')}
                      onClick={handleClearFinished}
                    >
                      {clearArmed ? t('action.clearFinishedConfirmShort') : t('action.clearFinished')}
                    </button>
                  )}
                </div>
                {showDone && done.map((task) => <TaskRow key={task.id} task={task} t={t} onOpenDetail={setDetailTask} />)}
              </div>
            )}
            {dropped.length > 0 && (
              <div className={styles.group}>
                <button type="button" className={styles.sectionToggle} onClick={() => setShowDropped(!showDropped)}>
                  {showDropped ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
                  {t('section.dropped', { count: dropped.length })}
                </button>
                {showDropped && dropped.map((task) => <DroppedRow key={task.id} task={task} t={t} />)}
              </div>
            )}
            <div className={styles.footer}>
              <span className={styles.footerActions}>
                {pending > 0 && !isL1 ? (
                  <Button
                    variant="primary"
                    size="sm"
                    className={approveArmed ? styles.approveArmed : undefined}
                    title={approveArmed ? t('footer.approveAndRunConfirm') : t('footer.approveAndRun')}
                    onClick={handleApproveAndRun}
                  >
                    {approveArmed ? t('footer.approveAndRunConfirmShort') : t('footer.approveAndRun')}
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled={host.queue.queued === 0 || host.batch.running} onClick={() => { void runNow().then(() => showToast(t('toast.runStarted'))) }}>
                    {t('footer.runNow')}
                  </Button>
                )}
              </span>
            </div>
          </>
        )}
      </div>
      <NewTaskModal open={modalOpen} t={t} defaultAutonomy={host.autonomy as 'l1' | 'l2' | 'l3'} onClose={() => setModalOpen(false)} />
      {detailTask !== null && <TaskDetail task={detailTask} t={t} onClose={() => setDetailTask(null)} onEdit={setEditTask} />}
      {editTask !== null && <EditTaskModal task={editTask} t={t} defaultAutonomy={host.autonomy as 'l1' | 'l2' | 'l3'} onClose={() => setEditTask(null)} />}
    </div>
  )
}

export { NewTaskModal }
