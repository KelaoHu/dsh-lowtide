/**
 * Savings-round: peakCostOf is the "what you'd have paid at peak" baseline
 * behind the saved-¥ figure. Only models with a real price entry (official
 * table — all three deepseek models — or a user override) get a baseline;
 * any other model yields 0 so no fake savings are ever reported.
 */
import { describe, expect, test } from 'vitest'
import { peakCostOf } from '../src/runner.ts'
import { OFFICIAL_PRICES } from 'lowtide-core'

const USAGE = { input: 1_000_000, output: 200_000, cacheRead: 500_000 }

describe('peakCostOf', () => {
  test('official flash model uses the flash peak row', () => {
    expect(peakCostOf(USAGE, 'deepseek-v4-flash', undefined))
      .toBe(1 * 3 + 0.5 * 0.1 + 0.2 * 9) // 3 + 0.05 + 1.8
  })

  test('official pro model uses the pro peak row', () => {
    expect(peakCostOf(USAGE, 'deepseek-v4-pro', undefined))
      .toBe(1 * 9 + 0.5 * 0.3 + 0.2 * 27) // 9 + 0.15 + 5.4
  })

  test('official vision model is priced like flash (peak baseline exists)', () => {
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
    expect(OFFICIAL_PRICES['deepseek-v4-flash-vision-exp']).toBeDefined()
  })
})
