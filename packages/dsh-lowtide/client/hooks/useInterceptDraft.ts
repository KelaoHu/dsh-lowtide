/**
 * Intercept draft bridge (Phase D: hook facade over the pure selector state).
 *
 * The `conversation.composer` chain re-runs its `select` whenever the owner
 * re-renders — i.e. on every input-store change (keystrokes) and session
 * changes, but NOT on plugin-store updates. The interception therefore keys
 * off the LIVE DRAFT (PLAN §6.2: "composer 有内容"):
 *  - an empty draft never claims the composer, so the native bar and the
 *    queue dock stay visible during busy hours;
 *  - the moment the user types, the owner re-renders, `select` reads the
 *    tracked draft and the intercept card takes over with the draft intact;
 *  - the per-message ✕ exemption sets a session flag; the handler then
 *    toggles the draft (append + restore, one batched render) to force the
 *    owner re-render, which re-runs the selectors and returns the native
 *    composer immediately. Clearing the draft re-arms interception.
 *
 * Constraint: `selectIntercept` is a PURE selector run by the host chain
 * machinery — it cannot use hooks. So the draft + exemption state lives in
 * module scope, and only the WRITE side is wrapped in a hook.
 */
import { useEffect } from 'react'

export const INTERCEPT_DISMISS_KEY = 'dsh-lowtide:intercept-session-dismissed'

let currentDraft = ''

/** Sync the live draft into the module state (QueueDock stays mounted inside
 * the overlay-kept fallback, so it keeps tracking while the card is up).
 * An emptied draft re-arms interception for the next message. */
export function useInterceptDraftTracking(draft: string): void {
  useEffect(() => {
    if (draft === currentDraft) return
    currentDraft = draft
    if (draft.trim() === '') clearInterceptSessionDismissal()
  }, [draft])
}

/** Pure read for the chain selector. */
export function readInterceptDraft(): string {
  return currentDraft
}

/** ✕ exemption: this message will not be intercepted again this session. */
export function dismissInterceptSession(): void {
  try {
    sessionStorage.setItem(INTERCEPT_DISMISS_KEY, '1')
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/** Clear the per-session exemption (new message = re-arm). */
export function clearInterceptSessionDismissal(): void {
  try {
    sessionStorage.removeItem(INTERCEPT_DISMISS_KEY)
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/** Pure read for the chain selector. */
export function isInterceptSessionDismissed(): boolean {
  try {
    return sessionStorage.getItem(INTERCEPT_DISMISS_KEY) === '1'
  } catch {
    return false
  }
}
