import { describe, it, expect } from 'vitest'
import { detectMime, mimeFromExtension, looksBinary } from '../src/core/mime.js'

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values)
}

describe('mime detection', () => {
  it('detects PNG by magic bytes regardless of extension', () => {
    const head = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00)
    expect(detectMime('photo.png', head)).toBe('image/png')
    expect(detectMime('photo.dat', head)).toBe('image/png') // extension must not override magic
  })

  it('detects JPEG, GIF, WEBP, BMP by magic bytes', () => {
    expect(detectMime('a.jpg', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(detectMime('a.bin', bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image/gif')
    expect(detectMime('a.bin', bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe('image/webp')
    expect(detectMime('a.bin', bytes(0x42, 0x4d, 0x00))).toBe('image/bmp')
  })

  it('detects PDF by magic bytes', () => {
    expect(detectMime('paper.bin', bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34))).toBe('application/pdf')
  })

  it('falls back to extension when no magic is present', () => {
    expect(detectMime('notes.md')).toBe('text/markdown')
    expect(detectMime('data.csv')).toBe('text/csv')
    expect(detectMime('main.py')).toBe('text/x-python')
    expect(detectMime('app.js')).toBe('text/javascript')
  })

  it('classifies NUL-containing payloads as binary', () => {
    expect(looksBinary(bytes(0x41, 0x00, 0x42))).toBe(true)
    expect(looksBinary(bytes(0x41, 0x42, 0x43))).toBe(false)
  })

  it('detects octet-stream for unknown extensions with binary content', () => {
    const head = bytes(0x00, 0x01, 0x02)
    expect(detectMime('blob.unknown', head)).toBe('application/octet-stream')
  })

  it('treats NUL-free unknown payloads as text', () => {
    const head = bytes(0x68, 0x65, 0x6c, 0x6c, 0x6f)
    expect(detectMime('mystery', head)).toBe('text/plain')
  })

  it('maps a broad set of extensions', () => {
    expect(mimeFromExtension('file.ts')).toBe('text/typescript')
    expect(mimeFromExtension('file.go')).toBe('text/x-go')
    expect(mimeFromExtension('file.yaml')).toBe('application/yaml')
    expect(mimeFromExtension('file.log')).toBe('text/plain')
    expect(mimeFromExtension('file.xyz')).toBe('application/octet-stream')
  })
})
