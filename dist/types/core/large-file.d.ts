/**
 * Large-file strategy. Thresholds keep DSH responsive: whole-file reads under
 * the normal cap, chunked streaming through the stream band, and head-only
 * plus explicit chunk navigation for truly large files.
 */
export declare const NORMAL_MAX_BYTES: number;
export declare const STREAM_MAX_BYTES: number;
export declare const DEFAULT_CHUNK_BYTES: number;
export declare const CSV_ROW_CAP = 10000;
export declare const JSON_MAX_BYTES: number;
export type LargeFileMode = 'normal' | 'stream' | 'large';
/** Classify a byte size into a loading strategy. */
export declare function classifySize(size: number): LargeFileMode;
export interface LoadPlan {
    mode: LargeFileMode;
    /** Bytes loaded on first open. */
    initialBytes: number;
    /** Whether the initial load covers the whole file. */
    complete: boolean;
    /** Human hint shown to the user for very large files. */
    hint?: string;
}
/** Plan the initial read for a file of `size` bytes. */
export declare function initialLoadPlan(size: number, chunkBytes?: number): LoadPlan;
/** Whether a whole-file read is safe for a renderer (e.g. image/pdf/json). */
export declare function allowWholeRead(size: number, cap?: number): boolean;
