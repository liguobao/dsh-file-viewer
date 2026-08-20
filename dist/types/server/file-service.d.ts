/**
 * Host-side File Viewer RPC service.
 *
 * The service does not know where content lives. It routes locators to
 * registered providers, enforces bounded reads, and converts provider bytes
 * to the RPC wire format consumed by the browser client.
 */
import { FileViewerContentRegistry } from './content-provider.js';
export type RpcResultLike = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
        details: Record<string, unknown>;
    };
};
export interface FileViewerServiceDeps {
    providers: FileViewerContentRegistry;
    log?: (level: 'debug' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void;
}
export interface FileMetaWire {
    path: string;
    name: string;
    ext: string;
    mime: string;
    size: number;
    mtimeMs: number | undefined;
    isDirectory: boolean;
    exists: boolean;
}
export interface DirEntryWire {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number | undefined;
    mtimeMs: number | undefined;
}
export declare const MAX_RANGE_BYTES: number;
export declare const MAX_HEAD_BYTES: number;
export declare class FileViewerService {
    private readonly deps;
    constructor(deps: FileViewerServiceDeps);
    handle(endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResultLike>;
    private resolve;
    private statProvider;
    private stat;
    private readRange;
    private readHead;
    private list;
    private openExternal;
}
