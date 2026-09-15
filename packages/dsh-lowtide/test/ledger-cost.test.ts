/**
 * Savings-round: peakCostOf is the "what you'd have paid at peak" baseline
 * behind the saved-¥ figure. Only models with a real price entry (the official
 * table — including legacy aliases such as deepseek-v4-flash-vision-exp — or a
 * user override) get a baseline; any other model yields 0 so no fake savings
 * are ever reported.
 *
 * Prices follow the 2026-09-10 V4.1-Flash table: flash peak = 2 / 0.04 / 8.
 */
import { describe, expect, test, vi } from 'vitest'
import { peakCostOf } from '../src/runner.ts'
import { hasPriceEntry, OFFICIAL_PRICES, resolvePriceModel } from 'lowtide-core'

const USAGE = { input: 1_000_000, output: 200_000, cacheRead: 500_000 }

describe('peakCostOf', () => {
  test('legacy flash id resolves to the new flash peak row', () => {
    expect(resolvePriceModel('deepseek-v4-flash')).toBe('deepseek-flash')
    expect(peakCostOf(USAGE, 'deepseek-v4-flash', undefined))
      .toBe(1 * 2 + 0.5 * 0.04 + 0.2 * 8) // 2 + 0.02 + 1.6
  })

  test('the canonical deepseek-flash id is priced too', () => {
    expect(peakCostOf(USAGE, 'deepseek-flash', undefined))
      .toBe(peakCostOf(USAGE, 'deepseek-v4-flash', undefined))
  })

  test('official pro model uses the pro peak row', () => {
    // Pin the clock BEFORE the V4 Pro retirement billing route takes effect
    // (Beijing 2026-09-14 12:00 = 04:00Z): after it, pro bills as flash and
    // this baseline collapses onto the flash row by design.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-13T00:00:00.000Z'))
      expect(peakCostOf(USAGE, 'deepseek-v4-pro', undefined))
        .toBe(1 * 9 + 0.5 * 0.3 + 0.2 * 27) // 9 + 0.15 + 5.4
    } finally {
      vi.useRealTimers()
    }
  })

  test('retired vision id aliases to flash (peak baseline exists)', () => {
    expect(peakCostOf(USAGE, 'deepseek-v4-flash-vision-exp', undefined))
      .toBe(peakCostOf(USAGE, 'deepseek-v4-flash', undefined))
  })

  test('unknown models (e.g. mimo) yield 0 — no fake savings', () => {
    expect(peakCostOf(USAGE, 'mimo-v2.5-pro', undefined)).toBe(0)
    expect(peakCostOf(USAGE, 'gpt-4o', undefined)).toBe(0)
    expect(peakCostOf(USAGE, 'some-gateway-model', {})).toBe(0)
  })

  test('a user price override supplies the peak baseline', () => {
    const prices = {
      'my-model': { peak: { input: 6, inputCached: 0.2, output: 18 }, off: { input: 3, inputCached: 0.1, output: 9 } },
    }
    expect(peakCostOf(USAGE, 'my-model', prices)).toBe(1 * 6 + 0.5 * 0.2 + 0.2 * 18)
  })

  test('official table still applies for models without an override entry', () => {
    expect(peakCostOf(USAGE, 'deepseek-v4-flash', {})).toBe(peakCostOf(USAGE, 'deepseek-v4-flash', undefined))
    expect(peakCostOf(USAGE, 'deepseek-v4-flash-vision-exp', {})).toBeGreaterThan(0)
  })

  test('unknown models have no peak baseline at all (ledger stays clean)', () => {
    // costOf() also returns 0 for unknown models, so saved = 0 - 0 = 0.
    expect(peakCostOf(USAGE, 'mimo-v2.5-pro', undefined)).toBe(0)
    expect(hasPriceEntry('deepseek-v4-flash-vision-exp')).toBe(true)
    expect(OFFICIAL_PRICES['deepseek-flash']).toBeDefined()
  })
})
