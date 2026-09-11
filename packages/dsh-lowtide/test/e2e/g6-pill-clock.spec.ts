/**
 * G6 (v0.2.2 regression): the header price pill must follow the LOCAL clock
 * even when the host push stream and the polling fallback are both dead —
 * the reported bug ("the pill does not change with the host's time").
 *
 * Method (no fake clock, real time, decisive):
 *   1. install a peak window that ends ~70s from now (so the boundary is close),
 *   2. let the SSE stream deliver that config (the pill reads 忙时),
 *   3. CUT the client off completely — abort both `/ds-lowtide/events` and
 *      `/ds-lowtide/state` — so no further host data can ever arrive,
 *   4. wait for the boundary: if the pill flips to 闲时, only the client-side
 *      tier clock (lib/tierClock.ts) can have done it.
 *
 * Pre-0.2.2 this test fails: the pill kept rendering the last pushed snapshot.
 *
 * Runs against the live instance at playwright.config.ts's baseURL (the canary
 * profile during the v0.2.2 test install). It only touches that instance's
 * config, and restores the official windows at the end.
 */
import { expect, test } from '@playwright/test'
import { openConversation, pillOf } from './pill.ts'

const PEAK_TEXT = /忙时|Peak hours/
const OFF_TEXT = /闲时|Off-peak/

/** "HH:MM" in the machine's local time (window configs without tz are local). */
function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

test('g6: the pill follows the local clock after the push stream dies', async ({ page, request }) => {
  test.setTimeout(300_000)

  // ── 1. a peak window that ends ~70s from now ───────────────────────────────
  const now = new Date()
  const end = new Date(now.getTime() + 70_000)
  const original = await request.get('/ds-lowtide/config')
  expect(original.ok()).toBe(true)
  const originalConfig = (await original.json()).config as Record<string, unknown>

  const put = await request.put('/ds-lowtide/config', {
    data: {
      windows: [{
        id: 'g6-boundary',
        level: 'peak',
        start: hhmm(new Date(now.getTime() - 120_000)),
        end: hhmm(end),
      }],
    },
  })
  expect(put.ok(), 'config write accepted').toBe(true)

  try {
    // ── 2. let the host push the new windows, then confirm 忙时 ──────────────
    await page.goto('/')
    await openConversation(page)
    const pill = pillOf(page)
    await expect(pill, 'pill shows the busy tier while inside the configured peak window')
      .toContainText(PEAK_TEXT, { timeout: 60_000 })

    // ── 3. cut the client off: no SSE frames, no polling ────────────────────
    await page.route('**/ds-lowtide/events', (route) => route.abort())
    await page.route('**/ds-lowtide/state', (route) => route.abort())

    // ── 4. cross the boundary with zero host traffic ────────────────────────
    const remaining = Math.max(end.getTime() - Date.now(), 0) + 20_000
    await page.waitForTimeout(remaining)
    await expect(pill, 'pill flipped to off-peak from the LOCAL clock alone')
      .toContainText(OFF_TEXT, { timeout: 30_000 })
  } finally {
    // Restore the official/default windows so the instance is left as found.
    await request.put('/ds-lowtide/config', {
      data: { windows: (originalConfig as { windows?: unknown }).windows ?? [] },
    }).catch(() => {})
  }
})
