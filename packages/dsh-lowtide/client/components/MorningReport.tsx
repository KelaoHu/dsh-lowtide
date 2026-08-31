/**
 * Interface ⑤ MorningReport (PLAN §6.5 + review round 1): the modal over a
 * batch result — latest report (from the dock bell / unread dot) plus a
 * history list (GET /ds-lowtide/reports). Conclusion first, anomalous
 * rows on top, one primary action (copy markdown). Round-1: history dates
 * use the same human format as the latest report, and a zero-savings night
 * shows "—" instead of a fake "¥0.00" headline.
 */
import { useState } from 'react'
import { Modal, Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { getReports, deleteReport, clearReports, retryTask } from '../api.ts'
import { lowtideStore, refreshNow, showToast, useLowtide, type HostReport } from '../store.ts'
import { type NsTranslate } from '../i18n.ts'
import { strategyLabel } from '../lib/taskMeta.ts'
import { CandidatesView } from './CandidatesView.tsx'
import { Money } from './atoms.tsx'
import styles from './MorningReport.module.css'

export type MorningReportProps = PropsRuntime<'shell.overlay'> & { t: NsTranslate }

function rowClass(status: string): string {
  if (status === 'done') return styles.doneRow
  return styles.badRow
}

/** Human date label matching the latest-report header (locale-aware). */
function reportDateLabel(dateIso: string): string {
  const d = new Date(`${dateIso}T08:00:00`)
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', weekday: 'short' })
}

function ReportBody({ report, t }: { report: HostReport; t: NsTranslate }): React.JSX.Element {
  const done = report.tasks.filter((t2) => t2.status === 'done')
  const anomalies = report.tasks.filter((t2) => t2.status !== 'done')

  return (
    <div className={styles.body}>
      <div className={styles.headline}>
        <span className={styles.headlineLabel}>{t('report.saved')}</span>
        {/* Always render the number: ¥0.00 is the honest value for a first /
            all-failed run — a bare "—" hides the headline (visual review). */}
        <span className={styles.headlineValue}><Money yuan={report.savedYuan} /></span>
        <span className={styles.headlineMeta}>
          {t('report.meta', {
            count: report.tasks.length,
            done: done.length,
            anomalies: anomalies.length,
            cost: report.totalCostYuan.toFixed(2),
          })}
          {(report.deferredCount ?? 0) > 0 && t('report.metaDeferred', { count: report.deferredCount })}
        </span>
      </div>
      <div className={styles.divider} />
      {anomalies.map((task) => (
        <div key={task.taskId} className={`${styles.taskRow} ${rowClass(task.status)}`}>
          <div className={styles.taskMain}>
            <span className={styles.taskPrompt}>{task.prompt.slice(0, 60)}</span>
            <span className={styles.taskMeta}>
              {task.status === 'stale' ? t('report.stale') : task.status === 'timeout' ? t('report.timeout') : t('report.failed')}
              {task.error !== undefined && <> · {task.error}</>}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { void retryTask(task.taskId).then(() => { showToast(t('toast.requeued')); refreshNow() }) }}
          >
            {t('report.retry')}
          </Button>
        </div>
      ))}
      {done.slice(0, 2).map((task) => (
        <div key={task.taskId} className={`${styles.taskRow} ${styles.doneRow}`}>
          <div className={styles.taskMain}>
            <span className={styles.taskPrompt}>{task.prompt.slice(0, 60)}</span>
            <span className={styles.taskMeta}>
              {strategyLabel(t, task.strategy, task.roundsRun) !== '' && <>{strategyLabel(t, task.strategy, task.roundsRun)} · </>}
              {task.elapsedMs !== undefined && <>{t('report.minutes', { minutes: Math.round(task.elapsedMs / 60000) })} · </>}
              {task.costYuan !== undefined && task.costYuan > 0
                ? <><Money yuan={task.costYuan} /> · </>
                : task.costYuan === 0 ? <>{t('report.priceUnknown')} · </> : <></>}
              {task.diffStat ?? '—'}
            </span>
            {task.candidates !== undefined && task.candidates.length > 0 && (
              <CandidatesView candidates={task.candidates} taskId={task.taskId} t={t} />
            )}
            {task.reviewExcerpt !== undefined && (
              <details className={styles.reviewExcerpt}>
                <summary>{t('report.reviewExcerpt')}</summary>
                <div className={styles.reviewExcerptBody}>{task.reviewExcerpt}</div>
              </details>
            )}
          </div>
        </div>
      ))}
      {done.length > 2 && <span className={styles.more}>{t('report.more', { count: done.length - 2 })}</span>}
      <div className={styles.divider} />
      <div className={styles.footer}>
        <Button variant="ghost" size="sm" onClick={() => { void writeClipboard(reportMarkdown(report, t)) }}>{t('report.copyMarkdown')}</Button>
      </div>
    </div>
  )
}

/** Markdown-safe single-line text (prompts/workspaces may contain any chars). */
function escapeMd(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|]/g, '\\$&').replace(/\s+/g, ' ')
}

function reportMarkdown(report: HostReport, t: NsTranslate): string {
  const lines = [
    `# ${t('report.mdTitle', { date: reportDateLabel(report.date), window: report.window })}`,
    '',
    t('report.mdSummary', {
      saved: report.savedYuan.toFixed(2),
      count: report.tasks.length,
      cost: report.totalCostYuan.toFixed(2),
    }),
    '',
  ]
  for (const task of report.tasks) {
    const mark = task.status === 'done' ? '●' : '✕'
    lines.push(`${mark} ${escapeMd(task.prompt)}（${escapeMd(task.workspace)}）`)
    if (task.costYuan !== undefined) lines.push(`   ¥${task.costYuan.toFixed(4)}${task.diffStat !== null && task.diffStat !== undefined ? ` · ${task.diffStat}` : ''}`)
  }
  return lines.join('\n')
}

export function MorningReport({ t }: MorningReportProps): React.JSX.Element {
  const report = useLowtide((s) => s.host?.latestReport ?? null)
  const reportOpen = useLowtide((s) => s.reportOpen)
  const historyOpen = useLowtide((s) => s.reportHistoryOpen)
  const [history, setHistory] = useState<HostReport[] | null>(null)
  const [viewing, setViewing] = useState<HostReport | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyLimit, setHistoryLimit] = useState(60)
  const [clearArmed, setClearArmed] = useState(false)

  function close(): void {
    lowtideStore.update((s) => {
      s.reportOpen = false
      s.reportHistoryOpen = false
      s.reportUnread = false
    })
    setViewing(null)
    setHistory(null)
  }

  async function openHistory(): Promise<void> {
    setLoadingHistory(true)
    const res = await getReports()
    setLoadingHistory(false)
    if (res.ok && res.reports !== undefined) {
      setHistory(res.reports)
      setHistoryLimit(res.limit ?? 60)
      setViewing(null)
      lowtideStore.update((s) => { s.reportOpen = false; s.reportHistoryOpen = true })
    } else {
      showToast(t('toast.historyFailed', { error: res.error ?? 'unknown' }))
    }
  }

  async function onDeleteReport(id: string): Promise<void> {
    const res = await deleteReport(id)
    if (res.ok) {
      showToast(t('toast.reportDeleted'))
      setHistory((prev) => prev?.filter((h) => h.id !== id) ?? null)
    } else {
      showToast(t('toast.reportDeleteFailed', { error: res.error ?? 'unknown' }))
    }
  }

  async function onClearReports(): Promise<void> {
    setClearArmed(false)
    const res = await clearReports()
    if (res.ok) {
      showToast(t('toast.reportsCleared', { count: res.cleared ?? 0 }))
      setHistory([])
    } else {
      showToast(t('toast.reportDeleteFailed', { error: res.error ?? 'unknown' }))
    }
  }

  const open = reportOpen || historyOpen || viewing !== null
  if (!open) return <></>

  // History list view.
  if (historyOpen && history !== null && viewing === null) {
    return (
      <Modal
        open
        onClose={close}
        title={t('report.history')}
        description={t('report.historyDesc', { count: history.length })}
        footer={
          <div className={styles.modalFooter}>
            <Button variant="primary" size="md" onClick={close}>{t('report.close')}</Button>
          </div>
        }
      >
        <div className={styles.historyList}>
          <div className={styles.historyHeader}>
            {historyLimit > 0
              ? <span className={styles.historyCount}>{t('report.showingLatest', { shown: history.length, limit: historyLimit })}</span>
              : <span className={styles.historyCount}>{t('report.totalCount', { count: history.length })}</span>}
          </div>
          {history.length === 0 && (
            <div className={styles.historyEmpty}>{t('report.historyEmpty')}</div>
          )}
          {history.map((r) => (
            <div key={r.id} className={styles.historyRowWrap}>
              <button type="button" className={styles.historyRow} onClick={() => setViewing(r)}>
                <span className={styles.historyDate}>{reportDateLabel(r.date)}</span>
                <span className={styles.historyMeta}>
                  {t('report.historyRow', { count: r.tasks.length, cost: r.totalCostYuan.toFixed(2), saved: r.savedYuan.toFixed(2) })}
                </span>
              </button>
              <button
                type="button"
                className={styles.historyDelete}
                title={t('report.delete')}
                onClick={(e) => { e.stopPropagation(); void onDeleteReport(r.id) }}
              >
                ✕
              </button>
            </div>
          ))}
          {history.length > 0 && (
            <div className={styles.historyFooter}>
              <button
                type="button"
                className={clearArmed ? styles.clearArmed : styles.clearBtn}
                onClick={() => {
                  if (!clearArmed) {
                    setClearArmed(true)
                    setTimeout(() => setClearArmed(false), 3000)
                    return
                  }
                  void onClearReports()
                }}
              >
                {clearArmed ? t('report.clearAllConfirm') : t('report.clearAll')}
              </button>
            </div>
          )}
        </div>
      </Modal>
    )
  }

  // Single report view (latest or a picked history item).
  const current = viewing ?? (reportOpen ? report : null)
  if (current === null) return <></>

  return (
    <Modal
      open
      onClose={close}
      title={t('report.title', { date: reportDateLabel(current.date) })}
      description={current.summary}
      footer={
        <div className={styles.modalFooter}>
          {viewing !== null && <Button variant="ghost" size="md" onClick={() => setViewing(null)}>{t('report.back')}</Button>}
          <Button variant="ghost" size="md" onClick={() => { void openHistory() }}>{t('report.history')}</Button>
          <Button variant="primary" size="md" onClick={close}>{t('report.close')}</Button>
        </div>
      }
    >
      <ReportBody report={current} t={t} />
    </Modal>
  )
}
