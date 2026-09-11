/**
 * Window model: peak/off-peak windows, matching, countdown, next-off-peak,
 * midnight-crossing, per-weekday, explicit timezone. Pure functions.
 *
 * Time semantics (PLAN §16.0.1): all window start/end are local times
 * interpreted in the window's own `tz` (default: system local timezone).
 * The official DeepSeek peak windows ship with tz fixed to Asia/Shanghai
 * because the pricing calendar is defined by Beijing time.
 */

export type WindowLevel = 'peak' | 'off' | 'custom'

export interface WindowCfg {
  id: string
  label?: string
  level: WindowLevel
  /** Local "HH:MM" boundaries, interpreted in `tz`. start === end = full day. */
  start: string
  end: string
  /** ISO weekdays (1=Mon … 7=Sun) the window applies; undefined = every day. */
  days?: number[]
  /** IANA timezone; defaults to the system local timezone. */
  tz?: string
  /** Price multiplier over the off-peak base (peak defaults 2, off/custom 1). */
  multiplier?: number
}

export interface BatchCfg {
  /** Local "HH:MM-HH:MM" window, e.g. "19:00-23:30", interpreted in `tz`. */
  window: string
  tz?: string
  /** Lead minutes for the evening confirm gate. */
  gateLeadMin: number
}

export interface LevelMatch {
  level: WindowLevel
  multiplier: number
  window: WindowCfg
}

export const DEFAULT_MULTIPLIER: Record<WindowLevel, number> = {
  peak: 2,
  off: 1,
  custom: 1,
}

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function minutesOf(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (match === null) throw new Error(`invalid HH:MM time "${hhmm}"`)
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) throw new Error(`invalid HH:MM time "${hhmm}"`)
  return h * 60 + m
}

function parseWindowRange(window: string): { start: number; end: number } {
  const match = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(window)
  if (match === null) throw new Error(`invalid window range "${window}" (expected "HH:MM-HH:MM")`)
  return { start: minutesOf(match[1]), end: minutesOf(match[2]) }
}

export { parseWindowRange }

/** Local HH:MM minutes + ISO weekday of a Date in an IANA timezone. */
export function localParts(when: Date, tz: string): { minutes: number; weekday: number } {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
      hour12: false,
    }).formatToParts(when)
  } catch {
    // Unknown/invalid tz must never crash the scheduler — fall back to the
    // system timezone (defense in depth on top of schema validation).
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: systemTimeZone(),
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
      hour12: false,
    }).formatToParts(when)
  }
  let hour = 0
  let minute = 0
  let weekday = 1
  for (const part of parts) {
    if (part.type === 'hour') {
      // DST fall-back transitions can format the repeated hour as "24" on
      // some engines — normalize it to 00 (still the next calendar day's
      // boundary in the caller's arithmetic).
      const h = Number(part.value)
      hour = Number.isFinite(h) ? (h === 24 ? 0 : h) : 0
    }
    if (part.type === 'minute') {
      const m = Number(part.value)
      minute = Number.isFinite(m) ? m : 0
    }
    if (part.type === 'weekday') {
      weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[part.value] ?? 1
    }
  }
  return { minutes: hour * 60 + minute, weekday }
}

function matchesDays(days: number[] | undefined, weekday: number): boolean {
  if (days === undefined || days.length === 0) return true
  return days.includes(weekday)
}

/** Whether `minutes` falls inside [start, end), with midnight-crossing support. */
function inRange(minutes: number, start: number, end: number): boolean {
  if (end > start) return minutes >= start && minutes < end
  if (end < start) return minutes >= start || minutes < end
  return true // full-day window
}

/**
 * Resolve the active window at `when` (array order = precedence).
 * Returns null when no window covers the moment.
 */
export function levelAt(when: Date, windows: WindowCfg[], defaultTz = systemTimeZone()): LevelMatch | null {
  for (const window of windows) {
    const tz = window.tz ?? defaultTz
    const { minutes, weekday } = localParts(when, tz)
    if (!matchesDays(window.days, weekday)) continue
    const start = minutesOf(window.start)
    const end = minutesOf(window.end)
    if (inRange(minutes, start, end)) {
      return { level: window.level, multiplier: window.multiplier ?? DEFAULT_MULTIPLIER[window.level], window }
    }
  }
  return null
}

/**
 * The next moment `when` is NOT in a peak window. Inside a peak, the
 * candidates are every peak window's next end boundary plus every explicitly
 * configured off/custom window's next start; the earliest wins. Outside a
 * peak, returns `when` unchanged (already off). Null only when the config
 * has no peak end reachable within the scan horizon.
 *
 * Day stepping is CALENDAR-based (per window tz) — fixed 86_400_000ms steps
 * drift by an hour across DST transitions.
 */
export function nextOffPeakStart(when: Date, windows: WindowCfg[], defaultTz = systemTimeZone()): Date | null {
  if (levelAt(when, windows, defaultTz)?.level !== 'peak') return when

  const peaks = windows.filter((w) => w.level === 'peak')
  const starts = windows.filter((w) => w.level !== 'peak')

  let best: Date | null = null
  const consider = (candidate: Date | null) => {
    if (candidate !== null && candidate > when && (best === null || candidate < best)) best = candidate
  }

  for (let day = 0; day < 8; day++) {
    for (const window of peaks) {
      const tz = window.tz ?? defaultTz
      const probe = addDaysInTz(when, tz, day)
      const { minutes, weekday } = localParts(probe, tz)
      if (!matchesDays(window.days, weekday)) continue
      const end = minutesOf(window.end)
      consider(new Date(probe.getTime() + (end - minutes) * 60_000))
    }
    for (const window of starts) {
      const tz = window.tz ?? defaultTz
      const probe = addDaysInTz(when, tz, day)
      const { minutes, weekday } = localParts(probe, tz)
      if (!matchesDays(window.days, weekday)) continue
      const start = minutesOf(window.start)
      consider(new Date(probe.getTime() + (start - minutes) * 60_000))
    }
    if (best !== null) break
  }
  return best
}

/**
 * The next moment the active level may change after `when`: the earliest
 * future boundary among every window's start and end (calendar-based, per
 * window tz, weekday-aware).
 *
 * The client tier clock uses this to flip a displayed 闲时/忙时 exactly at the
 * boundary — even when no host frame ever arrives (a stalled push stream must
 * never freeze the indicator). Scanning mirrors `nextOffPeakStart`: day steps
 * go through `addDaysInTz` so DST/midnight-crossing windows stay correct.
 *
 * Returns null when no boundary is reachable within 8 days (e.g. no windows).
 */
export function nextLevelChangeAt(when: Date, windows: WindowCfg[], defaultTz = systemTimeZone()): Date | null {
  let best: Date | null = null
  for (let day = 0; day < 8; day++) {
    for (const window of windows) {
      const tz = window.tz ?? defaultTz
      const probe = addDaysInTz(when, tz, day)
      const { minutes, weekday } = localParts(probe, tz)
      if (!matchesDays(window.days, weekday)) continue
      const start = minutesOf(window.start)
      const end = minutesOf(window.end)
      // start === end is a full-day window: its only meaningful boundary is the
      // start (the level cannot change inside it).
      const boundaries = end === start ? [start] : [start, end]
      for (const boundary of boundaries) {
        const candidate = new Date(probe.getTime() + (boundary - minutes) * 60_000)
        if (candidate.getTime() > when.getTime() && (best === null || candidate.getTime() < best.getTime())) best = candidate
      }
    }
    if (best !== null) break
  }
  return best
}

/** Next batch start from a "HH:MM-HH:MM" window (local time in batch tz). */
export function nextBatchAt(now: Date, batch: BatchCfg, defaultTz = systemTimeZone()): Date {
  const { start } = parseWindowRange(batch.window)
  const tz = batch.tz ?? defaultTz
  let target = new Date(dayStartInTz(now, tz).getTime() + start * 60_000)
  if (target.getTime() <= now.getTime()) {
    target = new Date(addDaysInTz(now, tz, 1).getTime() + start * 60_000)
  }
  return target
}

/** Whether an estimated task duration fits the remaining off-peak minutes. */
export function fitsWindow(estMin: number, remainingMin: number): boolean {
  return estMin <= remainingMin
}

/** Minutes from `now` until `at` (floor), 0 when past. */
export function minutesUntil(now: Date, at: Date): number {
  return Math.max(0, Math.floor((at.getTime() - now.getTime()) / 60_000))
}

/** A window's boundaries re-expressed as wall-clock times in another tz. */
export interface WindowLocal {
  label: string
  start: string
  end: string
  /** The segment crosses midnight in the target tz (end is on the next day). */
  crossesDay: boolean
  /** ISO weekdays the window applies to (preserved from the source window). */
  days?: number[]
}

function fmtMinutes(minutes: number): string {
  const h = Math.floor(((minutes % 1440) + 1440) % 1440 / 60)
  const m = ((minutes % 60) + 60) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * The instant when the calendar day containing `probe` (in `tz`) begins.
 *
 * Wall-clock subtraction breaks on DST spring-forward days (23h): walking
 * back N minutes from 05:00 PDT lands at 23:00 PST the previous day. Instead
 * we binary-search the earliest UTC instant whose tz calendar day equals the
 * probe's — the tz day is monotonic in UTC, so the boundary IS local 00:00.
 */
export function dayStartInTz(probe: Date, tz: string): Date {
  const targetDay = daySerial(probe, tz)
  // 26h back is always the previous calendar day (max day length is 25h).
  let lo = new Date(probe.getTime() - 26 * 3_600_000)
  let hi = probe
  for (let i = 0; i < 32; i++) {
    const mid = new Date((lo.getTime() + hi.getTime()) / 2)
    if (daySerial(mid, tz) === targetDay) hi = mid
    else lo = mid
  }
  return hi
}

/**
 * The calendar-day start `days` days after/before the day containing `probe`
 * (in `tz`). Steps via a noon-ish probe so DST ±1h days cannot misalign.
 */
export function addDaysInTz(probe: Date, tz: string, days: number): Date {
  const day0 = dayStartInTz(probe, tz)
  const mid = new Date(day0.getTime() + (days * 24 + 12) * 3_600_000)
  return dayStartInTz(mid, tz)
}

/** Calendar-day serial (YYYY-MM-DD) of an instant in a tz. */
function daySerial(when: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(when)
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: systemTimeZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(when)
  }
}

/** Wall-clock minutes + calendar-day serial of an instant in a tz. */
function readInTz(instant: Date, tz: string): { minutes: number; day: string } {
  return { minutes: localParts(instant, tz).minutes, day: daySerial(instant, tz) }
}

/**
 * Re-express windows (interpreted in each window's own `tz`) as local
 * "HH:MM" ranges of `tz`, probed on a concrete date so DST shifts are
 * respected. Used to show the official Beijing-defined peak windows in the
 * user's local clock (a west-hemisphere user may see day-shifted, even
 * midnight-crossing, segments). Pure.
 */
export function windowsInTz(windows: WindowCfg[], tz: string, probe = new Date()): WindowLocal[] {
  return windows.map((w) => {
    const fromTz = w.tz ?? systemTimeZone()
    const dayStart = dayStartInTz(probe, fromTz)
    const startMin = minutesOf(w.start)
    const endMin = minutesOf(w.end)
    // end <= start means the window crosses midnight: the end boundary
    // belongs to the NEXT day in the source tz.
    const endOffset = endMin <= startMin ? endMin + 24 * 60 : endMin
    const start = readInTz(new Date(dayStart.getTime() + startMin * 60_000), tz)
    const end = readInTz(new Date(dayStart.getTime() + endOffset * 60_000), tz)
    return {
      label: w.label ?? '',
      start: fmtMinutes(start.minutes),
      end: fmtMinutes(end.minutes),
      crossesDay: end.day !== start.day,
      ...(w.days === undefined ? {} : { days: [...w.days] }),
    }
  })
}
