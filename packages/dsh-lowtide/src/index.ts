/**
 * dsh-lowtide host half (Phase 1 assembly).
 * Load the store, start the scheduler, register the HTTP API.
 * Spike routes from Phase 0 are gone — the formal intake/routes API replaces
 * them (PLAN G0 directive).
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { registerRoutes } from './routes.ts'
import { startScheduler } from './scheduler.ts'
import { LowtideStore, stateFilePath } from './store.ts'

/** Cordis service dependencies for the host half. */
export const inject = ['webServer', 'agents', 'permissionPresets', 'agentDefaultModel', 'agentPresets', 'llm', 'settings', 'workspaceRegistry', 'sessions']

export function apply(ctx: Context): void {
  const store = LowtideStore.load(stateFilePath())
  ctx.logger('lowtide').info('host half loaded (store: %d tasks, batch window %s)',
    store.tasks.length, store.config.batch.window)
  // Diagnostic: confirm workspace registry and sessions are available.
  const hasRegistry = (ctx as any).workspaceRegistry !== undefined
  const hasSessions = (ctx as any).sessions !== undefined
  ctx.logger('lowtide').info('services: workspaceRegistry=%s, sessions=%s', hasRegistry, hasSessions)

  const scheduler = startScheduler(ctx, store)
  registerRoutes(ctx, { store, scheduler })

  ctx.effect(() => () => {
    scheduler.stop()
    store.save()
  })
}
