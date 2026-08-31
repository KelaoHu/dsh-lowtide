/**
 * Session picker (functional-fix round): enumerate dsh conversations from
 * the official storage files (workspace.json + session_projcache.json),
 * grouped by workspace, with titles.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listWorkspaceSessions } from '../src/session-picker.ts'

const roots: string[] = []

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lt-sess-'))
  roots.push(dir)
  mkdirSync(join(dir, 'storages'), { recursive: true })
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function seed(home: string, workspaces: unknown, sessions: unknown, archived: string[] = []): void {
  writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['ws1', 'ws2'], archivedSessionIds: archived },
    tables: { workspaces },
  }), 'utf8')
  writeFileSync(join(home, 'storages', 'session_projcache.json'), JSON.stringify({
    unit: { name: 'session_projcache', version: 3 },
    global: null,
    tables: { sessions },
  }), 'utf8')
}

describe('listWorkspaceSessions', () => {
  test('groups conversations by workspace with titles, newest first', () => {
    const home = tempHome()
    process.env.DSH_HOME = home
    try {
      seed(home,
        {
          ws1: {
            path: 'C:\\Users\\me\\ProjA',
            title: 'ProjA',
            sessionIds: ['session-aaa-1', 'session-aaa-2'],
          },
          ws2: {
            path: 'C:\\Users\\me\\ProjB',
            title: null,
            sessionIds: ['session-bbb-1'],
          },
        },
        {
          'session-aaa-1': {
            identity: { createdAt: 1000, cwd: 'C:\\Users\\me\\ProjA' },
            rows: { title: { ver: 1, seq: 1, val: '重构 auth.ts' } },
          },
          'session-aaa-2': {
            identity: { createdAt: 2000, cwd: 'C:\\Users\\me\\ProjA' },
            rows: { title: { ver: 1, seq: 1, val: null } },
          },
          'session-bbb-1': {
            identity: { createdAt: 500, cwd: 'C:\\Users\\me\\ProjB' },
            rows: { title: { ver: 1, seq: 1, val: '写 README' } },
          },
        },
      )

      const result = listWorkspaceSessions()
      const a = result.find((w) => w.cwd === 'C:\\Users\\me\\ProjA')
      expect(a).toBeDefined()
      expect(a!.label).toBe('ProjA')
      expect(a!.sessions.map((s) => s.id)).toEqual(['session-aaa-2', 'session-aaa-1'])
      expect(a!.sessions[1].title).toBe('重构 auth.ts')
      expect(a!.sessions[0].title).toBeNull()
      // Newest workspace first.
      expect(result[0].cwd).toBe('C:\\Users\\me\\ProjA')
    } finally {
      delete process.env.DSH_HOME
    }
  })

  test('lowtide task sessions are excluded (absent from workspace.sessionIds)', () => {
    const home = tempHome()
    process.env.DSH_HOME = home
    try {
      seed(home,
        {
          ws1: {
            path: 'C:\\Users\\me\\ProjA',
            title: 'ProjA',
            sessionIds: ['session-real-1'], // lt-/ns- sessions never appear here
          },
        },
        {
          'session-real-1': { identity: { createdAt: 1, cwd: 'C:\\Users\\me\\ProjA' }, rows: {} },
          'lt-lt-foo-123': { identity: { createdAt: 2, cwd: 'C:\\Users\\me\\ProjA' }, rows: {} },
          'ns-ns-bar-456': { identity: { createdAt: 3, cwd: 'C:\\Users\\me\\ProjA' }, rows: {} },
        },
      )
      const result = listWorkspaceSessions()
      const a = result.find((w) => w.cwd === 'C:\\Users\\me\\ProjA')
      expect(a!.sessions.map((s) => s.id)).toEqual(['session-real-1'])
    } finally {
      delete process.env.DSH_HOME
    }
  })

  test('blank sessions (never prompted) are excluded from continuation choices', () => {
    const home = tempHome()
    process.env.DSH_HOME = home
    try {
      seed(home,
        {
          ws1: {
            path: 'C:\\Users\\me\\ProjA',
            title: 'ProjA',
            sessionIds: ['session-used-1', 'session-blank-1'],
          },
        },
        {
          'session-used-1': {
            identity: { createdAt: 1, cwd: 'C:\\Users\\me\\ProjA' },
            rows: { sessionListMetadata: { ver: 1, seq: 1, val: { blank: false, lastPromptAt: 100 } } },
          },
          'session-blank-1': {
            identity: { createdAt: 2, cwd: 'C:\\Users\\me\\ProjA' },
            rows: { sessionListMetadata: { ver: 1, seq: 1, val: { blank: true, lastPromptAt: null } } },
          },
        },
      )
      const result = listWorkspaceSessions()
      const a = result.find((w) => w.cwd === 'C:\\Users\\me\\ProjA')
      expect(a!.sessions.map((s) => s.id)).toEqual(['session-used-1'])
    } finally {
      delete process.env.DSH_HOME
    }
  })

  test('archived sessions are excluded (hidden in the GUI with no restore entry)', () => {
    const home = tempHome()
    process.env.DSH_HOME = home
    try {
      seed(home,
        {
          ws1: {
            path: 'C:\\Users\\me\\ProjA',
            title: 'ProjA',
            sessionIds: ['session-live-1', 'session-archived-1'],
          },
        },
        {
          'session-live-1': { identity: { createdAt: 1, cwd: 'C:\\Users\\me\\ProjA' }, rows: {} },
          'session-archived-1': { identity: { createdAt: 2, cwd: 'C:\\Users\\me\\ProjA' }, rows: {} },
        },
        ['session-archived-1'],
      )
      const result = listWorkspaceSessions()
      const a = result.find((w) => w.cwd === 'C:\\Users\\me\\ProjA')
      expect(a!.sessions.map((s) => s.id)).toEqual(['session-live-1'])
    } finally {
      delete process.env.DSH_HOME
    }
  })

  test('missing or malformed storage files yield an empty list', () => {
    const home = tempHome()
    process.env.DSH_HOME = home
    try {
      expect(listWorkspaceSessions()).toEqual([])
      writeFileSync(join(home, 'storages', 'workspace.json'), '{ broken', 'utf8')
      expect(listWorkspaceSessions()).toEqual([])
    } finally {
      delete process.env.DSH_HOME
    }
  })
})
