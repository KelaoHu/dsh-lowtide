/**
 * Shared e2e workspace path. The default is a per-run temporary directory so
 * the suite is machine-independent; set LOWTIDE_E2E_WORKSPACE to pin a
 * specific directory (e.g. a dedicated git repo on your machine).
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const E2E_WORKSPACE = process.env.LOWTIDE_E2E_WORKSPACE !== undefined && process.env.LOWTIDE_E2E_WORKSPACE.trim() !== ''
  ? process.env.LOWTIDE_E2E_WORKSPACE
  : join(tmpdir(), 'lowtide-e2e-workspace')
