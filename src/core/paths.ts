/**
 * Path safety: normalization and root-boundary validation. The host is the
 * final authority (it realpaths through ctx.fs and checks containment), but
 * these helpers give the client a cheap pre-check and give the host a
 * consistent vocabulary, and they are fully unit-tested.
 */

/** Reject unsafe request inputs before they reach the host. */
export function normalizeRequestPath(input: unknown): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error('A file path is required.')
  }
  const trimmed = input.trim()
  if (trimmed.includes('\u0000')) {
    throw new Error('The path contains a NUL byte.')
  }
  if (trimmed.length > 4096) {
    throw new Error('The path is too long.')
  }
  return trimmed
}

/**
 * Lexical containment test: is `candidate` equal to `root` or inside it?
 * Dot segments (`.`, `..`) are resolved before comparing. Windows-looking
 * paths are compared case-insensitively to match drive-letter behavior.
 */
export function isPathInside(root: string, candidate: string): boolean {
  const r = comparisonPath(root)
  const c = comparisonPath(candidate)
  if (c === r) return true
  return c.startsWith(`${r}/`)
}

/** Resolve `.`/`..` segments lexically (no filesystem access). */
function resolveSegments(path: string): string[] {
  const segments = normalizeSeparators(path).split('/')
  const out: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      out.pop()
      continue
    }
    out.push(segment)
  }
  return out
}

/** Normalize separators to forward slashes and collapse duplicate slashes. */
export function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
}

/** Trim and remove trailing separators from a root, preserving drive roots. */
export function normalizeRootPath(path: string): string {
  const trimmed = path.trim()
  if (trimmed === '') return ''
  const driveRoot = trimmed.match(/^([A-Za-z]:)([/\\])?$/)
  if (driveRoot !== null) return `${driveRoot[1]}${driveRoot[2] ?? '/'}`
  if (/^[/\\]+$/.test(trimmed)) return trimmed.startsWith('\\') ? '\\' : '/'
  return trimmed.replace(/[/\\]+$/, '')
}

/** True for absolute local paths, including Windows drive-letter paths. */
export function isAbsoluteLocalPath(path: string): boolean {
  const normalized = normalizeSeparators(path)
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
}

/** Check a candidate path against a list of allowed roots (any root passes). */
export function isInsideAnyRoot(roots: readonly string[], candidate: string): boolean {
  return roots.some((root) => isPathInside(root, candidate))
}

/** Join segments safely: the result must stay inside `root`. */
export function safeJoin(root: string, ...segments: string[]): string {
  const base = normalizeSeparators(root).replace(/\/+$/, '')
  const joined = [base, ...segments.map((segment) => normalizeSeparators(segment).replace(/^\/+|\/+$/g, ''))]
    .filter(Boolean)
    .join('/')
  if (!isPathInside(root, joined)) {
    throw new Error('Resolved path escapes the allowed root.')
  }
  return joined
}

/** True when a path contains traversal segments (`..`). */
export function hasTraversal(path: string): boolean {
  const segments = normalizeSeparators(path).split('/')
  return segments.includes('..')
}

function comparisonPath(path: string): string {
  const normalized = resolveSegments(path).join('/')
  return isWindowsLikePath(path) ? normalized.toLowerCase() : normalized
}

function isWindowsLikePath(path: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\') || path.startsWith('//')
}
