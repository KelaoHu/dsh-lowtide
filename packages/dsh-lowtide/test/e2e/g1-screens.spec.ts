/**
 * G1 six-surface screenshots (PLAN §13.3 G1 + §16.0.4): light + dark pairs.
 * ① PricePill ② InterceptCard ③ QueueDock ④ MorningReport
 * ⑤ queue while a batch is running ⑥ morning report (detail view).
 *
 * Preconditions (set up by the runner script, not by this spec):
 * - `dsh web` is live at baseURL with the client bundle rebuilt;
 * - the store holds e2e leftovers (done tasks + a report);
 * - config.windows contains a peak window covering NOW and today's
 *   intercept is NOT dismissed;
 * - there is at least one session in the host.
 *
 * Review round 1 notes:
 * - selectors are LOCALE-AGNOSTIC (structural slots + exact regex names):
 *   the page's active locale flipped between zh/en across runs;
 * - the interception keys off the LIVE DRAFT (intercept-draft.ts): an empty
 *   draft keeps the native composer + queue dock visible; typing claims the
 *   composer. The input draft persists per session, so the spec ✕-dismisses
 *   any active intercept before the dock steps and re-arms it for ②.
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { E2E_WORKSPACE } from './workspace.ts'

// Human-review copy of the screenshots (machine-independent).
const OUT = join(tmpdir(), 'g1-screens')
const DOCK = '[data-slot="conversation.input.dock"]'

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `test/screenshots/g1-${name}-light.png` })
  await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
  await page.waitForTimeout(350)
  await page.screenshot({ path: `test/screenshots/g1-${name}-dark.png` })
  await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
  await page.waitForTimeout(250)
}

/** The price pill only renders inside a live session header. */
async function openSession(page: Page): Promise<void> {
  const fallbackTitle = process.env.LOWTIDE_E2E_SESSION_TITLE
  for (let i = 0; i < 15; i++) {
    if ((await page.getByText(/\/M/).count()) > 0) return
    await page.waitForTimeout(2000)
  }
  // Optional fallback: pin a host session title via LOWTIDE_E2E_SESSION_TITLE
  // so the pill can be reached when no session is currently open.
  if (fallbackTitle !== undefined && fallbackTitle.trim() !== '') {
    await page.getByText(fallbackTitle.trim()).first().click()
    await page.waitForTimeout(6000)
  }
  expect(await page.getByText(/\/M/).count()).toBeGreaterThan(0)
}

/** Dismiss an active intercept card (✕) so the native composer + dock show. */
async function dismissIntercept(page: Page): Promise<void> {
  const close = page.locator('[data-slot="conversation.composer"] button[title]').first()
  for (let i = 0; i < 8; i++) {
    if (await close.isVisible().catch(() => false)) {
      await close.click({ timeout: 3000 })
      await page.waitForTimeout(800)
    }
    if (await page.locator(DOCK).locator('button').last().isVisible().catch(() => false)) return
    await page.waitForTimeout(1000)
  }
}

test('g1: six surfaces, light + dark', async ({ page, request }) => {
  test.setTimeout(300_000)

  let crashed: string | null = null
  page.on('crash', () => { crashed = 'renderer crashed' })
  page.on('pageerror', (err) => { crashed = String(err) })

  await page.goto('/')
  await page.waitForSelector('[data-shell-overlay], main', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(4000)
  expect(crashed, `renderer health before interactions: ${crashed ?? 'ok'}`).toBeNull()
  await openSession(page)

  // ① PricePill — session header utility.
  await shot(page, '01-pricepill')

  // The dock lives inside the native input area; an active intercept (the
  // input draft persists per session) hides it — dismiss the card first.
  await dismissIntercept(page)

  const dock = page.locator(DOCK)
  // First-use onboarding banner: dismiss for clean screenshots.
  const onboarding = dock.locator('button', { hasText: /知道了|Got it/ })
  if (await onboarding.count()) { await onboarding.first().click({ timeout: 2000 }).catch(() => {}) }
  await page.waitForTimeout(300)

  // ③ QueueDock — expand the drawer (queue holds the e2e leftovers).
  await dock.locator('button').last().click() // Expand / Collapse toggle
  await page.waitForTimeout(800)
  await shot(page, '03-queuedock')

  // ④ MorningReport — opened from the dock's first action (Report).
  await dock.locator('button').first().click()
  await page.waitForTimeout(800)
  expect(await page.getByRole('dialog').count(), 'report modal opens').toBeGreaterThan(0)
  await shot(page, '04-morningreport')
  await page.getByRole('button', { name: /^(Close|关闭)$/ }).first().click()
  await page.waitForTimeout(400)

  // ⑥ Morning report detail — reopen (same modal, fresh render).
  await dock.locator('button').first().click()
  await page.waitForTimeout(800)
  await shot(page, '06-reportdetail')
  await page.getByRole('button', { name: /^(Close|关闭)$/ }).first().click()
  await page.waitForTimeout(400)

  // ⑤ Queue while a batch is running: submit + approve + run-now, then shoot.
  const t = await (await request.post('/ds-lowtide/tasks', {
    data: {
      prompt: `在 ${E2E_WORKSPACE} 创建文件 gamma.txt，内容为 gamma-ok，不要写其他文件`,
      files: [],
      workspace: E2E_WORKSPACE,
      priority: 0,
      permissionPreset: 'lt-standard',
    },
  })).json()
  expect(t.ok).toBeTruthy()
  await request.post(`/ds-lowtide/tasks/${t.task.id}/approve`)
  await request.post('/ds-lowtide/batch/run-now')
  const start = Date.now()
  while (Date.now() - start < 30_000) {
    const s = await (await request.get('/ds-lowtide/state')).json()
    if (s.batch.running) break
    await page.waitForTimeout(400)
  }
  await page.waitForTimeout(500)
  await shot(page, '05-batchrunning')

  // ② InterceptCard — re-arm this page-session interception (the ✕ above set
  //    the session flag), then type a draft so the compare renders and the
  //    card claims the composer on the next owner re-render.
  await page.evaluate(() => {
    sessionStorage.removeItem('dsh-lowtide:intercept-session-dismissed')
  })
  await page.locator('textarea:visible').first().fill('重构 auth.ts 的错误处理并跑一遍测试')
  await page.waitForTimeout(600)
  await shot(page, '02-interceptcard')

  // Ship the screenshots before anything can clear them.
  mkdirSync(OUT, { recursive: true })
  let copied = 0
  for (const f of readdirSync('test/screenshots')) {
    if (f.startsWith('g1-')) {
      copyFileSync(join('test/screenshots', f), join(OUT, f))
      copied += 1
    }
  }
  expect(copied).toBe(12)
})
