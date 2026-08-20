/**
 * MIME / content-type detection. Never relies on the extension alone: when a
 * content head is available, magic bytes take precedence, and a NUL scan
 * decides binary-vs-text for unknown types.
 */
/** MIME by extension; falls back to application/octet-stream. */
export declare function mimeFromExtension(path: string): string;
/** Raw bytes (Uint8Array) magic-byte signatures → MIME. */
export declare function mimeFromMagic(head: Uint8Array): string | undefined;
/**
 * Whether the head looks like binary content: a NUL byte within the first
 * 8 KiB of a non-BMP/non-PDF payload is a strong binary signal.
 */
export declare function looksBinary(head: Uint8Array): boolean;
/**
 * Decide the MIME for a file given its path and, when available, a content
 * head. Magic bytes win; otherwise the extension; a NUL-free unknown payload
 * falls back to text/plain so text viewers can offer "Open as text".
 */
export declare function detectMime(path: string, head?: Uint8Array): string;
