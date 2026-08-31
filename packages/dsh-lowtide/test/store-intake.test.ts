import { describe, expect, test, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { intake } from '../src/intake.ts'
import { configUpdateSchema, LowtideStore } from '../src/store.ts'
import type { MorningReport, Task } from 'lowtide-core'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lt-store-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function sampleTask(id: string, status: Task['status'] = 'queued'): Task {
  return {
    id,
    prompt: '测试任务',
    files: [],
    workspace: 'E:/x',
    priority: 1,
    permissionPreset: 'lt-standard',
    status,
    createdAt: new Date().toISOString(),
  }
}

describe('LowtideStore', () => {
  test('persists and reloads state', () => {
    const dir = tempDir()
    const file = join(dir, 'lowtide.json')
    const store = LowtideStore.load(file)
    store.addTask(sampleTask('t1'))
    store.setStatus('t1', 'queued', { triagedAt: 'now', triagedBy: 'user' })
    const reloaded = LowtideStore.load(file)
    expect(reloaded.tasks).toHaveLength(1)
    expect(reloaded.tasks[0].status).toBe('queued')
  })

  test('overdue recovery requeues running/preflight tasks', () => {
    const dir = tempDir()
    const file = join(dir, 'lowtide.json')
    const store = LowtideStore.load(file)
    store.addTask(sampleTask('t-run', 'running'))
    store.addTask(sampleTask('t-pre', 'preflight'))
    store.addTask(sampleTask('t-queued', 'queued'))
    const reloaded = LowtideStore.load(file)
    expect(reloaded.tasks.find((t) => t.id === 't-run')?.status).toBe('queued')
    expect(reloaded.tasks.find((t) => t.id === 't-pre')?.status).toBe('queued')
    expect(reloaded.tasks.find((t) => t.id === 't-queued')?.status).toBe('queued')
  })

  test('corrupt file is backed up, not loaded', () => {
    const dir = tempDir()
    const file = join(dir, 'lowtide.json')
    writeFileSync(file, '{ definitely not json', 'utf8')
    const store = LowtideStore.load(file)
    expect(store.tasks).toHaveLength(0)
    const dirEntries = readdirSync(dir)
    expect(dirEntries.some((name) => name.startsWith('lowtide.json.bak-'))).toBe(true)
  })

  test('ledger accumulates daily spend and savings', () => {
    const dir = tempDir()
    const store = LowtideStore.load(join(dir, 'lowtide.json'))
    store.addTask(sampleTask('t1'))
    store.recordRun('t1', {
      at: new Date().toISOString(),
      status: 'done',
      elapsedMs: 1000,
      costYuan: 0.01,
    }, 'done')
    store.addSavings(0.01)
    const ledger = store.ledgerToday(new Date())
    expect(ledger.yuan).toBeCloseTo(0.01, 6)
    expect(ledger.savedYuan).toBeCloseTo(0.01, 6)
  })

  test('hard delete removes the task for good and persists', () => {
    const dir = tempDir()
    const file = join(dir, 'lowtide.json')
    const store = LowtideStore.load(file)
    store.addTask(sampleTask('t1', 'pending-review'))
    store.addTask(sampleTask('t2', 'done'))
    expect(store.deleteTask('t1')).toBe(true)
    expect(store.tasks.map((t) => t.id)).toEqual(['t2'])
    expect(store.deleteTask('no-such-id')).toBe(false)
    const reloaded = LowtideStore.load(file)
    expect(reloaded.tasks.map((t) => t.id)).toEqual(['t2'])
  })
})

describe('report management (functional fixes: delete + history cap)', () => {
  function sampleReport(id: string): MorningReport {
    return {
      id,
      date: '2026-08-20',
      window: '19:00-23:30',
      startedAt: '2026-08-20T11:00:00.000Z',
      finishedAt: '2026-08-20T11:30:00.000Z',
      tasks: [],
      totalCostYuan: 1,
      savedYuan: 0.5,
      summary: `报告 ${id}`,
    }
  }

  test('deleteReport removes one report, ledger and tasks untouched', () => {
    const dir = tempDir()
    const store = LowtideStore.load(join(dir, 'lowtide.json'))
    store.addTask(sampleTask('t1'))
    store.addReport(sampleReport('r1'))
    store.addReport(sampleReport('r2'))
    expect(store.deleteReport('r1')).toBe(true)
    expect(store.reports.map((r) => r.id)).toEqual(['r2'])
    expect(store.deleteReport('nope')).toBe(false)
    expect(store.tasks).toHaveLength(1)
  })

  test('clearReports empties reports only and returns the count', () => {
    const dir = tempDir()
    const store = LowtideStore.load(join(dir, 'lowtide.json'))
    store.addReport(sampleReport('r1'))
    store.addReport(sampleReport('r2'))
    expect(store.clearReports()).toBe(2)
    expect(store.reports).toHaveLength(0)
  })

  test('addReport honors maxReportHistory (0 = unlimited)', () => {
    const dir = tempDir()
    const store = LowtideStore.load(join(dir, 'lowtide.json'))
    store.updateConfig({ maxReportHistory: 3 })
    for (let i = 0; i < 5; i++) store.addReport(sampleReport(`r${i}`))
    expect(store.reports).toHaveLength(3)
    expect(store.reports[0].id).toBe('r4') // newest first

    store.updateConfig({ maxReportHistory: 0 })
    for (let i = 5; i < 8; i++) store.addReport(sampleReport(`r${i}`))
    expect(store.reports).toHaveLength(6)
  })

  test('legacy state without maxReportHistory loads and defaults to 60', () => {
    const dir = tempDir()
    const file = join(dir, 'lowtide.json')
    writeFileSync(file, JSON.stringify({
      version: 1,
      config: {
        autonomy: 'l2',
        batch: { window: '19:00-23:30', gateLeadMin: 30, maxTasksPerNight: 10, maxDurationMin: 240, paused: false },
        windows: [],
        prices: {},
        budgetDailyYuan: 0,
      },
      tasks: [],
      reports: [],
      ledger: {},
    }), 'utf8')
    const store = LowtideStore.load(file)
    expect(store.config.maxReportHistory).toBeUndefined()
    for (let i = 0; i < 65; i++) store.addReport(sampleReport(`r${i}`))
    expect(store.reports).toHaveLength(60) // falls back to the default cap
  })
})

describe('intake', () => {
  test('valid input lands pending-review with snapshots and estimate', async () => {
    const dir = tempDir()
    const file = join(dir, 'hello.txt')
    writeFileSync(file, 'hello lowtide', 'utf8')
    const result = await intake({
      prompt: '修改 hello.txt 并报告内容',
      files: ['hello.txt'],
      workspace: dir,
      priority: 0,
    }, dir)
    expect(result.ok).toBe(true)
    const task = result.task!
    expect(task.status).toBe('pending-review')
    expect(task.files).toHaveLength(1)
    expect(task.files[0].path).toBe(file)
    expect(task.files[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(task.files[0].size).toBe(13)
    expect(task.estimateYuan).toBeGreaterThan(0)
    expect(task.workspace).toBe(dir)
  })

  test('rejects missing workspace', async () => {
    const dir = tempDir()
    const result = await intake({ prompt: 'x' }, join(dir, 'nope'))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('工作区不存在')
  })

  test('autonomy l3 queues immediately with auto-l3 audit', async () => {
    const dir = tempDir()
    const result = await intake({ prompt: 'x' }, dir, { autonomy: 'l3' })
    expect(result.ok).toBe(true)
    expect(result.task?.status).toBe('queued')
    expect(result.task?.triagedBy).toBe('auto-l3')
    expect(result.task?.triagedAt).toBeDefined()
  })

  test('autonomy l2 (default) lands pending-review for human adjudication', async () => {
    const dir = tempDir()
    const result = await intake({ prompt: 'x' }, dir, { autonomy: 'l2' })
    expect(result.ok).toBe(true)
    expect(result.task?.status).toBe('pending-review')
  })

  test('per-task l3 overrides a global l2 and auto-queues (new-task modal)', async () => {
    const dir = tempDir()
    const result = await intake({ prompt: 'x', autonomy: 'l3' }, dir, { autonomy: 'l2' })
    expect(result.ok).toBe(true)
    expect(result.task?.status).toBe('queued')
    expect(result.task?.triagedBy).toBe('auto-l3')
    expect(result.task?.triagedAt).toBeDefined()
    // The explicit override is persisted on the task.
    expect(result.task?.autonomy).toBe('l3')
  })

  test('per-task l1 stays pending-review even under a global l3', async () => {
    const dir = tempDir()
    const result = await intake({ prompt: 'x', autonomy: 'l1' }, dir, { autonomy: 'l3' })
    expect(result.ok).toBe(true)
    expect(result.task?.status).toBe('pending-review')
    expect(result.task?.triagedBy).toBeUndefined()
    expect(result.task?.autonomy).toBe('l1')
  })

  test('absent autonomy follows the global config and is not persisted', async () => {
    const dir = tempDir()
    const result = await intake({ prompt: 'x' }, dir, { autonomy: 'l3' })
    expect(result.ok).toBe(true)
    expect(result.task?.status).toBe('queued')
    expect(result.task?.autonomy).toBeUndefined()
  })

  test('rejects missing files', async () => {
    const dir = tempDir()
    const result = await intake({ prompt: 'x', files: ['missing.txt'], workspace: dir }, dir)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('文件不存在')
  })

  test('rejects empty prompt', async () => {
    const dir = tempDir()
    const result = await intake({ prompt: '' }, dir)
    expect(result.ok).toBe(false)
  })

  test('continuesFromSession passes through when provided', async () => {
    const dir = tempDir()
    const result = await intake({ prompt: '修复问题2', continuesFromSession: 'session-abc123' }, dir)
    expect(result.ok).toBe(true)
    expect(result.task?.continuesFromSession).toBe('session-abc123')
  })

  test('absent continuesFrom stays undefined', async () => {
    const dir = tempDir()
    const result = await intake({ prompt: 'x' }, dir)
    expect(result.ok).toBe(true)
    expect(result.task?.continuesFromSession).toBeUndefined()
  })

  test('model passes through and scales the estimate (pro > flash)', async () => {
    const dir = tempDir()
    const flash = await intake({ prompt: '测试指令内容', strategy: 'single' }, dir)
    const pro = await intake({ prompt: '测试指令内容', strategy: 'single', model: 'deepseek-v4-pro' }, dir)
    expect(flash.ok && pro.ok).toBe(true)
    expect(flash.task?.model).toBeUndefined()
    expect(pro.task?.model).toBe('deepseek-v4-pro')
    expect(pro.task?.estimateYuan ?? 0).toBeGreaterThan(flash.task?.estimateYuan ?? 0)
  })

  test('modelProvider rides along with a task-level model (custom providers)', async () => {
    const dir = tempDir()
    const result = await intake({ prompt: 'x', model: 'gpt-4o', modelProvider: 'my-gateway' }, dir)
    expect(result.ok).toBe(true)
    expect(result.task?.model).toBe('gpt-4o')
    expect(result.task?.modelProvider).toBe('my-gateway')
    const bare = await intake({ prompt: 'x', model: 'gpt-4o' }, dir)
    expect(bare.ok).toBe(true)
    expect(bare.task?.model).toBe('gpt-4o')
    expect(bare.task?.modelProvider).toBeUndefined()
  })

  test('unknown model ids pass through (unlisted ids are sendable directly)', async () => {
    const dir = tempDir()
    const result = await intake({ prompt: 'x', model: 'deepseek-v3' }, dir)
    expect(result.ok).toBe(true)
    expect(result.task?.model).toBe('deepseek-v3')
  })
})

describe('configUpdateSchema strict validation (Kimi review)', () => {
  test('rejects an unknown timezone', () => {
    const parsed = configUpdateSchema.safeParse({ batch: { tz: 'Not/ARealTz' } })
    expect(parsed.success).toBe(false)
  })

  test('accepts a real timezone and rejects malformed clock bounds', () => {
    expect(configUpdateSchema.safeParse({ batch: { tz: 'Asia/Shanghai' } }).success).toBe(true)
    expect(configUpdateSchema.safeParse({ batch: { window: '25:00-23:30' } }).success).toBe(false)
    expect(configUpdateSchema.safeParse({ batch: { window: '19:00-23:30' } }).success).toBe(true)
  })

  test('rejects windows with out-of-range start/end and bad tz', () => {
    expect(configUpdateSchema.safeParse({ windows: [{ id: 'w', level: 'peak', start: '25:00', end: '12:00' }] }).success).toBe(false)
    expect(configUpdateSchema.safeParse({ windows: [{ id: 'w', level: 'peak', start: '09:00', end: '12:00' }] }).success).toBe(true)
    expect(configUpdateSchema.safeParse({ windows: [{ id: 'w', level: 'peak', start: '09:00', end: '12:00', tz: 'Bogus/Zone' }] }).success).toBe(false)
  })

  test('lenient persistence schema still loads legacy values (no data loss on upgrade)', () => {
    // The persistence path (stateSchema) must NOT reject files that carry
    // values the write path now refuses — verify via the store load path.
    const dir = tempDir()
    const file = join(dir, 'lowtide.json')
    writeFileSync(file, JSON.stringify({
      version: 1,
      config: {
        autonomy: 'l2',
        batch: { window: '19:00-23:30', gateLeadMin: 30, maxTasksPerNight: 10, maxDurationMin: 240, paused: false },
        windows: [{ id: 'legacy', level: 'peak', start: '25:00', end: '12:00', tz: 'Bogus/Zone' }],
        prices: {},
        budgetDailyYuan: 0,
      },
      tasks: [],
      reports: [],
      ledger: {},
    }), 'utf8')
    const store = LowtideStore.load(file)
    expect(store.config.windows).toHaveLength(1)
    expect(store.config.windows[0].start).toBe('25:00') // legacy value preserved
  })
})

describe('rename migration: legacy nightshift.json → lowtide.json', () => {
  const legacyState = {
    version: 1,
    config: {
      autonomy: 'l2',
      batch: { window: '19:00-23:30', gateLeadMin: 30, maxTasksPerNight: 10, maxDurationMin: 240, paused: false, maxConcurrency: 3 },
      windows: [],
      prices: {},
      budgetDailyYuan: 0,
    },
    tasks: [{
      id: 'ns-legacy-1',
      prompt: '旧任务',
      files: [],
      workspace: 'E:/old',
      priority: 1,
      permissionPreset: 'ns-standard',
      status: 'queued',
      createdAt: '2026-08-20T00:00:00.000Z',
      strategy: 'single',
      rounds: 1,
    }],
    reports: [{
      id: 'rpt-old',
      date: '2026-08-20',
      window: '19:00-23:30',
      startedAt: '2026-08-20T11:00:00.000Z',
      finishedAt: '2026-08-20T11:30:00.000Z',
      tasks: [],
      totalCostYuan: 1.23,
      savedYuan: 0.45,
      summary: '旧报告',
    }],
    ledger: { '2026-08-20': { yuan: 1.23, savedYuan: 0.45 } },
  }

  test('migrates legacy tasks (ns-* presets), ledger and reports; legacy file kept as .migrated', () => {
    const dir = tempDir()
    const legacy = join(dir, 'nightshift.json')
    const file = join(dir, 'lowtide.json')
    writeFileSync(legacy, JSON.stringify(legacyState), 'utf8')

    const store = LowtideStore.load(file)

    expect(store.tasks).toHaveLength(1)
    expect(store.tasks[0].id).toBe('ns-legacy-1')
    expect(store.tasks[0].permissionPreset).toBe('lt-standard')
    expect(store.snapshot().ledger['2026-08-20']).toEqual({ yuan: 1.23, savedYuan: 0.45 })
    expect(store.reports).toHaveLength(1)
    expect(store.reports[0].id).toBe('rpt-old')
    expect(existsSync(file)).toBe(true)
    expect(existsSync(`${legacy}.migrated`)).toBe(true)
    expect(existsSync(legacy)).toBe(false)
  })

  test('no migration when the new file already exists', () => {
    const dir = tempDir()
    const legacy = join(dir, 'nightshift.json')
    const file = join(dir, 'lowtide.json')
    writeFileSync(file, JSON.stringify({ version: 1, config: legacyState.config, tasks: [], reports: [], ledger: {} }), 'utf8')
    writeFileSync(legacy, '{ bogus — must not be touched', 'utf8')

    LowtideStore.load(file)

    expect(existsSync(legacy)).toBe(true)
    expect(existsSync(`${legacy}.migrated`)).toBe(false)
  })

  test('corrupt legacy file falls back to fresh state without touching it', () => {
    const dir = tempDir()
    const legacy = join(dir, 'nightshift.json')
    const file = join(dir, 'lowtide.json')
    writeFileSync(legacy, '{ not json', 'utf8')

    const store = LowtideStore.load(file)

    expect(store.tasks).toHaveLength(0)
    expect(existsSync(legacy)).toBe(true)
    expect(existsSync(file)).toBe(false)
  })
})
