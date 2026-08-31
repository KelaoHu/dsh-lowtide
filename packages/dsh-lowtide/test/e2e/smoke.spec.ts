import { test, expect } from '@playwright/test'

/**
 * T0.1 client-side acceptance (PLAN W4): the dsh-lowtide client bundle
 * materializes in the web shell — console shows the client-half log, no
 * boot errors, and both themes render. Run against a live `dsh web`.
 */
test('client half materializes in the web shell', async ({ page }) => {
  const logs: string[] = []
  const errors: string[] = []
  page.on('console', (msg) => logs.push(msg.text()))
  page.on('pageerror', (err) => errors.push(String(err)))

  await page.goto('/')
  await page.waitForTimeout(10_000)

  const found = logs.some((l) => l.includes('[dsh-lowtide] client half loaded'))
  expect(found, `console logs: ${logs.join('\n')}`).toBeTruthy()
  expect(errors).toEqual([])

  await page.screenshot({ path: 'test/screenshots/t01-light.png' })
  await page.evaluate(() => {
    document.body.setAttribute('data-ds-dark-theme', '')
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test/screenshots/t01-dark.png' })
})
