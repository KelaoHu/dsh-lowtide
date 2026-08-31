/**
 * Shared task metadata helpers (Phase D split): status labels and strategy
 * labels used by the queue rows, task detail, and the execution report.
 * Pure functions over the i18n seat — no CSS, no component state.
 */
import { type NsTranslate } from '../i18n.ts'

const STATUS_KEYS: Record<string, string> = {
  'pending-review': 'status.pending-review',
  queued: 'status.queued',
  deferred: 'status.deferred',
  dropped: 'status.dropped',
  running: 'status.running',
  preflight: 'status.preflight',
  done: 'status.done',
  failed: 'status.failed',
  stale: 'status.stale',
  timeout: 'status.timeout',
  cancelled: 'status.cancelled',
}

/** Localized status label ("待裁定" / "Queued" …). */
export function statusLabel(t: NsTranslate, status: string): string {
  return t((STATUS_KEYS[status] ?? status) as never)
}

/** 策略标签:迭代 N 轮 / 采样 N 份 / 复核 / 单次(空)。 */
export function strategyLabel(t: NsTranslate, strategy: string | undefined, roundsRun: number | undefined): string {
  if (strategy === 'iterative') return t('report.strategyIterative', { rounds: roundsRun ?? 1 })
  if (strategy === 'sampling') return t('report.strategySampling', { count: roundsRun ?? 1 })
  if (strategy === 'review') return t('report.strategyReview')
  return ''
}

