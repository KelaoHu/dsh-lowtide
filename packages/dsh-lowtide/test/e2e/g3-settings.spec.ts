/**
 * G3 (v3.3): the Lowtide settings page — the official-pricing explainer
 * with the local-timezone conversion, the 24h band preview, and the
 * one-click "adopt official hours" flow. Locale-agnostic structural
 * selectors (the page flips zh/en across runs).
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `test/screenshots/g3-${name}-light.png` })
  await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
  await page.waitForTimeout(350)
  await page.screenshot({ path: `test/screenshots/g3-${name}-dark.png` })
  await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
  await page.waitForTimeout(250)
}

test('g3: settings — official pricing explainer, local conversion, band, adopt', async ({ page, request }) => {
  test.setTimeout(120_000)

  let crashed: string | null = null
  page.on('crash', () => { crashed = 'renderer crashed' })
  page.on('pageerror', (err) => { crashed = String(err) })

  await page.goto('/')
  await page.waitForSelector('[data-shell-overlay], main', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(4000)
  expect(crashed, `renderer health: ${crashed ?? 'ok'}`).toBeNull()

  // Open the settings page (sidebar bottom button; locale-agnostic).
  await page.getByRole('button', { name: /Settings|设置/ }).first().click({ timeout: 5000 })
  await page.waitForTimeout(600)

  // The settings dialog is tabbed — open the Lowtide tab (slot label).
  await page.getByRole('button', { name: /Lowtide|闲时计划/ }).first().click({ timeout: 5000 })
  await page.waitForTimeout(1200)

  // The lowtide section card: title + official-pricing explainer.
  const section = page.locator('[data-slot="settings.section"]')
  expect(await section.count(), 'lowtide settings section mounted').toBeGreaterThan(0)
  const title = section.getByText(/官方定价说明|About the official pricing/).first()
  expect(await title.count(), 'official pricing explainer present').toBe(1)

  // Local timezone line renders the conversion ("你的本地时区" / "Your local timezone").
  const tzLine = section.getByText(/你的本地时区|Your local timezone/).first()
  expect(await tzLine.count(), 'local timezone line present').toBe(1)

  // The official-in-local range line is either identity or day-shifted — it
  // must render at least one "–" range.
  const rangeLine = section.getByText(/官方忙时在你本地|Official peak hours in your local time/).first()
  expect(await rangeLine.count(), 'official-in-local range line present').toBe(1)
  expect(await rangeLine.textContent()).toContain('–')

  await shot(page, 'settings')

  // Scrolled view: the 24h band + window editor rows (the dialog scrolls).
  await section.getByText(/价格带|price band/i).first().scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(500)
  await shot(page, 'settings-band')

  // Band preview: 48 cells with a "now" marker (title=现在/now) and axis labels.
  const nowCell = section.locator('[title="现在"], [title="now"]')
  expect(await nowCell.count(), 'band now-marker cell present').toBeGreaterThan(0)
  expect(await section.getByText('00:00').count(), 'band axis labels present').toBeGreaterThan(0)

  // One-click adopt: on a UTC+8 machine (identity) the button is disabled
  // with "已采用官方时段"; elsewhere it fills the window list with the
  // converted local segments.
  const adopt = section.getByRole('button', { name: /一键采用|Adopt official|已采用|Official hours already/ }).first()
  expect(await adopt.count(), 'adopt button present').toBe(1)
  const disabled = await adopt.isDisabled().catch(() => false)
  if (!disabled) {
    await adopt.click({ timeout: 3000 })
    await page.waitForTimeout(400)
    const rows = section.locator('input[placeholder="名称（可选）"], input[placeholder="Name (optional)"]')
    expect(await rows.count(), 'adopt fills window rows').toBeGreaterThan(0)
  }

  // Restore a clean slate: no custom windows left behind by this spec.
  const cfg = await (await request.get('/ds-lowtide/config')).json()
  if (Array.isArray(cfg?.config?.windows) && cfg.config.windows.length > 0) {
    await request.put('/ds-lowtide/config', { data: { windows: [] } })
  }
})
