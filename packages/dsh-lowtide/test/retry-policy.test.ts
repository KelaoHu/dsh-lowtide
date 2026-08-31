/**
 * Retry-policy round: a user hitting "stop generating" aborts the turn — the
 * runner must NOT auto-retry it (a retry would silently turn a deliberate
 * stop into a new LLM call, and with an exhausted account that surfaces as a
 * misleading 402). Quota/balance rejections are likewise not retried.
 */
import { describe, expect, test } from 'vitest'
import { isQuotaError } from '../src/runner.ts'

describe('isQuotaError', () => {
  test('deepseek 402 payloads are quota errors', () => {
    expect(isQuotaError('turn failed: 402: {"code":"402","message":"Insufficient account balance","type":"insufficient_balance"} [QUOTA]')).toBe(true)
    expect(isQuotaError('402: Insufficient account balance')).toBe(true)
    expect(isQuotaError('insufficient_balance')).toBe(true)
  })

  test('generic errors are not quota errors', () => {
    expect(isQuotaError('turn failed: model does not support reasoning effort "max"')).toBe(false)
    expect(isQuotaError('timeout after 20min')).toBe(false)
    expect(isQuotaError('attempt crashed: TypeError: x')).toBe(false)
  })

  test('undefined/empty errors are never quota errors', () => {
    expect(isQuotaError(undefined)).toBe(false)
    expect(isQuotaError('')).toBe(false)
  })
})
