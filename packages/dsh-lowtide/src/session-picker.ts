/**
 * Workspace session picker (functional-fix round): enumerate dsh
 * conversations from the official storage files, grouped by workspace, so a
 * new off-peak task can RESUME an existing conversation (agents.resume at
 * execution time). Read-only; payloads (session.jsonl.zstd) are loaded by
 * dsh itself on resume.
 *
 * Data sources (verified against a live profile):
 *   $DSH_HOME/storages/workspace.json
 *     tables.workspaces.<id> = { path, title, sessionIds, updatedAt }
 *   $DSH_HOME/storages/session_projcache.json
 *     tables.sessions.<sessionId> = { identity: { createdAt, cwd },
 *                                     rows: { title: { val },
 *                                             sessionListMetadata: { val: { lastPromptAt } } } }
 * Last activity = lastPromptAt (fallback: createdAt).
 * Lowtide's own task sessions (prefix lt- or ns-) are NOT listed in
 * workspace.sessionIds, so starting from the workspace table excludes them.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface WorkspaceSession {
  id: string
  /** Conversation title from the proj cache (null when never titled). */
  title: string | null
  lastModified: number
}

export interface WorkspaceSessions {
  cwd: string
  label: string | null
  sessions: WorkspaceSession[]
}

export function storagesDir(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages')
}

function readJsonSafe(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** List conversations per workspace, most recently active first. */
export function listWorkspaceSessions(limitPerWorkspace = 30): WorkspaceSessions[] {
  const dir = storagesDir()
  const ws = readJsonSafe(join(dir, 'workspace.json'))
  const proj = readJsonSafe(join(dir, 'session_projcache.json'))
  if (ws === null) return []

  const wsTables = ws.tables as Record<string, unknown> | undefined
  const workspaces = wsTables?.workspaces as Record<string, { path?: unknown; title?: unknown; sessionIds?: unknown }> | undefined
  // Registry-global archive set: archived sessions are hidden from every
  // grouping surface and have NO unarchive entry point in the GUI — offering
  // them as continuation sources would only confuse (the session exists but
  // the user cannot see it anywhere).
  const archived = new Set(
    Array.isArray((ws.global as Record<string, unknown> | undefined)?.archivedSessionIds)
      ? ((ws.global as Record<string, unknown>).archivedSessionIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
  )
  const projSessions = (proj?.tables as Record<string, unknown> | undefined)?.sessions as
    | Record<string, {
        identity?: { createdAt?: unknown }
        rows?: {
          title?: { val?: unknown }
          sessionListMetadata?: { val?: { lastPromptAt?: unknown; blank?: unknown } }
        }
      }>
    | undefined

  const result: WorkspaceSessions[] = []
  for (const entry of Object.values(workspaces ?? {})) {
    if (typeof entry.path !== 'string') continue
    // Only real dsh conversations (session-*) are offered for continuation —
    // the plugin's own batch sessions (lt-/ns- prefixes) are auto-generated
    // and would clutter the picker.
    const ids = Array.isArray(entry.sessionIds)
      ? entry.sessionIds.filter((id): id is string =>
          typeof id === 'string' && !id.startsWith('lt-') && !id.startsWith('ns-'))
      : []
    const sessions: WorkspaceSession[] = []
    for (const id of ids) {
      const cached = projSessions?.[id]
      // Blank sessions (never prompted) have no completed turn to inherit —
      // excluding them avoids offering continuations that cannot be lossless.
      if (cached?.rows?.sessionListMetadata?.val?.blank === true) continue
      // Archived sessions are hidden in the GUI with no restore entry — do
      // not offer them as continuation sources.
      if (archived.has(id)) continue
      const titleVal = cached?.rows?.title?.val
      const createdAt = cached?.identity?.createdAt
      // Last activity = last prompt time when known, else creation time.
      const lastPromptAt = cached?.rows?.sessionListMetadata?.val?.lastPromptAt
      sessions.push({
        id,
        title: typeof titleVal === 'string' ? titleVal : null,
        lastModified: typeof lastPromptAt === 'number' ? lastPromptAt : typeof createdAt === 'number' ? createdAt : 0,
      })
    }
    if (sessions.length === 0) continue
    sessions.sort((a, b) => b.lastModified - a.lastModified)
    result.push({
      cwd: entry.path,
      label: typeof entry.title === 'string' ? entry.title : null,
      sessions: sessions.slice(0, limitPerWorkspace),
    })
  }
  // Workspaces with the most recent activity first.
  result.sort((a, b) => (b.sessions[0]?.lastModified ?? 0) - (a.sessions[0]?.lastModified ?? 0))
  return result
}
