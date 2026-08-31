/**
 * Git workspace introspection for the runner (spike 3, PLAN T0.5 / C7).
 * Every helper degrades gracefully: non-git directory, missing git binary,
 * or a timeout yields null — never throws.
 */
import { execFile } from 'node:child_process'

const GIT_TIMEOUT_MS = 3000

function git(workspace: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    // '-c core.fsmonitor=' disables the fsmonitor hook: a malicious workspace
    // could point .git/config core.fsmonitor at an executable and get RCE the
    // moment we run any read-only git command in it (pentest P1).
    execFile('git', ['-c', 'core.fsmonitor=', ...args], { cwd: workspace, timeout: GIT_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null)
      resolve(stdout.trim())
    })
  })
}

/** Current HEAD short sha + branch, or null when the workspace is no git repo. */
export async function gitRef(workspace: string): Promise<{ sha: string; branch: string } | null> {
  const sha = await git(workspace, ['rev-parse', '--short', 'HEAD'])
  if (sha === null) return null
  const branch = await git(workspace, ['branch', '--show-current'])
  return { sha, branch: branch || '(detached)' }
}

/**
 * `git diff --stat HEAD` covering modified + staged changes against HEAD,
 * e.g. "3 files changed, 124 insertions(+), 67 deletions(-)".
 * Untracked files are not part of any diff — collect them with
 * {@link gitUntrackedFiles} and compose in the report.
 * Returns null when the workspace is no git repo. Use with the session cwd
 * pinned to task.workspace (PLAN C7) or the diff reads the wrong tree.
 */
export async function gitDiffStat(workspace: string): Promise<string | null> {
  const stat = await git(workspace, ['diff', '--stat', 'HEAD'])
  return stat === null ? null : (stat === '' ? null : stat)
}

/** New untracked files (one path per line), or null on a non-git workspace. */
export async function gitUntrackedFiles(workspace: string): Promise<string[] | null> {
  const list = await git(workspace, ['ls-files', '--others', '--exclude-standard'])
  return list === null ? null : (list === '' ? [] : list.split('\n'))
}
