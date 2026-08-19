import { describe, it, expect } from 'vitest'
import { detectDelimiter, CsvStreamParser, parseCsv, splitLine } from '../src/core/csv.js'

describe('delimiter detection', () => {
  it('detects commas, semicolons, tabs and pipes outside quotes', () => {
    expect(detectDelimiter('a,b,c\n1,2,3\n')).toBe(',')
    expect(detectDelimiter('a;b;c\n1;2;3\n')).toBe(';')
    expect(detectDelimiter('a\tb\tc\n1\t2\t3\n')).toBe('\t')
    expect(detectDelimiter('a|b|c\n1|2|3\n')).toBe('|')
  })

  it('ignores delimiters inside quoted fields', () => {
    expect(detectDelimiter('a,"b,c",d\n')).toBe(',')
    expect(detectDelimiter('name,"value;with;semis"\n')).toBe(',')
  })

  it('defaults to comma for single-column content', () => {
    expect(detectDelimiter('hello\nworld\n')).toBe(',')
  })
})

describe('streaming CSV parsing', () => {
  it('parses simple rows', () => {
    const rows = parseCsv('a,b,c\n1,2,3\n')
    expect(rows.rows).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
    expect(rows.delimiter).toBe(',')
  })

  it('handles quoted fields with embedded delimiters and newlines', () => {
    const rows = parseCsv('name,note\nalice,"hello, world"\nbob,"line1\nline2"\n')
    expect(rows.rows[1]).toEqual(['alice', 'hello, world'])
    expect(rows.rows[2]).toEqual(['bob', 'line1\nline2'])
  })

  it('handles escaped quotes (RFC 4180 "")', () => {
    const rows = parseCsv('a,b\n"say ""hi""",2\n')
    expect(rows.rows[1]).toEqual(['say "hi"', '2'])
  })

  it('handles CRLF and bare CR line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n').rows).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a,b\r1,2\r').rows).toEqual([['a', 'b'], ['1', '2']])
  })

  it('streams across chunk boundaries without losing rows', () => {
    const parser = new CsvStreamParser(',')
    const first = parser.push('a,b,c\n1,2,')
    const second = parser.push('3\n4,5,6\n')
    const tail = parser.finish()
    expect([...first, ...second, ...tail]).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ])
  })

  it('keeps a partial record between chunks (mid-field split)', () => {
    const parser = new CsvStreamParser(',')
    const first = parser.push('a,"unfinished')
    const second = parser.push(' field",b\n')
    const tail = parser.finish()
    expect([...first, ...second, ...tail]).toEqual([['a', 'unfinished field', 'b']])
  })

  it('does not throw on malformed input (unclosed quote at EOF)', () => {
    const result = parseCsv('a,b\n1,"unterminated')
    expect(result.rows.length).toBeGreaterThanOrEqual(1)
    expect(result.rows[0]).toEqual(['a', 'b'])
  })

  it('caps row counts and reports truncation', () => {
    const text = Array.from({ length: 100 }, (_, index) => `r${index},x`).join('\n') + '\n'
    const result = parseCsv(text, ',', 10)
    expect(result.rows.length).toBe(10)
    expect(result.truncated).toBe(true)
  })

  it('splits a single line with quotes', () => {
    expect(splitLine('a,"b,c",d', ',')).toEqual(['a', 'b,c', 'd'])
  })

  it('parses trailing empty fields', () => {
    const rows = parseCsv('a,b,c\n1,2,\n')
    expect(rows.rows[1]).toEqual(['1', '2', ''])
  })
})
