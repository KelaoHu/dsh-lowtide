/**
 * Task-level model override (functional round): resolveBatchModel's model
 * override wins over the live selection; a provider override rides along.
 * The provider comes from the task when the model is non-deepseek, so a
 * batch can run on ANY connected harness model — not just the deepseek pair.
 */
import { describe, expect, test } from 'vitest'
import { resolveBatchModel } from '../src/turns.ts'

const FLASH = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
const PRO = { provider: 'deepseek-official', model: 'deepseek-v4-pro' }
const OTHER = { provider: 'deepseek-vision', model: 'deepseek-v4-vision' }
const GATEWAY = { provider: 'my-gateway', model: 'gpt-4o' }

describe('resolveBatchModel model override', () => {
  test('task model override wins, keeping the live provider when none given', () => {
    expect(resolveBatchModel(FLASH, undefined, 'deepseek-v4-pro')).toEqual(PRO)
    expect(resolveBatchModel(OTHER, undefined, 'deepseek-v4-pro')).toEqual({ provider: 'deepseek-vision', model: 'deepseek-v4-pro' })
    expect(resolveBatchModel(PRO, undefined, 'deepseek-v4-flash')).toEqual(FLASH)
  })

  test('model + provider override replaces both (custom harness providers)', () => {
    expect(resolveBatchModel(FLASH, undefined, 'gpt-4o', 'my-gateway')).toEqual(GATEWAY)
    expect(resolveBatchModel(GATEWAY, undefined, 'deepseek-v4-flash', 'deepseek-official')).toEqual(FLASH)
  })

  test('provider override without a model override is ignored (model stays live)', () => {
    expect(resolveBatchModel(FLASH, undefined, undefined, 'my-gateway')).toEqual(FLASH)
  })

  test('empty overrides behave like no override', () => {
    expect(resolveBatchModel(OTHER, undefined, '')).toEqual(OTHER)
    expect(resolveBatchModel(FLASH, undefined, 'deepseek-v4-flash', '')).toEqual(FLASH)
  })

  test('no override keeps the live selection unchanged', () => {
    expect(resolveBatchModel(OTHER)).toEqual(OTHER)
    expect(resolveBatchModel(FLASH)).toEqual(FLASH)
    expect(resolveBatchModel(PRO)).toEqual(PRO)
  })

  test('reasoning effort rides along with the override', () => {
    const r = resolveBatchModel(FLASH, 'low', 'deepseek-v4-pro')
    expect(r).toEqual({ ...PRO, reasoningEffort: 'low' })
    const g = resolveBatchModel(FLASH, 'high', 'gpt-4o', 'my-gateway')
    expect(g).toEqual({ ...GATEWAY, reasoningEffort: 'high' })
  })
})
