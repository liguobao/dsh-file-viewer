/**
 * Lightweight, dependency-free CSV parser tuned for streaming: quote-aware,
 * CRLF/LF tolerant, delimiter auto-detection, and safe on malformed input.
 * It never throws on bad data — malformed rows degrade to literal fields.
 */

export const DELIMITER_CANDIDATES = [',', ';', '\t', '|'] as const

/**
 * Count delimiter occurrences outside quoted regions in a text sample and
 * pick the most plausible delimiter. Ties resolve to candidate order.
 */
export function detectDelimiter(sample: string, candidates: readonly string[] = DELIMITER_CANDIDATES): string {
  let best = ','
  let bestCount = -1
  for (const candidate of candidates) {
    if (candidate === '') continue
    let count = 0
    let inQuotes = false
    for (let i = 0; i < sample.length; i += 1) {
      const ch = sample[i]
      if (ch === '"') {
        // A doubled quote inside a quoted field is an escaped quote.
        if (inQuotes && sample[i + 1] === '"') {
          i += 1
          continue
        }
        inQuotes = !inQuotes
      } else if (ch === candidate && !inQuotes) {
        count += 1
      }
    }
    // Prefer the delimiter that appears at least once; among candidates with
    // equal counts keep the first (comma default for single-column files).
    if (count > bestCount) {
      bestCount = count
      best = candidate
    }
  }
  return best
}

/** One logical record as raw fields (no type inference — the viewer owns display). */
export type CsvRow = string[]

/**
 * Streaming CSV parser: feed chunks with `push`, collect completed rows,
 * then call `finish()` to flush the trailing record. Keeps only the
 * partial record between pushes — memory is bounded by what the caller keeps.
 */
export class CsvStreamParser {
  private readonly delimiter: string
  private inQuotes = false
  private field = ''
  private row: string[] = []
  private done = false

  constructor(delimiter?: string) {
    this.delimiter = delimiter ?? ','
  }

  /**
   * Feed one decoded text chunk. Returns the rows completed by this chunk.
   * Partial records (possibly split across chunk boundaries) are carried in
   * parser state and continue on the next push.
   */
  push(chunk: string): CsvRow[] {
    if (this.done) return []
    return this.parse(chunk)
  }

  /** Flush any unterminated trailing record. Safe to call once. */
  finish(): CsvRow[] {
    if (this.done) return []
    this.done = true
    // A trailing separator leaves an empty final field.
    const rows: CsvRow[] = []
    if (this.field !== '' || this.row.length > 0) {
      this.row.push(this.field)
      rows.push(this.row)
    }
    return rows
  }

  private parse(text: string): CsvRow[] {
    const rows: CsvRow[] = []
    let i = 0
    while (i < text.length) {
      const ch = text[i]
      if (this.inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            this.field += '"'
            i += 2
            continue
          }
          this.inQuotes = false
          i += 1
          continue
        }
        this.field += ch
        i += 1
        continue
      }
      if (ch === '"' && this.field === '') {
        this.inQuotes = true
        i += 1
        continue
      }
      if (ch === this.delimiter) {
        this.row.push(this.field)
        this.field = ''
        i += 1
        continue
      }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i += 1
        this.row.push(this.field)
        rows.push(this.row)
        this.row = []
        this.field = ''
        i += 1
        continue
      }
      this.field += ch
      i += 1
    }
    return rows
  }
}

/**
 * One-shot convenience: parse a full text (already decoded, bounded by the
 * caller's large-file strategy) into rows, tolerating malformed input.
 */
export function parseCsv(text: string, delimiter?: string, maxRows = Infinity): { rows: CsvRow[]; delimiter: string; truncated: boolean } {
  const separator = delimiter ?? detectDelimiter(text)
  const parser = new CsvStreamParser(separator)
  const rows: CsvRow[] = []
  let truncated = false
  for (const row of parser.push(text)) {
    if (rows.length >= maxRows) {
      truncated = true
      break
    }
    rows.push(row)
  }
  if (!truncated) {
    for (const row of parser.finish()) {
      if (rows.length >= maxRows) {
        truncated = true
        break
      }
      rows.push(row)
    }
  }
  return { rows, delimiter: separator, truncated }
}

/** Simple quoted-aware field split for one line (used by the CSV table header). */
export function splitLine(line: string, delimiter: string): string[] {
  const parser = new CsvStreamParser(delimiter)
  const rows = parser.push(line)
  const tail = parser.finish()
  return rows[0] ?? tail[0] ?? []
}
