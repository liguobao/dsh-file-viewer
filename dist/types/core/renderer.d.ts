/**
 * Renderer registry: decides which renderer handles a file. Matching never
 * depends on the extension alone — MIME (from magic bytes when available)
 * leads, the extension refines, and registrants may supply custom matchers
 * with priorities. Extensible so other plugins can register renderers.
 */
export type RendererId = 'image' | 'pdf' | 'csv' | 'code' | 'text' | 'markdown' | 'json' | 'yaml' | 'fallback';
/** Metadata about the file being previewed (host `stat` projection). */
export interface FileInfo {
    path: string;
    name: string;
    ext: string;
    /** MIME from magic bytes when a head was read, else extension-based. */
    mime: string;
    size: number;
    mtimeMs: number | undefined;
    isDirectory: boolean;
    /** Present when the caller supplied a content head (magic-byte sniffing). */
    headBytes?: number;
}
/** Open options the public API accepts. */
export interface OpenOptions {
    /** Jump the code/text renderer to this 1-based line. */
    line?: number;
    /** Force a renderer id. */
    renderer?: RendererId;
}
export interface RendererRegistration {
    id: RendererId | string;
    /** Ascending; higher priority wins when several renderers match. */
    priority: number;
    /** Extensions this renderer claims (lower-case, no dot). */
    extensions?: readonly string[];
    /** MIME prefixes/types this renderer claims. */
    mimes?: readonly string[];
    /** Optional fine-grained matcher; runs after mime/ext checks. */
    matches?: (file: FileInfo) => boolean;
}
export declare class RendererRegistry {
    private readonly registrations;
    constructor();
    /**
     * Register a renderer match rule. A renderer id may carry several rules
     * (e.g. by extension and by MIME); `unregister` removes them all.
     */
    register(registration: RendererRegistration): void;
    /** Remove every match rule for a renderer id. */
    unregister(id: string): void;
    /** All registered ids, in priority order (highest first). */
    list(): readonly RendererRegistration[];
    /** Resolve the renderer id for a file; `forced` overrides everything. */
    resolve(file: FileInfo, forced?: string): RendererId;
    private matches;
    private seedBuiltins;
}
/** Convenience: build a FileInfo from host stat + optional sniffed mime. */
export declare function buildFileInfo(stat: {
    path: string;
    name: string;
    ext: string;
    size: number;
    mtimeMs?: number;
    isDirectory: boolean;
    head?: Uint8Array;
}): FileInfo;
