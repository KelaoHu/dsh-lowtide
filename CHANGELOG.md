# Changelog

All notable changes to dsh-lowtide are documented in this file.

## [0.2.3] - 2026-09-15

### Fixed

- **Web boot failure on dsh 0.1.5 (issue #4).** The 0.2.2 client bundle
  externalised `@deepseek-ai/dsh-client-runtime/client`, a package the 0.1.5
  plugin tree no longer ships (its snapshot-store engine was promoted to
  `@deepseek-ai/dsh-client-store`). With no manifest row and no seed word for
  it, the client module loader threw
  `require("@deepseek-ai/dsh-client-runtime/client") missed the module table`
  and the whole plugin failed to load. The store engine is now imported from
  `@deepseek-ai/dsh-client-store` and **bundled into** `lib/client.js`
  (a plugin-private store needs no shared identity), so the bundle's externals
  shrink to the three words every shell generation seeds statically:
  `react`, `react/jsx-runtime`, `@deepseek-ai/dsh-client-ui-primitives`.
  Verified against a clean dsh 0.1.5-rc.1 install: every external resolves to
  a shell static module, and the served bundle contains no `dsh-client-runtime`
  reference.
- **Continuation fork path reconciled with the dsh 0.1.5 session API.**
  `Session.events` is gone in favour of `snapshotEvents()`, and the fork's
  inherited prefix length moved from `meta.seedLength` to the top-level
  `inheritedEventCount` (gated on `meta.isSeeded`). The host half now
  feature-detects the generation at runtime, so lossless fork continuation
  works on both dsh ≥ 0.1.5-rc.1 and the 0.1.1-era host inside DSH Desktop
  2.0.3.
- **`Modal` calls updated for ui-primitives 0.1.5**, which made the
  accessibility prop `closeLabel` required (it defaulted to `"Close"` before).
  All seven call sites now pass a localized label (new `modal.close` key;
  existing `detail.close` / `report.close` reused). Safe on the desktop's
  0.1.1-era Modal too — the prop already existed there with a default.
- **Two time-bomb tests pinned.** `ledger-cost` / `store-intake` asserted
  V4 Pro peak pricing with the live clock; since the dated billing route took
  effect (Beijing 2026-09-14 12:00, pro bills as flash) they failed on any run
  after the switch. Both now pin the clock before the route.

### Changed

- Build hardening: the client bundler's platform-external list is now the
  **7-word intersection seeded by every known shell generation** (react,
  react/jsx-runtime, react-dom, react-dom/client, cordis, ui-slots,
  ui-primitives); everything else `@deepseek-ai/*` must be explicitly inlined
  or the build fails. The per-package exemption for the runtime client is
  deleted — exemptions are exactly what produced #4.
- `dsh.client.inject` pruned to the services the client actually waits on
  (`locale`, `ui-conversation`, `ui-settings`, `connection`).
- Dev/peer dependencies moved to the 0.1.5 line (`^0.1.5-rc.1`);
  `dsh-client-runtime` and the unused `dsh-host-apiproxy` dropped,
  `dsh-client-store` + `dsh-client-ui-renderer` (types-only: the 0.1.5 home of
  the `ctx.slots` augmentation) added.

### Compatibility

- dsh CLI **≥ 0.1.5-rc.1** (verified on a clean isolated install: manifest
  row, loader replay, host endpoints) and **DSH Desktop 2.0.3** (0.1.1-era
  shell — its seed table covers the three externals, and the session fork
  shim targets its API generation). Older 0.1.1-era CLI shells share the
  desktop's seed table and should behave the same, but only the two targets
  above are tested.

## [0.2.2] - 2026-09-11

### Fixed

- **Price pill no longer freezes (the reported bug).** The session-header
  闲时/忙时 indicator was a pure mirror of the host's pushed snapshot, and the
  client disabled its 4s polling the moment the EventSource reported `open` —
  with no freshness check. One silently stalled stream (host restart leaving a
  half-open socket, a hidden/frozen Electron window, system sleep, a swapped or
  capped SSE client) froze the indicator indefinitely while the clock moved on,
  and `connected === false` was invisible while a snapshot existed.
  - The displayed tier is now derived **locally** from the host's windows and
    this machine's clock (`client/lib/tierClock.ts`, using the very same
    `levelAt` from `lowtide-core`), recomputed on every frame, on a 30s
    heartbeat, and exactly at the next window boundary.
  - A **watchdog** demotes a silent-but-open stream after 45s, re-enables the
    polling fallback, and reconnects with 5s→60s backoff; the host now also
    sends an SSE `retry: 5000` hint.
  - Staleness is **visible**: the pill's dot switches to the warning state and
    the tooltip reports how old the pushed data is.
  - The same clock now drives the intercept card's busy/idle decision, and the
    24h price band's "now" marker ticks on its own (it used to be computed once
    per render).
  - Host side: a throwing `statePayload()` can no longer reject the
    fire-and-forget broadcast (which silently killed the heartbeat); SSE
    clients are also dropped on socket `error`, not just `close`.
- **Broken theme token fixed** (found by the `css-vars` e2e check): the task
  detail's resume warning used `--dsw-alias-state-warning-primary`, a token the
  host theme does not define (the real one is `--dsw-alias-state-warn-primary`),
  so the warning silently rendered with an inherited colour.
- **e2e specs made self-sufficient** (they assumed a restored conversation):
  an empty "new session" hides the session header, so `g4-window-editor`
  (which clicked a workspace node) and `g1-screens` (which waited for the
  removed `"/M"` price text) could never reach the pill. Both now use the new
  shared `test/e2e/pill.ts` helper (`pillOf()` + `openConversation()`, which
  opens conversations until the pill actually mounts); `g6-pill-clock` uses it
  too.

### Changed

- **DeepSeek official table refreshed to the 2026-09-10 V4.1-Flash release**
  (sourced from api-docs.deepseek.com): the flash row is now 2 / 0.04 / 8 (peak)
  and 1 / 0.02 / 4 (off-peak) ¥ per 1M tokens; V4 Pro keeps 9 / 0.3 / 27 and
  4.5 / 0.15 / 13.5. Peak hours are unchanged (Beijing weekdays 09:00–12:00 and
  14:00–18:00; weekends entirely off-peak).
- **Model naming**: `deepseek-flash` (DeepSeek-V4.1-Flash) is the canonical
  flash id. The retired ids `deepseek-v4-flash` and
  `deepseek-v4-flash-vision-exp` are kept as **aliases** (DeepSeek routes their
  requests to V4.1-Flash and bills Flash prices), so existing tasks and Harness
  catalogs stay priced instead of falling back to "价格未知".
- **Dated billing route**: from Beijing 2026-09-14 12:00 (04:00Z) every
  `deepseek-v4-pro` request is billed as Flash — the ledger follows the official
  routing, and `/ds-lowtide/models` exposes the notice in the UI.
- Hard-coded model ids are gone from the client: the new-task modal follows the
  live selection, the intercept card follows the live model, and the price-table
  editor lists the union of the official table, the live Harness catalog and any
  user override — a future DeepSeek rename needs no code change.
- `settings.officialBody` (zh/en) rewritten for the 2026-09-10 scheme; a new
  drift notice appears when the saved windows no longer match the official
  hours, next to the existing one-click "adopt official hours" action.
- Task reasoning efforts are fenced for `deepseek-official`: anything outside
  the adapter's wire set (off/low/high/max) is dropped instead of being sent —
  `dsh-llm-deepseek` throws `UNSUPPORTED_REASONING_EFFORT` for it.
- The `permission.presets` row patch now documents its binding to the
  `dsh-base` version (a row patch replaces the whole config).
- Versions aligned at 0.2.2 across the root, `lowtide-core` and the plugin;
  release tarballs (`packages/*/*.tgz`) are gitignored.
- `dev` script moved to `@deepseek-ai/dsh@0.1.5-rc.1`; devDependencies stay on
  the verified `^0.1.0-rc.7` line (satisfied by both the 0.1.1-rc.2 and the
  0.1.5-rc.1 runtimes).

### Tests

- Core: 54 cases (new: legacy-id aliases, the V4 Pro routing boundary at
  2026-09-14 03:59:59Z / 04:00:00Z, `nextLevelChangeAt` boundaries, weekends and
  midnight-crossing windows).
- Plugin: 178 cases (new `test/tier-clock.test.ts` pins the fix — a 17:59:30
  clock flips to 闲时 just after 18:00 with **zero** server frames, the 30s
  heartbeat catches a late boundary, config edits re-derive immediately, and
  `stop()` cancels both timers).

## [0.2.1] - 2026-09-01

### Fixed

- Marketplace installation failure reported after the v0.2.0 release:
  installers fetching the plugin through the `releases/latest` download URL
  could receive a stale cached tarball (0.1.3), which broke pnpm's install
  and left the profile inconsistent. Install/update via the versioned URL
  `releases/download/v0.2.1/dsh-lowtide.tgz` (or the marketplace once
  catalogued). No functional changes versus 0.2.0.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-01

### Added

- In-place task editing: queued tasks can be revised after submission
  (prompt, strategy, model, workspace, locked files) while keeping their id,
  status and triage history. Editing re-runs the intake pipeline — fresh
  sha256 snapshots, fresh git ref, new estimate — and the five pre-run
  preflight checks still gate the batch at run time. Edit audit counters
  track how often a task was edited.
- Penetration test suite (`test/pentest/`, 30 cases) covering the trust
  fence, path confinement, config bounds, body/SSE/file-size limits and
  git-hook abuse.

### Changed

- Monorepo package directory renamed `packages/dsh` → `packages/dsh-lowtide`
  to match the package identity. Plugin id, routes, state file and npm name
  are unchanged — zero migration for existing installs.
- Reasoning-effort picker shows each model's own adapter-declared labels
  verbatim (e.g. the model's native "Low"/"High") instead of generic
  translations.

### Security

- git calls now disable `core.fsmonitor`: a malicious workspace could point
  the hook at an executable and achieve RCE during read-only git commands.
- Locked files are confined to the workspace via realpath resolution —
  `../../` traversal and in-workspace symlinks pointing outside are rejected.
- Config updates enforce bounds: non-negative prices/budget, positive
  multiplier, sane batch limits, ISO weekday 1–7, IANA timezone validation.
- Request body capped at 1MB (413), SSE connections capped at 16 (429),
  locked-file snapshots capped at 64MB with streamed hashing.
- 500 responses no longer echo internal error text; state file is
  owner-only (0600) on posix.
- Threat model documented in SECURITY.md (loopback trust boundary).

## [0.1.1] - 2026-08-23

### Added

- Weekend all-day off-peak pricing support (DeepSeek pricing update of
  2026-08-23): weekends are off-peak all day, peak windows apply to weekdays
  only.
- Peak-cost baseline (`peakCostOf`) for the savings figure: only models with
  a real price entry (official table or user override) report savings;
  unknown models report 0 instead of fabricated numbers.
- Per-task batch model picker: any model connected to the local Harness
  (including custom providers), grouped by provider.
- Bilingual README (English + 简体中文) with interface screenshots.

### Fixed

- English UI copy: removed a stray Chinese fragment in the iterative-strategy
  placeholder text.
- `types` field of `dsh-lowtide` now points at the actual declaration output
  (`lib/types/src/index.d.ts`).

## [0.1.0] - 2026-08

### Added

- Initial release candidate: human-adjudicated off-peak batch pipeline for
  DeepSeek Harness (dsh), desktop and web.
- Six UI surfaces: price pill, peak-hours intercept card, queue dock, batch
  confirm gate, execution report, settings section, plus the new-task modal.
- Four execution strategies: single / iterative / sampling / review.
- Three autonomy levels (L1 per-task / L2 batch / L3 full-auto) with
  per-task override.
- Custom busy/idle windows with local-timezone semantics and a live 24h
  price band; one-click adoption of official peak hours.
- Preflight gates (workspace, git HEAD snapshot, locked-file sha256, window
  fit, daily budget); atomic, self-healing state persistence.
- 168 unit tests + 10 Playwright e2e specs.
