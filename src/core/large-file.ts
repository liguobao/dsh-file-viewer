/**
 * Large-file strategy. Thresholds keep DSH responsive: whole-file reads under
 * the normal cap, chunked streaming through the stream band, and head-only
 * plus explicit chunk navigation for truly large files.
 */

export const NORMAL_MAX_BYTES = 5 * 1024 * 1024 // 5 MiB
export const STREAM_MAX_BYTES = 50 * 1024 * 1024 // 50 MiB
export const DEFAULT_CHUNK_BYTES = 256 * 1024 // 256 KiB per range read
export const CSV_ROW_CAP = 10_000 // rows kept in memory for windowed tables
export const JSON_MAX_BYTES = 8 * 1024 * 1024 // whole-JSON cap for tree view

export type LargeFileMode = 'normal' | 'stream' | 'large'

/** Classify a byte size into a loading strategy. */
export function classifySize(size: number): LargeFileMode {
  if (size <= NORMAL_MAX_BYTES) return 'normal'
  if (size <= STREAM_MAX_BYTES) return 'stream'
  return 'large'
}

export interface LoadPlan {
  mode: LargeFileMode
  /** Bytes loaded on first open. */
  initialBytes: number
  /** Whether the initial load covers the whole file. */
  complete: boolean
  /** Human hint shown to the user for very large files. */
  hint?: string
}

/** Plan the initial read for a file of `size` bytes. */
export function initialLoadPlan(size: number, chunkBytes = DEFAULT_CHUNK_BYTES): LoadPlan {
  const mode = classifySize(size)
  if (mode === 'normal') {
    return { mode, initialBytes: size, complete: true }
  }
  if (mode === 'stream') {
    // First screenful = 1 chunk; the renderer streams further chunks on demand.
    return { mode, initialBytes: chunkBytes, complete: false }
  }
  // Large: one head chunk; user navigates explicitly.
  return {
    mode,
    initialBytes: chunkBytes,
    complete: false,
    hint: `This file is ${(size / 1024 / 1024).toFixed(0)} MB. Only part of the file will be loaded to keep DSH responsive.`,
  }
}

/** Whether a whole-file read is safe for a renderer (e.g. image/pdf/json). */
export function allowWholeRead(size: number, cap = STREAM_MAX_BYTES): boolean {
  return size <= cap
}
