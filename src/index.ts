/**
 * dsh-file-viewer — node half (host side).
 *
 * Registers the `/fileviewer` authenticated RPC channel and a `fileViewerContent`
 * provider registry. Content can come from any plugin; local workspace files
 * are only an optional backwards-compatible provider.
 */

import s from '@deepseek-ai/schemastery'
import { FileViewerService } from './server/file-service.js'
import { FileViewerContentRegistry } from './server/content-provider.js'
import {
  LocalFileContentProvider,
  type FsLike,
  type ApiProxyLike,
  type HostSessionsLike,
  type SessionControllerLike,
  type WorkspaceRegistryLike,
} from './server/local-file-provider.js'
import { normalizeRootPath } from './core/paths.js'

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
    .map(normalizeRootPath)
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
      // DSH 0.1.1-rc.2 requires this policy argument. DSH 0.1.2-alpha.1
      // authenticates every registered channel and safely ignores the extra
      // JavaScript argument, so always passing it keeps both hosts compatible.
      options: { authority: 'loopback' | 'trusted-host' },
    ): () => Promise<void>
  }
}

/**
 * Host-side service exposed to trusted plugins as `fileViewerHost`.
 *
 * The service intentionally keeps the same bounded RPC-shaped contract as
 * the browser RPC channel. A transport plugin can forward an allowlisted subset
 * without reaching around File Viewer's provider authorization boundary.
 */
export interface FileViewerHostService {
  handle(endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown>
}

export function apply(ctx: HostContextLike, input: Config = {}): void {
  const providers = new FileViewerContentRegistry()
  const service = new FileViewerService({
    providers,
    log: (level, message, fields) => ctx.logger[level](`dsh-file-viewer: ${message}`, fields),
  })
  ctx.provide('fileViewerContent', providers)
  ctx.inject(['connection'], (runtime) => {
    void activate(runtime, input, providers, service)
  })
}

async function activate(
  ctx: HostContextLike,
  input: Config,
  providers: FileViewerContentRegistry,
  service: FileViewerService,
): Promise<void> {
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
  if (!merged.enabled) {
    ctx.logger.debug('dsh-file-viewer disabled by settings')
    return
  }
  ctx.provide('fileViewerHost', service satisfies FileViewerHostService)

  const fs = ctx.get<FsLike>('fs')
  const connection = ctx.get<HostConnectionLike>('connection')
  if (connection?.rpc === undefined) {
    ctx.logger.warn('dsh-file-viewer: the connection RPC registry is unavailable; the viewer is disabled')
    return
  }

  let unregisterLocalFiles: (() => void) | undefined
  if (fs !== undefined) {
    const roots = new Set<string>([process.cwd(), ...merged.extraRoots])
    unregisterLocalFiles = providers.register(new LocalFileContentProvider({
      fs,
      apiProxy: () => ctx.get<ApiProxyLike>('apiProxy'),
      workspaceRegistry: () => ctx.get<WorkspaceRegistryLike>('workspaceRegistry'),
      sessions: () => ctx.get<HostSessionsLike>('sessions'),
      sessionController: () => ctx.get<SessionControllerLike>('sessionController'),
      roots: [...roots].map(normalizeRootPath).filter(Boolean),
    }))
  } else {
    ctx.logger.info('dsh-file-viewer: ctx.fs is unavailable; waiting for registered content providers')
  }

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
