/**
 * Host-side File Viewer RPC service.
 *
 * The service does not know where content lives. It routes locators to
 * registered providers, enforces bounded reads, and converts provider bytes
 * to the RPC wire format consumed by the browser client.
 */

import { basename, extname } from '../core/format.js'
import { mimeFromExtension } from '../core/mime.js'
import { normalizeRequestPath } from '../core/paths.js'
import {
  FileViewerContentRegistry,
  type FileViewerContentMeta,
  type FileViewerContentProvider,
} from './content-provider.js'

export type RpcResultLike =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

export interface FileViewerServiceDeps {
  providers: FileViewerContentRegistry
  log?: (level: 'debug' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void
}

export interface FileMetaWire {
  path: string
  name: string
  ext: string
  mime: string
  size: number
  mtimeMs: number | undefined
  isDirectory: boolean
  exists: boolean
}

export interface DirEntryWire {
  name: string
  path: string
  isDirectory: boolean
  size: number | undefined
  mtimeMs: number | undefined
}

export const MAX_RANGE_BYTES = 8 * 1024 * 1024
export const MAX_HEAD_BYTES = 1024 * 1024

function ok(value: unknown): RpcResultLike {
  return { ok: true, value }
}

function fail(message: string, code = 'internal'): RpcResultLike {
  return { ok: false, error: { code, message, details: {} } }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The request payload is invalid.')
  }
  return value as Record<string, unknown>
}

export class FileViewerService {
  constructor(private readonly deps: FileViewerServiceDeps) {}

  async handle(endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResultLike> {
    try {
      switch (endpoint) {
        case 'stat':
          return ok(await this.stat(payload, signal))
        case 'readRange':
          return ok(await this.readRange(payload, signal))
        case 'readHead':
          return ok(await this.readHead(payload, signal))
        case 'list':
          return ok(await this.list(payload, signal))
        case 'openExternal':
          return ok(await this.openExternal(payload, signal))
        default:
          return fail(`Unknown endpoint: ${endpoint}`, 'bad-request')
      }
    } catch (error) {
      if (signal.aborted) return fail('The request was aborted.', 'cancelled')
      const message = error instanceof Error ? error.message : String(error)
      this.deps.log?.('warn', 'fileviewer rpc failed', { endpoint, message })
      return fail(message)
    }
  }

  private resolve(rawLocator: unknown): { locator: string; provider: FileViewerContentProvider } {
    const locator = normalizeRequestPath(rawLocator)
    const provider = this.deps.providers.resolve(locator)
    if (provider === undefined) throw new Error(`No content provider is registered for: ${locator}`)
    return { locator, provider }
  }

  private async statProvider(locator: string, provider: FileViewerContentProvider, signal: AbortSignal): Promise<FileViewerContentMeta | undefined> {
    return provider.stat(locator, signal)
  }

  private async stat(payload: unknown, signal: AbortSignal): Promise<FileMetaWire> {
    const { locator, provider } = this.resolve(record(payload).path)
    const info = await this.statProvider(locator, provider, signal)
    if (info === undefined) {
      return {
        path: locator,
        name: basename(locator),
        ext: extname(locator),
        mime: mimeFromExtension(locator),
        size: 0,
        mtimeMs: undefined,
        isDirectory: false,
        exists: false,
      }
    }
    return {
      path: locator,
      name: info.name,
      ext: extname(info.name),
      mime: info.mime ?? mimeFromExtension(info.name),
      size: info.isDirectory === true ? 0 : info.size,
      mtimeMs: info.mtimeMs,
      isDirectory: info.isDirectory === true,
      exists: true,
    }
  }

  private async readRange(payload: unknown, signal: AbortSignal): Promise<{ data: string; offset: number; size: number; eof: boolean }> {
    const input = record(payload)
    const { locator, provider } = this.resolve(input.path)
    const offset = Number(input.offset)
    const length = Number(input.length)
    if (!Number.isInteger(offset) || offset < 0) throw new Error('A non-negative integer offset is required.')
    if (!Number.isInteger(length) || length <= 0) throw new Error('A positive integer length is required.')
    const info = await this.statProvider(locator, provider, signal)
    if (info === undefined) throw new Error('The content does not exist.')
    if (info.isDirectory === true) throw new Error('A directory cannot be read as content.')
    const capped = Math.min(length, MAX_RANGE_BYTES)
    const data = await provider.read(locator, { offset, length: capped, signal })
    if (data.byteLength > capped) throw new Error(`Content provider "${provider.id}" returned more bytes than requested.`)
    return {
      data: Buffer.from(data).toString('base64'),
      offset,
      size: info.size,
      eof: offset + data.byteLength >= info.size,
    }
  }

  private async readHead(payload: unknown, signal: AbortSignal): Promise<{ data: string; size: number; truncated: boolean }> {
    const input = record(payload)
    const requested = Number(input.maxBytes)
    const maxBytes = Math.min(Number.isFinite(requested) && requested > 0 ? requested : MAX_HEAD_BYTES, MAX_HEAD_BYTES)
    const { locator, provider } = this.resolve(input.path)
    const info = await this.statProvider(locator, provider, signal)
    if (info === undefined) throw new Error('The content does not exist.')
    if (info.isDirectory === true) return { data: '', size: 0, truncated: false }
    const data = await provider.read(locator, { offset: 0, length: maxBytes, signal })
    if (data.byteLength > maxBytes) throw new Error(`Content provider "${provider.id}" returned more bytes than requested.`)
    return {
      data: Buffer.from(data).toString('base64'),
      size: info.size,
      truncated: data.byteLength < info.size,
    }
  }

  private async list(payload: unknown, signal: AbortSignal): Promise<{ path: string; entries: DirEntryWire[] }> {
    const { locator, provider } = this.resolve(record(payload).path)
    const info = await this.statProvider(locator, provider, signal)
    if (info === undefined) throw new Error('The directory does not exist.')
    if (info.isDirectory !== true) throw new Error('The locator is not a directory.')
    if (provider.list === undefined) throw new Error(`Content provider "${provider.id}" does not support directory listing.`)
    const listing = await provider.list(locator, signal)
    return {
      path: locator,
      entries: listing.map((entry) => ({
        name: entry.name,
        path: entry.locator,
        isDirectory: entry.isDirectory === true,
        size: entry.isDirectory === true ? 0 : entry.size,
        mtimeMs: entry.mtimeMs,
      })),
    }
  }

  private async openExternal(payload: unknown, signal: AbortSignal): Promise<{ opened: true }> {
    const { locator, provider } = this.resolve(record(payload).path)
    if (provider.openExternal === undefined) throw new Error(`Content provider "${provider.id}" does not support external open.`)
    await provider.openExternal(locator, signal)
    return { opened: true }
  }
}
