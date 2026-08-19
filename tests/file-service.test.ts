import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileViewerService, type FsLike } from '../src/server/file-service.js'
import { isPathInside } from '../src/core/paths.js'

let root: string
let service: FileViewerService

/** Minimal structural ctx.fs double over the real filesystem. */
function fakeFs(base: string): FsLike {
  return {
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
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsfv-test-'))
  await writeFile(join(root, 'notes.txt'), 'hello world\nline two\n')
  await writeFile(join(root, 'data.csv'), 'a,b,c\n1,2,3\n')
  await writeFile(join(root, 'paper.pdf'), '%PDF-1.4 fake')
  await mkdir(join(root, 'sub'))
  await writeFile(join(root, 'sub', 'deep.txt'), 'deep')
  await writeFile(join(root, 'big.bin'), Buffer.alloc(1000, 7))
  service = new FileViewerService({
    fs: fakeFs(root),
    roots: [root],
    cwd: root,
  })
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
