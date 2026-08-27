import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileViewerService } from '../src/server/file-service.js'
import { FileViewerContentRegistry, type FileViewerContentProvider } from '../src/server/content-provider.js'
import { LocalFileContentProvider, type FsLike } from '../src/server/local-file-provider.js'
import { isPathInside } from '../src/core/paths.js'

let root: string
let service: FileViewerService

/** Minimal structural ctx.fs double over the real filesystem. */
function fakeFs(base: string, overrides: Partial<FsLike> = {}): FsLike {
  const fs: FsLike = {
    async resolve(path) {
      return { targetKey: path, displayPath: path }
    },
    contains(parent, child) {
      return isPathInside(parent.targetKey, child.targetKey)
    },
    processPath(target) {
      return target.targetKey
    },
    async stat(target) {
      const { stat } = await import('node:fs/promises')
      const info = await stat(target.targetKey).catch(() => undefined)
      if (info === undefined) return undefined
      return { type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other', size: info.size }
    },
    async listDir(target) {
      const entries = await readdir(target.targetKey, { withFileTypes: true })
      return entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
        target: { targetKey: join(target.targetKey, entry.name) },
        size: undefined,
      }))
    },
  }
  return { ...fs, ...overrides }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsfv-test-'))
  await writeFile(join(root, 'notes.txt'), 'hello world\nline two\n')
  await writeFile(join(root, 'data.csv'), 'a,b,c\n1,2,3\n')
  await writeFile(join(root, 'paper.pdf'), '%PDF-1.4 fake')
  await mkdir(join(root, 'sub'))
  await writeFile(join(root, 'sub', 'deep.txt'), 'deep')
  await writeFile(join(root, 'big.bin'), Buffer.alloc(1000, 7))
  const providers = new FileViewerContentRegistry()
  providers.register(new LocalFileContentProvider({
    fs: fakeFs(root),
    roots: [root],
  }))
  service = new FileViewerService({ providers })
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

async function call(endpoint: string, payload: unknown): Promise<{ ok: boolean; value?: unknown; error?: { message?: string } }> {
  return service.handle(endpoint, payload, new AbortController().signal) as Promise<{ ok: boolean; value?: unknown; error?: { message?: string } }>
}

function decode(data: string): string {
  return Buffer.from(data, 'base64').toString('utf8')
}

describe('file-viewer service', () => {
  it('stats an existing file', async () => {
    const result = await call('stat', { path: join(root, 'notes.txt') })
    expect(result.ok).toBe(true)
    const value = result.value as { exists: boolean; size: number; mime: string; name: string }
    expect(value.exists).toBe(true)
    expect(value.size).toBe(21)
    expect(value.name).toBe('notes.txt')
    expect(value.mime).toBe('text/plain')
  })

  it('reports a missing file as not existing', async () => {
    const result = await call('stat', { path: join(root, 'missing.txt') })
    expect(result.ok).toBe(true)
    expect((result.value as { exists: boolean }).exists).toBe(false)
  })

  it('reads a byte range', async () => {
    const result = await call('readRange', { path: join(root, 'notes.txt'), offset: 6, length: 5 })
    expect(result.ok).toBe(true)
    const value = result.value as { data: string; size: number; eof: boolean; offset: number }
    expect(decode(value.data)).toBe('world')
    expect(value.size).toBe(21)
    expect(value.eof).toBe(false)
  })

  it('flags end of file', async () => {
    const result = await call('readRange', { path: join(root, 'notes.txt'), offset: 20, length: 100 })
    expect(result.ok).toBe(true)
    expect((result.value as { eof: boolean }).eof).toBe(true)
  })

  it('reads a bounded head', async () => {
    const result = await call('readHead', { path: join(root, 'big.bin'), maxBytes: 16 })
    expect(result.ok).toBe(true)
    const value = result.value as { data: string; size: number; truncated: boolean }
    expect(value.size).toBe(1000)
    expect(value.truncated).toBe(true)
    expect(decode(value.data).length).toBe(16)
  })

  it('rejects paths outside the allowed roots', async () => {
    const result = await call('stat', { path: '/etc/hostname' })
    expect(result.ok).toBe(false)
    expect((result.error as { message?: string }).message).toMatch(/Access denied/)
  })

  it('rejects path traversal escaping the root', async () => {
    const result = await call('stat', { path: join(root, '..', '..', 'etc', 'hostname') })
    expect(result.ok).toBe(false)
  })

  it('accepts Windows-style resolved keys inside the root when contains mismatches casing', async () => {
    const file = join(root, 'notes.txt')
    const providers = new FileViewerContentRegistry()
    providers.register(new LocalFileContentProvider({
      fs: fakeFs(root, {
        async resolve(path) {
          if (path === root) return { targetKey: 'c:\\workspace\\project', displayPath: root }
          if (path === file) return { targetKey: 'C:\\Workspace\\Project\\notes.txt', displayPath: file }
          return { targetKey: path, displayPath: path }
        },
        contains() {
          return false
        },
        processPath(target) {
          return target.displayPath ?? target.targetKey
        },
      }),
      roots: [root],
    }))
    const windowsService = new FileViewerService({ providers })
    const result = await windowsService.handle('stat', { path: file }, new AbortController().signal)

    expect(result.ok).toBe(true)
    expect((result as { ok: true; value: { name: string } }).value.name).toBe('notes.txt')
  })

  it('accepts roots discovered from apiProxy at request time', async () => {
    const file = join(root, 'notes.txt')
    let apiProxyAvailable = false
    const providers = new FileViewerContentRegistry()
    providers.register(new LocalFileContentProvider({
      fs: fakeFs(root),
      apiProxy: () => apiProxyAvailable
        ? {
            workspace: {
              async list() {
                return { result: { ok: true, value: { items: [{ path: root }] } } }
              },
            },
            host: {
              async openPath() {
                return undefined
              },
            },
          }
        : undefined,
      roots: [],
    }))
    const dynamicService = new FileViewerService({ providers })

    const denied = await dynamicService.handle('stat', { path: file }, new AbortController().signal)
    expect(denied.ok).toBe(false)

    apiProxyAvailable = true
    const allowed = await dynamicService.handle('stat', { path: file }, new AbortController().signal)
    expect(allowed.ok).toBe(true)
    expect((allowed as { ok: true; value: { name: string } }).value.name).toBe('notes.txt')
  })

  it('accepts Windows roots discovered from apiProxy at request time', async () => {
    const file = join(root, 'notes.txt')
    const windowsRoot = 'c:\\workspace\\project\\'
    const windowsFile = 'C:\\Workspace\\Project\\notes.txt'
    const providers = new FileViewerContentRegistry()
    providers.register(new LocalFileContentProvider({
      fs: fakeFs(root, {
        async resolve(path) {
          if (path === windowsRoot.replace(/\\$/, '')) return { targetKey: 'c:\\workspace\\project', displayPath: root }
          if (path === windowsRoot) return { targetKey: 'c:\\workspace\\project', displayPath: root }
          if (path === windowsFile) return { targetKey: windowsFile, displayPath: file }
          return { targetKey: path, displayPath: path }
        },
        contains() {
          return false
        },
        processPath(target) {
          return target.displayPath ?? target.targetKey
        },
      }),
      apiProxy: {
        workspace: {
          async list() {
            return { result: { ok: true, value: { items: [{ path: windowsRoot }] } } }
          },
        },
        host: {
          async openPath() {
            return undefined
          },
        },
      },
      roots: [],
    }))
    const windowsService = new FileViewerService({ providers })
    const result = await windowsService.handle('stat', { path: windowsFile }, new AbortController().signal)

    expect(result.ok).toBe(true)
    expect((result as { ok: true; value: { name: string } }).value.name).toBe('notes.txt')
  })

  it('accepts session cwd roots discovered from apiProxy at request time', async () => {
    const file = join(root, 'notes.txt')
    const providers = new FileViewerContentRegistry()
    providers.register(new LocalFileContentProvider({
      fs: fakeFs(root),
      apiProxy: {
        workspace: {
          async list() {
            return { result: { ok: true, value: { items: [] } } }
          },
        },
        sessions: {
          async list() {
            return { result: { ok: true, value: { items: [{ cwd: root }] } } }
          },
        },
        host: {
          async openPath() {
            return undefined
          },
        },
      },
      roots: [],
    }))
    const sessionCwdService = new FileViewerService({ providers })
    const result = await sessionCwdService.handle('stat', { path: file }, new AbortController().signal)

    expect(result.ok).toBe(true)
    expect((result as { ok: true; value: { name: string } }).value.name).toBe('notes.txt')
  })

  it('rejects malformed payloads', async () => {
    const result = await call('readRange', { path: join(root, 'notes.txt'), offset: -1, length: 5 })
    expect(result.ok).toBe(false)
  })

  it('lists a directory with entries', async () => {
    const result = await call('list', { path: root })
    expect(result.ok).toBe(true)
    const value = result.value as { path: string; entries: Array<{ name: string; isDirectory: boolean }> }
    const names = value.entries.map((entry) => entry.name)
    expect(names).toContain('notes.txt')
    expect(names).toContain('data.csv')
    expect(names).toContain('sub')
    const sub = value.entries.find((entry) => entry.name === 'sub')
    expect(sub?.isDirectory).toBe(true)
  })

  it('fails openExternal when no api proxy is available', async () => {
    const result = await call('openExternal', { path: join(root, 'notes.txt') })
    expect(result.ok).toBe(false)
    expect((result.error as { message?: string }).message).toMatch(/not available/)
  })

  it('returns bad-request for unknown endpoints', async () => {
    const result = await call('nope', {})
    expect(result.ok).toBe(false)
    expect((result.error as { message?: string }).message).toMatch(/Unknown endpoint/)
  })
})

describe('registered content providers', () => {
  const locator = 'artifact://run-42/report.json'
  const bytes = new TextEncoder().encode('{"ok":true}')
  const provider: FileViewerContentProvider = {
    id: 'test-artifacts',
    supports: (candidate) => candidate.startsWith('artifact://'),
    async stat(candidate) {
      if (candidate !== locator) return undefined
      return { name: 'report.json', mime: 'application/json', size: bytes.byteLength }
    },
    async read(candidate, request) {
      if (candidate !== locator) throw new Error('missing artifact')
      return bytes.slice(request.offset, request.offset + request.length)
    },
  }

  it('reads non-filesystem content through a registered provider', async () => {
    const providers = new FileViewerContentRegistry()
    providers.register(provider)
    const virtualService = new FileViewerService({ providers })
    const signal = new AbortController().signal

    const statResult = await virtualService.handle('stat', { path: locator }, signal)
    expect(statResult).toEqual({
      ok: true,
      value: {
        path: locator,
        name: 'report.json',
        ext: 'json',
        mime: 'application/json',
        size: bytes.byteLength,
        mtimeMs: undefined,
        isDirectory: false,
        exists: true,
      },
    })

    const rangeResult = await virtualService.handle('readRange', { path: locator, offset: 2, length: 4 }, signal)
    expect(rangeResult.ok).toBe(true)
    const value = (rangeResult as { ok: true; value: { data: string; size: number } }).value
    expect(decode(value.data)).toBe('ok":')
    expect(value.size).toBe(bytes.byteLength)
  })

  it('unregisters providers cleanly', async () => {
    const providers = new FileViewerContentRegistry()
    const unregister = providers.register(provider)
    unregister()
    const virtualService = new FileViewerService({ providers })
    const result = await virtualService.handle('stat', { path: locator }, new AbortController().signal)
    expect(result.ok).toBe(false)
    expect((result as { ok: false; error: { message: string } }).error.message).toMatch(/No content provider/)
  })

  it('prefers a custom provider over a later fallback registration', () => {
    const providers = new FileViewerContentRegistry()
    providers.register(provider)
    providers.register({
      id: 'broad-fallback',
      priority: -1000,
      supports: () => true,
      async stat() { return undefined },
      async read() { return new Uint8Array() },
    })
    expect(providers.resolve(locator)).toBe(provider)
  })
})
