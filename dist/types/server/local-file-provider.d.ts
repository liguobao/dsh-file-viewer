/** Optional local-files provider for backwards compatibility. */
import type { FileViewerContentEntry, FileViewerContentMeta, FileViewerContentProvider, FileViewerReadRequest } from './content-provider.js';
export interface FsTargetLike {
    targetKey: string;
    displayPath?: string;
}
export interface FsLike {
    resolve(path: string, opts?: {
        signal?: AbortSignal;
    }): Promise<FsTargetLike>;
    contains(parent: FsTargetLike, child: FsTargetLike): boolean;
    processPath(target: FsTargetLike): string;
    stat(target: FsTargetLike, signal?: AbortSignal): Promise<{
        type: 'file' | 'directory' | 'other';
        size?: number;
    } | undefined>;
    listDir(target: FsTargetLike, signal?: AbortSignal): Promise<Array<{
        name: string;
        type: 'file' | 'directory' | 'other';
        target: FsTargetLike;
        size?: number;
    }>>;
}
export interface ApiProxyLike {
    workspace: {
        list(request: {
            rpcId: string;
            payload: object;
        }): Promise<{
            result: {
                ok: boolean;
                value?: {
                    items: Array<{
                        path: string;
                    }>;
                };
            };
        }>;
    };
    sessions?: {
        list(request: {
            rpcId: string;
            payload: object;
        }): Promise<{
            result: {
                ok: boolean;
                value?: {
                    items: Array<{
                        cwd?: string;
                    }>;
                };
            };
        }>;
    };
    host: {
        openPath(request: {
            rpcId: string;
            payload: {
                path: string;
            };
        }, signal?: AbortSignal): Promise<unknown>;
    };
}
export interface WorkspaceRegistryLike {
    list(): unknown[] | {
        items?: unknown[];
        byId?: Record<string, unknown>;
    } | Map<unknown, unknown> | Set<unknown> | Promise<unknown>;
}
export interface HostSessionsLike {
    list?(): unknown[] | {
        items?: unknown[];
        byId?: Record<string, unknown>;
    } | Map<unknown, unknown> | Set<unknown> | Promise<unknown>;
    all?(): unknown[] | {
        items?: unknown[];
        byId?: Record<string, unknown>;
    } | Map<unknown, unknown> | Set<unknown> | Promise<unknown>;
}
export interface SessionControllerLike {
    openWorkspacePath(request: {
        path: string;
    }, signal?: AbortSignal): Promise<{
        opened: true;
    } | {
        ok: true;
        value: {
            opened: true;
        };
    } | {
        ok: false;
        error: {
            message?: string;
        };
    }>;
}
export interface LocalFileContentProviderOptions {
    fs: FsLike;
    /** Legacy DSH <= 0.1.0 API proxy. Prefer the explicit services below. */
    apiProxy?: ApiProxyLike | (() => ApiProxyLike | undefined);
    workspaceRegistry?: WorkspaceRegistryLike | (() => WorkspaceRegistryLike | undefined);
    sessions?: HostSessionsLike | (() => HostSessionsLike | undefined);
    sessionController?: SessionControllerLike | (() => SessionControllerLike | undefined);
    /** Absolute directory roots the provider may access. */
    roots: string[];
}
export declare class LocalFileContentProvider implements FileViewerContentProvider {
    private readonly options;
    readonly id = "local-files";
    readonly priority = -1000;
    constructor(options: LocalFileContentProviderOptions);
    /** This is the fallback provider; registry precedence lets custom sources win. */
    supports(): boolean;
    stat(locator: string, signal: AbortSignal): Promise<FileViewerContentMeta | undefined>;
    read(locator: string, request: FileViewerReadRequest): Promise<Uint8Array>;
    list(locator: string, signal: AbortSignal): Promise<FileViewerContentEntry[]>;
    openExternal(locator: string, signal: AbortSignal): Promise<void>;
    private resolveChecked;
    private isInsideAllowedRoot;
    private allowedRoots;
    private currentApiProxy;
    private currentWorkspaceRegistry;
    private currentSessions;
    private currentSessionController;
}
