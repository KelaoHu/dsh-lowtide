/**
 * Vendored from deepseek-harness packages/client/tsdown.client.ts (rc.5
 * snapshot).
 *
 * The shared tsdown preset itself is a monorepo-root script and ships in no
 * npm package (PLAN audit W3), so this vendor copy stands in. Changes made
 * for the standalone package:
 *  - PLATFORM_MODULES inlined (no ./web/src/platform.ts import).
 *  - browserSourcePath simplified: source maps resolve sources relative to
 *    the package root instead of the monorepo /packages/ tree.
 *  - Default client entry is client/index.ts (PLAN §5.2 layout).
 *
 * Semantics preserved: __ModuleLoader__.load({id, factory}) closure-factory
 * artifact, external resolution through the injected require (loader module
 * table), CSS Modules compiled by lightningcss and auto-injected as
 * <style data-plugin="<id>">, bundle purity gate forbidding cross-plugin
 * value imports of non-platform modules.
 *
 * 0.2.3 platform-drift hardening (issue #4): PLATFORM_MODULES is now the
 * INTERSECTION of the supported shell seed tables, not one generation's
 * list — DSH Desktop 2.0.3 seeds 7 words (no dsh-client-store, no
 * ui-dockkit); the dsh 0.1.5-rc.1 CLI web shell seeds those plus
 * @deepseek-ai/dsh-client-store and @deepseek-ai/dsh-client-ui-dockkit; the
 * 0.1.0-rc.7-era shell seeded a now-dead set (dsh-client-web-react,
 * ui-attachment, schema-form). Anything outside the intersection MUST be
 * inlined (see INLINE_SAFE) or the bundle dies at boot with "missed the
 * module table" on hosts lacking the word. The former
 * RUNTIME_STORE_EXEMPTION (@deepseek-ai/dsh-client-runtime/client) was
 * exactly such a drift casualty: the package left the plugin tree after
 * 0.1.1-rc.2, so the exemption became an unresolved external on 0.1.5.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/**
 * Platform modules seeded by EVERY supported shell (desktop 2.0.3 ∩ CLI
 * 0.1.5-rc.1): the only safe build-time externals. Verified against the
 * desktop web-frontend bundle and dsh-client-web@0.1.5-rc.1
 * getStaticModules().
 */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

/** Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/**
 * Wire/type layers a client bundle may inline: browser-safe contracts
 * with no runtime identity to share (no Symbol/instanceof/singleton state).
 *
 * dsh-client-store joined in 0.2.3 (issue #4): the snapshot-store engine
 * (zustand vanilla + immer) is self-contained — lowtide's stores are
 * plugin-private (components subscribe via useSyncExternalStore), so no
 * instance identity is shared with the host. Inlining it immunizes the
 * bundle against the seed-table drift between shell generations (desktop
 * 2.0.3 does not seed it; CLI 0.1.5 does).
 */
export const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand|client-store)(\/|$)/

/** Vendored framework libraries: no cross-plugin runtime identity to share. */
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/

/** Generated descriptor/codec contribution with no shared runtime identity. */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

/** Skip-worktree marker kept for preset-compatibility. */
const SKIP_WORKSPACE_BUILD: UserConfig = { entry: '' }

/** Externals resolved from the loader module table (the seed intersection only). */
export const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES]

/** Absolute path of this file, used as the source-map rebasing anchor. */
const PACKAGE_ROOT = resolvePath(fileURLToPath(new URL('..', import.meta.url)))

/**
 * Rebase a physical source onto a browser-friendly path relative to the
 * package root (the client.js.map is served from /plugins/<id>/client.js.map;
 * sourcesContent keeps them usable).
 */
function browserSourcePath(source: string, sourcemapPath: string): string {
  if (!source.startsWith('.')) return source
  const physicalSource = resolvePath(dirname(sourcemapPath), source)
  const packagePath = relative(PACKAGE_ROOT, physicalSource).split(sep).join('/')
  return packagePath.startsWith('../') ? source : packagePath
}

/** One platform module specifier. */
export type PlatformModule = (typeof PLATFORM_MODULES)[number]

interface ClientBundleOptions {
  /** Emit the Node-side artifacts during the Host pass instead of the Client pass. */
  readonly hostPhase?: boolean
  /** Additional Node-side configs emitted alongside the package library. */
  readonly companions?: readonly UserConfig[]
  /** Overrides for the package's primary Node-side library config. */
  readonly lib?: UserConfig
}

type BuildFace = 'host' | 'client' | undefined

type BuildFaceConfig = (inlineConfig: Pick<UserConfig, 'env'>) => UserConfig[]

function buildFace(value: unknown): BuildFace {
  if (value === undefined || value === 'host' || value === 'client') return value
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

function clientLibraryConfig(
  id: string,
  libEntry: readonly string[],
  overrides: UserConfig = {},
): UserConfig {
  return {
    name: id,
    entry: [...libEntry],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    ...overrides,
  }
}

function clientConfig(id: string, entry: string): UserConfig {
  return {
    name: `${id}/client`,
    entry: { client: entry },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: [...CLIENT_EXTERNALS],
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [{
      name: 'dsh-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (CLIENT_EXTERNALS.includes(source)) return null
        if (VENDORED_LIBRARY.test(source)) return null
        if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null
        throw new Error(
          `client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS), an inline-safe wire layer, or a generated /remote contribution — `
          + 'cross-plugin value imports are forbidden; collaborate through cordis services (type-only imports are erased and never reach this gate)',
        )
      },
    }, {
      name: 'dsh-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
        return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
        return [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
          'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
          '  const tag = document.createElement(\'style\');',
          `  tag.dataset.plugin = ${JSON.stringify(id)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      sourcemapPathTransform: browserSourcePath,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = `${sep}lib${sep}types${sep}`
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}

/**
 * Build the tsdown config for one UI plugin package: the node-half lib build
 * plus the browser client bundle.
 */
export function clientBundle(
  id: string,
  libEntry: readonly string[],
  options: ClientBundleOptions = {},
): BuildFaceConfig {
  const lib = clientLibraryConfig(id, libEntry, options.lib)
  return ({ env }) => {
    const face = buildFace(env?.DSH_BUILD_FACE)
    const client = clientConfig(id, face === undefined
      ? 'client/index.tsx'
      : 'lib/types/client/index.js')
    const node = [lib, ...(options.companions ?? [])]
    if (face === 'host') return options.hostPhase === true ? node : [SKIP_WORKSPACE_BUILD]
    if (face === 'client') return options.hostPhase === true ? [client] : [...node, client]
    return [...node, client]
  }
}

/** Build a Client-only Node library during the Client pass. */
export function clientLibrary(id: string, libEntry: readonly string[]): BuildFaceConfig {
  const lib = clientLibraryConfig(id, libEntry)
  return clientOnly([lib])
}

/** Select arbitrary package-local configs only during the Client pass. */
export function clientOnly(configs: readonly UserConfig[]): BuildFaceConfig {
  return ({ env }) => buildFace(env?.DSH_BUILD_FACE) === 'host'
    ? [SKIP_WORKSPACE_BUILD]
    : [...configs]
}
