<div align="center">

# dsh-lowtide

**Queue tasks when it's busy. They run on their own when it's cheap.**

<sub>Semi-auto or full-auto, off the model's peak hours and peak prices. A must-have plugin for DeepSeek Harness.</sub>

**English** | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-HK.md) | [العربية](./docs/README.ar.md) | [Deutsch](./docs/README.de.md) | [Español](./docs/README.es.md) | [Français](./docs/README.fr.md) | [Italiano](./docs/README.it.md) | [한국어](./docs/README.ko.md)

<img src="./assets/overview.png" alt="lowtide overview" width="100%">

</div>

---

![hero](./assets/screenshots/hero.png)

<p align="center"><i>Three tasks waiting in the queue, the price status glowing in the session header, auto-run when your window opens</i></p>

## Introduction

lowtide is a plugin for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh). The problem it solves is plain and perfectly natural:

Usually, when you want an agent to do some work, you sit at the computer, send the agent an instruction, wait for the reply, and then review it by hand. But this workflow seems to forget that you have plenty of idle time — and a chance to dodge the peak/off-peak pricing that some models charge.

With lowtide installed, the day goes like this: whenever a job crosses your mind during the day, toss it in the queue, glance at it, release it. The tasks pile up until the time you set (say, after 7 PM — that's when DeepSeek is at valley pricing), then run by themselves. Next morning you open the report: keep what went well, send back what didn't.

That's all it is. But use it for a week and your working rhythm genuinely slows down — and don't forget, "time is money, efficiency is life"...

A few key capabilities:

- Four execution strategies: single, iterative, sampling, review — from "one pass is enough" to "run five candidates and I'll pick"
- 168 unit tests + 10 end-to-end specs, CI green across ubuntu / windows × node 22 / 24
- One build artifact serves both desktop and web — install once, works on both
- Off-peak execution lands in DeepSeek's valley hours: the same batch costs about half of what peak would

## A normal day with an agent might look like this…

**Ten minutes before clocking out.** You've finished reviewing code, so you file three tickets for tomorrow: a refactor (iterative, 3 rounds), a weekly report (single), and a design you're unsure about (sampling, 4 candidates). Release them all, shut down, leave. Tomorrow at your desk, the morning report says: the refactor's done, the report's drafted, and four candidate designs sit side by side, each with its cost written out.

**Friday night.** Queue a week's worth of chores in one go: dependency cleanup, missing tests, data scripts. Weekends are valley price around the clock. You go out; it works from home. Monday you check the report — retry what failed, merge what's good.

**A 10 AM brainwave.** You're mid-conversation with the agent about an urgent bug when you think "hey, update the docs too." The intercept card pops up: running now costs peak price, tonight it's about half — the difference is spelled out. Click "queue for off-peak"; your draft survives untouched, and you go back to the bug.

**An always-on server.** You've got a machine running dsh 24/7. Switch to L3 full-auto, then file tasks from anywhere through the API (`POST /ds-lowtide/tasks`). It runs them on schedule and writes the report. Nobody's watching, but the sandbox, the daily budget, and the file locks are all still there.

**Deliverables for a client.** Use the review strategy: run once, then automatically open an independent session that tears the result apart through your chosen focus (say, "hunt for data-source errors"). In the morning you don't get a bare result — you get a result plus a critical review.

**Living abroad.** You're in San Francisco; DeepSeek's peak is Beijing time, which for you lands in the evening and night before. Settings converts the official hours to your local clock, one click to adopt. You set windows by your own schedule, and the books always stay aligned with the official table.

## How lowtide works

```
① Intake             ② Adjudicate         ③ Execute               ④ Accept
Whenever you have    The queue dock        When the off-peak       When you're back:
a moment: one-click  groups tasks by       window opens: five      open the report —
from the intercept   workspace; triage    preflight gates pass,    results + diff
card, or file a  →   line by line:    →   then sandboxed runs →    + actual spend
ticket (4 strategies) ✓approve ⏸defer     one batch per window     + money saved
                     ✕drop / approve-all
```

A task's life: `pending-review → queued → preflight → running → done / failed / stale / timeout`, plus `deferred` (postponed) and `dropped` (soft-deleted, restorable).

Step two is where lowtide differs from a "fully automated script": **every task must be released by your hand before it runs** (in L2, you release the whole batch at once, 30 minutes before the window). The machine cannot move itself into the run queue. Execution is automated; decisions are not. That's why you can safely be absent.

## A tour of the lowtide interface

**The new-task modal.** Four strategies side by side, each with a plain-language hint; rounds, priority, and run mode ride along per task — no trip back to settings. Tasks land as "pending review". Nothing enters the queue without passing you.

![new-task-modal](./assets/screenshots/new-task-modal.png)

**Advanced options.** Model, reasoning effort, priority from 0 to 9, fresh session or continue-previous, and the locked-files list — all in one small pane. Locked files, briefly: anything on the list gets sha256-checked before execution, and if it doesn't match what you filed, the task goes stale and refuses to run. Otherwise the file you queued against could be rewritten by another task while waiting, and this one would blindly stomp on it.

![advanced-options](./assets/screenshots/advanced-options.png)

**Pick any model.** Batch runs default to the official `deepseek-v4-flash`, but each task can pick its own model — anything connected to your Harness is in the dropdown, grouped by provider. Private providers work too. Non-official models have no public price table, so the ledger honestly says "price unknown"; add a price override in settings if you want the bookkeeping exact.

![model-picker](./assets/screenshots/model-picker.png)

**The window editor.** Multi-segment, overnight, per-weekday — all fine. Underneath is a live 24-hour price band: red for peak, green for valley, and a marker showing where you are right now. Outside UTC+8, one click on "adopt official peak hours" converts Beijing time to your local clock.

![window-editor](./assets/screenshots/window-editor.png)

**The settings page.** Window hours, tasks per batch, per-task duration cap, concurrency, daily budget, report history, autonomy level, price overrides — all graphical, no config files. The official pricing rules (including the new all-weekend valley) are explained in human language on the same page.

![settings](./assets/screenshots/settings.png)

Three more pieces of UI appear in daily use: the **price pill** (session header — busy/idle, countdown, queue size; click it to edit windows), the **peak-hours intercept card** (type at peak, it appears; the price difference is spelled out; your draft survives), and the **execution report** (the morning briefing: savings first, anomalies pinned, candidates awaiting your pick, one-click Markdown copy).

## About lowtide workspaces

Every task runs inside a workspace. That single dropdown decides three things.

**Which files it can touch.** Tasks run in a sandbox whose boundary is the workspace directory. Pick wrong and at best it can't find the files; at worst it edits something it shouldn't.

**Who it queues with.** Tasks in the same workspace run serially (two tasks never fight over one repo); different workspaces run in parallel (default cap 3, adjustable). Want throughput? Spread unrelated work across workspaces. Want order? Keep it in one.

**How reports group.** Both the dock and the morning report organize by workspace — once you have real volume, this grouping pays off.

The Workspace dropdown in the ticket modal has three sources: **Use current workspace** (whatever your session lives in — the common case), **an existing workspace from the list** (each shown with its absolute path, so you always know which project it is), or **Custom path…** (type one by hand). If you picked "Continue previous" as the session mode, you'll also choose the workspace and the exact conversation — the task resumes with that conversation's context.

My advice: **one project, one workspace — don't mix.** The git snapshot and file locks in preflight are workspace-scoped; mixing projects in one workspace is a good way to confuse yourself.

## Four strategies, and when to use which

| Strategy | What it does | When to reach for it | Cost |
|---|---|---|---|
| **Single** | One pass, done | Simple, well-defined jobs | 1× |
| **Iterative** | 2–5 rounds in one session, each improving the last through your "iteration lens"; stops early when two rounds look alike enough | Work that needs polishing: writing, plans, code | ~N× |
| **Sampling** | 2–5 isolated sessions each produce a complete candidate, shown side by side with costs — **you** pick; the machine makes no aesthetic judgment | Titles, ideas, designs: you want options, not an answer | ~N× |
| **Review** | After the run, an independent session tears the result apart through your "review focus" and writes up its findings | Important deliverables, one more pass before shipping | ~2× |

## Three autonomy levels

- **L1 per-task**: every task needs your individual ✓. Use it early on, or when the repo is precious.
- **L2 batch** (default): tasks wait in review; a gate card appears 30 minutes before the batch and releases everything at once; no release, no run. The daily driver.
- **L3 full-auto**: filed tasks queue immediately and run in the sandbox at off-peak, zero confirmations (switching asks twice). Built for always-on servers.

Individual tasks can override the global level in the ticket modal.

## Architecture: how it runs while you're away

Letting an agent run batch jobs while you sleep is a big ask. Four layers underneath make it safe.

**The Cordis microkernel.** dsh runs on the Cordis microkernel plugin ecosystem: every capability is a plugin, and plugins talk through service injection rather than direct dependency. lowtide's host half is a set of well-behaved Cordis services — routes, scheduler, state machine — each doing its own job, registered into the kernel, starting with the harness, uninstalling cleanly. In plain words: it's not a skin stapled onto dsh; it's an organ grown inside the kernel.

**Two faces, one artifact.** The host half (Node.js) owns scheduling, execution, and the ledger; the browser half (React) owns every pixel. One build produces both — and since dsh Desktop's GUI is itself web-rendered, desktop and web need no separate branches. Same bytes, same behavior.

**A platform-agnostic core.** `lowtide-core` holds the window model, price tables, the billing formula, queue digest, ledger, and batch-window math — all pure functions that touch zero dsh APIs, shipped as their own package with their own tests. The practical payoff: the core has been hammered by 44 pure-function unit tests, and if you ever port lowtide to another agent framework, this package lifts out intact.

**Defense in depth.** Five preflight gates (is the workspace still there, did git HEAD move, do the locked-file sha256s match, does the window fit, is there budget left) — fail any one and the task goes stale or defers; never a blind run. Three sandbox presets with approval set to never — unattended means nobody is there to click "allow", so what's permitted is decided before the run starts. The state file is written atomically and rolls back to a backup if corrupted. HTTP routes only accept same-origin requests from this machine.

State sync uses SSE with a 4-second polling fallback — the queue moves, the UI moves with it.

## Installation

**One-line install (prebuilt):** `dsh plugin --profile web add https://github.com/KelaoHu/dsh-lowtide/releases/latest/download/dsh-lowtide.tgz` — or build from source below.

Prerequisites: Node `^22.19 || >=24`, pnpm `11.7`. Everything is on the public npm registry — no private registry needed.

First install dsh (pick one): Desktop from DeepSeek's official channels, or `npm install -g @deepseek-ai/dsh` for the CLI. Then configure a working model in dsh's settings (e.g. an official DeepSeek API key) — lowtide never touches your credentials.

Then clone, build, install:

```powershell
git clone https://github.com/KelaoHu/dsh-lowtide
cd dsh-lowtide
pnpm install

# Build the core layer first (the plugin's tests resolve its output)
pnpm --filter lowtide-core bundle
# Then the plugin: host half + browser half in one pass
pnpm --filter dsh-lowtide bundle

# Install into a profile — one artifact serves desktop and web
npx @deepseek-ai/dsh@0.1.0-rc.7 plugin --profile desktop add ./packages/dsh-lowtide   # Desktop
npx @deepseek-ai/dsh@0.1.0-rc.7 plugin --profile web add ./packages/dsh-lowtide       # Web

# Start the dev instance (port 3080)
pnpm --filter dsh-lowtide dev
```

Open dsh afterwards: you should see the price pill in the session header and the queue dock beside the input area. If not, check the FAQ below.

## Day-to-day usage

**Three ways to file a task.** The intercept card (type at peak, one click, your draft becomes the ticket unchanged); the ticket modal ("New" beside the input area — prompt, strategy, rounds, priority); or the API (`POST /ds-lowtide/tasks`, wire it into your own automation).

**Life in the queue dock.** Grouped by workspace into pending / finished / dropped. Inline per task: ✓ approve, ⏸ defer, ✕ drop (soft delete, restorable). "Approve all" releases everything; "clear finished" keeps it tidy (the books are unaffected); "Run now" skips the wait and launches a batch immediately — that's how you debug.

**Time semantics.** Official peak hours are judged in **Beijing time** (DeepSeek bills in Beijing time, so the books stay aligned; weekends are off-peak all day). Your custom windows and the run window are judged in **your local time**, with overnight ranges and per-weekday rules. Window end stops new launches; running tasks are never interrupted.

**The ledger.** `ledger[YYYY-MM-DD] = { yuan, savedYuan }` — spend and savings, accrued daily. The displayed price is the billed price: one formula, auditable to the digit.

## Configuration reference

`GET /ds-lowtide/config` reads; `PUT` partially updates (unlisted fields are rejected):

| Field | Type | Default | Notes |
|---|---|---|---|
| `autonomy` | `'l1'\|'l2'\|'l3'` | `l2` | Autonomy level; per-task override in the ticket modal |
| `batch.window` | `"HH:MM-HH:MM"` | `19:00-23:30` | Off-peak run window (local timezone) |
| `batch.tz` | IANA timezone | system | Run-window timezone (empty = local) |
| `batch.gateLeadMin` | minutes | `30` | Batch gate lead time |
| `batch.maxTasksPerNight` | number | `10` | Tasks per batch cap |
| `batch.maxDurationMin` | minutes | `240` | Per-task duration cap (cancel + one retry on timeout) |
| `batch.maxConcurrency` | number | `3` | Max concurrency 1–8 (serial per workspace, parallel across) |
| `batch.paused` | boolean | `false` | Pause automatic batching |
| `budgetDailyYuan` | ¥ | `0` | Daily budget (0 = unlimited) |
| `windows[]` | array | `[]` | Custom windows; empty = official peak (Beijing time) |
| `windows[].level` | `peak\|off\|custom` | — | Peak / off-peak / custom (off-peak price × multiplier) |
| `windows[].start/end` | `"HH:MM"` | — | Local clock, overnight supported |
| `windows[].days` | `1..7` array | every day | ISO weekdays (1 = Mon … 7 = Sun) |
| `windows[].tz` | IANA timezone | system | Per-window timezone |
| `windows[].multiplier` | number | `1` | Off-peak price multiplier for custom windows |
| `prices[model].{peak,off}.{input,inputCached,output}` | ¥/1M | official | Price-table overrides |

## HTTP API

Prefix `/ds-lowtide/`, behind the same-origin + loopback trust fence:

| Method | Path | Purpose |
|---|---|---|
| GET | `/state` | Aggregate state (prices/countdown/queue/latest report) |
| GET | `/events` | SSE incremental push (client falls back to 4s polling) |
| GET/PUT | `/config` | Read/write configuration |
| POST | `/tasks` | Submit a ticket |
| POST | `/tasks/:id/approve \| defer \| drop \| cancel \| retry \| restore \| delete \| choose-candidate` | Adjudication & management |
| POST | `/tasks/approve-all` | Approve everything |
| POST | `/estimate` | Estimate: peak vs off-peak |
| POST | `/batch/run-now` | Run the batch now |
| POST | `/dismiss` | No interception for the rest of today |
| GET | `/health` | Heartbeat |

## Permission presets

| preset | sandbox | approval |
|---|---|---|
| `lt-readonly` | read-only | never |
| `lt-standard` | workspace-write | never |
| `lt-trusted` | danger-full-access | never |

The intake UI doesn't offer a choice — all tasks run under `lt-standard`; the other two remain for API callers (`permissionPreset` on `POST /tasks`). Nothing runs without preflight.

## Data & state

- Everything persists in `$DSH_HOME/lowtide.json` (atomic writes, automatic rollback on corruption); with `DSH_PROFILE` set, state is isolated per profile. **One writer per file at a time** — don't run Desktop and Web at once without profile isolation.
- One batch per window, overnight-safe; an empty queue produces no empty report.
- Deferral recovery: at window start, preflight-deferred tasks re-queue automatically (failed after ≥3); manually deferred tasks return to pending-review.

## Testing & CI

```powershell
pnpm --filter lowtide-core test    # 44 pure-function core tests
pnpm --filter dsh-lowtide test     # 124 plugin unit tests
pnpm --filter dsh-lowtide exec playwright test   # e2e (needs dsh web running on :3080)
```

Ten e2e specs run serially, from two-face load smoke to the full intake→adjudicate→run→report loop against the real API. The repo includes a GitHub Actions workflow: every push / PR runs install → build → typecheck → the full unit suite on four environments.

## Security

- Routes only accept loopback + same-origin; **don't expose port 3080 to the public internet** — use an SSH tunnel or an authenticated reverse proxy.
- The Windows sandbox is mitigation-grade; Linux/macOS enforce fully. For unattended use, stack the file allowlist and the daily budget.
- Switching to L3 full-auto asks twice.
- The state file holds full task prompts and paths; treat backups accordingly.
- Report vulnerabilities privately via [SECURITY.md](./SECURITY.md).

## FAQ

**The window came and nothing ran?**
Check in order: tasks approved? → "pause off-peak batch" ticked? → gate released? → budget exhausted? → preflight failed (task becomes `stale`, reason in the detail view).

**Why doesn't sampling auto-pick the winner?**
On purpose. The machine makes no aesthetic judgment — candidates and costs sit side by side, and you click "pick this one".

**I'm abroad and peak hours don't match my schedule?**
Settings shows what the official hours look like locally; set custom windows for your own rhythm, or click "adopt official peak hours (converted to my timezone)".

**Estimate and actual don't match?**
Estimates use a rough input-token upper bound; actuals use real usage (output and cache hits included). Both numbers are in the report.

**A task went stale?**
Preflight failed: workspace gone, git snapshot moved, a locked file changed, budget short, or the window can't fit it. Read `lastError` in details, fix, `retry`.

## Known limitations & roadmap

- Release candidate (v0.1.1), installed from source; e2e needs a live dsh web instance.
- Default batch model is `deepseek-v4-flash`; non-official models have no public price table — the ledger marks them "price unknown", fillable in settings.
- Per-task cap is 240 minutes; timeout cancels and retries once.
- Roadmap candidates: multi-window multi-batch, task dependency graphs, automatic budget split, report push (email/Webhook), price-change alerts.

## Repository layout

```
dsh-lowtide/
├── README.md                  This file
├── README.zh-CN.md            中文版
├── README.zh-HK.md            繁體中文
├── assets/screenshots/        README screenshots
├── docs/                      Multilingual READMEs (ar, de, es, fr, it, ko)
├── LICENSE                    MIT
├── CHANGELOG.md               Version history
├── CONTRIBUTING.md            Contributing guide
├── CODE_OF_CONDUCT.md         Code of conduct
├── SECURITY.md                Security policy
├── .github/                   CI workflow + issue/PR templates
├── package.json               pnpm workspace root
└── packages/
    ├── core/                  Platform-agnostic core (lowtide-core)
    │   ├── src/               windows / pricing / model / digest / ledger / scheduler
    │   └── test/              Pure-function unit tests
    └── dsh/                   The plugin (dsh-lowtide)
        ├── src/               Host half: routes / runner / scheduler / intake / store / state-machine
        ├── client/            Browser half: components / hooks / i18n / store
        ├── test/              Unit tests + e2e (Playwright)
        ├── cordis.patch.yml   Plugin line + lt-* permission presets
        └── README.md          Package-level README
```

## A few honest words

May this Harness plugin be of the people, by the people, for the people. May the wisdom of the open-source community, and the will to collaborate, never perish from the earth.

## License & acknowledgements

MIT License (see [LICENSE](./LICENSE)).

- Built on [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh) · the Cordis plugin ecosystem
- [DeepSeek pricing announcement (2026-08-13)](https://finance.eastmoney.com/a/202608133840616378.html) · [effective-date coverage (2026-08-17)](https://www.dzwww.com/news/ssnews/202608/t20260817_18025522.htm) · [weekend pricing notice](https://www.ithome.com/0/993/095.htm)
