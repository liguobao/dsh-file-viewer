/**
 * dsh-file-viewer — client half (browser bundle).
 *
 * Registered via window.__ModuleLoader__.load; the factory receives the
 * module-table require (react + the injected @deepseek-ai seeds). The bundle
 * provides:
 *   - the `fileViewer` service (ctx.get('fileViewer')) → openFile(path, opts)
 *   - a `conversation.view` tab ("文件查看器", sibling of the "对话" and
 *     "轨迹" tabs) rendering the viewer column inside the conversation area,
 *     styled like the Harness details panel; opened from produced-file chips
 *     or the workspace "…" menu "浏览文件" entry
 *   - `activateFileViewerTab()` — clicks the rendered tab button to switch
 *     to the viewer tab (tab state is owned by the conversation plugin)
 *   - `window.__dsfvBrowseWorkspace(workspaceIdOrPath)` — the bridge the
 *     patched workspace menu calls (scripts/patch-workspace-menu.mjs)
 *   - a `conversation.chat.turnTail` chain entry (priority -1) rendering
 *     produced-file chips that open the viewer
 *
 * All pure logic lives in src/core (node-tested); this file only assembles
 * React components over it.
 */
declare global {
    interface Window {
        __ModuleLoader__: {
            load(input: {
                id: string;
                factory: (require: (id: string) => unknown) => unknown;
            }): void;
        };
        /** Installed by the workspace-row menu patch (scripts/patch-workspace-menu.mjs). */
        __dsfvBrowseWorkspace?: (workspaceIdOrPath: string) => void;
    }
}
export {};
