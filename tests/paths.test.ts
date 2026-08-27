import { describe, it, expect } from 'vitest'
import {
  normalizeRequestPath,
  isAbsoluteLocalPath,
  isPathInside,
  isInsideAnyRoot,
  safeJoin,
  hasTraversal,
} from '../src/core/paths.js'

describe('path validation', () => {
  it('rejects empty, NUL, and non-string inputs', () => {
    expect(() => normalizeRequestPath('')).toThrow()
    expect(() => normalizeRequestPath('   ')).toThrow()
    expect(() => normalizeRequestPath('a\u0000b')).toThrow()
    expect(() => normalizeRequestPath(42)).toThrow()
    expect(() => normalizeRequestPath(undefined)).toThrow()
  })

  it('accepts normal absolute and relative paths', () => {
    expect(normalizeRequestPath('/workspace/a.txt')).toBe('/workspace/a.txt')
    expect(normalizeRequestPath('notes/readme.md')).toBe('notes/readme.md')
  })

  it('rejects traversal outside the root', () => {
    expect(isPathInside('/workspace', '/workspace/a.txt')).toBe(true)
    expect(isPathInside('/workspace', '/workspace')).toBe(true)
    expect(isPathInside('/workspace', '/workspace/sub/deep.txt')).toBe(true)
    expect(isPathInside('/workspace', '/etc/passwd')).toBe(false)
    expect(isPathInside('/workspace', '/workspace-secret/x')).toBe(false) // prefix, not a real child
    expect(isPathInside('/workspace', '/workspace/../etc/passwd')).toBe(false)
  })

  it('checks membership across multiple roots', () => {
    const roots = ['/workspace', '/home/user/project']
    expect(isInsideAnyRoot(roots, '/workspace/a.txt')).toBe(true)
    expect(isInsideAnyRoot(roots, '/home/user/project/src/main.ts')).toBe(true)
    expect(isInsideAnyRoot(roots, '/tmp/evil')).toBe(false)
  })

  it('safeJoin stays inside the root or throws', () => {
    expect(safeJoin('/workspace', 'a', 'b.txt')).toBe('/workspace/a/b.txt')
    expect(() => safeJoin('/workspace', '..', '..', 'etc')).toThrow()
  })

  it('flags traversal segments', () => {
    expect(hasTraversal('a/../b')).toBe(true)
    expect(hasTraversal('a/b/c.txt')).toBe(false)
  })

  it('normalizes windows separators', () => {
    expect(isPathInside('C:/workspace', 'C:\\workspace\\a.txt')).toBe(true)
    expect(isPathInside('c:/workspace', 'C:\\Workspace\\a.txt')).toBe(true)
    expect(isPathInside('C:/workspace', 'D:\\workspace\\a.txt')).toBe(false)
    expect(isPathInside('/Workspace', '/workspace/a.txt')).toBe(false)
  })

  it('detects absolute local paths across platforms', () => {
    expect(isAbsoluteLocalPath('/workspace/a.txt')).toBe(true)
    expect(isAbsoluteLocalPath('C:\\workspace\\a.txt')).toBe(true)
    expect(isAbsoluteLocalPath('C:/workspace/a.txt')).toBe(true)
    expect(isAbsoluteLocalPath('notes/readme.md')).toBe(false)
  })
})
