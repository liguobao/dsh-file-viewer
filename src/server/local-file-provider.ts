/** Optional local-files provider for backwards compatibility. */

import { open, stat as fsStat } from 'node:fs/promises'
import { basename } from '../core/format.js'
import { mimeFromExtension } from '../core/mime.js'
import { isPathInside, normalizeRootPath } from '../core/paths.js'
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
    list(request: { rpcId: string; payload: object }): Promise<{ result: { ok: boolean; value?: { items: Array<{ path: string }> } } }>
  }
  sessions?: {
    list(request: { rpcId: string; payload: object }): Promise<{ result: { ok: boolean; value?: { items: Array<{ cwd?: string }> } } }>
  }
  host: {
    openPath(request: { rpcId: string; payload: { path: string } }, signal?: AbortSignal): Promise<unknown>
  }
}

export interface WorkspaceRegistryLike {
  list(): Array<{ path?: string } | undefined>
}

export interface HostSessionsLike {
  list(): Array<{ cwd?: string; header?: { cwd?: string } } | undefined>
}

export interface SessionControllerLike {
  openWorkspacePath(
    request: { path: string },
    signal?: AbortSignal,
  ): Promise<
    | { opened: true }
    | { ok: true; value: { opened: true } }
    | { ok: false; error: { message?: string } }
  >
}

export interface LocalFileContentProviderOptions {
  fs: FsLike
  /** Legacy DSH <= 0.1.0 API proxy. Prefer the explicit services below. */
  apiProxy?: ApiProxyLike | (() => ApiProxyLike | undefined)
  workspaceRegistry?: WorkspaceRegistryLike | (() => WorkspaceRegistryLike | undefined)
  sessions?: HostSessionsLike | (() => HostSessionsLike | undefined)
  sessionController?: SessionControllerLike | (() => SessionControllerLike | undefined)
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
    const sessionController = this.currentSessionController()
    if (sessionController !== undefined) {
      const result = await sessionController.openWorkspacePath({ path }, signal)
      if (isRpcResult(result) && !result.ok) {
        throw new Error(result.error.message ?? 'External open failed.')
      }
      return
    }
    const apiProxy = this.currentApiProxy()
    if (apiProxy === undefined) throw new Error('External open is not available.')
    await apiProxy.host.openPath({ rpcId: 'file-viewer-open', payload: { path } }, signal)
  }

  private async resolveChecked(locator: string, signal: AbortSignal): Promise<{ target: FsTargetLike; path: string }> {
    let target: FsTargetLike
    try {
      target = await this.options.fs.resolve(locator, { signal })
    } catch (error) {
      throw new Error(`Cannot resolve locator: ${error instanceof Error ? error.message : String(error)}`)
    }
    for (const root of await this.allowedRoots()) {
      let rootTarget: FsTargetLike
      try {
        rootTarget = await this.options.fs.resolve(root, { signal })
      } catch {
        continue
      }
      if (this.options.fs.contains(rootTarget, target) || isPathInside(rootTarget.targetKey, target.targetKey)) {
        return { target, path: this.options.fs.processPath(target) }
      }
    }
    throw new Error('Access denied: the locator is outside the allowed workspaces.')
  }

  private async allowedRoots(): Promise<string[]> {
    const roots = new Set(this.options.roots.map(normalizeRootPath).filter((root) => root !== ''))
    const workspaceRegistry = this.currentWorkspaceRegistry()
    if (workspaceRegistry !== undefined) {
      try {
        for (const workspace of workspaceRegistry.list()) {
          const root = typeof workspace?.path === 'string' ? normalizeRootPath(workspace.path) : ''
          if (root !== '') roots.add(root)
        }
      } catch {
        // Fall through to other root sources when the workspace registry is still booting.
      }
    }
    const sessions = this.currentSessions()
    if (sessions !== undefined) {
      try {
        for (const session of sessions.list()) {
          const cwd = session?.header?.cwd ?? session?.cwd
          const root = typeof cwd === 'string' ? normalizeRootPath(cwd) : ''
          if (root !== '') roots.add(root)
        }
      } catch {
        // Live session roots are opportunistic; static roots still apply.
      }
    }
    const apiProxy = this.currentApiProxy()
    if (apiProxy !== undefined) {
      try {
        const response = await apiProxy.workspace.list({ rpcId: 'file-viewer-roots', payload: {} })
        if (response.result.ok && response.result.value !== undefined) {
          for (const workspace of response.result.value.items) {
            const root = normalizeRootPath(workspace.path)
            if (root !== '') roots.add(root)
          }
        }
      } catch {
        // Fall back to static roots when the workspace service is temporarily unavailable.
      }
      try {
        const response = await apiProxy.sessions?.list({ rpcId: 'file-viewer-session-roots', payload: {} })
        if (response?.result.ok && response.result.value !== undefined) {
          for (const session of response.result.value.items) {
            if (session.cwd === undefined) continue
            const root = normalizeRootPath(session.cwd)
            if (root !== '') roots.add(root)
          }
        }
      } catch {
        // Session cwd roots are an opportunistic fallback for ungrouped sessions.
      }
    }
    return [...roots]
  }

  private currentApiProxy(): ApiProxyLike | undefined {
    return typeof this.options.apiProxy === 'function' ? this.options.apiProxy() : this.options.apiProxy
  }

  private currentWorkspaceRegistry(): WorkspaceRegistryLike | undefined {
    return typeof this.options.workspaceRegistry === 'function' ? this.options.workspaceRegistry() : this.options.workspaceRegistry
  }

  private currentSessions(): HostSessionsLike | undefined {
    return typeof this.options.sessions === 'function' ? this.options.sessions() : this.options.sessions
  }

  private currentSessionController(): SessionControllerLike | undefined {
    return typeof this.options.sessionController === 'function' ? this.options.sessionController() : this.options.sessionController
  }
}

function isRpcResult(value: unknown): value is { ok: boolean; error: { message?: string } } {
  return typeof value === 'object' && value !== null && typeof (value as { ok?: unknown }).ok === 'boolean'
}
