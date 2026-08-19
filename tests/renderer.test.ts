import { describe, it, expect } from 'vitest'
import { RendererRegistry, buildFileInfo } from '../src/core/renderer.js'

function file(overrides: Partial<Parameters<typeof buildFileInfo>[0]> = {}): ReturnType<typeof buildFileInfo> {
  return buildFileInfo({
    path: '/workspace/file',
    name: 'file',
    ext: '',
    size: 100,
    mtimeMs: 0,
    isDirectory: false,
    ...overrides,
  })
}

function fileWithHead(path: string, head: Uint8Array): ReturnType<typeof buildFileInfo> {
  return buildFileInfo({
    path,
    name: path.split('/').pop() ?? path,
    ext: path.split('.').pop() ?? '',
    size: 100,
    mtimeMs: 0,
    isDirectory: false,
    head,
  })
}

describe('renderer registry', () => {
  it('resolves by MIME (magic bytes win over extension)', () => {
    const registry = new RendererRegistry()
    const png = fileWithHead('photo.dat', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(registry.resolve(png)).toBe('image')
    const pdf = fileWithHead('paper.bin', Uint8Array.from([0x25, 0x50, 0x44, 0x46]))
    expect(registry.resolve(pdf)).toBe('pdf')
  })

  it('resolves by extension', () => {
    const registry = new RendererRegistry()
    expect(registry.resolve(file({ path: '/w/main.py', name: 'main.py', ext: 'py', }))).toBe('code')
    expect(registry.resolve(file({ path: '/w/README.md', name: 'README.md', ext: 'md', }))).toBe('markdown')
    expect(registry.resolve(file({ path: '/w/data.csv', name: 'data.csv', ext: 'csv', }))).toBe('csv')
    expect(registry.resolve(file({ path: '/w/config.json', name: 'config.json', ext: 'json', }))).toBe('json')
    expect(registry.resolve(file({ path: '/w/out.log', name: 'out.log', ext: 'log', }))).toBe('text')
  })

  it('falls back for unknown binary content', () => {
    const registry = new RendererRegistry()
    const unknown = fileWithHead('blob.zzz', Uint8Array.from([0x00, 0x01, 0x02]))
    expect(registry.resolve(unknown)).toBe('fallback')
  })

  it('honours a forced renderer', () => {
    const registry = new RendererRegistry()
    const csv = file({ path: '/w/data.csv', name: 'data.csv', ext: 'csv', })
    expect(registry.resolve(csv, 'text')).toBe('text')
    expect(registry.resolve(csv, 'json')).toBe('json')
    expect(registry.resolve(csv, 'auto')).toBe('csv')
  })

  it('supports custom renderer registration with priority', () => {
    const registry = new RendererRegistry()
    registry.register({ id: 'my-format', priority: 500, extensions: ['zzz'] })
    const zzz = file({ path: '/w/a.zzz', name: 'a.zzz', ext: 'zzz', })
    expect(registry.resolve(zzz)).toBe('my-format')
    registry.unregister('my-format')
    expect(registry.resolve(zzz)).toBe('fallback')
  })

  it('higher priority wins when several renderers match', () => {
    const registry = new RendererRegistry()
    registry.register({ id: 'premium-csv', priority: 200, extensions: ['csv'] })
    const csv = file({ path: '/w/data.csv', name: 'data.csv', ext: 'csv', })
    expect(registry.resolve(csv)).toBe('premium-csv')
  })

  it('text mime resolves to text for unknown extension text files', () => {
    const registry = new RendererRegistry()
    const txt = fileWithHead('/w/mystery', Uint8Array.from([0x68, 0x69]))
    expect(txt.mime).toBe('text/plain')
    expect(registry.resolve(txt)).toBe('text')
  })
})
