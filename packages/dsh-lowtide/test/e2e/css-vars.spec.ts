import { test, expect } from '@playwright/test'

/**
 * PLAN §9 visual acceptance vehicle: every var(--…) referenced by the plugin
 * client bundle must resolve in the host's computed style (no silent token
 * fallbacks). Fetches the served bundle, extracts the reference set, and
 * checks each against the live document's computed custom properties.
 */
test('every var() reference in the client bundle resolves in the host theme', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(8000)

  const bundle = await page.evaluate(async () => {
    const res = await fetch('/plugins/dsh-lowtide/client.js')
    return await res.text()
  })

  const refs = [...new Set([...bundle.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map((m) => m[1]!))]
  const missing: string[] = []
  for (const name of refs) {
    const resolved = await page.evaluate((n) => {
      const value = getComputedStyle(document.body).getPropertyValue(n)
      return value.trim()
    }, name)
    if (resolved === '') missing.push(name)
  }
  expect(refs.length).toBeGreaterThan(0)
  expect(missing, `unresolved tokens: ${missing.join(', ')}`).toEqual([])
})
