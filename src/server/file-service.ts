/**
 * Host-side File Viewer service: implements the `/fileviewer` RPC channel.
 * All file access goes through `ctx.fs` (resolve → canonical target) and is
 * boundary-checked against the allowed roots (workspace directories + host
 * cwd + configured extras). `readRange` uses bounded Node fs reads on the
 * resolved process path, so huge files are never buffered whole.
 */

import { open, stat as fsStat } from 'node:fs/promises'
import { basename, extname } from '../core/format.js'
import { normalizeRequestPath } from '../core/paths.js'
import { mimeFromExtension } from '../core/mime.js'

/** Structural host faces (kept local to avoid version coupling). */
export interface FsTargetLike {
  targetKey: string
  displayPath?: string
}
export interface FsLike {
  resolve(path: string, opts?: { signal?: AbortSignal }): Promise<FsTargetLike>
  contains(parent: FsTargetLike, child: FsTargetLike): boolean
  processPath(target: FsTargetLike): string
  stat(target: FsTargetLike, signal?: AbortSignal): Promise<{ type: 'file' | 'directory' | 'other'; size?: number } | undefined>
  listDir(target: FsTargetLike, signal?: AbortSignal): Promise<Array<{ name: string; type: 'file' | 'directory' | 'other'; target: FsTargetLike; size?: number }>>
}

export interface ApiProxyLike {
  workspace: {
    list(request: { rpcId: string; payload: object }): Promise<{ result: { ok: true; value: { items: Array<{ path: string }> } } }>
  }
  host: {
    openPath(request: { rpcId: string; payload: { path: string } }, signal?: AbortSignal): Promise<unknown>
  }
}

export type RpcResultLike =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

export interface FileViewerServiceDeps {
  fs: FsLike
  apiProxy?: ApiProxyLike
  /** Absolute directory roots the viewer may access (workspaces + extras). */
  roots: string[]
  /** Host process cwd (the fs default base). */
  cwd: string
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

export const MAX_RANGE_BYTES = 8 * 1024 * 1024 // 8 MiB per range read
export const MAX_HEAD_BYTES = 1024 * 1024 // 1 MiB sniffing cap

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

  /** Resolve + boundary-check a request path; returns the canonical process path. */
  private async resolveChecked(rawPath: unknown, signal: AbortSignal): Promise<{ target: FsTargetLike; path: string }> {
    const requested = normalizeRequestPath(rawPath)
    let target: FsTargetLike
    try {
      target = await this.deps.fs.resolve(requested, { signal })
    } catch (error) {
      throw new Error(`Cannot resolve path: ${error instanceof Error ? error.message : String(error)}`)
    }
    for (const root of this.deps.roots) {
      let rootTarget: FsTargetLike
      try {
        rootTarget = await this.deps.fs.resolve(root, { signal })
      } catch {
        continue // a stale root (deleted workspace) must not block other roots
      }
      if (this.deps.fs.contains(rootTarget, target)) {
        return { target, path: this.deps.fs.processPath(target) }
      }
    }
    throw new Error('Access denied: the path is outside the allowed workspaces.')
  }

  private async stat(payload: unknown, signal: AbortSignal): Promise<FileMetaWire> {
    const { path } = await this.resolveChecked(record(payload).path, signal)
    const info = await fsStat(path).catch(() => undefined)
    if (info === undefined) {
      return { path, name: basename(path), ext: extname(path), mime: mimeFromExtension(path), size: 0, mtimeMs: undefined, isDirectory: false, exists: false }
    }
    return {
      path,
      name: basename(path),
      ext: extname(path),
      mime: mimeFromExtension(path),
      size: info.isDirectory() ? 0 : info.size,
      mtimeMs: info.mtimeMs,
      isDirectory: info.isDirectory(),
      exists: true,
    }
  }

  private async readRange(payload: unknown, signal: AbortSignal): Promise<{ data: string; offset: number; size: number; eof: boolean }> {
    const input = record(payload)
    const { path } = await this.resolveChecked(input.path, signal)
    const offset = Number(input.offset)
    const length = Number(input.length)
    if (!Number.isInteger(offset) || offset < 0) throw new Error('A non-negative integer offset is required.')
    if (!Number.isInteger(length) || length <= 0) throw new Error('A positive integer length is required.')
    const capped = Math.min(length, MAX_RANGE_BYTES)
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(capped)
      const { bytesRead } = await handle.read(buffer, 0, capped, offset)
      const statInfo = await handle.stat()
      const size = statInfo.size
      return {
        data: Buffer.from(buffer.subarray(0, bytesRead)).toString('base64'),
        offset,
        size,
        eof: offset + bytesRead >= size,
      }
    } finally {
      await handle.close()
    }
  }

  private async readHead(payload: unknown, signal: AbortSignal): Promise<{ data: string; size: number; truncated: boolean }> {
    const input = record(payload)
    const maxBytes = Math.min(Number(input.maxBytes) || MAX_HEAD_BYTES, MAX_HEAD_BYTES)
    const { path } = await this.resolveChecked(input.path, signal)
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(maxBytes)
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
      const statInfo = await handle.stat()
      return {
        data: Buffer.from(buffer.subarray(0, bytesRead)).toString('base64'),
        size: statInfo.size,
        truncated: bytesRead < statInfo.size,
      }
    } finally {
      await handle.close()
    }
  }

  private async list(payload: unknown, signal: AbortSignal): Promise<{ path: string; entries: DirEntryWire[] }> {
    const { target, path } = await this.resolveChecked(record(payload).path, signal)
    const info = await fsStat(path).catch(() => undefined)
    if (info === undefined) throw new Error('The directory does not exist.')
    if (!info.isDirectory()) throw new Error('The path is not a directory.')
    const listing = await this.deps.fs.listDir(target, signal)
    const entries: DirEntryWire[] = []
    for (const entry of listing) {
      const childPath = this.deps.fs.processPath(entry.target)
      const isDirectory = entry.type === 'directory'
      let size: number | undefined = entry.size
      let mtimeMs: number | undefined
      try {
        const statInfo = await fsStat(childPath)
        if (size === undefined) size = statInfo.isDirectory() ? 0 : statInfo.size
        mtimeMs = statInfo.mtimeMs
      } catch {
        // stale entry — keep the listing but without extra metadata
      }
      entries.push({ name: entry.name, path: childPath, isDirectory, size, mtimeMs })
    }
    return { path, entries }
  }

  private async openExternal(payload: unknown, signal: AbortSignal): Promise<{ opened: true }> {
    const { path } = await this.resolveChecked(record(payload).path, signal)
    if (this.deps.apiProxy === undefined) throw new Error('External open is not available.')
    await this.deps.apiProxy.host.openPath({ rpcId: 'file-viewer-open', payload: { path } }, signal)
    return { opened: true }
  }
}
