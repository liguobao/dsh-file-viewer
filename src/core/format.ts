/** Small formatting helpers shared by host and client. */

/** Trailing path segment (handles both separators). */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** Directory part of a path ('' when none). */
export function dirname(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? '' : path.slice(0, at)
}

/** Extension of a basename, lower-cased, without the dot ('' when none). */
export function extname(path: string): string {
  const base = basename(path)
  const at = base.lastIndexOf('.')
  if (at <= 0 || at === base.length - 1) return ''
  return base.slice(at + 1).toLowerCase()
}

/** Human-readable byte size, e.g. "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB'] as const
  let value = bytes
  let unit = 'B'
  for (const candidate of units) {
    value /= 1024
    unit = candidate
    if (value < 1024) break
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${unit}`
}

/** Localized time string from an epoch-ms value. */
export function formatTime(mtimeMs: number | undefined): string {
  if (mtimeMs === undefined || !Number.isFinite(mtimeMs)) return '—'
  const date = new Date(mtimeMs)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

/** Compact "HH:MM" or "MM-DD HH:MM" style time (matches the requested status bar). */
export function formatClock(mtimeMs: number | undefined): string {
  if (mtimeMs === undefined || !Number.isFinite(mtimeMs)) return '—'
  const date = new Date(mtimeMs)
  if (Number.isNaN(date.getTime())) return '—'
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
