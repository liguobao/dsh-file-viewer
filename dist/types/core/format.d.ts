/** Small formatting helpers shared by host and client. */
/** Trailing path segment (handles both separators). */
export declare function basename(path: string): string;
/** Directory part of a path ('' when none). */
export declare function dirname(path: string): string;
/** Extension of a basename, lower-cased, without the dot ('' when none). */
export declare function extname(path: string): string;
/** Human-readable byte size, e.g. "1.2 MB". */
export declare function formatBytes(bytes: number): string;
/** Localized time string from an epoch-ms value. */
export declare function formatTime(mtimeMs: number | undefined): string;
/** Compact "HH:MM" or "MM-DD HH:MM" style time (matches the requested status bar). */
export declare function formatClock(mtimeMs: number | undefined): string;
