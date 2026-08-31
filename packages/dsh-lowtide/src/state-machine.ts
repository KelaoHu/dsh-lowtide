/**
 * Triage state-machine (review round 1, B6): the transition table guarding
 * every /tasks/:id/:action route. Kept dependency-free so the full matrix is
 * unit-testable without pulling the host bundle.
 */
/** Triage actions accepted by the /tasks/:id/:action routes. */
export type TriageAction = 'approve' | 'defer' | 'drop' | 'cancel' | 'retry' | 'delete' | 'restore' | 'choose-candidate'

/**
 * Statuses whose content may be EDITED in place (edit keeps the status —
 * a pending-review task stays pending-review, a queued one stays queued).
 * deferred is included: it has not run yet, so editing it and waiting for
 * the next window is natural (otherwise the user would need restore → edit
 * → approve, three steps for one fix).
 */
export const EDITABLE_STATUSES = ['pending-review', 'queued', 'deferred'] as const

/** Whether a task in this status may be edited in place. */
export function canEdit(status: string): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status)
}

/**
 * A transition is rejected unless the current status allows it — otherwise a
 * running task could be re-queued behind the agent's back and the persisted
 * state would fight the live execution.
 */
export function canTransition(status: string, action: TriageAction): boolean {
  switch (action) {
    case 'approve': return status === 'pending-review' || status === 'deferred'
    case 'defer': return status === 'pending-review' || status === 'queued'
    case 'drop': return status !== 'running' && status !== 'preflight'
    case 'cancel': return status === 'queued' || status === 'pending-review' || status === 'deferred'
    case 'retry': return status === 'failed' || status === 'timeout' || status === 'stale' || status === 'cancelled'
    case 'restore': return status === 'dropped'
    case 'choose-candidate': return status === 'done'
    case 'delete': return status !== 'running' && status !== 'preflight'
  }
}
