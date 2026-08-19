import { describe, it, expect } from 'vitest'
import { parseJson, buildJsonTree, scalarText, getByPath } from '../src/core/json.js'

describe('JSON parsing', () => {
  it('parses valid JSON', () => {
    const result = parseJson('{"user": {"name": "Alice", "age": 30}, "tags": ["a", "b"]}')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ user: { name: 'Alice', age: 30 }, tags: ['a', 'b'] })
    }
  })

  it('reports a structured error for malformed JSON', () => {
    const result = parseJson('{"user": "unterminated')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
  })

  it('rejects non-object roots gracefully', () => {
    expect(parseJson('42').ok).toBe(true)
    expect(parseJson('[1,2,3]').ok).toBe(true)
    expect(parseJson('undefined').ok).toBe(false)
  })

  it('builds a path-addressable tree', () => {
    const nodes = buildJsonTree({ user: { name: 'Alice' }, list: [1, 2] })
    const paths = nodes.map((node) => node.path)
    expect(paths).toContain('')
    expect(paths).toContain('user')
    expect(paths).toContain('user.name')
    expect(paths).toContain('list[0]')
    expect(paths).toContain('list[1]')
    const nameNode = nodes.find((node) => node.path === 'user.name')
    expect(nameNode?.value).toBe('Alice')
  })

  it('renders scalars', () => {
    expect(scalarText('hi')).toBe('"hi"')
    expect(scalarText(42)).toBe('42')
    expect(scalarText(true)).toBe('true')
    expect(scalarText(null)).toBe('null')
  })

  it('looks up values by path', () => {
    const value = { user: { name: 'Alice' }, list: [{ id: 1 }] }
    expect(getByPath(value, 'user.name')).toBe('Alice')
    expect(getByPath(value, 'list[0].id')).toBe(1)
    expect(getByPath(value, 'missing')).toBeUndefined()
  })
})
