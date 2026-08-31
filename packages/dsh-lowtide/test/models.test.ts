/**
 * Available-model enumeration (functional round): listAvailableModels reads
 * the llm service catalog (listProviders + listModels) instead of hard-coding
 * the deepseek pair, marks price knowledge from the official/override table,
 * and tolerates unreadable providers. inferProvider locates the owning
 * provider of a bare model id (old persisted tasks).
 */
import { describe, expect, test } from 'vitest'
import { OFFICIAL_PRICES } from 'lowtide-core'
import type { Context } from '@deepseek-ai/cordis'
import { inferProvider, listAvailableModels } from '../src/models.ts'

interface FakeLlm {
  listProviders(): Array<{ id: string; name: string }>
  listModels(provider: string): Promise<unknown[]>
}

function ctxWith(providers: Array<{ id: string; name: string }>, modelsOf: (provider: string) => unknown[]): Context {
  const llm: FakeLlm = {
    listProviders: () => providers.map((p) => ({ id: p.id, name: p.name })),
    listModels: async (provider: string) => modelsOf(provider),
  }
  return { llm } as unknown as Context
}

describe('listAvailableModels', () => {
  test('lists deepseek official + custom provider models, deepseek first', async () => {
    const ctx = ctxWith(
      [
        { id: 'my-gateway', name: 'My Gateway' },
        { id: 'deepseek-official', name: 'DeepSeek' },
      ],
      (p) => p === 'deepseek-official'
        ? [
            { provider: p, id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
            { provider: p, id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
          ]
        : [{ provider: p, id: 'gpt-4o', name: 'GPT-4o' }],
    )
    const out = await listAvailableModels(ctx, OFFICIAL_PRICES)
    expect(out.map((p) => p.provider)).toEqual(['deepseek-official', 'my-gateway'])
    expect(out[0].displayName).toBe('DeepSeek')
    expect(out[0].models.map((m) => m.id)).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
    expect(out[0].models.every((m) => m.priceKnown)).toBe(true)
    expect(out[1].models[0]).toMatchObject({ id: 'gpt-4o', name: 'GPT-4o', priceKnown: false })
  })

  test('skips providers whose catalog cannot be read', async () => {
    const ctx = ctxWith(
      [
        { id: 'deepseek-official', name: 'DeepSeek' },
        { id: 'broken', name: 'Broken' },
      ],
      (p) => {
        if (p === 'broken') throw new Error('no adapter')
        return [{ provider: p, id: 'deepseek-v4-flash', name: 'Flash' }]
      },
    )
    const out = await listAvailableModels(ctx)
    expect(out.map((p) => p.provider)).toEqual(['deepseek-official'])
  })

  test('carries input modalities when the adapter declares them', async () => {
    const ctx = ctxWith(
      [{ id: 'deepseek-official', name: 'DeepSeek' }],
      () => [
        { provider: 'deepseek-official', id: 'deepseek-v4-flash-vision-exp', name: 'Vision', inputModalities: ['text', 'image'] },
      ],
    )
    const out = await listAvailableModels(ctx)
    expect(out[0].models[0].inputModalities).toEqual(['text', 'image'])
  })

  test('empty catalog means the provider is dropped', async () => {
    const ctx = ctxWith([{ id: 'deepseek-official', name: 'DeepSeek' }], () => [])
    const out = await listAvailableModels(ctx)
    expect(out).toEqual([])
  })
})

describe('inferProvider', () => {
  test('finds the owning provider of a bare model id', async () => {
    const ctx = ctxWith(
      [
        { id: 'deepseek-official', name: 'DeepSeek' },
        { id: 'my-gateway', name: 'My Gateway' },
      ],
      (p) => p === 'deepseek-official'
        ? [{ provider: p, id: 'deepseek-v4-flash', name: 'Flash' }]
        : [{ provider: p, id: 'gpt-4o', name: 'GPT-4o' }],
    )
    expect(await inferProvider(ctx, 'gpt-4o')).toBe('my-gateway')
    expect(await inferProvider(ctx, 'deepseek-v4-flash')).toBe('deepseek-official')
    expect(await inferProvider(ctx, 'nope')).toBeUndefined()
  })

  test('skips unreadable providers while searching', async () => {
    const ctx = ctxWith(
      [
        { id: 'broken', name: 'Broken' },
        { id: 'my-gateway', name: 'My Gateway' },
      ],
      (p) => {
        if (p === 'broken') throw new Error('no adapter')
        return [{ provider: p, id: 'gpt-4o', name: 'GPT-4o' }]
      },
    )
    expect(await inferProvider(ctx, 'gpt-4o')).toBe('my-gateway')
  })
})
