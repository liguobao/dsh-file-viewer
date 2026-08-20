/** Optional local-files provider for backwards compatibility. */

import { open, stat as fsStat } from 'node:fs/promises'
import { basename } from '../core/format.js'
import { mimeFromExtension } from '../core/mime.js'
import type {
  FileViewerContentEntry,
  FileViewerContentMeta,
  FileViewerContentProvider,
  FileViewerReadRequest,
} from './content-provider.js'

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

export interface LocalFileContentProviderOptions {
  fs: FsLike
  apiProxy?: ApiProxyLike
  /** Absolute directory roots the provider may access. */
  roots: string[]
}

export class LocalFileContentProvider implements FileViewerContentProvider {
  readonly id = 'local-files'
  readonly priority = -1000

  constructor(private readonly options: LocalFileContentProviderOptions) {}

  /** This is the fallback provider; registry precedence lets custom sources win. */
  supports(): boolean {
    return true
  }

  async stat(locator: string, signal: AbortSignal): Promise<FileViewerContentMeta | undefined> {
    const { path } = await this.resolveChecked(locator, signal)
    const info = await fsStat(path).catch(() => undefined)
    if (info === undefined) return undefined
    return {
      name: basename(path),
      size: info.isDirectory() ? 0 : info.size,
      mime: mimeFromExtension(path),
      mtimeMs: info.mtimeMs,
      isDirectory: info.isDirectory(),
    }
  }

  async read(locator: string, request: FileViewerReadRequest): Promise<Uint8Array> {
    const { path } = await this.resolveChecked(locator, request.signal)
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(request.length)
      const { bytesRead } = await handle.read(buffer, 0, request.length, request.offset)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  async list(locator: string, signal: AbortSignal): Promise<FileViewerContentEntry[]> {
    const { target, path } = await this.resolveChecked(locator, signal)
    const info = await fsStat(path).catch(() => undefined)
    if (info === undefined) throw new Error('The directory does not exist.')
    if (!info.isDirectory()) throw new Error('The locator is not a directory.')
    const listing = await this.options.fs.listDir(target, signal)
    const entries: FileViewerContentEntry[] = []
    for (const entry of listing) {
      const childPath = this.options.fs.processPath(entry.target)
      const isDirectory = entry.type === 'directory'
      let size = entry.size
      let mtimeMs: number | undefined
      try {
        const statInfo = await fsStat(childPath)
        if (size === undefined) size = statInfo.isDirectory() ? 0 : statInfo.size
        mtimeMs = statInfo.mtimeMs
      } catch {
        // Preserve stale directory entries without optional metadata.
      }
      entries.push({
        locator: childPath,
        name: entry.name,
        size: size ?? 0,
        mime: mimeFromExtension(childPath),
        mtimeMs,
        isDirectory,
      })
    }
    return entries
  }

  async openExternal(locator: string, signal: AbortSignal): Promise<void> {
    const { path } = await this.resolveChecked(locator, signal)
    if (this.options.apiProxy === undefined) throw new Error('External open is not available.')
    await this.options.apiProxy.host.openPath({ rpcId: 'file-viewer-open', payload: { path } }, signal)
  }

  private async resolveChecked(locator: string, signal: AbortSignal): Promise<{ target: FsTargetLike; path: string }> {
    let target: FsTargetLike
    try {
      target = await this.options.fs.resolve(locator, { signal })
    } catch (error) {
      throw new Error(`Cannot resolve locator: ${error instanceof Error ? error.message : String(error)}`)
    }
    for (const root of this.options.roots) {
      let rootTarget: FsTargetLike
      try {
        rootTarget = await this.options.fs.resolve(root, { signal })
      } catch {
        continue
      }
      if (this.options.fs.contains(rootTarget, target)) {
        return { target, path: this.options.fs.processPath(target) }
      }
    }
    throw new Error('Access denied: the locator is outside the allowed workspaces.')
  }
}
