/**
 * JSON parsing helpers for the JSON/YAML tree views: safe parsing plus a
 * flat "path → value" projection used to render expandable trees and to
 * copy values / paths.
 */

export type JsonScalar = string | number | boolean | null

export interface JsonNode {
  /** Path from the root, e.g. `user.settings[0].name`. */
  path: string
  /** Display key of this node (object key or array index). */
  key: string
  value: unknown
  kind: 'object' | 'array' | 'scalar'
  /** Children count for objects/arrays (0 for scalars). */
  size: number
}

export type JsonParseResult =
  | { ok: true; value: unknown; nodes: JsonNode[] }
  | { ok: false; error: string }

/** Parse JSON, returning a structured error message instead of throwing. */
export function parseJson(text: string): JsonParseResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
  return { ok: true, value, nodes: buildJsonTree(value) }
}

/** Flatten a parsed JSON value into path-addressed nodes (depth-first). */
export function buildJsonTree(value: unknown, prefix = ''): JsonNode[] {
  const nodes: JsonNode[] = []
  const walk = (current: unknown, path: string, key: string): void => {
    if (Array.isArray(current)) {
      nodes.push({ path, key, value: current, kind: 'array', size: current.length })
      current.forEach((item, index) => {
        walk(item, path === '' ? String(index) : `${path}[${index}]`, String(index))
      })
      return
    }
    if (typeof current === 'object' && current !== null) {
      const record = current as Record<string, unknown>
      const keys = Object.keys(record)
      nodes.push({ path, key, value: current, kind: 'object', size: keys.length })
      for (const childKey of keys) {
        walk(record[childKey], path === '' ? childKey : `${path}.${childKey}`, childKey)
      }
      return
    }
    nodes.push({ path, key, value: current, kind: 'scalar', size: 0 })
  }
  walk(value, prefix, '')
  return nodes
}

/** Render a scalar for display. */
export function scalarText(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

/** Look up a value by dotted path inside a parsed JSON value. */
export function getByPath(value: unknown, path: string): unknown {
  if (path === '') return value
  const parts = path.split('.')
  let current: unknown = value
  for (const part of parts) {
    const indexMatch = /^(.*)\[(\d+)\]$/.exec(part)
    if (indexMatch !== null) {
      const container = (current as Record<string, unknown> | undefined)?.[indexMatch[1] ?? '']
      current = Array.isArray(container) ? container[Number(indexMatch[2])] : undefined
    } else {
      current = (current as Record<string, unknown> | undefined)?.[part]
    }
    if (current === undefined) return undefined
  }
  return current
}
