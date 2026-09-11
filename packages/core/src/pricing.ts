/**
 * Pricing: official DeepSeek peak/valley table (effective 2026-09-10 — the
 * DeepSeek-V4.1-Flash release, which renamed the flash model to
 * `deepseek-flash` and cut its prices; sourced from api-docs.deepseek.com),
 * overrides, legacy-id aliases, dated billing routes, and usage→¥ conversion.
 * Pure functions.
 *
 * Usage semantics (verified against rc.7 @deepseek-ai/dsh-llm-deepseek
 * mapUsage, lib/index.js:190-199):
 *  - inputTokens is DISJOINT from cache reads (prompt_tokens minus cached).
 *  - outputTokens is the TOTAL completion count — it already INCLUDES
 *    reasoningTokens, so reasoning must NEVER be added on top (PLAN C3).
 *  - The rc.7 harness TokenUsage reports no cacheWriteTokens field.
 *
 * Peak = Beijing 09:00–12:00, 14:00–18:00 weekdays only; weekends (Sat/Sun)
 * are always off-peak (announced 2026-08-22, effective 2026-08-23; unchanged
 * by the 2026-09-10 price cut). Off-peak is exactly half of peak.
 * All amounts are CNY per 1M tokens.
 */

import { levelAt, type WindowCfg, type WindowLevel } from './windows.ts'

export interface PriceRow {
  /** ¥ per 1M input tokens, cache miss. */
  input: number
  /** ¥ per 1M input tokens, cache hit. */
  inputCached: number
  /** ¥ per 1M output tokens (includes reasoning). */
  output: number
}

export type PriceTier = Record<'peak' | 'off', PriceRow>

export type ModelId = string

/**
 * Official defaults (CNY /1M tokens), effective from 2026-09-10 — the
 * DeepSeek-V4.1-Flash release, which renamed the flash model to
 * `deepseek-flash` and cut its API prices (official docs 2026-09-10).
 * Peak hours are unchanged: Beijing weekdays 09:00–12:00 & 14:00–18:00,
 * everything else (including all weekend hours) is off-peak at half price.
 */
export const OFFICIAL_EFFECTIVE_FROM = '2026-09-10'

/** Canonical id of the current official flash model (V4.1-Flash, multimodal). */
export const FLASH_MODEL_ID = 'deepseek-flash'

export const OFFICIAL_PRICES: Record<ModelId, PriceTier> = {
  [FLASH_MODEL_ID]: {
    peak: { input: 2, inputCached: 0.04, output: 8 },
    off: { input: 1, inputCached: 0.02, output: 4 },
  },
  'deepseek-v4-pro': {
    peak: { input: 9, inputCached: 0.3, output: 27 },
    off: { input: 4.5, inputCached: 0.15, output: 13.5 },
  },
}

/**
 * Legacy model ids that DeepSeek still accepts but has retired: requests are
 * served by DeepSeek-V4.1-Flash and billed at the Flash price (official docs,
 * 2026-09-10). Mapping them keeps old persisted tasks and existing Harness
 * catalogs priced instead of silently falling back to "价格未知".
 */
export const PRICE_ALIASES: Record<ModelId, ModelId> = {
  'deepseek-v4-flash': FLASH_MODEL_ID,
  'deepseek-v4-flash-vision-exp': FLASH_MODEL_ID,
}

/** Dated billing routes: from `from` (inclusive) the model bills as `to`. */
export interface PriceRoute {
  model: ModelId
  /** ISO instant the route takes effect (Beijing 2026-09-14 12:00 = 04:00Z). */
  from: string
  to: ModelId
  /** Why the route exists — surfaced by the UI as a notice. */
  note: string
}

export const PRICE_ROUTING: readonly PriceRoute[] = [
  {
    model: 'deepseek-v4-pro',
    from: '2026-09-14T04:00:00.000Z',
    to: FLASH_MODEL_ID,
    note: 'DeepSeek V4 Pro 于北京时间 2026-09-14 12:00 起下线，请求按 V4.1-Flash 计费',
  },
]

/**
 * Resolve the model id that actually gets billed at `when`: legacy aliases are
 * mapped to their canonical entry first, then dated routes apply (V4 Pro →
 * Flash after its retirement instant).
 */
export function resolvePriceModel(model: ModelId, when: Date = new Date()): ModelId {
  const aliased = PRICE_ALIASES[model] ?? model
  let resolved = aliased
  for (const route of PRICE_ROUTING) {
    if ((route.model === model || route.model === aliased) && when.getTime() >= Date.parse(route.from)) {
      resolved = route.to
    }
  }
  return resolved
}

/** The active routing notice for a model at `when` (null when none applies). */
export function priceRouteNotice(model: ModelId, when: Date = new Date()): string | null {
  for (const route of PRICE_ROUTING) {
    if (route.model === model && when.getTime() >= Date.parse(route.from)) return route.note
  }
  return null
}

/** Official peak windows (Beijing-defined calendar; tz fixed Asia/Shanghai).
 *  days: [1,2,3,4,5] = weekdays only; weekends are always off-peak. */
export const OFFICIAL_PEAK_WINDOWS: WindowCfg[] = [
  { id: 'peak-morning', label: '官方早高峰', level: 'peak', start: '09:00', end: '12:00', tz: 'Asia/Shanghai', days: [1, 2, 3, 4, 5] },
  { id: 'peak-afternoon', label: '官方午高峰', level: 'peak', start: '14:00', end: '18:00', tz: 'Asia/Shanghai', days: [1, 2, 3, 4, 5] },
]

/** Normalized usage fed by either platform adapter (PLAN §17.1). */
export interface UsageLike {
  input: number
  output: number
  cacheRead: number
  reasoning?: number
}

/** Fallback tier for models without an explicit entry (keeps the UI alive). */
export const FALLBACK_TIER: PriceTier = OFFICIAL_PRICES[FLASH_MODEL_ID]

/**
 * Resolve a model's price tier at `when`. Resolution order:
 *   1. billing id from `resolvePriceModel` (alias + dated route),
 *   2. a user override on that id, then on the raw id (legacy overrides keep
 *      working after a rename),
 *   3. the official table, then the flash fallback.
 * Unknown models fall back to the flash tier instead of throwing — the UI can
 * flag `hasPriceEntry === false` and show a "按默认价估算" hint rather than
 * going dark.
 */
export function tierFor(
  model: ModelId,
  prices: Record<ModelId, PriceTier> = OFFICIAL_PRICES,
  when: Date = new Date(),
): PriceTier {
  const billed = resolvePriceModel(model, when)
  return prices[billed] ?? prices[model] ?? OFFICIAL_PRICES[billed] ?? FALLBACK_TIER
}

/** Whether the model has an explicit price entry (override, alias or official). */
export function hasPriceEntry(
  model: ModelId,
  prices: Record<ModelId, PriceTier> = OFFICIAL_PRICES,
  when: Date = new Date(),
): boolean {
  const billed = resolvePriceModel(model, when)
  return billed in prices || model in prices || billed in OFFICIAL_PRICES
}

/** Cost in ¥ for a usage at a known tier row. */
export function costAtRow(usage: UsageLike, row: PriceRow): number {
  // Round the final ¥ to 1e-6 (micro-yuan): floating drift from many small
  // additions otherwise accumulates in the ledger (0.1+0.2 class errors).
  const raw = (
    usage.input * row.input
    + usage.cacheRead * row.inputCached
    + usage.output * row.output
  ) / 1_000_000
  return Math.round(raw * 1_000_000) / 1_000_000
}

/**
 * Display price row for a level match — mirrors `cost()` exactly so what the
 * UI shows always equals what the ledger charges:
 *   - null / off  → off-peak row
 *   - peak        → peak row
 *   - custom      → off row × multiplier (component-wise; cost() multiplies
 *                   the linear total, which is equivalent)
 */
export function rowForLevel(tier: PriceTier, level: WindowLevel | null, multiplier = 1): PriceRow {
  if (level === null || level === 'off') return tier.off
  if (level === 'peak') return tier.peak
  return {
    input: tier.off.input * multiplier,
    inputCached: tier.off.inputCached * multiplier,
    output: tier.off.output * multiplier,
  }
}

/**
 * Cost in ¥: resolves peak/off from the active window at `when` (array
 * order = precedence; null match = off-peak base) and applies custom
 * window multipliers over the off row.
 */
export function cost(
  usage: UsageLike,
  model: ModelId,
  when: Date,
  windows: WindowCfg[] = OFFICIAL_PEAK_WINDOWS,
  prices: Record<ModelId, PriceTier> = OFFICIAL_PRICES,
): number {
  const tier = tierFor(model, prices, when)
  const match = levelAt(when, windows)
  if (match === null || match.level === 'off') return costAtRow(usage, tier.off)
  if (match.level === 'peak') return costAtRow(usage, tier.peak)
  // custom windows: off base × multiplier
  return costAtRow(usage, tier.off) * match.multiplier
}

/** Rough pre-flight estimate: text chars ÷ 3.5, files by byte size ÷ 4. */
export function estimateTokens(prompt: string, files: { size: number }[]): number {
  const promptTokens = Math.ceil(prompt.length / 3.5)
  const fileTokens = files.reduce((sum, file) => sum + Math.ceil(file.size / 4), 0)
  return promptTokens + fileTokens
}

/** Peak/off cost estimate for a draft prompt + files, assuming ~5:1 out ratio is not applied (input-only bound). */
export function estimate(
  prompt: string,
  files: { size: number }[],
  model: ModelId,
  prices: Record<ModelId, PriceTier> = OFFICIAL_PRICES,
  when: Date = new Date(),
): { peak: number; off: number } {
  const tokens = estimateTokens(prompt, files)
  const tier = tierFor(model, prices, when)
  return {
    peak: costAtRow({ input: tokens, output: 0, cacheRead: 0 }, tier.peak),
    off: costAtRow({ input: tokens, output: 0, cacheRead: 0 }, tier.off),
  }
}
