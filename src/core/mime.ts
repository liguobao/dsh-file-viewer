/**
 * MIME / content-type detection. Never relies on the extension alone: when a
 * content head is available, magic bytes take precedence, and a NUL scan
 * decides binary-vs-text for unknown types.
 */

/** Extension → MIME table (lower-case extension without the dot). */
const EXTENSION_MIME: Readonly<Record<string, string>> = {
  // images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  // documents
  pdf: 'application/pdf',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  jsonl: 'application/x-ndjson',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  xml: 'application/xml',
  // plain text / logs
  txt: 'text/plain',
  text: 'text/plain',
  log: 'text/plain',
  out: 'text/plain',
  ini: 'text/plain',
  conf: 'text/plain',
  cfg: 'text/plain',
  env: 'text/plain',
  gitignore: 'text/plain',
  lock: 'text/plain',
  // source code
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  jsx: 'text/jsx',
  ts: 'text/typescript',
  mts: 'text/typescript',
  cts: 'text/typescript',
  tsx: 'text/tsx',
  py: 'text/x-python',
  go: 'text/x-go',
  rs: 'text/x-rust',
  java: 'text/x-java',
  c: 'text/x-c',
  h: 'text/x-c',
  cpp: 'text/x-c++',
  cc: 'text/x-c++',
  cxx: 'text/x-c++',
  hpp: 'text/x-c++',
  cs: 'text/x-csharp',
  sh: 'text/x-shellscript',
  bash: 'text/x-shellscript',
  zsh: 'text/x-shellscript',
  fish: 'text/x-shellscript',
  ps1: 'text/x-powershell',
  psd1: 'text/x-powershell',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  scss: 'text/x-scss',
  less: 'text/x-less',
  sql: 'text/x-sql',
  r: 'text/x-r',
  lua: 'text/x-lua',
  rb: 'text/x-ruby',
  php: 'text/x-php',
  vue: 'text/x-vue',
  svelte: 'text/x-svelte',
  swift: 'text/x-swift',
  kotlin: 'text/x-kotlin',
  kt: 'text/x-kotlin',
  dart: 'text/x-dart',
  scala: 'text/x-scala',
  groovy: 'text/x-groovy',
  diff: 'text/x-diff',
  patch: 'text/x-diff',
  // archives / binaries
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  gz2: 'application/x-7z-compressed',
  '7z': 'application/x-7z-compressed',
  exe: 'application/octet-stream',
  dll: 'application/octet-stream',
  so: 'application/octet-stream',
  dylib: 'application/octet-stream',
  bin: 'application/octet-stream',
  dat: 'application/octet-stream',
  db: 'application/octet-stream',
  sqlite: 'application/octet-stream',
  sqlite3: 'application/octet-stream',
  ipynb: 'application/x-ipynb+json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  wasm: 'application/wasm',
}

/** MIME by extension; falls back to application/octet-stream. */
export function mimeFromExtension(path: string): string {
  const ext = extname(path)
  return EXTENSION_MIME[ext] ?? 'application/octet-stream'
}

/** Raw bytes (Uint8Array) magic-byte signatures → MIME. */
export function mimeFromMagic(head: Uint8Array): string | undefined {
  const len = head.length
  const has = (i: number, byte: number): boolean => i < len && head[i] === byte

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (len >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png'
  // JPEG: FF D8 FF
  if (len >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  // GIF: GIF8
  if (len >= 4 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) return 'image/gif'
  // BMP: BM
  if (len >= 2 && head[0] === 0x42 && head[1] === 0x4d) return 'image/bmp'
  // WEBP: RIFF .... WEBP
  if (
    len >= 12 &&
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) return 'image/webp'
  // PDF: %PDF
  if (len >= 4 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'application/pdf'
  // ZIP (also xlsx/docx/pptx/jar): PK\x03\x04
  if (len >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'application/zip'
  // GZIP
  if (len >= 2 && head[0] === 0x1f && head[1] === 0x8b) return 'application/gzip'
  // 7z
  if (len >= 6 && head[0] === 0x37 && head[1] === 0x7a && head[2] === 0xbc && head[3] === 0xaf && head[4] === 0x27 && head[5] === 0x1c) return 'application/x-7z-compressed'
  // ELF
  if (len >= 4 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return 'application/octet-stream'
  // WASM
  if (len >= 4 && head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d) return 'application/wasm'
  return undefined
}

/**
 * Whether the head looks like binary content: a NUL byte within the first
 * 8 KiB of a non-BMP/non-PDF payload is a strong binary signal.
 */
export function looksBinary(head: Uint8Array): boolean {
  const limit = Math.min(head.length, 8192)
  for (let i = 0; i < limit; i += 1) {
    if (head[i] === 0) return true
  }
  return false
}

/**
 * Decide the MIME for a file given its path and, when available, a content
 * head. Magic bytes win; otherwise the extension; a NUL-free unknown payload
 * falls back to text/plain so text viewers can offer "Open as text".
 */
export function detectMime(path: string, head?: Uint8Array): string {
  if (head !== undefined && head.length > 0) {
    const byMagic = mimeFromMagic(head)
    if (byMagic !== undefined) return byMagic
    if (looksBinary(head)) return 'application/octet-stream'
    // No magic and no NULs: text. Let the extension refine (e.g. .md).
    const byExt = mimeFromExtension(path)
    if (byExt !== 'application/octet-stream') return byExt
    return 'text/plain'
  }
  return mimeFromExtension(path)
}

function extname(path: string): string {
  const at = path.lastIndexOf('/')
  const base = at === -1 ? path : path.slice(at + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}
