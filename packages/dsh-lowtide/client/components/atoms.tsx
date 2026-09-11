/**
 * Atomic presentational pieces (PLAN §3.6/§3.7): money with tabular nums,
 * live countdown, status dot. Only §4 tokens.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import styles from './atoms.module.css'

/**
 * Wall-clock tick for "now" markers (v0.2.2): re-renders every `periodMs`
 * (default 30s) and on mount. The 24h band's marker used to be computed once
 * per render with no timer, so it never moved on its own — the same class of
 * staleness the tier clock fixes for the pill.
 */
export function useWallClock(periodMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), periodMs)
    return () => clearInterval(timer)
  }, [periodMs])
  return now
}

/** ¥3.82 two-decimals; ¥123 without decimals at ≥¥100; <¥0.01 for dust (PLAN §3.6). */
export function Money({ yuan, className }: { yuan: number; className?: string }): React.JSX.Element {
  const text = yuan >= 100 ? `¥${Math.round(yuan)}` : yuan < 0.005 ? '<¥0.01' : `¥${yuan.toFixed(2)}`
  return <span className={className ?? styles.money}>{text}</span>
}

/** HH:MM:SS live countdown to a timestamp (local interval, no network). */
export function Countdown({ targetMs, className }: { targetMs: number; className?: string }): React.JSX.Element {
  const now = useSyncExternalStore(
    (onChange) => {
      const t = setInterval(onChange, 1000)
      return () => clearInterval(t)
    },
    () => Date.now(),
  )
  const remaining = Math.max(0, targetMs - now)
  const totalSeconds = Math.floor(remaining / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return <span className={className ?? styles.countdown}>{`${h}:${pad(m)}:${pad(s)}`}</span>
}

/** HH:MM from a timestamp. */
export function ClockTime({ ms, className }: { ms: number; className?: string }): React.JSX.Element {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return <span className={className ?? styles.countdown}>{`${pad(d.getHours())}:${pad(d.getMinutes())}`}</span>
}

export type LevelState = 'peak' | 'off' | 'running' | 'ending'

/** StateDot mapping: red peak / green off / amber window-ending / blue-pulse running. */
export function LevelDot({ state }: { state: LevelState }): React.JSX.Element {
  const dot: StateDotState = state === 'peak' ? 'error' : state === 'off' ? 'done' : state === 'ending' ? 'warning' : 'ongoing'
  return <StateDot state={dot} />
}

/** Small tag showing which model a task uses. Optionally flags unknown pricing. */
export function ModelBadge({ model, priceKnown }: { model?: string; priceKnown?: boolean }): React.JSX.Element | null {
  if (model === undefined || model === '') return null
  // Show only the model id (not the provider) to keep the tag compact.
  const short = model.includes('/') ? model.split('/').pop() ?? model : model
  return (
    <span className={`${styles.modelBadge} ${priceKnown === false ? styles.modelBadgeUnknown : ''}`}>
      {short}{priceKnown === false && <span className={styles.modelBadgeQ}>?</span>}
    </span>
  )
}
