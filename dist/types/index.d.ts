/**
 * dsh-file-viewer — node half (host side).
 *
 * Registers the `/fileviewer` authenticated RPC channel and a `fileViewerContent`
 * provider registry. Content can come from any plugin; local workspace files
 * are only an optional backwards-compatible provider.
 */
import s from '@deepseek-ai/schemastery';
export declare const name = "dsh-file-viewer";
export interface Config {
    enabled?: boolean;
    /** Extra absolute directories the viewer may access beyond workspaces + cwd. */
    extraRoots?: string[];
}
/** Cordis-facing configuration schema (schemastery). */
export declare const Config: s<Config>;
/** Minimal structural host context (what this plugin actually uses). */
export interface HostContextLike {
    inject(services: string[], callback: (ctx: HostContextLike) => void | Promise<void>): void;
    effect(effect: () => (() => void | Promise<void>) | void, label: string): void;
    get<T = unknown>(name: string): T | undefined;
    provide(name: string, value: unknown): void;
    logger: {
        debug(message: string, fields?: unknown): void;
        info(message: string, fields?: unknown): void;
        warn(message: string, fields?: unknown): void;
        error(message: string, fields?: unknown): void;
    };
}
export interface HostConnectionLike {
    rpc: {
        handle(channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>): () => Promise<void>;
    };
}
/**
 * Host-side service exposed to trusted plugins as `fileViewerHost`.
 *
 * The service intentionally keeps the same bounded RPC-shaped contract as
 * the browser RPC channel. A transport plugin can forward an allowlisted subset
 * without reaching around File Viewer's provider authorization boundary.
 */
export interface FileViewerHostService {
    handle(endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown>;
}
export declare function apply(ctx: HostContextLike, input?: Config): void;
export { FileViewerContentRegistry } from './server/content-provider.js';
export type { FileViewerContentEntry, FileViewerContentMeta, FileViewerContentProvider, FileViewerReadRequest, } from './server/content-provider.js';
export { FileViewerService } from './server/file-service.js';
export type { DirEntryWire, FileMetaWire } from './server/file-service.js';
export type { FileViewerClientService, FileViewerHeadWire, FileViewerRangeWire } from './client-api.js';
