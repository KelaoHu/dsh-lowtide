/**
 * G2 (temporary, v3.1): the NewTaskModal — default single view + the review
 * strategy selected (pills, guidance textarea, priority 0–9, advanced
 * collapsible). Locale-agnostic structural selectors.
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `test/screenshots/g2-${name}-light.png` })
  await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
  await page.waitForTimeout(350)
  await page.screenshot({ path: `test/screenshots/g2-${name}-dark.png` })
  await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
  await page.waitForTimeout(250)
}

test('g2: new task modal, default + review strategy', async ({ page }) => {
  test.setTimeout(120_000)

  let crashed: string | null = null
  page.on('crash', () => { crashed = 'renderer crashed' })
  page.on('pageerror', (err) => { crashed = String(err) })

  await page.goto('/')
  await page.waitForSelector('[data-shell-overlay], main', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(4000)
  expect(crashed, `renderer health: ${crashed ?? 'ok'}`).toBeNull()

  // Open a session (pill appears only inside a live session header).
  const dock = page.locator('[data-slot="conversation.input.dock"]')
  for (let i = 0; i < 15; i++) {
    if (await dock.count()) break
    await page.waitForTimeout(2000)
  }
  expect(await dock.count(), 'dock mounted').toBeGreaterThan(0)

  // Open the modal from the dock's new-task button (locale-agnostic).
  const newBtn = dock.getByRole('button', { name: /新建|New/ }).first()
  await newBtn.click({ timeout: 5000 })
  await page.waitForTimeout(600)
  expect(await page.getByRole('dialog').count(), 'modal opens').toBeGreaterThan(0)

  // ① default single strategy.
  await shot(page, 'modal-single')

  // ② review strategy selected — pills + guidance textarea + no rounds row.
  // Locale-agnostic: the page flips zh/en across runs.
  const reviewPill = page.getByText(/复核|Review/, { exact: true }).first()
  if (await reviewPill.count()) {
    await reviewPill.click({ timeout: 3000 })
    await page.waitForTimeout(500)
    await shot(page, 'modal-review')
  } else {
    await shot(page, 'modal-review-placeholder')
  }

  // ③ advanced: the gear button opens a separate SMALL WINDOW stacked on the
  // main modal; Done closes only that window.
  const advanced = page.getByRole('button', { name: /高级|Advanced/ }).first()
  if (await advanced.count()) {
    await advanced.click({ timeout: 3000 })
    await page.waitForTimeout(500)
    expect(await page.getByRole('dialog').count(), 'advanced window stacks on the main modal').toBe(2)
    await shot(page, 'modal-advanced')
    await page.getByRole('button', { name: /完成|Done/ }).first().click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(300)
    expect(await page.getByRole('dialog').count(), 'Done closes only the advanced window').toBe(1)
  }

  await page.getByRole('button', { name: /^(Close|关闭)$/ }).first().click().catch(() => {})
})
