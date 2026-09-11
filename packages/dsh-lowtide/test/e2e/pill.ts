/**
 * Shared helpers for specs that need the session-header price pill.
 *
 * Why this exists: the pill lives in `conversation.session.header.utilities`,
 * which the shell only renders for a conversation WITH CONTENT — an empty
 * "new session" hides the header entirely. Older specs either waited for a
 * "¥1.5/M" text (removed from the pill in the v3.1 redesign) or clicked a
 * fixed sidebar index (workspace parents merely expand), so they became
 * environment-dependent and flaky.
 *
 * `openConversation()` is deterministic: it clicks sidebar entries one by one
 * until the pill actually mounts, bounded to a handful of attempts.
 */
import { expect, type Page } from '@playwright/test'

const TIER_TEXT = /忙时|闲时|执行中|Peak hours|Off-peak|Running/

/**
 * The pill: the `Pill` primitive carries this plugin's CSS-module class
 * (`…_pill`) plus the tier word. Class-based because the primitive may render a
 * div without a button role.
 */
export function pillOf(page: Page) {
  return page.locator('[class*="pill"]').filter({ hasText: TIER_TEXT }).first()
}

/**
 * Ensure a conversation with content is open so the header (and the pill)
 * renders. Returns once the pill is visible; throws with context otherwise.
 */
export async function openConversation(page: Page, attempts = 10): Promise<void> {
  const pill = pillOf(page)
  if (await pill.count() > 0) return

  // Wait a moment first: the shell may restore the last conversation itself.
  await page.waitForTimeout(4000)
  if (await pill.count() > 0) return

  const items = page.getByRole('treeitem')
  const total = Math.min(await items.count(), attempts)
  for (let i = 0; i < total; i++) {
    await items.nth(i).click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(2500)
    if (await pill.count() > 0) return
  }
  expect(await pill.count(), 'price pill is present in the session header').toBeGreaterThan(0)
}
