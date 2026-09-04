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
  list(): unknown[] | { items?: unknown[]; byId?: Record<string, unknown> } | Map<unknown, unknown> | Set<unknown> | Promise<unknown>
}

export interface HostSessionsLike {
  list?(): unknown[] | { items?: unknown[]; byId?: Record<string, unknown> } | Map<unknown, unknown> | Set<unknown> | Promise<unknown>
  all?(): unknown[] | { items?: unknown[]; byId?: Record<string, unknown> } | Map<unknown, unknown> | Set<unknown> | Promise<unknown>
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
    const { target, path } = await this.resolveChecked(locator, signal)
    const info = await this.options.fs.stat(target, signal).catch(() => undefined)
    if (info === undefined) return undefined
    const displayPath = target.displayPath ?? path
    const nativeInfo = await fsStat(path).catch(() => undefined)
    const isDirectory = info.type === 'directory'
    return {
      name: basename(displayPath),
      size: isDirectory ? 0 : info.size ?? nativeInfo?.size ?? 0,
      mime: mimeFromExtension(displayPath),
      mtimeMs: nativeInfo?.mtimeMs,
      isDirectory,
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
    const { target } = await this.resolveChecked(locator, signal)
    const info = await this.options.fs.stat(target, signal).catch(() => undefined)
    if (info === undefined) throw new Error('The directory does not exist.')
    if (info.type !== 'directory') throw new Error('The locator is not a directory.')
    const listing = await this.options.fs.listDir(target, signal)
    const entries: FileViewerContentEntry[] = []
    for (const entry of listing) {
      const childPath = this.options.fs.processPath(entry.target)
      const childLocator = entry.target.displayPath ?? childPath
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
        locator: childLocator,
        name: entry.name,
        size: size ?? 0,
        mime: mimeFromExtension(childLocator),
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
      if (this.isInsideAllowedRoot(rootTarget, target)) {
        return { target, path: this.options.fs.processPath(target) }
      }
    }
    throw new Error('Access denied: the locator is outside the allowed workspaces.')
  }

  private isInsideAllowedRoot(root: FsTargetLike, target: FsTargetLike): boolean {
    if (this.options.fs.contains(root, target) || isPathInside(root.targetKey, target.targetKey)) return true
    try {
      return isPathInside(this.options.fs.processPath(root), this.options.fs.processPath(target))
    } catch {
      return false
    }
  }

  private async allowedRoots(): Promise<string[]> {
    const roots = new Set(this.options.roots.map(normalizeRootPath).filter((root) => root !== ''))
    const workspaceRegistry = this.currentWorkspaceRegistry()
    if (workspaceRegistry !== undefined) {
      try {
        for (const workspace of entriesFrom(await workspaceRegistry.list())) addRoot(roots, workspacePath(workspace))
      } catch {
        // Fall through to other root sources when the workspace registry is still booting.
      }
    }
    const sessions = this.currentSessions()
    if (sessions !== undefined) {
      try {
        const listed = sessions.list !== undefined ? await sessions.list() : await sessions.all?.()
        for (const session of entriesFrom(listed)) addRoot(roots, sessionCwd(session))
      } catch {
        // Live session roots are opportunistic; static roots still apply.
      }
    }
    const apiProxy = this.currentApiProxy()
    if (apiProxy !== undefined) {
      try {
        const response = await apiProxy.workspace.list({ rpcId: 'file-viewer-roots', payload: {} })
        if (response.result.ok && response.result.value !== undefined) {
          for (const workspace of entriesFrom(response.result.value.items)) addRoot(roots, workspacePath(workspace))
        }
      } catch {
        // Fall back to static roots when the workspace service is temporarily unavailable.
      }
      try {
        const response = await apiProxy.sessions?.list({ rpcId: 'file-viewer-session-roots', payload: {} })
        if (response?.result.ok && response.result.value !== undefined) {
          for (const session of entriesFrom(response.result.value.items)) addRoot(roots, sessionCwd(session))
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

function addRoot(roots: Set<string>, candidate: unknown): void {
  if (typeof candidate !== 'string') return
  const root = normalizeRootPath(candidate)
  if (root !== '') roots.add(root)
}

function entriesFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value instanceof Map || value instanceof Set) return [...value.values()]
  if (!isRecord(value)) return []
  if (Array.isArray(value.items)) return value.items
  if (value.items instanceof Map || value.items instanceof Set) return [...value.items.values()]
  if (isRecord(value.byId)) return Object.values(value.byId)
  return []
}

function workspacePath(value: unknown): string | undefined {
  return firstString(value, ['path'], ['workspace', 'path'], ['root', 'path'])
}

function sessionCwd(value: unknown): string | undefined {
  return firstString(value, ['cwd'], ['header', 'cwd'], ['summary', 'cwd'], ['meta', 'cwd'])
}

function firstString(value: unknown, ...paths: string[][]): string | undefined {
  for (const path of paths) {
    const result = nestedString(value, path)
    if (result !== undefined) return result
  }
  return undefined
}

function nestedString(value: unknown, path: string[]): string | undefined {
  let current = value
  for (const segment of path) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return typeof current === 'string' ? current : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
