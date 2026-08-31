# Contributing to dsh-lowtide

Thanks for your interest! dsh-lowtide is a plugin for
[DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh). This document
covers how to build, test, and submit changes.

## Repository layout

```
packages/
  core/   # Platform-agnostic logic: windows/pricing/model/digest/scheduler/ledger
  dsh/    # The dsh plugin: host half (src/) + web client (client/) + tests
```

- `packages/core` has no dsh dependency and is fully unit-testable.
- `packages/dsh-lowtide` depends on the dsh runtime (`@deepseek-ai/*`) for both its
  host services and its client bundle.

## Prerequisites

- Node.js `^22.19.0 || >=24.0.0` (see root `package.json`)
- pnpm `11.x`
- All runtime dependencies (`@deepseek-ai/*`) are published on the public npm
  registry; no private registry is required.

## Build & test

```bash
pnpm install

# Build both packages (required before testing: the plugin's unit tests
# resolve lowtide-core via its built output at packages/core/lib)
pnpm build

# Type-check everything
pnpm typecheck

# Run the full unit test suite (core + plugin)
pnpm test
```

Individual package scripts:

```bash
pnpm --filter lowtide-core typecheck|test|bundle
pnpm --filter dsh-lowtide typecheck|test|bundle
```

## Manual testing inside dsh

To run the plugin inside a live dsh web instance:

```bash
# Link-install the plugin into a dsh profile, then
pnpm --filter dsh-lowtide dev        # runs `dsh web --patch ./cordis.dev.yml`
```

The e2e suite (`packages/dsh-lowtide/test/e2e`) additionally requires a running dsh
web instance and real model access — see `playwright.config.ts` and the spec
headers for preconditions.

## Coding conventions

- TypeScript strict; no `any` unless unavoidable (prefer a narrow cast).
- Chinese user-facing copy lives in `packages/dsh-lowtide/client/i18n.ts` (zh + en
  must stay key-identical).
- New behavior must ship with unit tests in `packages/<pkg>/test/`.
- Keep `packages/core` free of dsh imports.

## Pull request process

1. Fork the repository and create a feature branch.
2. Make your change; add/adjust tests.
3. Run `pnpm typecheck` and `pnpm test` locally — both must pass.
4. Open a pull request using the template; describe the motivation and the
   verification you ran.

## Reporting issues

Use the issue templates: bug reports need a reproduction (harness version,
plugin version, steps), feature requests should describe the user problem
before the proposed solution.
