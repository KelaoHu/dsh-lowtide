/**
 * G4 (v4): the pill's window editor — click the header status pill to open
 * the 闲时/忙时 editor, edit segments in local time, save, and verify the
 * config round-trips. Locale-agnostic structural selectors.
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `test/screenshots/g4-${name}-light.png` })
  await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
  await page.waitForTimeout(350)
  await page.screenshot({ path: `test/screenshots/g4-${name}-dark.png` })
  await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
  await page.waitForTimeout(250)
}

test('g4: pill window editor — open, edit, save, round-trip', async ({ page, request }) => {
  test.setTimeout(120_000)

  let crashed: string | null = null
  page.on('crash', () => { crashed = 'renderer crashed' })
  page.on('pageerror', (err) => { crashed = String(err) })

  await page.goto('/')
  await page.waitForSelector('[data-shell-overlay], main', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(4000)
  expect(crashed, `renderer health: ${crashed ?? 'ok'}`).toBeNull()

  // The pill is the session header status button (text = 闲时/忙时/Off-peak/
  // Peak/Running). It only exists inside an OPEN session.
  const pill = page.getByRole('button', { name: /Off-peak|闲时|Peak|忙时|Running|执行中/ }).first()
  for (let i = 0; i < 15; i++) {
    if (await pill.count()) break
    if (i === 4 && (await page.getByRole('treeitem').count()) > 0) {
      await page.getByRole('treeitem').nth(1).click({ timeout: 3000 }).catch(() => {})
    }
    await page.waitForTimeout(2000)
  }
  expect(await pill.count(), 'pill mounted').toBeGreaterThan(0)

  // Click the pill → editor modal opens.
  await pill.click({ timeout: 5000 })
  await page.waitForTimeout(700)
  const dialogs = page.getByRole('dialog')
  expect(await dialogs.count(), 'editor modal opens').toBeGreaterThan(0)

  // The editor title + local-time hint render.
  const title = page.getByText(/闲时 \/ 忙时时段|Off-peak \/ peak windows/).first()
  expect(await title.count(), 'editor title').toBe(1)
  const tzLine = page.getByText(/你的本地时间|local timezone/).first()
  expect(await tzLine.count(), 'local-tz hint').toBe(1)

  await shot(page, 'editor-default')

  // Add a peak segment 20:00–22:00 (empty config on this machine → the
  // editor may prefill official segments; we append one more row).
  await page.getByRole('button', { name: /添加一段|Add segment/ }).first().click({ timeout: 3000 })
  await page.waitForTimeout(300)
  // The new row is the last one: set its times via the row's time inputs.
  const lastRowInputs = page.locator('input[type="time"]')
  const inputCount = await lastRowInputs.count()
  expect(inputCount, 'time inputs present').toBeGreaterThanOrEqual(2)
  await lastRowInputs.nth(inputCount - 2).fill('20:00')
  await lastRowInputs.nth(inputCount - 1).fill('22:00')
  await page.waitForTimeout(200)

  // Save.
  await page.getByRole('button', { name: /^保存$|^Save$/ }).first().click({ timeout: 5000 })
  await page.waitForTimeout(800)
  expect(await dialogs.count(), 'editor closes after save').toBe(0)

  // Round-trip: the config now carries the edited segments.
  const cfg = await (await request.get('/ds-lowtide/config')).json()
  const windows: Array<{ level: string; start: string; end: string }> = cfg?.config?.windows ?? []
  const edited = windows.find((w) => w.start === '20:00' && w.end === '22:00')
  expect(edited, 'edited segment persisted').toBeTruthy()

  // Restore a clean slate.
  await request.put('/ds-lowtide/config', { data: { windows: [] } })
})
