/**
 * Lightweight, dependency-free CSV parser tuned for streaming: quote-aware,
 * CRLF/LF tolerant, delimiter auto-detection, and safe on malformed input.
 * It never throws on bad data — malformed rows degrade to literal fields.
 */
export declare const DELIMITER_CANDIDATES: readonly [",", ";", "\t", "|"];
/**
 * Count delimiter occurrences outside quoted regions in a text sample and
 * pick the most plausible delimiter. Ties resolve to candidate order.
 */
export declare function detectDelimiter(sample: string, candidates?: readonly string[]): string;
/** One logical record as raw fields (no type inference — the viewer owns display). */
export type CsvRow = string[];
/**
 * Streaming CSV parser: feed chunks with `push`, collect completed rows,
 * then call `finish()` to flush the trailing record. Keeps only the
 * partial record between pushes — memory is bounded by what the caller keeps.
 */
export declare class CsvStreamParser {
    private readonly delimiter;
    private inQuotes;
    private field;
    private row;
    private done;
    constructor(delimiter?: string);
    /**
     * Feed one decoded text chunk. Returns the rows completed by this chunk.
     * Partial records (possibly split across chunk boundaries) are carried in
     * parser state and continue on the next push.
     */
    push(chunk: string): CsvRow[];
    /** Flush any unterminated trailing record. Safe to call once. */
    finish(): CsvRow[];
    private parse;
}
/**
 * One-shot convenience: parse a full text (already decoded, bounded by the
 * caller's large-file strategy) into rows, tolerating malformed input.
 */
export declare function parseCsv(text: string, delimiter?: string, maxRows?: number): {
    rows: CsvRow[];
    delimiter: string;
    truncated: boolean;
};
/** Simple quoted-aware field split for one line (used by the CSV table header). */
export declare function splitLine(line: string, delimiter: string): string[];
