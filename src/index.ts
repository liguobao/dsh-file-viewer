/**
 * dsh-file-viewer — node half (host side).
 *
 * Registers the `/fileviewer` authenticated RPC channel and a `fileViewerContent`
 * provider registry. Content can come from any plugin; local workspace files
 * are only an optional backwards-compatible provider.
 */

import s from '@deepseek-ai/schemastery'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
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

const FILEVIEWER_CHANNEL = '/fileviewer'
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/
const INVALID_REQUEST_RPC_ID = 'invalid-request'

/** Minimal structural host context (what this plugin actually uses). */
export interface HostContextLike {
  inject(services: string[], callback: (ctx: HostContextLike) => void | Promise<void>): void
  effect(effect: () => (() => void | Promise<void>) | void, label: string): void
  get<T = unknown>(name: string): T | undefined
  provide(name: string, value: unknown): void
  logger: { debug(message: string, fields?: unknown): void; info(message: string, fields?: unknown): void; warn(message: string, fields?: unknown): void; error(message: string, fields?: unknown): void }
}

export interface HostConnectionLike {
  requestRejection?(request: { headers: IncomingHttpHeaders }): number | undefined
  rpc: {
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
      // DSH 0.1.1-rc.2 requires this policy argument. DSH 0.1.2-rc.1
      // authenticates every registered channel and safely ignores the extra
      // JavaScript argument, so always passing it keeps both hosts compatible.
      options: { authority: 'loopback' | 'trusted-host' },
    ): () => Promise<void>
  }
}

export interface HostWebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>
  }): () => void | Promise<void>
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
  ctx.inject(['connection', 'webServer'], (runtime) => {
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

  const webServer = ctx.get<HostWebServerLike>('webServer')
  if (webServer !== undefined && connection.requestRejection !== undefined) {
    await ctx.effect(() => {
      const dispose = webServer.register({
        kind: 'prefix',
        path: FILEVIEWER_CHANNEL,
        handler: (req, res) => handleFileViewerRequest(connection, service, req, res),
      })
      ctx.logger.debug('dsh-file-viewer: /fileviewer channel registered')
      return async () => {
        unregisterLocalFiles?.()
        await dispose()
      }
    }, 'dsh-file-viewer: rpc channel')
  } else {
    await ctx.effect(() => {
      const dispose = connection.rpc.handle(
        FILEVIEWER_CHANNEL,
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
}

async function handleFileViewerRequest(
  connection: HostConnectionLike,
  service: FileViewerService,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const rejection = connection.requestRejection?.(req)
  if (rejection !== undefined) {
    res.writeHead(rejection)
    res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
    return
  }

  const endpoint = endpointFromPath(FILEVIEWER_CHANNEL, new URL(req.url ?? '/', 'http://dsh.internal').pathname)
  if (req.method !== 'POST' || endpoint === undefined) {
    writeText(res, 404, 'not found')
    return
  }
  if (contentType(req.headers) !== 'application/json') {
    writeText(res, 415, 'content type must be application/json')
    return
  }

  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch {
    writeText(res, 400, 'body is not JSON')
    return
  }

  const message = clientRequest(body)
  if (message === undefined) {
    writeJson(res, 200, errorResponse(rpcId(body), {
      code: 'gateway/bad-request',
      message: 'invalid client-request message',
      details: { issues: [] },
    }))
    return
  }
  if (message.method !== endpoint) {
    writeJson(res, 200, errorResponse(message.rpcId, {
      code: 'gateway/bad-request',
      message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
      details: { issues: [] },
    }))
    return
  }

  try {
    const result = await service.handle(endpoint, message.payload, requestSignal(req))
    writeJson(res, 200, fullResponse(message.rpcId, result))
  } catch (error) {
    writeText(res, 500, `handler failure: ${String(error)}`)
  }
}

function endpointFromPath(channel: string, pathname: string): string | undefined {
  if (!pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  if (endpoint.split('/').some((segment) => segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    return undefined
  }
  return endpoint
}

function contentType(headers: IncomingHttpHeaders): string | undefined {
  const raw = headers['content-type']
  const value = Array.isArray(raw) ? raw[0] : raw
  return value?.split(';', 1)[0]?.trim().toLowerCase()
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function requestSignal(req: IncomingMessage): AbortSignal {
  const abort = new AbortController()
  req.on('close', () => {
    if (!req.complete) abort.abort()
  })
  return abort.signal
}

interface ClientRequestWire {
  type: 'client-request'
  rpcId: string
  method: string
  payload: unknown
}

function clientRequest(value: unknown): ClientRequestWire | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.type !== 'client-request' || typeof record.rpcId !== 'string' || typeof record.method !== 'string') return undefined
  return { type: 'client-request', rpcId: record.rpcId, method: record.method, payload: record.payload }
}

function rpcId(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return INVALID_REQUEST_RPC_ID
  const record = value as Record<string, unknown>
  return typeof record.rpcId === 'string' ? record.rpcId : INVALID_REQUEST_RPC_ID
}

function errorResponse(rpcId: string, error: { code: string; message: string; details: Record<string, unknown> }): Record<string, unknown> {
  return fullResponse(rpcId, { ok: false, error })
}

function fullResponse(rpcId: string, result: unknown): Record<string, unknown> {
  return { type: 'server-response', rpcId, result }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function writeText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status)
  res.end(body)
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
