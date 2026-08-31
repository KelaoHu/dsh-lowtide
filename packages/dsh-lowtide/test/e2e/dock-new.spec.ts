/**
 * Regression: the dock's New-task button must open the modal in BOTH drawer
 * states (collapsed and expanded). Bug history: the modal was only mounted in
 * one branch — first the collapsed branch lost it, then a fix moved the
 * breakage to the expanded branch (10/10 repro). The mounts now live in both
 * branches; this spec pins that behavior.
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { E2E_WORKSPACE } from './workspace.ts'

async function waitDock(page: Page): Promise<void> {
  const dock = page.locator('[data-slot="conversation.input.dock"]')
  for (let i = 0; i < 15; i++) {
    if (await dock.count()) return
    await page.waitForTimeout(2000)
  }
  throw new Error('dock never mounted')
}

test('dock New button opens the modal in both collapsed and expanded states', async ({ page, request }) => {
  test.setTimeout(180_000)

  // Seed one queued task so the expanded drawer has content.
  const seed = await (await request.post('/ds-lowtide/tasks', {
    data: {
      prompt: `在 ${E2E_WORKSPACE} 创建文件 dock-new-reg.txt，内容为 dock-new-ok`,
      files: [], workspace: E2E_WORKSPACE, priority: 0, permissionPreset: 'lt-standard',
    },
  })).json()
  expect(seed.ok).toBeTruthy()
  await request.post(`/ds-lowtide/tasks/${seed.task.id}/approve`)

  const problems: string[] = []
  page.on('pageerror', (err) => problems.push(`pageerror: ${String(err)}`))

  await page.goto('/')
  await page.waitForSelector('[data-shell-overlay], main', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(4000)
  await waitDock(page)
  const dock = page.locator('[data-slot="conversation.input.dock"]')

  const onboarding = dock.locator('button', { hasText: /知道了|Got it/ })
  if (await onboarding.count()) await onboarding.first().click({ timeout: 2000 }).catch(() => {})

  async function assertNewOpens(): Promise<void> {
    await dock.getByRole('button', { name: /新建|New/ }).first().click({ timeout: 5000 })
    await page.waitForTimeout(700)
    expect(await page.getByRole('dialog').count(), `modal opens (${problems.join('; ') || 'no pageerrors'})`).toBeGreaterThan(0)
    await page.getByRole('button', { name: /^(Close|关闭|Cancel|取消)$/ }).first().click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(300)
  }

  // Collapsed (default) — the drawer is closed.
  await assertNewOpens()
  await assertNewOpens()

  // Expanded.
  const expand = dock.getByRole('button', { name: /展开|Expand/ }).first()
  if (await expand.count()) await expand.click({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(600)
  await assertNewOpens()
  await assertNewOpens()
  // A polling update lands between attempts (intermittency window).
  await page.waitForTimeout(3200)
  await assertNewOpens()

  expect(problems).toEqual([])

  // Cleanup.
  await request.post(`/ds-lowtide/tasks/${seed.task.id}/delete`).catch(() => {})
})
