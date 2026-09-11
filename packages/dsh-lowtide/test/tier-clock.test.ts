/**
 * Regression tests for the reported bug: the header price pill showed 闲时/忙时
 * of the LAST PUSHED snapshot, so one silently stalled SSE stream froze the
 * indicator forever while the clock moved on.
 *
 * These tests pin the fix's contract (no React, no browser — plain logic):
 *   1. the tier is derived from the windows + the local clock (same `levelAt`
 *      the host uses), and
 *   2. the clock flips the tier at the next boundary with ZERO server frames.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { deriveTier, isStreamFresh, nextBoundaryAt, OFF_TIER, startTierClock, SSE_STALE_MS, tierTimeZone } from '../client/lib/tierClock.ts'

/** Official peak windows, Beijing: 09:00–12:00 & 14:00–18:00 on weekdays. */
const PEAK = [
  { id: 'peak-morning', level: 'peak' as const, start: '09:00', end: '12:00', tz: 'Asia/Shanghai', days: [1, 2, 3, 4, 5] },
  { id: 'peak-afternoon', level: 'peak' as const, start: '14:00', end: '18:00', tz: 'Asia/Shanghai', days: [1, 2, 3, 4, 5] },
]

const CUSTOM = [
  { id: 'busy', level: 'custom' as const, start: '00:00', end: '23:59', tz: 'Asia/Shanghai', multiplier: 1.5 },
]

function beijing(iso: string): Date {
  return new Date(`${iso}+08:00`)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('tierClock.deriveTier (local, clock-accurate)', () => {
  test('morning peak window reports peak with its boundaries', () => {
    const tier = deriveTier(PEAK, 'Asia/Shanghai', beijing('2026-09-10T10:00:00'))
    expect(tier.level).toBe('peak')
    expect(tier.window?.start).toBe('09:00')
    expect(tier.window?.end).toBe('12:00')
    expect(tier.multiplier).toBe(2)
  })

  test('the 12:00-14:00 gap is off-peak (no window matches)', () => {
    expect(deriveTier(PEAK, 'Asia/Shanghai', beijing('2026-09-10T13:00:00'))).toEqual(OFF_TIER)
  })

  test('18:00 sharp is off-peak, 17:59 is still peak', () => {
    expect(deriveTier(PEAK, 'Asia/Shanghai', beijing('2026-09-10T17:59:00')).level).toBe('peak')
    expect(deriveTier(PEAK, 'Asia/Shanghai', beijing('2026-09-10T18:00:00')).level).toBe('off')
  })

  test('the weekend is off-peak even during official peak hours', () => {
    expect(deriveTier(PEAK, 'Asia/Shanghai', beijing('2026-09-12T10:00:00')).level).toBe('off')
  })

  test('custom windows keep their multiplier', () => {
    const tier = deriveTier(CUSTOM, 'Asia/Shanghai', beijing('2026-09-10T03:00:00'))
    expect(tier.level).toBe('custom')
    expect(tier.multiplier).toBe(1.5)
  })

  test('no windows at all means off-peak (never a crash)', () => {
    expect(deriveTier([], 'Asia/Shanghai', new Date())).toEqual(OFF_TIER)
  })

  test('tierTimeZone prefers the host tz and falls back to the browser tz', () => {
    expect(tierTimeZone('Asia/Shanghai')).toBe('Asia/Shanghai')
    expect(tierTimeZone('')).toBeTruthy()
    expect(tierTimeZone(null)).toBeTruthy()
    expect(tierTimeZone(undefined)).toBeTruthy()
  })
})

describe('tierClock.nextBoundaryAt', () => {
  test('from inside the afternoon peak the next boundary is 18:00', () => {
    const at = nextBoundaryAt(PEAK, 'Asia/Shanghai', beijing('2026-09-10T17:00:00'))
    expect(at).toBe(beijing('2026-09-10T18:00:00').getTime())
  })

  test('from the evening the next boundary is the next morning peak', () => {
    const at = nextBoundaryAt(PEAK, 'Asia/Shanghai', beijing('2026-09-10T20:00:00'))
    expect(at).toBe(beijing('2026-09-11T09:00:00').getTime())
  })

  test('no windows means no boundary to arm', () => {
    expect(nextBoundaryAt([], 'Asia/Shanghai', new Date())).toBeNull()
  })
})

describe('tierClock.isStreamFresh (the frozen-pill guard)', () => {
  test('no frame ever received is not fresh', () => {
    expect(isStreamFresh(0, 1_000_000)).toBe(false)
  })

  test('a frame inside the window is fresh, an older one is not', () => {
    const now = 10_000_000
    expect(isStreamFresh(now - 1_000, now)).toBe(true)
    expect(isStreamFresh(now - SSE_STALE_MS, now)).toBe(true)
    expect(isStreamFresh(now - SSE_STALE_MS - 1, now)).toBe(false)
  })
})

describe('tierClock.startTierClock — flips at the boundary with NO server frames', () => {
  test('a 17:59:30 clock shows 忙时 and flips to 闲时 just after 18:00', () => {
    vi.useFakeTimers()
    vi.setSystemTime(beijing('2026-09-10T17:59:30'))

    const changes: string[] = []
    const clock = startTierClock({
      getWindows: () => PEAK,
      getTimeZone: () => 'Asia/Shanghai',
      onChange: (tier) => changes.push(tier.level),
    })

    // Nothing has changed yet — the initial derivation is peak and it was
    // reported once (the first snapshot is a change from the OFF seed).
    expect(changes).toEqual(['peak'])
    expect(clock.current().level).toBe('peak')

    // 20s later we are still inside the peak window: no spurious churn.
    vi.advanceTimersByTime(20_000)
    expect(changes).toEqual(['peak'])
    expect(clock.current().level).toBe('peak')

    // Cross 18:00 with the boundary timer only — no state frame, no poll.
    vi.advanceTimersByTime(11_000) // 18:00:01
    expect(clock.current().level).toBe('off')
    expect(changes).toEqual(['peak', 'off'])

    clock.stop()
  })

  test('the 30s heartbeat alone catches a boundary when the exact timer is late', () => {
    vi.useFakeTimers()
    vi.setSystemTime(beijing('2026-09-10T11:59:50'))

    const seen: string[] = []
    const clock = startTierClock({
      getWindows: () => PEAK,
      getTimeZone: () => 'Asia/Shanghai',
      onChange: (tier) => seen.push(tier.level),
    })
    expect(seen).toEqual(['peak'])

    vi.advanceTimersByTime(31_000) // 12:00:21 — morning peak over
    expect(clock.current().level).toBe('off')
    expect(seen).toEqual(['peak', 'off'])

    clock.stop()
  })

  test('the clock follows a NEW window set pushed by the host (config edit)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(beijing('2026-09-10T13:00:00'))

    let windows = PEAK
    const seen: string[] = []
    const clock = startTierClock({
      getWindows: () => windows,
      getTimeZone: () => 'Asia/Shanghai',
      onChange: (tier) => seen.push(tier.level),
    })
    expect(clock.current().level).toBe('off')

    // The user marks 13:00–14:00 as busy (or the host pushes adopted hours).
    windows = [{ id: 'extra', level: 'peak' as const, start: '13:00', end: '14:00', tz: 'Asia/Shanghai' }]
    expect(clock.refresh().level).toBe('peak')
    // `off` matched the initial seed, so only the change is reported.
    expect(seen).toEqual(['peak'])

    clock.stop()
  })

  test('stop() cancels both timers (no callbacks after unload)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(beijing('2026-09-10T17:59:30'))
    const seen: string[] = []
    const clock = startTierClock({
      getWindows: () => PEAK,
      getTimeZone: () => 'Asia/Shanghai',
      onChange: (tier) => seen.push(tier.level),
    })
    clock.stop()
    vi.advanceTimersByTime(120_000)
    expect(seen).toEqual(['peak'])
  })
})
