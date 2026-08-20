/**
 * dsh-file-viewer — node half (host side).
 *
 * Registers the `/fileviewer` loopback RPC channel and a `fileViewerContent`
 * provider registry. Content can come from any plugin; local workspace files
 * are only an optional backwards-compatible provider.
 */

import s from '@deepseek-ai/schemastery'
import { FileViewerService } from './server/file-service.js'
import { FileViewerContentRegistry } from './server/content-provider.js'
import { LocalFileContentProvider, type FsLike, type ApiProxyLike } from './server/local-file-provider.js'
import { normalizeSeparators } from './core/paths.js'

export const name = 'dsh-file-viewer'

export interface Config {
  enabled?: boolean
  /** Extra absolute directories the viewer may access beyond workspaces + cwd. */
  extraRoots?: string[]
}

/** Cordis-facing configuration schema (schemastery). */
export const Config: s<Config> = s.object({
  enabled: s.boolean(),
  extraRoots: s.array(s.string()),
})

function resolveConfig(input: Config = {}): Required<Config> {
  const extraRoots = (input.extraRoots ?? [])
    .map((root) => normalizeSeparators(root).replace(/\/+$/, ''))
    .filter((root) => root !== '')
  return { enabled: input.enabled ?? true, extraRoots }
}

/** Minimal structural host context (what this plugin actually uses). */
export interface HostContextLike {
  inject(services: string[], callback: (ctx: HostContextLike) => void | Promise<void>): void
  effect(effect: () => (() => void | Promise<void>) | void, label: string): void
  get<T = unknown>(name: string): T | undefined
  provide(name: string, value: unknown): void
  logger: { debug(message: string, fields?: unknown): void; info(message: string, fields?: unknown): void; warn(message: string, fields?: unknown): void; error(message: string, fields?: unknown): void }
}

export interface HostConnectionLike {
  rpc: {
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
      options: { authority: 'loopback' | 'trusted-host' },
    ): () => Promise<void>
  }
}

export function apply(ctx: HostContextLike, input: Config = {}): void {
  const providers = new FileViewerContentRegistry()
  ctx.provide('fileViewerContent', providers)
  ctx.inject(['connection'], (runtime) => {
    void activate(runtime, input, providers)
  })
}

async function activate(ctx: HostContextLike, input: Config, providers: FileViewerContentRegistry): Promise<void> {
  const config = resolveConfig(input)
  if (!config.enabled) {
    ctx.logger.debug('dsh-file-viewer disabled by config')
    return
  }

  const settings = ctx.get<{
    register(
      namespace: string,
      schema: s<Config>,
      options: { base?: Config; applies: 'restart'; validate?: (value: Config) => void },
    ): { get(): Config } | undefined
  }>('settings')
  const settingsScope = settings?.register('dsh-file-viewer', Config, {
    base: input,
    applies: 'restart',
    validate: (value) => { resolveConfig(value) },
  })
  const merged = resolveConfig(settingsScope?.get() ?? input)

  const fs = ctx.get<FsLike>('fs')
  const apiProxy = ctx.get<ApiProxyLike>('apiProxy')
  const connection = ctx.get<HostConnectionLike>('connection')
  if (connection?.rpc === undefined) {
    ctx.logger.warn('dsh-file-viewer: the connection RPC registry is unavailable; the viewer is disabled')
    return
  }

  let unregisterLocalFiles: (() => void) | undefined
  if (fs !== undefined) {
    const roots = new Set<string>([process.cwd(), ...merged.extraRoots])
    if (apiProxy !== undefined) {
      try {
        const response = await apiProxy.workspace.list({ rpcId: 'file-viewer-roots', payload: {} })
        if (response.result.ok) {
          for (const workspace of response.result.value.items) roots.add(normalizeSeparators(workspace.path))
        }
      } catch (error) {
        ctx.logger.warn('dsh-file-viewer: workspace list unavailable', error)
      }
    }
    unregisterLocalFiles = providers.register(new LocalFileContentProvider({
      fs,
      apiProxy,
      roots: [...roots].filter(Boolean),
    }))
  } else {
    ctx.logger.info('dsh-file-viewer: ctx.fs is unavailable; waiting for registered content providers')
  }

  const service = new FileViewerService({
    providers,
    log: (level, message, fields) => ctx.logger[level](`dsh-file-viewer: ${message}`, fields),
  })

  await ctx.effect(() => {
    const dispose = connection.rpc.handle(
      '/fileviewer',
      (endpoint, payload, signal) => service.handle(endpoint, payload, signal),
      { authority: 'loopback' },
    )
    ctx.logger.debug('dsh-file-viewer: /fileviewer channel registered')
    return async () => {
      unregisterLocalFiles?.()
      await dispose()
    }
  }, 'dsh-file-viewer: rpc channel')
}

export { FileViewerContentRegistry } from './server/content-provider.js'
export type {
  FileViewerContentEntry,
  FileViewerContentMeta,
  FileViewerContentProvider,
  FileViewerReadRequest,
} from './server/content-provider.js'
export { FileViewerService } from './server/file-service.js'
export type { DirEntryWire, FileMetaWire } from './server/file-service.js'
export type { FileViewerClientService, FileViewerHeadWire, FileViewerRangeWire } from './client-api.js'
