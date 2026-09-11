/**
 * Available-model enumeration (functional round): every model this machine's
 * dsh has configured. Uses the llm service's canonical catalog API
 * (`ctx.llm.listProviders` + `ctx.llm.listModels`) instead of hard-coding the
 * deepseek pair or reading one settings namespace, so ANY provider the user
 * has connected — deepseek official, llm-pi-ai gateways, custom
 * openai-compatible endpoints, … — is listed with exactly the models its
 * adapter actually serves (configured catalog or adapter defaults).
 */
import { hasPriceEntry, priceRouteNotice, resolvePriceModel, OFFICIAL_PRICES, type PriceTier } from 'lowtide-core'
import type { Context } from '@deepseek-ai/cordis'

export interface AvailableModel {
  id: string
  name: string
  /** Whether this model has an official/override price entry (aliases count). */
  priceKnown: boolean
  /** The id that actually gets billed (legacy alias / dated route resolved). */
  priceModel: string
  /** Adapter-declared input modalities (e.g. ["text", "image"]) — optional. */
  inputModalities?: string[]
  /** Supported reasoning efforts with the adapter's native labels. */
  reasoningEfforts?: ReadonlyArray<{ id: string; name: string; description?: string }>
  /** The model's default reasoning effort id, when the adapter declares one. */
  defaultReasoningEffort?: string
  /** Billing notice (e.g. a retired model routed to a cheaper one). */
  notice?: string
}

export interface AvailableProvider {
  provider: string
  displayName: string
  models: AvailableModel[]
}

/** Enumerate all configured models on this machine (deepseek first). A
 *  provider whose catalog cannot be read (missing credential, no models) is
 *  skipped rather than failing the whole listing. Reasoning metadata comes
 *  from the adapter's exact-model resolution so every model — including
 *  user-added providers — reports its own supported effort set. */
export async function listAvailableModels(
  ctx: Context,
  prices: Record<string, PriceTier> = OFFICIAL_PRICES,
): Promise<AvailableProvider[]> {
  const out: AvailableProvider[] = []
  const providers = ctx.llm?.listProviders() ?? []
  for (const p of providers) {
    let models: AvailableModel[] = []
    try {
      const listed = await ctx.llm.listModels(p.id)
      models = await Promise.all(listed.map(async (m): Promise<AvailableModel> => {
        let reasoningEfforts: AvailableModel['reasoningEfforts']
        let defaultReasoningEffort: string | undefined
        try {
          const info = await ctx.llm.resolveModelInfo(p.id, m.id)
          const efforts = info?.reasoning?.efforts
          if (Array.isArray(efforts) && efforts.length > 0) {
            reasoningEfforts = efforts.map((e) => {
              const { id, name, description } = e as { id: string; name?: string; description?: string }
              return {
                id,
                name: name ?? id,
                ...(description !== undefined ? { description } : {}),
              }
            })
          }
          if (typeof info?.reasoning?.defaultEffort === 'string') {
            defaultReasoningEffort = info.reasoning.defaultEffort
          }
        } catch {
          // No reasoning metadata — leave undefined (UI falls back to the
          // fixed off/low/high/max set).
        }
        const notice = priceRouteNotice(m.id)
        return {
          id: m.id,
          name: m.name,
          priceKnown: hasPriceEntry(m.id, prices),
          priceModel: resolvePriceModel(m.id),
          ...(m.inputModalities !== undefined ? { inputModalities: [...m.inputModalities] } : {}),
          ...(reasoningEfforts !== undefined ? { reasoningEfforts } : {}),
          ...(defaultReasoningEffort !== undefined ? { defaultReasoningEffort } : {}),
          ...(notice !== null ? { notice } : {}),
        }
      }))
    } catch {
      // Adapter could not enumerate this provider — skip it.
      continue
    }
    if (models.length > 0) {
      out.push({ provider: p.id, displayName: p.name ?? p.id, models })
    }
  }
  out.sort((a, b) => (a.provider === 'deepseek-official' ? -1 : b.provider === 'deepseek-official' ? 1 : 0))
  return out
}

/** Best-effort provider lookup for a bare model id — used by old persisted
 *  tasks that carry `model` but no `modelProvider`. Returns the first
 *  registered provider whose catalog contains the id, or undefined. */
export async function inferProvider(ctx: Context, model: string): Promise<string | undefined> {
  const providers = ctx.llm?.listProviders() ?? []
  for (const p of providers) {
    try {
      const listed = await ctx.llm.listModels(p.id)
      if (listed.some((m) => m.id === model)) return p.id
    } catch {
      // Unreadable provider — keep looking.
    }
  }
  return undefined
}
