/**
 * Pluggable content source contract for the File Viewer host.
 *
 * Providers own locator resolution and access control. A locator can be a
 * normal path, a URI such as `artifact://run/output.json`, or any other stable
 * string understood by the provider that claims it.
 */
export interface FileViewerContentMeta {
    name: string;
    size: number;
    mime?: string;
    mtimeMs?: number;
    isDirectory?: boolean;
}
export interface FileViewerContentEntry extends FileViewerContentMeta {
    locator: string;
}
export interface FileViewerReadRequest {
    offset: number;
    length: number;
    signal: AbortSignal;
}
export interface FileViewerContentProvider {
    /** Unique diagnostic name for this provider. */
    id: string;
    /** Higher values win when more than one provider supports a locator. */
    priority?: number;
    /** Return true when this provider owns the locator. */
    supports(locator: string): boolean;
    /** Return undefined when the locator is owned but does not exist. */
    stat(locator: string, signal: AbortSignal): Promise<FileViewerContentMeta | undefined>;
    /** Return at most `request.length` bytes starting at `request.offset`. */
    read(locator: string, request: FileViewerReadRequest): Promise<Uint8Array>;
    /** Optional directory support. */
    list?(locator: string, signal: AbortSignal): Promise<FileViewerContentEntry[]>;
    /** Optional hand-off to a native/external application. */
    openExternal?(locator: string, signal: AbortSignal): Promise<void>;
}
/**
 * Runtime registry exposed to other host plugins as `fileViewerContent`.
 * Higher-priority registrations take precedence, so a specific provider can
 * override a broad fallback such as the optional local-files provider.
 */
export declare class FileViewerContentRegistry {
    private readonly providers;
    register(provider: FileViewerContentProvider): () => void;
    resolve(locator: string): FileViewerContentProvider | undefined;
    list(): readonly FileViewerContentProvider[];
}
