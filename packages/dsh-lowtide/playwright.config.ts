import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  // Serial: full-loop and strategies both drive /batch/run-now against the
  // same scheduler — parallel workers would race the batch runner (the
  // suite is small; determinism beats speed here).
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3080',
    viewport: { width: 1440, height: 900 },
    // Review round 1: the G1 run crashed the renderer during a blind wait on
    // this machine — disabling GPU compositing avoids the most common Windows
    // Chromium renderer crash class (OOM/GPU).
    launchOptions: {
      args: ['--disable-gpu'],
    },
  },
  reporter: [['list']],
  // Keep failures/traces out of the screenshots dir: outputDir is wiped on
  // every run, but test/screenshots holds review artifacts for humans.
  outputDir: 'test-results',
})
