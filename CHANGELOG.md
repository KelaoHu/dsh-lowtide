# Changelog

All notable changes to dsh-lowtide are documented in this file.

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
