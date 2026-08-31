import { describe, expect, test, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitDiffStat, gitRef, gitUntrackedFiles } from '../src/git.ts'

const roots: string[] = []

function sh(cwd: string, cmd: string): void {
  execFileSync('git', cmd.split(' '), { cwd, stdio: 'pipe' })
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lt-git-'))
  roots.push(dir)
  sh(dir, 'init')
  sh(dir, 'config user.email test@example.com')
  sh(dir, 'config user.name test')
  return dir
}

afterEach(() => {
  // Windows: git subprocesses / Defender may briefly hold the tree — retry
  // the recursive delete, and treat a still-locked tree as best-effort so
  // cleanup flakiness never fails an otherwise passing assertion.
  for (const dir of roots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      /* temp dir leaked (file locked) — harmless in CI/temp */
    }
  }
})

describe('git workspace introspection', () => {
  test('gitRef returns sha+branch for a committed repo', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'hello')
    sh(dir, 'add .')
    sh(dir, 'commit -m init')
    const ref = await gitRef(dir)
    expect(ref).not.toBeNull()
    expect(ref!.sha).toMatch(/^[0-9a-f]{7}$/)
    expect(typeof ref!.branch).toBe('string')
  })

  test('gitDiffStat covers modified and staged files against HEAD', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'hello\n')
    writeFileSync(join(dir, 'b.txt'), 'base\n')
    sh(dir, 'add .')
    sh(dir, 'commit -m init')
    appendFileSync(join(dir, 'a.txt'), 'world\n')
    writeFileSync(join(dir, 'b.txt'), 'staged change\n')
    sh(dir, 'add b.txt')
    const stat = await gitDiffStat(dir)
    expect(stat).not.toBeNull()
    expect(stat).toContain('2 files changed')
    expect(stat).toContain('insertion')
  })

  test('gitDiffStat is null on a clean tree', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'hello')
    sh(dir, 'add .')
    sh(dir, 'commit -m init')
    expect(await gitDiffStat(dir)).toBeNull()
  })

  test('gitUntrackedFiles lists new files while diff stays clean', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'hello')
    sh(dir, 'add .')
    sh(dir, 'commit -m init')
    writeFileSync(join(dir, 'new.txt'), 'created by agent')
    expect(await gitDiffStat(dir)).toBeNull()
    const untracked = await gitUntrackedFiles(dir)
    expect(untracked).toEqual(['new.txt'])
  })

  test('all helpers degrade to null on a non-git directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lt-nogit-'))
    roots.push(dir)
    expect(await gitRef(dir)).toBeNull()
    expect(await gitDiffStat(dir)).toBeNull()
    expect(await gitUntrackedFiles(dir)).toBeNull()
  })
})
