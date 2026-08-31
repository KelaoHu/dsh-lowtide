/**
 * G5 (v4): concurrent batch dispatch — three tasks in three DIFFERENT
 * workspaces must run in parallel (max running ≥ 2 observed), while two
 * tasks in the SAME workspace never overlap (git index-lock safety).
 * API-only (no browser); real LLM execution.
 */
import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workspaces = [mkdtempSync(join(tmpdir(), 'lt-g5-a-')), mkdtempSync(join(tmpdir(), 'lt-g5-b-')), mkdtempSync(join(tmpdir(), 'lt-g5-c-'))]
writeFileSync(join(workspaces[0], 'marker.txt'), 'g5', 'utf8')

test.afterAll(() => {
  for (const ws of workspaces) {
    try { rmSync(ws, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
})

async function api(request: APIRequestContext, method: string, path: string, data?: unknown): Promise<any> {
  const res = await request.fetch(path, { method, data })
  const body = await res.json().catch(() => ({}))
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()}: ${JSON.stringify(body)}`)
  return body
}

test('g5: cross-workspace concurrency with same-workspace serialization', async ({ request }) => {
  test.setTimeout(300_000)

  const ids: string[] = []
  for (let i = 0; i < 3; i++) {
    const r = await api(request, 'POST', '/ds-lowtide/tasks', {
      prompt: `在 ${workspaces[i]} 创建文件 g5-out-${i}.txt，内容为 done-${i}，不要写其他文件`,
      files: [], workspace: workspaces[i], priority: 0, permissionPreset: 'lt-standard',
    })
    ids.push(r.task.id)
    await api(request, 'POST', `/ds-lowtide/tasks/${r.task.id}/approve`)
  }
  // Two tasks in the FIRST workspace (serialization probe).
  const s1 = await api(request, 'POST', '/ds-lowtide/tasks', {
    prompt: `在 ${workspaces[0]} 创建文件 g5-same-1.txt，内容为 sw1，不要写其他文件`,
    files: [], workspace: workspaces[0], priority: 0, permissionPreset: 'lt-standard',
  })
  const s2 = await api(request, 'POST', '/ds-lowtide/tasks', {
    prompt: `在 ${workspaces[0]} 创建文件 g5-same-2.txt，内容为 sw2，不要写其他文件`,
    files: [], workspace: workspaces[0], priority: 0, permissionPreset: 'lt-standard',
  })
  await api(request, 'POST', `/ds-lowtide/tasks/${s1.task.id}/approve`)
  await api(request, 'POST', `/ds-lowtide/tasks/${s2.task.id}/approve`)
  ids.push(s1.task.id, s2.task.id)

  await api(request, 'POST', '/ds-lowtide/batch/run-now')

  const runningSets: string[][] = []
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    const st = await api(request, 'GET', '/ds-lowtide/state')
    runningSets.push((st.tasks ?? []).filter((t) => t.status === 'running' || t.status === 'preflight').map((t) => t.id))
    const pending = (st.tasks ?? []).filter((t) => ['queued', 'running', 'preflight'].includes(t.status))
    if (pending.length === 0) break
    await new Promise((r) => setTimeout(r, 300))
  }

  const maxConcurrent = Math.max(0, ...runningSets.map((s) => s.length))
  const sameWs = [ids[0], s1.task.id, s2.task.id]
  const sameWsOverlap = runningSets.some((s) => sameWs.filter((id) => s.includes(id)).length > 1)

  for (const id of ids) await api(request, 'POST', `/ds-lowtide/tasks/${id}/delete`).catch(() => {})

  expect(maxConcurrent, 'cross-workspace tasks ran in parallel').toBeGreaterThanOrEqual(2)
  expect(sameWsOverlap, 'same-workspace tasks never overlap').toBe(false)
})
