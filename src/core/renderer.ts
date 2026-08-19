/**
 * Renderer registry: decides which renderer handles a file. Matching never
 * depends on the extension alone — MIME (from magic bytes when available)
 * leads, the extension refines, and registrants may supply custom matchers
 * with priorities. Extensible so other plugins can register renderers.
 */

import { detectMime } from './mime.js'

export type RendererId =
  | 'image'
  | 'pdf'
  | 'csv'
  | 'code'
  | 'text'
  | 'markdown'
  | 'json'
  | 'yaml'
  | 'fallback'

/** Metadata about the file being previewed (host `stat` projection). */
export interface FileInfo {
  path: string
  name: string
  ext: string
  /** MIME from magic bytes when a head was read, else extension-based. */
  mime: string
  size: number
  mtimeMs: number | undefined
  isDirectory: boolean
  /** Present when the caller supplied a content head (magic-byte sniffing). */
  headBytes?: number
}

/** Open options the public API accepts. */
export interface OpenOptions {
  /** Jump the code/text renderer to this 1-based line. */
  line?: number
  /** Force a renderer id. */
  renderer?: RendererId
}

export interface RendererRegistration {
  id: RendererId | string
  /** Ascending; higher priority wins when several renderers match. */
  priority: number
  /** Extensions this renderer claims (lower-case, no dot). */
  extensions?: readonly string[]
  /** MIME prefixes/types this renderer claims. */
  mimes?: readonly string[]
  /** Optional fine-grained matcher; runs after mime/ext checks. */
  matches?: (file: FileInfo) => boolean
}

const CODE_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'py', 'go', 'rs', 'java',
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'cs', 'sh', 'bash', 'zsh', 'fish', 'ps1',
  'psd1', 'html', 'htm', 'css', 'scss', 'less', 'sql', 'r', 'lua', 'rb', 'php',
  'vue', 'svelte', 'swift', 'kotlin', 'kt', 'dart', 'scala', 'groovy', 'diff',
  'patch', 'xml', 'toml', 'proto',
])

const TEXT_EXTENSIONS = new Set(['txt', 'text', 'log', 'out', 'ini', 'conf', 'cfg', 'env', 'gitignore', 'lock'])

export class RendererRegistry {
  private readonly registrations: RendererRegistration[] = []

  constructor() {
    this.seedBuiltins()
  }

  /**
   * Register a renderer match rule. A renderer id may carry several rules
   * (e.g. by extension and by MIME); `unregister` removes them all.
   */
  register(registration: RendererRegistration): void {
    this.registrations.push({ ...registration, priority: registration.priority ?? 0 })
  }

  /** Remove every match rule for a renderer id. */
  unregister(id: string): void {
    for (let index = this.registrations.length - 1; index >= 0; index -= 1) {
      if (this.registrations[index]?.id === id) this.registrations.splice(index, 1)
    }
  }

  /** All registered ids, in priority order (highest first). */
  list(): readonly RendererRegistration[] {
    return [...this.registrations].sort((a, b) => b.priority - a.priority)
  }

  /** Resolve the renderer id for a file; `forced` overrides everything. */
  resolve(file: FileInfo, forced?: string): RendererId {
    if (forced !== undefined && forced !== 'auto') return forced as RendererId
    const candidates = this.registrations
      .filter((registration) => this.matches(registration, file))
      .sort((a, b) => b.priority - a.priority)
    return (candidates[0]?.id as RendererId | undefined) ?? 'fallback'
  }

  private matches(registration: RendererRegistration, file: FileInfo): boolean {
    if (registration.id === 'fallback') return false // never matched by rules
    if (registration.mimes !== undefined) {
      for (const mime of registration.mimes) {
        if (mime.endsWith('/*')) {
          if (file.mime.startsWith(mime.slice(0, -1))) return true
        } else if (file.mime === mime) {
          return true
        }
      }
    }
    if (registration.extensions !== undefined && file.ext !== '' && registration.extensions.includes(file.ext)) {
      return true
    }
    return registration.matches?.(file) ?? false
  }

  private seedBuiltins(): void {
    this.register({ id: 'image', priority: 100, mimes: ['image/*'] })
    this.register({ id: 'pdf', priority: 100, mimes: ['application/pdf'] })
    this.register({ id: 'csv', priority: 90, mimes: ['text/csv', 'text/tab-separated-values'], extensions: ['csv', 'tsv'] })
    this.register({ id: 'markdown', priority: 90, mimes: ['text/markdown'], extensions: ['md', 'markdown'] })
    this.register({ id: 'json', priority: 90, mimes: ['application/json', 'application/x-ndjson'], extensions: ['json', 'jsonl'] })
    this.register({ id: 'yaml', priority: 90, mimes: ['application/yaml'], extensions: ['yaml', 'yml'] })
    this.register({ id: 'code', priority: 80, extensions: [...CODE_EXTENSIONS] })
    this.register({ id: 'text', priority: 80, extensions: [...TEXT_EXTENSIONS] })
    // text/* catches everything else (including text/x-* code mimes without a
    // known extension) at a lower priority so mime-typed code still lands on code.
    this.register({ id: 'code', priority: 70, mimes: ['text/javascript', 'text/typescript', 'text/x-'] })
    this.register({ id: 'text', priority: 60, mimes: ['text/*'] })
  }
}

/** Convenience: build a FileInfo from host stat + optional sniffed mime. */
export function buildFileInfo(stat: {
  path: string
  name: string
  ext: string
  size: number
  mtimeMs?: number
  isDirectory: boolean
  head?: Uint8Array
}): FileInfo {
  return {
    path: stat.path,
    name: stat.name,
    ext: stat.ext,
    mime: detectMime(stat.path, stat.head),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    isDirectory: stat.isDirectory,
    headBytes: stat.head?.length,
  }
}
