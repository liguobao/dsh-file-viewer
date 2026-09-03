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

import { detectMime, looksBinary, mimeFromExtension } from './core/mime.js'
import { RendererRegistry, buildFileInfo, type FileInfo, type OpenOptions } from './core/renderer.js'
import { initialLoadPlan, DEFAULT_CHUNK_BYTES, CSV_ROW_CAP } from './core/large-file.js'
import { CsvStreamParser, detectDelimiter } from './core/csv.js'
import { parseJson, scalarText } from './core/json.js'
import { isAbsoluteLocalPath, normalizeRequestPath } from './core/paths.js'
import { basename, dirname, extname, formatBytes, formatClock } from './core/format.js'
import { FileViewerContentRegistry, type FileViewerContentProvider } from './server/content-provider.js'
import * as pdfjs from 'pdfjs-dist'
// The PDF.js worker source is injected at build time (scripts/build.mjs) and
// served from a Blob URL so the single client bundle needs no second file.
declare const DSH_FILE_VIEWER_PDF_WORKER_SOURCE: string
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import java from 'highlight.js/lib/languages/java'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import bash from 'highlight.js/lib/languages/bash'
import powershell from 'highlight.js/lib/languages/powershell'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import r from 'highlight.js/lib/languages/r'
import lua from 'highlight.js/lib/languages/lua'
import ruby from 'highlight.js/lib/languages/ruby'
import php from 'highlight.js/lib/languages/php'
import jsonLang from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'
import ini from 'highlight.js/lib/languages/ini'
import diff from 'highlight.js/lib/languages/diff'
import plaintext from 'highlight.js/lib/languages/plaintext'
import { load as yamlLoad } from 'js-yaml'

declare global {
  interface Window {
    __ModuleLoader__: {
      load(input: { id: string; factory: (require: (id: string) => unknown) => unknown }): void
    }
    /** Installed by the workspace-row menu patch (scripts/patch-workspace-menu.mjs). */
    __dsfvBrowseWorkspace?: (workspaceIdOrPath: string) => void
  }
}

// ---------------------------------------------------------------------------
// Syntax-highlighting language table (curated; extended cheaply later).
// ---------------------------------------------------------------------------
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('java', java)
hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('powershell', powershell)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('r', r)
hljs.registerLanguage('lua', lua)
hljs.registerLanguage('ruby', ruby)
hljs.registerLanguage('php', php)
hljs.registerLanguage('json', jsonLang)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('ini', ini)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('plaintext', plaintext)

const HLJS_LANG_BY_EXT: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  py: 'python', go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'csharp',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', psd1: 'powershell',
  html: 'xml', htm: 'xml', xml: 'xml', css: 'css', scss: 'css', sql: 'sql',
  r: 'r', lua: 'lua', rb: 'ruby', php: 'php', json: 'json', jsonl: 'json',
  yaml: 'yaml', yml: 'yaml', md: 'markdown', markdown: 'markdown',
  ini: 'ini', conf: 'ini', cfg: 'ini', diff: 'diff', patch: 'diff',
  txt: 'plaintext', log: 'plaintext',
}

window.__ModuleLoader__.load({
  id: 'dsh-file-viewer',
  factory: (require) => {
    const module = { exports: {} as Record<string, unknown> }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react') as typeof import('react')

    // PDF worker: the bundle inlines the worker source and serves it from a
    // Blob URL so the single client.js needs no second file.
    try {
      const workerBlob = new Blob([DSH_FILE_VIEWER_PDF_WORKER_SOURCE], { type: 'text/javascript' })
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(workerBlob), { type: 'module' })
    } catch {
      // Worker creation can fail under strict CSP; PDF rendering will then
      // surface a readable error inside the renderer error boundary.
    }

    const inject = ['connection', 'slots', 'locale', 'sessions', 'workspaces']
    const SAVE_AS_DEFAULT_MAX_BYTES = 100 * 1024 * 1024
    const SAVE_AS_CHUNK_BYTES = 512 * 1024

    // -----------------------------------------------------------------------
    // Locales
    // -----------------------------------------------------------------------
    const NS = 'fileViewer'
    const zh = {
      panelTitle: '文件查看器',
      viewFile: '文件查看器',
      backToBrowser: '返回上一级',
      openFile: '打开 {name}',
      browse: '浏览',
      browseFiles: '浏览文件',
      refresh: '刷新',
      openExternal: '在外部打开',
      revealInExplorer: '在资源管理器中显示',
      copyPath: '复制路径',
      saveAs: '另存为',
      saveAsUnavailable: '仅支持 {size} 以内文件另存，远程文件还需要 LAN、P2P 或 TURN 连接。',
      saveAsProgress: '正在另存 {percent}%',
      saveAsDone: '已另存',
      saveAsFailed: '另存失败：{reason}',
      close: '关闭',
      loading: '加载中…',
      previewUnavailable: '无法预览',
      filename: '文件名',
      type: '类型',
      size: '大小',
      modified: '修改时间',
      encoding: 'UTF-8',
      noFileOpen: '没有打开的文件。点击 Agent 输出中的文件，或从侧栏打开“文件查看器”浏览工作目录。',
      openAsText: '以文本打开',
      openInBrowse: '打开文件浏览',
      produced: '产物',
      showInFolder: '在文件夹中显示',
      fileChanged: '文件已在磁盘上更改。',
      reload: '重新加载',
      retry: '重试',
      reason: '原因',
      goUp: '上级目录',
      directoryEmpty: '此目录为空。',
      errorUnknown: '未知错误',
      line: '行 {line}',
      page: '页 {page}/{total}',
      rowsLoaded: '已加载 {rows} 行',
      loadMore: '加载更多',
      showingRows: '显示 {shown} 行（文件共 {size}）',
      fit: '适应窗口',
      percent: '{percent}%',
      reset: '重置',
      zoomIn: '放大',
      zoomOut: '缩小',
      wordWrap: '自动换行',
      fontSize: '字号',
      search: '搜索',
      searchResults: '{count} 个结果',
      jumpToLine: '跳转到行',
      goToEnd: '跳转到末尾',
      nextChunk: '加载下一段',
      sortAsc: '升序',
      sortDesc: '降序',
      tree: '树',
      source: '源码',
      preview: '预览',
      expandAll: '全部展开',
      collapseAll: '全部折叠',
      copyValue: '复制值',
      copyJsonPath: '复制路径',
      firstChunk: '仅加载了文件开头。继续加载以查看更多内容。',
      largeFileHint: '此文件为 {size}。为保持 DSH 响应，仅加载部分内容。',
      pdfToolbar: 'PDF',
      prevPage: '上一页',
      nextPage: '下一页',
      csvToolbar: 'CSV',
      codeToolbar: '代码',
      textToolbar: '文本',
      markdownToolbar: 'Markdown',
      jsonToolbar: 'JSON',
      yamlToolbar: 'YAML',
      imageToolbar: '图片',
      imageDimensions: '{width} × {height}',
      selectWorkspace: '选择要浏览的目录',
      currentDirectory: '当前目录',
      copy: '复制',
      selectAll: '全选',
      cancel: '取消',
      loadingMore: '加载中…',
      truncatedNotice: '行数过多，仅保留前 {count} 行。',
      noSearchResults: '无匹配结果',
      pdfInvalid: '无法预览此 PDF。',
      openTextHint: '该文件看起来是二进制文件。仅在你确认它是文本时以文本打开。',
    } as const
    const en: Record<keyof typeof zh, string> = {
      panelTitle: 'File Viewer',
      viewFile: 'File Viewer',
      backToBrowser: 'Back to browser',
      openFile: 'Open {name}',
      browseFiles: 'Browse files',
      browse: 'Browse',
      refresh: 'Refresh',
      openExternal: 'Open externally',
      revealInExplorer: 'Reveal in Explorer',
      copyPath: 'Copy path',
      saveAs: 'Save as',
      saveAsUnavailable: 'Save As is limited to files up to {size}. Remote files also require a LAN, P2P, or TURN connection.',
      saveAsProgress: 'Saving {percent}%',
      saveAsDone: 'Saved',
      saveAsFailed: 'Save failed: {reason}',
      close: 'Close',
      loading: 'Loading…',
      previewUnavailable: 'Preview unavailable',
      filename: 'Filename',
      type: 'Type',
      size: 'Size',
      modified: 'Modified',
      encoding: 'UTF-8',
      noFileOpen: 'No file open. Click a file in the agent output, or open "File Viewer" from the sidebar to browse the workspace.',
      openAsText: 'Open as text',
      openInBrowse: 'Open file browser',
      produced: 'Produced',
      showInFolder: 'Show in folder',
      fileChanged: 'File changed on disk.',
      reload: 'Reload',
      retry: 'Retry',
      reason: 'Reason',
      goUp: 'Parent directory',
      directoryEmpty: 'This directory is empty.',
      errorUnknown: 'Unknown error',
      line: 'Line {line}',
      page: 'Page {page}/{total}',
      rowsLoaded: '{rows} rows loaded',
      loadMore: 'Load more',
      showingRows: 'Showing {shown} rows · file {size}',
      fit: 'Fit',
      percent: '{percent}%',
      reset: 'Reset',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      wordWrap: 'Word wrap',
      fontSize: 'Font size',
      search: 'Search',
      searchResults: '{count} results',
      jumpToLine: 'Jump to line',
      goToEnd: 'Go to end',
      nextChunk: 'Load next chunk',
      sortAsc: 'Ascending',
      sortDesc: 'Descending',
      tree: 'Tree',
      source: 'Source',
      preview: 'Preview',
      expandAll: 'Expand all',
      collapseAll: 'Collapse all',
      copyValue: 'Copy value',
      copyJsonPath: 'Copy path',
      firstChunk: 'Only the beginning of the file was loaded. Load more to see the rest.',
      largeFileHint: 'This file is {size}. Only part of the file will be loaded to keep DSH responsive.',
      pdfToolbar: 'PDF',
      prevPage: 'Previous page',
      nextPage: 'Next page',
      csvToolbar: 'CSV',
      codeToolbar: 'Code',
      textToolbar: 'Text',
      markdownToolbar: 'Markdown',
      jsonToolbar: 'JSON',
      yamlToolbar: 'YAML',
      imageToolbar: 'Image',
      imageDimensions: '{width} × {height}',
      selectWorkspace: 'Choose a directory to browse',
      currentDirectory: 'Current directory',
      copy: 'Copy',
      selectAll: 'Select all',
      cancel: 'Cancel',
      loadingMore: 'Loading…',
      truncatedNotice: 'Too many rows; only the first {count} are kept.',
      noSearchResults: 'No matches',
      pdfInvalid: 'Unable to preview this PDF.',
      openTextHint: 'This file looks binary. Only open it as text if you are sure it is text.',
    }
    type Translate = (key: keyof typeof zh, params?: Record<string, string | number>) => string

    // -----------------------------------------------------------------------
    // Tiny external store
    // -----------------------------------------------------------------------
    function createStore<S>(initial: S): {
      get(): S
      set(patch: Partial<S> | ((state: S) => Partial<S>)): void
      subscribe(listener: () => void): () => void
    } {
      let state = initial
      const listeners = new Set<() => void>()
      return {
        get: () => state,
        set: (patch) => {
          state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
          for (const listener of listeners) listener()
        },
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    }

    interface ViewerState {
      open: boolean
      mode: 'idle' | 'browse' | 'file'
      file: FileInfo | null
      options: OpenOptions
      status: string
      error: string | null
      loading: boolean
      saving: boolean
      reloadNonce: number
      /** Whether the sniffed head marks the file as binary (NUL bytes). */
      binary: boolean
      browsePath: string | null
      browseEntries: Array<{ name: string; path: string; isDirectory: boolean; size?: number; mtimeMs?: number }> | null
      browseError: string | null
      /** Whether the "文件查看器" conversation view is the active tab. */
      active: boolean
    }

    const viewerStore = createStore<ViewerState>({
      open: false,
      mode: 'idle',
      file: null,
      options: {},
      status: '',
      error: null,
      loading: false,
      saving: false,
      reloadNonce: 0,
      binary: false,
      browsePath: null,
      browseEntries: null,
      browseError: null,
      active: false,
    })

    function useViewerState(): ViewerState {
      return React.useSyncExternalStore(viewerStore.subscribe, viewerStore.get)
    }

    // The "文件查看器" tab is registered under conversation.view; switching
    // tabs is a chatStore action owned by the conversation plugin (not
    // exposed to third-party slots), so we activate our tab by clicking the
    // rendered tab button (role="tab", label = viewFile). This runs after
    // React commits the tab bar; retry briefly in case the header renders
    // asynchronously.
    const FILE_VIEWER_TAB_LABELS = ['文件查看器', 'File Viewer']
    // Populated from ctx.workspaces at apply time; used to resolve relative
    // chip paths against every known workspace (the current session cwd may
    // differ from the workspace that produced the file).
    const knownWorkspaceRoots: Array<string | undefined> = []
    function activateFileViewerTab(): void {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        window.setTimeout(() => {
          const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
          const label = (tab: HTMLButtonElement): string => (tab.textContent ?? '').trim()
          const target = tabs.find((tab) => FILE_VIEWER_TAB_LABELS.includes(label(tab)))
          if (target !== undefined) target.click()
        }, attempt * 120)
      }
    }

    // Leave the viewer tab: click the "对话" tab (the chat view; default
    // order 0) so the conversation becomes active again, and reset the
    // viewer to its idle state.
    const CHAT_TAB_LABELS = ['对话', 'Chat']
    function leaveFileViewerTab(): void {
      viewerStore.set({ open: false, mode: 'idle', file: null, error: null, loading: false, status: '', binary: false, browsePath: null, browseEntries: null, browseError: null })
      for (let attempt = 0; attempt < 5; attempt += 1) {
        window.setTimeout(() => {
          const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
          const label = (tab: HTMLButtonElement): string => (tab.textContent ?? '').trim()
          const target = tabs.find((tab) => CHAT_TAB_LABELS.includes(label(tab)))
          if (target !== undefined) target.click()
        }, attempt * 120)
      }
    }

    // -----------------------------------------------------------------------
    // RPC client + public API
    // -----------------------------------------------------------------------
    interface RpcResultLike { ok: boolean; value?: unknown; error?: { message?: string } }
    interface HostCtxLike {
      connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<RpcResultLike> } }
      effect(effect: () => (() => void) | void, label: string): void
      locale: {
        bind(namespace: string): Translate
        register(namespace: string, dictionaries: { zh: typeof zh; en: typeof en }): () => void
      }
      slots: {
        inject(name: string, factory: () => unknown): void
        register(options: Record<string, unknown>, component: unknown): unknown
      }
      provide(name: string, value: unknown): void
      get<T = unknown>(name: string): T | undefined
      logger: { warn(message: string): void; error(message: string): void }
    }
    interface SessionsLike {
      list: { getSnapshot(): { byId?: Record<string, { cwd?: string } | undefined>; current?: string } }
    }

    function resolveWorkspacePath(cwd: string | undefined, path: string): string {
      // Provider locators (for example artifact://run/report.json) are opaque
      // and must never be rewritten relative to the current workspace.
      if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path)) return path
      if (isAbsoluteLocalPath(path)) return path
      if (cwd === undefined || cwd === '') return path
      return `${cwd.replace(/[/\\]+$/, '')}/${path.replace(/^[/\\]+/, '')}`
    }

    function decodeBase64(base64: string): Uint8Array {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      return bytes
    }

    function bytesToBase64(bytes: Uint8Array): string {
      let binary = ''
      const chunk = 0x8000
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
      }
      return btoa(binary)
    }

    function messageOf(reason: unknown): string {
      return reason instanceof Error ? reason.message : String(reason)
    }

    function isPendingControlRoute(reason: unknown): boolean {
      return reason instanceof Error && /transport failure for \/fileviewer\/[^:]+: HTTP 405$/.test(reason.message)
    }

    function delay(ms: number): Promise<void> {
      return new Promise((resolve) => window.setTimeout(resolve, ms))
    }

    interface FileViewerApi {
      openFile(path: string, options?: OpenOptions): void
      registerContentProvider(provider: FileViewerContentProvider): () => void
      stat(path: string): Promise<{ path: string; name: string; ext: string; mime: string; size: number; mtimeMs?: number; isDirectory: boolean; exists: boolean }>
      readRange(path: string, offset: number, length: number): Promise<{ data: string; offset: number; size: number; eof: boolean }>
      readHead(path: string, maxBytes: number): Promise<{ data: string; size: number; truncated: boolean }>
      list(path: string): Promise<{ path: string; entries: Array<{ name: string; path: string; isDirectory: boolean; size?: number; mtimeMs?: number }> }>
      openExternal(path: string): Promise<{ opened: true }>
      saveAsLimit(path: string): { allowed: boolean; maxBytes: number }
      canSaveAs(path: string, size: number): boolean
      saveAs(file: FileInfo, onProgress: (received: number, total: number) => void): Promise<void>
      dataUrl(path: string, mime: string): Promise<string>
    }

    function createApi(ctx: HostCtxLike, sessions: SessionsLike | undefined, contentProviders: FileViewerContentRegistry): FileViewerApi {
      const rpcCall = async <T,>(endpoint: string, payload: Record<string, unknown>): Promise<T> => {
        let result: RpcResultLike
        for (let attempt = 0; ; attempt += 1) {
          try {
            result = await ctx.connection.rpc.call('/fileviewer', endpoint, payload)
            break
          } catch (reason) {
            if (attempt >= 19 || !isPendingControlRoute(reason)) throw reason
            await delay(100)
          }
        }
        if (!result.ok) throw new Error(result.error?.message ?? 'File Viewer request failed.')
        return result.value as T
      }

      const stat = async (path: string): Promise<{ path: string; name: string; ext: string; mime: string; size: number; mtimeMs?: number; isDirectory: boolean; exists: boolean }> => {
        const provider = contentProviders.resolve(path)
        if (provider === undefined) return rpcCall('stat', { path })
        const info = await provider.stat(path, new AbortController().signal)
        if (info === undefined) {
          return { path, name: basename(path), ext: extname(path), mime: mimeFromExtension(path), size: 0, isDirectory: false, exists: false }
        }
        return {
          path,
          name: info.name,
          ext: extname(info.name),
          mime: info.mime ?? mimeFromExtension(info.name),
          size: info.isDirectory === true ? 0 : info.size,
          mtimeMs: info.mtimeMs,
          isDirectory: info.isDirectory === true,
          exists: true,
        }
      }

      const readRange = async (path: string, offset: number, length: number): Promise<{ data: string; offset: number; size: number; eof: boolean }> => {
        const provider = contentProviders.resolve(path)
        if (provider === undefined) return rpcCall('readRange', { path, offset, length })
        if (!Number.isInteger(offset) || offset < 0) throw new Error('A non-negative integer offset is required.')
        if (!Number.isInteger(length) || length <= 0) throw new Error('A positive integer length is required.')
        const signal = new AbortController().signal
        const info = await provider.stat(path, signal)
        if (info === undefined) throw new Error('The content does not exist.')
        const capped = Math.min(length, 8 * 1024 * 1024)
        const data = await provider.read(path, { offset, length: capped, signal })
        if (data.byteLength > capped) throw new Error(`Content provider "${provider.id}" returned more bytes than requested.`)
        return { data: bytesToBase64(data), offset, size: info.size, eof: offset + data.byteLength >= info.size }
      }

      const readHead = async (path: string, requestedBytes: number): Promise<{ data: string; size: number; truncated: boolean }> => {
        const provider = contentProviders.resolve(path)
        if (provider === undefined) return rpcCall('readHead', { path, maxBytes: requestedBytes })
        const signal = new AbortController().signal
        const info = await provider.stat(path, signal)
        if (info === undefined) throw new Error('The content does not exist.')
        if (info.isDirectory === true) return { data: '', size: 0, truncated: false }
        const maxBytes = Math.min(Math.max(1, Math.floor(requestedBytes)), 1024 * 1024)
        const data = await provider.read(path, { offset: 0, length: maxBytes, signal })
        if (data.byteLength > maxBytes) throw new Error(`Content provider "${provider.id}" returned more bytes than requested.`)
        return { data: bytesToBase64(data), size: info.size, truncated: data.byteLength < info.size }
      }

      const list = async (path: string): Promise<{ path: string; entries: Array<{ name: string; path: string; isDirectory: boolean; size?: number; mtimeMs?: number }> }> => {
        const provider = contentProviders.resolve(path)
        if (provider === undefined) return rpcCall('list', { path })
        if (provider.list === undefined) throw new Error(`Content provider "${provider.id}" does not support directory listing.`)
        const entries = await provider.list(path, new AbortController().signal)
        return {
          path,
          entries: entries.map((entry) => ({ name: entry.name, path: entry.locator, isDirectory: entry.isDirectory === true, size: entry.size, mtimeMs: entry.mtimeMs })),
        }
      }

      const openExternal = async (path: string): Promise<{ opened: true }> => {
        const provider = contentProviders.resolve(path)
        if (provider === undefined) return rpcCall('openExternal', { path })
        if (provider.openExternal === undefined) throw new Error(`Content provider "${provider.id}" does not support external open.`)
        await provider.openExternal(path, new AbortController().signal)
        return { opened: true }
      }

      const saveAsLimit = (path: string): { allowed: boolean; maxBytes: number } => {
        const provider = contentProviders.resolve(path)
        const decision = provider?.saveAsAllowed?.(path)
        if (decision === false) return { allowed: false, maxBytes: SAVE_AS_DEFAULT_MAX_BYTES }
        if (typeof decision === 'object') {
          const maxBytes = decision.maxBytes
          return {
            allowed: decision.allowed,
            maxBytes: Number.isSafeInteger(maxBytes) && maxBytes !== undefined && maxBytes > 0 ? maxBytes : SAVE_AS_DEFAULT_MAX_BYTES,
          }
        }
        return { allowed: true, maxBytes: SAVE_AS_DEFAULT_MAX_BYTES }
      }

      const canSaveAs = (path: string, size: number): boolean => {
        const limit = saveAsLimit(path)
        return limit.allowed && size <= limit.maxBytes
      }

      const saveAs = async (file: FileInfo, onProgress: (received: number, total: number) => void): Promise<void> => {
        const initialLimit = saveAsLimit(file.path)
        if (!initialLimit.allowed || file.size > initialLimit.maxBytes) throw new Error('Save As is unavailable for this file.')
        const chunks: BlobPart[] = []
        let received = 0
        while (received < file.size) {
          const currentLimit = saveAsLimit(file.path)
          if (!currentLimit.allowed || file.size > currentLimit.maxBytes) throw new Error('Save As is unavailable for this file.')
          const length = Math.min(SAVE_AS_CHUNK_BYTES, file.size - received)
          const range = await readRange(file.path, received, length)
          if (range.offset !== received) throw new Error('The file source returned a mismatched range.')
          if (range.size > saveAsLimit(file.path).maxBytes) throw new Error('The file is larger than the Save As limit.')
          const bytes = decodeBase64(range.data)
          if (bytes.byteLength === 0 && !range.eof) throw new Error('The file source returned an empty range.')
          chunks.push(new Uint8Array(bytes))
          received += bytes.byteLength
          onProgress(received, file.size)
          if (range.eof || bytes.byteLength === 0) break
        }
        const blob = new Blob(chunks, { type: file.mime || 'application/octet-stream' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.href = url
        link.download = file.name || basename(file.path) || 'download'
        link.style.display = 'none'
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
      }

      const currentCwd = (): string | undefined => {
        const snapshot = sessions?.list.getSnapshot()
        return snapshot?.byId === undefined ? undefined : Object.values(snapshot.byId).find((session) => session?.cwd !== undefined)?.cwd
      }

      const openFile = (rawPath: string, options: OpenOptions = {}): void => {
        let path: string
        try {
          path = resolveWorkspacePath(currentCwd(), normalizeRequestPath(rawPath))
        } catch (error) {
          viewerStore.set({ open: true, mode: 'file', file: null, options: {}, status: '', error: messageOf(error), loading: false, binary: false, reloadNonce: viewerStore.get().reloadNonce + 1 })
          return
        }
        // Keep the previous browse context (browsePath/browseEntries) so the
        // user can step back to the parent directory after previewing a file.
        viewerStore.set({ open: true, mode: 'file', file: null, options, status: '', error: null, loading: true, binary: false, reloadNonce: viewerStore.get().reloadNonce + 1 })
        activateFileViewerTab()
        void loadFile(path, options)
      }

      const loadFile = async (path: string, options: OpenOptions): Promise<void> => {
        try {
          const [meta, head] = await Promise.all([
            stat(path),
            readHead(path, 4096).catch(() => ({ data: '', size: 0, truncated: false })),
          ])
          if (!meta.exists) throw new Error('The file does not exist.')
          const headBytes = head.data !== '' ? decodeBase64(head.data) : undefined
          const file: FileInfo = buildFileInfo({
            path: meta.path,
            name: meta.name,
            ext: meta.ext,
            size: meta.size,
            mtimeMs: meta.mtimeMs,
            isDirectory: meta.isDirectory,
            head: headBytes,
          })
          viewerStore.set({ file, loading: false, error: null, binary: headBytes !== undefined && looksBinary(headBytes) })
        } catch (error) {
          viewerStore.set({ loading: false, error: messageOf(error) })
        }
      }

      return {
        openFile,
        registerContentProvider: (provider) => contentProviders.register(provider),
        stat,
        readRange,
        readHead,
        list,
        openExternal,
        saveAsLimit,
        canSaveAs,
        saveAs,
        dataUrl: async (path, mime) => {
          const range = await readRange(path, 0, 50 * 1024 * 1024)
          return `data:${mime};base64,${range.data}`
        },
      }
    }

    // -----------------------------------------------------------------------
    // Error boundary
    // -----------------------------------------------------------------------
    interface ErrorBoundaryProps { children?: unknown; onError: (error: Error) => void }
    interface ErrorBoundaryState { error: Error | null }
    class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
      constructor(props: ErrorBoundaryProps) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error }
      }

      override componentDidCatch(error: Error): void {
        this.props.onError(error)
      }

      override render(): React.ReactNode {
        // The host renders its own error panel via onError; render nothing here.
        return this.state.error === null ? (this.props.children as React.ReactNode) : null
      }
    }

    // -----------------------------------------------------------------------
    // Shared UI atoms
    // -----------------------------------------------------------------------
    type ToolbarButtonProps = { label: string; title?: string; onClick: () => void; disabled?: boolean; primary?: boolean }
    function ToolbarButton(props: ToolbarButtonProps): React.ReactNode {
      return React.createElement(
        'button',
        {
          type: 'button',
          className: `dsfv-toolbar-btn${props.primary === true ? ' isPrimary' : ''}`,
          title: props.title ?? props.label,
          'aria-label': props.label,
          disabled: props.disabled === true,
          onClick: props.onClick,
        },
        props.label,
      )
    }

    function IconButton(props: { glyph: string; label: string; onClick: () => void; disabled?: boolean; title?: string }): React.ReactNode {
      return React.createElement(
        'button',
        {
          type: 'button',
          className: 'dsfv-icon-btn',
          title: props.title ?? props.label,
          'aria-label': props.label,
          disabled: props.disabled === true,
          onClick: props.onClick,
        },
        props.glyph,
      )
    }

    function ErrorPanel(props: { title: string; reason: string; onRetry: () => void; onOpenExternal: () => void; t: Translate }): React.ReactNode {
      const { t } = props
      return React.createElement(
        'div',
        { className: 'dsfv-error' },
        React.createElement('strong', null, props.title),
        React.createElement('p', null, t('reason'), ' ', props.reason),
        React.createElement(
          'div',
          { className: 'dsfv-error-actions' },
          React.createElement(ToolbarButton, { label: t('retry'), primary: true, onClick: props.onRetry }),
          React.createElement(ToolbarButton, { label: t('openExternal'), onClick: props.onOpenExternal }),
        ),
      )
    }

    // -----------------------------------------------------------------------
    // Viewer panel
    // -----------------------------------------------------------------------
    interface ConversationViewRequest {
      readonly view: string
      readonly focus: string
    }

    interface FileViewerPanelProps {
      api: FileViewerApi
      t: Translate
      sessionId?: string
      useSessions?: (selector: (snapshot: SessionListSnapshot) => string | undefined) => string | undefined
      viewRequest?: ConversationViewRequest | null
      completeViewRequest?: () => void
    }

    function FileViewerPanel(props: FileViewerPanelProps): React.ReactNode {
      const { api, t } = props
      const state = useViewerState()

      // DSH 0.1.2-rc.1 lets another conversation view select this tab and
      // address an opaque focus value to it. File Viewer interprets that value
      // as a locator, then acknowledges the one-shot request. Both owner props
      // remain optional so the same bundle still runs on 0.1.1-rc.2.
      React.useEffect(() => {
        const request = props.viewRequest
        if (request?.view !== 'dsh-file-viewer') return
        api.openFile(request.focus)
        props.completeViewRequest?.()
      }, [api, props.viewRequest, props.completeViewRequest])

      React.useEffect(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
          if (event.key === 'Escape') leaveFileViewerTab()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [])

      // This conversation view renders only while its tab is active, so
      // mount/unmount is the reliable active signal for the header seat.
      React.useEffect(() => {
        viewerStore.set({ active: true })
        return () => { viewerStore.set({ active: false }) }
      }, [])

      // When the tab becomes active with nothing loaded yet, drop straight
      // into the workspace browser so the current working directory is
      // listed immediately (no empty-guide detour).
      React.useEffect(() => {
        const current = viewerStore.get()
        if (!current.open && current.mode === 'idle' && current.browseEntries === null) {
          viewerStore.set({ open: true, mode: 'browse', browsePath: null, browseEntries: null, browseError: null, error: null, loading: false, status: '', binary: false })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const file = state.file
      const plan = file !== null ? initialLoadPlan(file.size) : null
      const refresh = (): void => {
        const current = viewerStore.get().file
        if (current !== null) api.openFile(current.path, viewerStore.get().options)
      }
      const openExternal = (): void => {
        const current = viewerStore.get().file
        if (current !== null) void api.openExternal(current.path).catch(() => undefined)
      }
      const copyPath = (): void => {
        const current = viewerStore.get().file
        if (current !== null) void navigator.clipboard?.writeText(current.path)
      }
      const saveAs = (): void => {
        const current = viewerStore.get().file
        if (current === null || viewerStore.get().saving) return
        viewerStore.set({ saving: true, status: t('saveAsProgress', { percent: 0 }) })
        void api.saveAs(current, (received, total) => {
          const percent = total <= 0 ? 100 : Math.min(100, Math.floor((received / total) * 100))
          viewerStore.set({ status: t('saveAsProgress', { percent }) })
        }).then(() => {
          viewerStore.set({ saving: false, status: t('saveAsDone') })
        }).catch((error) => {
          viewerStore.set({ saving: false, status: t('saveAsFailed', { reason: messageOf(error) }) })
        })
      }

      // Title row inside the view: the path/filename on the left stays
      // visible the whole time (browse shows the current directory, preview
      // shows the file), and the file actions sit to its right — nothing
      // moves into the Harness session header, so no overlap with the tabs.
      const titleLabel = file !== null
        ? file.path
        : state.browsePath ?? t('panelTitle')
      const saveAsLimit = file !== null ? api.saveAsLimit(file.path) : null
      const saveAsAvailable = file !== null && saveAsLimit !== null && saveAsLimit.allowed && file.size <= saveAsLimit.maxBytes
      const saveAsUnavailableTitle = saveAsLimit !== null
        ? t('saveAsUnavailable', { size: formatBytes(saveAsLimit.maxBytes) })
        : t('saveAs')

      return React.createElement(
        'section',
        {
          className: 'dsfv-panel',
          'aria-label': t('panelTitle'),
          // Match Harness's Trajectory tab: the composer floats over a
          // full-height view while the view reserves its measured height for
          // bottom content. Without this marker the viewer stops above the
          // composer and its bottom edge no longer aligns with sibling tabs.
          'data-conversation-composer-overlay': '',
        },
        React.createElement(
          'div',
          { className: 'dsfv-titlebar' },
          React.createElement(
            'div',
            { className: 'dsfv-titlebar-path' },
            file !== null
              ? React.createElement(
                  'button',
                  { type: 'button', className: 'dsfv-back-btn', title: t('backToBrowser'), onClick: () => viewerStore.set({ mode: 'browse', file: null, error: null, loading: false }) },
                  '‹',
                )
              : null,
            React.createElement('strong', { className: 'dsfv-path', title: titleLabel }, titleLabel),
            file !== null && React.createElement('span', { className: 'dsfv-meta' }, file.mime),
            file !== null && React.createElement('span', { className: 'dsfv-meta' }, formatBytes(file.size)),
          ),
          React.createElement(
            'div',
            { className: 'dsfv-titlebar-actions' },
            file !== null && React.createElement(ToolbarButton, { label: t('refresh'), onClick: refresh }),
            file !== null && React.createElement(ToolbarButton, { label: t('saveAs'), title: saveAsAvailable ? t('saveAs') : saveAsUnavailableTitle, disabled: state.saving || !saveAsAvailable, onClick: saveAs }),
            file !== null && React.createElement(ToolbarButton, { label: t('openExternal'), onClick: openExternal }),
            file !== null && React.createElement(ToolbarButton, { label: t('copyPath'), onClick: copyPath }),
            React.createElement(
              'button',
              { type: 'button', className: 'dsfv-close', 'aria-label': t('close'), title: t('close'), onClick: leaveFileViewerTab },
              React.createElement('svg', { viewBox: '0 0 16 16', width: '14', height: '14', 'aria-hidden': true },
                React.createElement('path', { d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' })),
            ),
          ),
        ),
        state.loading
          ? React.createElement('div', { className: 'dsfv-center' }, t('loading'))
          : state.error !== null && file === null
            ? React.createElement(ErrorPanel, {
                title: t('previewUnavailable'),
                reason: state.error,
                onRetry: refresh,
                onOpenExternal: openExternal,
                t,
              })
            : state.mode === 'browse'
              ? React.createElement(DirectoryBrowser, { api, t, useSessions: props.useSessions })
              : file === null
                ? React.createElement(
                    'div',
                    { className: 'dsfv-center dsfv-empty' },
                    React.createElement('p', null, t('noFileOpen')),
                    React.createElement(ToolbarButton, { label: t('openInBrowse'), primary: true, onClick: () => viewerStore.set({ mode: 'browse' }) }),
                  )
                : React.createElement(React.Fragment, null,
                    plan !== null && plan.hint !== undefined
                      ? React.createElement('div', { className: 'dsfv-hint' }, t('largeFileHint', { size: formatBytes(file.size) }))
                      : null,
                    React.createElement(
                      'div',
                      { className: 'dsfv-body' },
                      React.createElement(RendererHost, { api, file, t, options: state.options, onStatus: (status: string) => { viewerStore.set({ status }) } }),
                    ),
                    React.createElement(
                      'footer',
                      { className: 'dsfv-statusbar' },
                      React.createElement('span', null, t('encoding')),
                      React.createElement('span', null, formatBytes(file.size)),
                      React.createElement('span', null, t('modified'), ' ', formatClock(file.mtimeMs)),
                      state.status !== '' ? React.createElement('span', { className: 'dsfv-status-extra' }, state.status) : null,
                    ),
                  ),
      )
    }

    // -----------------------------------------------------------------------
    // Directory browser — lists through the boundary-checked /fileviewer RPC.
    // It starts at the current session's workspace root, so every listed
    // directory (and every opened file) stays inside the allowed roots.
    // -----------------------------------------------------------------------
    interface BrowseCrumb { path: string; label: string; separator: string }
    interface SessionListSnapshot { byId?: Record<string, { cwd?: string } | undefined>; current?: string }

    function browseCrumbs(path: string): BrowseCrumb[] {
      const windows = path.match(/^([A-Za-z]:)([/\\]?)(.*)$/)
      if (windows !== null) {
        const separator = windows[2] === '\\' || path.includes('\\') ? '\\' : '/'
        const drive = windows[1] ?? ''
        const tail = (windows[3] ?? '').split(/[/\\]+/).filter(Boolean)
        const crumbs: BrowseCrumb[] = [{ path: `${drive}${separator}`, label: drive, separator }]
        let current = `${drive}${separator}`
        for (const part of tail) {
          current = current.endsWith(separator) ? `${current}${part}` : `${current}${separator}${part}`
          crumbs.push({ path: current, label: part, separator })
        }
        return crumbs
      }

      const absolute = path.startsWith('/')
      const separator = '/'
      const segments = path.split('/').filter(Boolean)
      let current = absolute ? '' : ''
      return segments.map((part) => {
        current = absolute
          ? `${current}/${part}`
          : current === '' ? part : `${current}/${part}`
        return { path: current, label: part, separator }
      })
    }

    function DirectoryBrowser(props: { api: FileViewerApi; t: Translate; useSessions?: (selector: (snapshot: SessionListSnapshot) => string | undefined) => string | undefined }): React.ReactNode {
      const { api, t } = props
      const state = useViewerState()
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState<string | null>(null)
      const workspaceRoot = props.useSessions?.((snapshot) => {
        const current = snapshot.current !== undefined ? snapshot.byId?.[snapshot.current] : undefined
        if (current?.cwd !== undefined) return current.cwd
        return Object.values(snapshot.byId ?? {}).find((session) => session?.cwd !== undefined)?.cwd
      })

      const openDirectory = (path: string | null): void => {
        setBusy(true)
        setError(null)
        viewerStore.set({ browsePath: path })
        const target = path ?? workspaceRoot
        const promise = target === undefined
          ? Promise.reject(new Error('No workspace is open yet.'))
          : api.list(target)
        promise.then((listing) => {
          const entries = listing.entries
            .filter((entry) => !entry.name.startsWith('.'))
            .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1))
          viewerStore.set({ browseEntries: entries })
          setBusy(false)
        }).catch((reason) => {
          setError(messageOf(reason))
          viewerStore.set({ browseEntries: null })
          setBusy(false)
        })
      }

      React.useEffect(() => {
        if (state.mode === 'browse' && state.browseEntries === null && state.browseError === null) {
          openDirectory(state.browsePath)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [state.mode, state.browsePath, workspaceRoot])

      const crumbs = browseCrumbs(state.browsePath ?? workspaceRoot ?? '')
      const rootLabel = t('browse')

      return React.createElement(
        'div',
        { className: 'dsfv-browser' },
        React.createElement(
          'div',
          { className: 'dsfv-browser-nav' },
          React.createElement(IconButton, { glyph: '↑', label: t('goUp'), disabled: state.browsePath === null || state.browsePath === '/', onClick: () => { if (state.browsePath !== null) openDirectory(dirname(state.browsePath) || '/') } }),
          React.createElement('span', { className: 'dsfv-crumb', onClick: () => openDirectory(null) }, rootLabel),
          crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1
            return React.createElement(
              'span',
              { key: crumb.path, className: `dsfv-crumb${isLast ? ' isCurrent' : ''}`, onClick: () => { if (!isLast) openDirectory(crumb.path) } },
              React.createElement('span', { className: 'dsfv-crumb-sep' }, crumb.separator),
              crumb.label,
            )
          }),
        ),
        error !== null
          ? React.createElement('div', { className: 'dsfv-center' }, error)
          : busy && state.browseEntries === null
            ? React.createElement('div', { className: 'dsfv-center' }, t('loading'))
            : state.browseEntries === null || state.browseEntries.length === 0
              ? React.createElement('div', { className: 'dsfv-center' }, t('directoryEmpty'))
              : React.createElement(
                  'ul',
                  { className: 'dsfv-filelist' },
                  state.browseEntries.map((entry) => React.createElement(
                    'li',
                    { key: entry.path },
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'dsfv-file-row',
                        title: entry.path,
                        onClick: () => {
                          if (entry.isDirectory) openDirectory(entry.path)
                          else api.openFile(entry.path)
                        },
                      },
                      React.createElement('span', { className: 'dsfv-file-icon', 'aria-hidden': true }, entry.isDirectory ? '▸' : '·'),
                      React.createElement('span', { className: 'dsfv-file-name' }, entry.name),
                      React.createElement('span', { className: 'dsfv-file-size' }, entry.isDirectory ? '' : formatBytes(entry.size ?? 0)),
                    ),
                  )),
                ),
      )
    }

    // -----------------------------------------------------------------------
    // Renderer host: registry resolution + error isolation
    // -----------------------------------------------------------------------
    interface RendererHostProps {
      api: FileViewerApi
      file: FileInfo
      t: Translate
      options: OpenOptions
      onStatus: (status: string) => void
    }

    function RendererHost(props: RendererHostProps): React.ReactNode {
      const { api, file, t, options, onStatus } = props
      const [retryNonce, setRetryNonce] = React.useState(0)
      const [renderError, setRenderError] = React.useState<string | null>(null)
      const rendererId = viewerRegistry.resolve(file, options.renderer)

      const onRendererError = (error: Error): void => { setRenderError(messageOf(error)) }

      if (renderError !== null) {
        return React.createElement(ErrorPanel, {
          title: t('previewUnavailable'),
          reason: renderError,
          onRetry: () => { setRenderError(null); setRetryNonce((n) => n + 1) },
          onOpenExternal: () => void api.openExternal(file.path).catch(() => undefined),
          t,
        })
      }

      const common = { api, file, t, options, onStatus }
      let renderer: React.ReactNode = null
      switch (rendererId) {
        case 'image': renderer = React.createElement(ImageRenderer, common); break
        case 'pdf': renderer = React.createElement(PdfRenderer, common); break
        case 'csv': renderer = React.createElement(CsvRenderer, common); break
        case 'code': renderer = React.createElement(CodeRenderer, common); break
        case 'markdown': renderer = React.createElement(MarkdownRenderer, common); break
        case 'json': renderer = React.createElement(JsonRenderer, common); break
        case 'yaml': renderer = React.createElement(YamlRenderer, common); break
        case 'text': renderer = React.createElement(TextRenderer, common); break
        default: renderer = React.createElement(FallbackRenderer, common); break
      }
      return React.createElement(
        ErrorBoundary,
        { onError: onRendererError },
        React.createElement('div', { key: `${file.path}:${retryNonce}`, className: 'dsfv-renderer' }, renderer),
      )
    }

    // -----------------------------------------------------------------------
    // Text renderer (txt/log/out/ini/conf/unknown text)
    // -----------------------------------------------------------------------
    interface TextLikeRendererProps {
      api: FileViewerApi
      file: FileInfo
      t: Translate
      options: OpenOptions
      onStatus: (status: string) => void
    }
    const MAX_KEPT_LINES = 50_000

    function useChunkedText(api: FileViewerApi, file: FileInfo): {
      lines: string[]
      loadedBytes: number
      eof: boolean
      truncated: boolean
      loadMore: () => Promise<void>
      goToEnd: () => Promise<void>
      error: string | null
    } {
      const [lines, setLines] = React.useState<string[]>([])
      const [loadedBytes, setLoadedBytes] = React.useState(0)
      const [eof, setEof] = React.useState(false)
      const [truncated, setTruncated] = React.useState(false)
      const [error, setError] = React.useState<string | null>(null)
      const plan = initialLoadPlan(file.size)
      const decoderRef = React.useRef<TextDecoder | null>(null)
      const pendingRef = React.useRef('')

      const decodeAppend = (base64: string): string[] => {
        const bytes = decodeBase64(base64)
        if (decoderRef.current === null) decoderRef.current = new TextDecoder('utf-8')
        const text = decoderRef.current.decode(bytes, { stream: true })
        const combined = pendingRef.current + text
        const newlineIndex = combined.lastIndexOf('\n')
        if (newlineIndex === -1) {
          pendingRef.current = combined
          return []
        }
        const complete = combined.slice(0, newlineIndex)
        pendingRef.current = combined.slice(newlineIndex + 1)
        return complete.split('\n')
      }

      React.useEffect(() => {
        let active = true
        decoderRef.current = null
        pendingRef.current = ''
        setLines([])
        setLoadedBytes(0)
        setEof(false)
        setTruncated(false)
        setError(null)
        const loadInitial = async (): Promise<void> => {
          try {
            const range = await api.readRange(file.path, 0, Math.min(plan.initialBytes, file.size))
            if (!active) return
            const initial = decodeAppend(range.data)
            setLines(initial)
            setLoadedBytes(range.offset + range.data.length / 4 * 3)
            if (range.eof) {
              setEof(true)
              const tail = pendingRef.current
              if (tail !== '') setLines((prev) => [...prev, tail])
            }
          } catch (reason) {
            if (active) setError(messageOf(reason))
          }
        }
        void loadInitial()
        return () => { active = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [file.path, file.size])

      const loadMore = async (): Promise<void> => {
        if (eof || truncated) return
        try {
          const range = await api.readRange(file.path, loadedBytes, DEFAULT_CHUNK_BYTES)
          const more = decodeAppend(range.data)
          setLines((prev) => {
            const next = [...prev, ...more]
            if (next.length > MAX_KEPT_LINES) {
              setTruncated(true)
              return next.slice(0, MAX_KEPT_LINES)
            }
            return next
          })
          const bytesInData = range.data.length / 4 * 3
          setLoadedBytes(range.offset + bytesInData)
          if (range.eof) {
            setEof(true)
            const tail = pendingRef.current
            if (tail !== '') setLines((prev) => [...prev, tail])
          }
        } catch (reason) {
          setError(messageOf(reason))
        }
      }

      const goToEnd = async (): Promise<void> => {
        try {
          const tailLength = Math.min(DEFAULT_CHUNK_BYTES, file.size)
          const range = await api.readRange(file.path, Math.max(0, file.size - tailLength), tailLength)
          decoderRef.current = null
          pendingRef.current = ''
          const bytes = decodeBase64(range.data)
          const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
          const all = text.split('\n')
          setLines(all)
          setLoadedBytes(file.size)
          setEof(true)
          setTruncated(false)
        } catch (reason) {
          setError(messageOf(reason))
        }
      }

      return { lines, loadedBytes, eof, truncated, loadMore, goToEnd, error }
    }

    function LineView(props: { lines: string[]; wrap: boolean; fontSize: number; query: string; jumpLine: number }): React.ReactNode {
      const { lines, wrap, fontSize, query, jumpLine } = props
      const containerRef = React.useRef<HTMLDivElement | null>(null)
      const lineRefs = React.useRef<Array<HTMLDivElement | null>>([])
      const matches = React.useMemo(() => {
        if (query === '') return new Set<number>()
        const lower = query.toLowerCase()
        const set = new Set<number>()
        lines.forEach((line, index) => { if (line.toLowerCase().includes(lower)) set.add(index) })
        return set
      }, [lines, query])

      React.useEffect(() => {
        if (jumpLine > 0 && lineRefs.current[jumpLine - 1] !== undefined) {
          lineRefs.current[jumpLine - 1]?.scrollIntoView({ block: 'center' })
        }
      }, [jumpLine, lines.length])

      return React.createElement(
        'div',
        { ref: containerRef, className: `dsfv-lines${wrap ? ' isWrap' : ''}` },
        React.createElement(
          'div',
          { className: 'dsfv-line-gutter', 'aria-hidden': true },
          lines.map((_, index) => React.createElement('div', { key: index, className: 'dsfv-gutter-line', style: { fontSize: `${fontSize}px` } }, String(index + 1))),
        ),
        React.createElement(
          'div',
          { className: 'dsfv-line-body' },
          lines.map((line, index) => {
            const isMatch = matches.has(index)
            return React.createElement(
              'div',
              {
                key: index,
                ref: ((node: HTMLDivElement | null): void => { lineRefs.current[index] = node }) as React.Ref<HTMLDivElement>,
                className: `dsfv-line${isMatch ? ' isMatch' : ''}`,
                style: { fontSize: `${fontSize}px` },
                'data-line': String(index + 1),
              },
              line === '' ? '\u00a0' : line,
            )
          }),
        ),
      )
    }

    function TextRenderer(props: TextLikeRendererProps): React.ReactNode {
      const { api, file, t, onStatus } = props
      const [wrap, setWrap] = React.useState(false)
      const [fontSize, setFontSize] = React.useState(13)
      const [query, setQuery] = React.useState('')
      const [jumpLine, setJumpLine] = React.useState(0)
      const { lines, loadedBytes, eof, truncated, loadMore, goToEnd, error } = useChunkedText(api, file)
      const plan = initialLoadPlan(file.size)

      React.useEffect(() => {
        onStatus(`${lines.length} lines`)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [lines.length])

      React.useEffect(() => {
        const line = props.options.line
        if (typeof line === 'number' && line > 0) setJumpLine(line)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      if (error !== null) return React.createElement('div', { className: 'dsfv-center' }, error)

      const scrollToNextMatch = (direction: 1 | -1): void => {
        const lower = query.toLowerCase()
        const indexes: number[] = []
        lines.forEach((line, index) => { if (line.toLowerCase().includes(lower)) indexes.push(index) })
        if (indexes.length === 0) return
        const current = jumpLine - 1
        const next = direction === 1
          ? indexes.find((index) => index > current) ?? indexes[0]
          : [...indexes].reverse().find((index) => index < current) ?? indexes[indexes.length - 1]
        if (next !== undefined) setJumpLine(next + 1)
      }

      return React.createElement(
        'div',
        { className: 'dsfv-renderer-stack' },
        React.createElement(
          'div',
          { className: 'dsfv-subtoolbar' },
          React.createElement(ToolbarButton, { label: t('wordWrap'), onClick: () => setWrap((w) => !w), disabled: false }),
          React.createElement(IconButton, { glyph: 'A-', label: t('fontSize'), title: t('fontSize'), onClick: () => setFontSize((s) => Math.max(10, s - 1)) }),
          React.createElement(IconButton, { glyph: 'A+', label: t('fontSize'), title: t('fontSize'), onClick: () => setFontSize((s) => Math.min(24, s + 1)) }),
          React.createElement('input', {
            className: 'dsfv-search-input',
            type: 'search',
            placeholder: t('search'),
            value: query,
            onChange: (event: Event) => setQuery((event.target as HTMLInputElement).value),
          }),
          React.createElement(IconButton, { glyph: '↑', label: t('search'), title: '', onClick: () => scrollToNextMatch(-1) }),
          React.createElement(IconButton, { glyph: '↓', label: t('search'), title: '', onClick: () => scrollToNextMatch(1) }),
          React.createElement('input', {
            className: 'dsfv-jump-input',
            type: 'number',
            min: 1,
            placeholder: t('jumpToLine'),
            onChange: (event: Event) => { const value = Number((event.target as HTMLInputElement).value); if (value > 0) setJumpLine(value) },
          }),
          !eof && plan.mode !== 'normal'
            ? React.createElement(ToolbarButton, { label: t('nextChunk'), onClick: () => void loadMore(), disabled: truncated })
            : null,
          !eof && plan.mode === 'large'
            ? React.createElement(ToolbarButton, { label: t('goToEnd'), onClick: () => void goToEnd() })
            : null,
        ),
        plan.mode !== 'normal' && !eof
          ? React.createElement('div', { className: 'dsfv-hint' }, t('firstChunk'))
          : null,
        truncated
          ? React.createElement('div', { className: 'dsfv-hint' }, t('truncatedNotice', { count: String(MAX_KEPT_LINES) }))
          : null,
        React.createElement(
          'div',
          { className: 'dsfv-scroll' },
          React.createElement(LineView, { lines, wrap, fontSize, query, jumpLine }),
        ),
        React.createElement('div', { className: 'dsfv-extra-status' }, `${formatBytes(loadedBytes)} / ${formatBytes(file.size)}`),
      )
    }

    // -----------------------------------------------------------------------
    // Code renderer (highlight.js, read-only)
    // -----------------------------------------------------------------------
    function CodeRenderer(props: TextLikeRendererProps): React.ReactNode {
      const { api, file, t } = props
      const [wrap, setWrap] = React.useState(false)
      const [fontSize, setFontSize] = React.useState(13)
      const [jumpLine, setJumpLine] = React.useState(0)
      const { lines, loadedBytes, eof, truncated, loadMore, goToEnd, error } = useChunkedText(api, file)
      const plan = initialLoadPlan(file.size)
      const hljsLang = HLJS_LANG_BY_EXT[file.ext] ?? 'plaintext'

      React.useEffect(() => {
        const line = props.options.line
        if (typeof line === 'number' && line > 0) setJumpLine(line)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      if (error !== null) return React.createElement('div', { className: 'dsfv-center' }, error)

      const highlight = (line: string): string => {
        if (line.trim() === '') return line
        try {
          const result = hljs.highlight(line, { language: hljsLang, ignoreIllegals: true })
          return result.value
        } catch {
          return line
        }
      }

      return React.createElement(
        'div',
        { className: 'dsfv-renderer-stack' },
        React.createElement(
          'div',
          { className: 'dsfv-subtoolbar' },
          React.createElement('span', { className: 'dsfv-lang-badge' }, hljsLang),
          React.createElement(ToolbarButton, { label: t('wordWrap'), onClick: () => setWrap((w) => !w) }),
          React.createElement(IconButton, { glyph: 'A-', label: t('fontSize'), title: t('fontSize'), onClick: () => setFontSize((s) => Math.max(10, s - 1)) }),
          React.createElement(IconButton, { glyph: 'A+', label: t('fontSize'), title: t('fontSize'), onClick: () => setFontSize((s) => Math.min(24, s + 1)) }),
          React.createElement('input', {
            className: 'dsfv-jump-input',
            type: 'number',
            min: 1,
            placeholder: t('jumpToLine'),
            onChange: (event: Event) => { const value = Number((event.target as HTMLInputElement).value); if (value > 0) setJumpLine(value) },
          }),
          !eof && plan.mode !== 'normal' ? React.createElement(ToolbarButton, { label: t('nextChunk'), onClick: () => void loadMore(), disabled: truncated }) : null,
          !eof && plan.mode === 'large' ? React.createElement(ToolbarButton, { label: t('goToEnd'), onClick: () => void goToEnd() }) : null,
        ),
        truncated ? React.createElement('div', { className: 'dsfv-hint' }, t('truncatedNotice', { count: String(MAX_KEPT_LINES) })) : null,
        React.createElement(
          'div',
          { className: 'dsfv-scroll' },
          React.createElement(
            'div',
            { className: 'dsfv-code-wrap' },
            React.createElement(
              'div',
              { className: `dsfv-lines dsfv-code${wrap ? ' isWrap' : ''}` },
              React.createElement(
                'div',
                { className: 'dsfv-line-gutter', 'aria-hidden': true },
                lines.map((_, index) => React.createElement('div', { key: index, className: 'dsfv-gutter-line', style: { fontSize: `${fontSize}px` } }, String(index + 1))),
              ),
              React.createElement(
                'div',
                { className: 'dsfv-line-body dsfv-code-body' },
                lines.map((line, index) => React.createElement(
                  'div',
                  { key: index, className: `dsfv-line${index + 1 === jumpLine ? ' isJump' : ''}`, style: { fontSize: `${fontSize}px` } },
                  React.createElement('span', { className: 'dsfv-code-hl', dangerouslySetInnerHTML: { __html: highlight(line) } }),
                )),
              ),
            ),
          ),
        ),
        React.createElement('div', { className: 'dsfv-extra-status' }, `${formatBytes(loadedBytes)} / ${formatBytes(file.size)}`),
      )
    }

    // -----------------------------------------------------------------------
    // Image renderer
    // -----------------------------------------------------------------------
    function ImageRenderer(props: { api: FileViewerApi; file: FileInfo; t: Translate; onStatus: (status: string) => void }): React.ReactNode {
      const { api, file, t, onStatus } = props
      const [src, setSrc] = React.useState<string | null>(null)
      const [error, setError] = React.useState<string | null>(null)
      const [scale, setScale] = React.useState<'fit' | number>('fit')
      const [dims, setDims] = React.useState<{ width: number; height: number } | null>(null)
      const [pan, setPan] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 })
      const containerRef = React.useRef<HTMLDivElement | null>(null)
      const dragRef = React.useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)

      React.useEffect(() => {
        let active = true
        setError(null)
        setSrc(null)
        setDims(null)
        setScale('fit')
        setPan({ x: 0, y: 0 })
        if (file.size > 50 * 1024 * 1024) {
          setError('Image is too large to preview in the browser (over 50 MB).')
          return
        }
        void api.dataUrl(file.path, file.mime).then((url) => {
          if (active) setSrc(url)
        }).catch((reason) => { if (active) setError(messageOf(reason)) })
        return () => { active = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [file.path])

      const onImageLoad = (event: Event): void => {
        const image = event.target as HTMLImageElement
        setDims({ width: image.naturalWidth, height: image.naturalHeight })
        onStatus(`Image · ${image.naturalWidth} × ${image.naturalHeight}`)
      }

      if (error !== null) return React.createElement('div', { className: 'dsfv-center' }, error)
      if (src === null) return React.createElement('div', { className: 'dsfv-center' }, t('loading'))

      const zoom = (factor: number): void => {
        setScale((current) => (current === 'fit' ? 1 : current) * factor)
        setPan({ x: 0, y: 0 })
      }
      const reset = (): void => { setScale('fit'); setPan({ x: 0, y: 0 }) }

      return React.createElement(
        'div',
        { className: 'dsfv-renderer-stack' },
        React.createElement(
          'div',
          { className: 'dsfv-subtoolbar' },
          React.createElement(ToolbarButton, { label: t('fit'), onClick: reset }),
          React.createElement('span', { className: 'dsfv-zoom-label' }, t('percent', { percent: scale === 'fit' ? 'fit' : String(Math.round(scale * 100)) })),
          React.createElement(IconButton, { glyph: '−', label: t('zoomOut'), title: t('zoomOut'), onClick: () => zoom(0.8) }),
          React.createElement(IconButton, { glyph: '+', label: t('zoomIn'), title: t('zoomIn'), onClick: () => zoom(1.25) }),
          React.createElement(ToolbarButton, { label: t('reset'), onClick: reset }),
          dims !== null ? React.createElement('span', { className: 'dsfv-meta' }, t('imageDimensions', { width: String(dims.width), height: String(dims.height) })) : null,
        ),
        React.createElement(
          'div',
          {
            ref: containerRef,
            className: 'dsfv-image-stage',
            onMouseDown: (event: MouseEvent) => {
              dragRef.current = { startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y }
              const pointerId = (event as unknown as PointerEvent).pointerId
              if (pointerId !== undefined) (event.currentTarget as HTMLElement).setPointerCapture?.(pointerId)
            },
            onMouseMove: (event: MouseEvent) => {
              if (dragRef.current === null) return
              setPan({ x: dragRef.current.panX + (event.clientX - dragRef.current.startX), y: dragRef.current.panY + (event.clientY - dragRef.current.startY) })
            },
            onMouseUp: () => { dragRef.current = null },
          },
          React.createElement('img', {
            className: 'dsfv-image',
            src,
            alt: file.name,
            draggable: false,
            style: {
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale === 'fit' ? 1 : scale})`,
              maxWidth: scale === 'fit' ? '100%' : 'none',
              maxHeight: scale === 'fit' ? '100%' : 'none',
              objectFit: scale === 'fit' ? 'contain' : undefined,
            },
            onLoad: onImageLoad,
          }),
        ),
      )
    }

    // -----------------------------------------------------------------------
    // PDF renderer (pdf.js, lazy page rendering)
    // -----------------------------------------------------------------------
    interface PdfDocumentLike { numPages: number; getPage(pageNumber: number): Promise<{ getViewport(params: { scale: number }): { width: number; height: number }; render(params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void>; cancel?(): void } }> }
    interface PdfRenderTaskLike { promise: Promise<void>; cancel?(): void }

    function PdfRenderer(props: { api: FileViewerApi; file: FileInfo; t: Translate; onStatus: (status: string) => void }): React.ReactNode {
      const { api, file, t, onStatus } = props
      const [error, setError] = React.useState<string | null>(null)
      const [pdf, setPdf] = React.useState<PdfDocumentLike | null>(null)
      const [pageNumber, setPageNumber] = React.useState(1)
      const [scaleMode, setScaleMode] = React.useState<'fit-width' | 'fit-page' | number>('fit-width')
      const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
      const stageRef = React.useRef<HTMLDivElement | null>(null)
      const renderTaskRef = React.useRef<PdfRenderTaskLike | null>(null)

      React.useEffect(() => {
        let active = true
        setError(null)
        setPdf(null)
        setPageNumber(1)
        const load = async (): Promise<void> => {
          if (file.size > 100 * 1024 * 1024) {
            setError('PDF is larger than 100 MB and cannot be previewed in the browser.')
            return
          }
          try {
            const range = await api.readRange(file.path, 0, file.size)
            const bytes = decodeBase64(range.data)
            const task = pdfjs.getDocument({
              data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
              isEvalSupported: false,
              useSystemFonts: true,
            })
            const doc = await task.promise
            if (!active) { void doc.destroy().catch(() => undefined); return }
            setPdf(doc as unknown as PdfDocumentLike)
            onStatus(`PDF · ${doc.numPages} pages`)
          } catch (reason) {
            if (active) setError(messageOf(reason))
          }
        }
        void load()
        return () => { active = false; renderTaskRef.current?.cancel?.() }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [file.path])

      const renderPage = React.useCallback(async (doc: PdfDocumentLike, pageNum: number): Promise<void> => {
        const canvas = canvasRef.current
        const stage = stageRef.current
        if (canvas === null || stage === null) return
        try {
          const page = await doc.getPage(pageNum)
          const base = page.getViewport({ scale: 1 })
          let scale: number
          const stageWidth = stage.clientWidth - 32
          const stageHeight = stage.clientHeight - 32
          if (typeof scaleMode === 'number') {
            scale = scaleMode
          } else if (scaleMode === 'fit-width') {
            scale = Math.max(0.05, stageWidth / base.width)
          } else {
            scale = Math.max(0.05, Math.min(stageWidth / base.width, stageHeight / base.height))
          }
          const viewport = page.getViewport({ scale })
          const ratio = window.devicePixelRatio || 1
          canvas.width = Math.floor(viewport.width * ratio)
          canvas.height = Math.floor(viewport.height * ratio)
          canvas.style.width = `${Math.floor(viewport.width)}px`
          canvas.style.height = `${Math.floor(viewport.height)}px`
          renderTaskRef.current?.cancel?.()
          const context = canvas.getContext('2d')
          if (context === null) return
          context.setTransform(ratio, 0, 0, ratio, 0, 0)
          const task = page.render({ canvasContext: context, viewport })
          renderTaskRef.current = task
          await task.promise
        } catch {
          // render aborted or failed — the page stays blank; user can retry by paging
        }
      }, [scaleMode])

      React.useEffect(() => {
        if (pdf === null) return
        void renderPage(pdf, pageNumber)
      }, [pdf, pageNumber, renderPage])

      if (error !== null) {
        return React.createElement('div', { className: 'dsfv-center' }, t('pdfInvalid'), ' ', React.createElement('p', { className: 'dsfv-muted' }, error))
      }
      if (pdf === null) return React.createElement('div', { className: 'dsfv-center' }, t('loading'))

      const go = (next: number): void => {
        const clamped = Math.min(Math.max(1, next), pdf.numPages)
        setPageNumber(clamped)
      }

      return React.createElement(
        'div',
        { className: 'dsfv-renderer-stack' },
        React.createElement(
          'div',
          { className: 'dsfv-subtoolbar' },
          React.createElement(IconButton, { glyph: '‹', label: t('prevPage'), title: t('prevPage'), disabled: pageNumber <= 1, onClick: () => go(pageNumber - 1) }),
          React.createElement('input', {
            className: 'dsfv-page-input',
            type: 'number',
            min: 1,
            max: pdf.numPages,
            value: pageNumber,
            onChange: (event: Event) => { const value = Number((event.target as HTMLInputElement).value); if (value >= 1) go(value) },
          }),
          React.createElement('span', { className: 'dsfv-meta' }, `/ ${pdf.numPages}`),
          React.createElement(IconButton, { glyph: '›', label: t('nextPage'), title: t('nextPage'), disabled: pageNumber >= pdf.numPages, onClick: () => go(pageNumber + 1) }),
          React.createElement(ToolbarButton, { label: t('fit'), onClick: () => setScaleMode('fit-page') }),
          React.createElement(ToolbarButton, { label: t('wordWrap') === 'Word wrap' ? 'Fit width' : '适应宽度', onClick: () => setScaleMode('fit-width') }),
          React.createElement(IconButton, { glyph: '−', label: t('zoomOut'), title: t('zoomOut'), onClick: () => setScaleMode((mode) => (typeof mode === 'number' ? mode * 0.8 : 1) * 0.8) }),
          React.createElement(IconButton, { glyph: '+', label: t('zoomIn'), title: t('zoomIn'), onClick: () => setScaleMode((mode) => (typeof mode === 'number' ? mode : 1) * 1.25) }),
        ),
        React.createElement(
          'div',
          { ref: stageRef, className: 'dsfv-pdf-stage' },
          React.createElement('canvas', { ref: canvasRef, className: 'dsfv-pdf-canvas' }),
        ),
      )
    }

    // -----------------------------------------------------------------------
    // CSV renderer
    // -----------------------------------------------------------------------
    interface CsvRowLike { cells: string[] }
    function CsvRenderer(props: { api: FileViewerApi; file: FileInfo; t: Translate; onStatus: (status: string) => void }): React.ReactNode {
      const { api, file, t, onStatus } = props
      const [rows, setRows] = React.useState<string[][]>([])
      const [delimiter, setDelimiter] = React.useState(',')
      const [error, setError] = React.useState<string | null>(null)
      const [colWidths, setColWidths] = React.useState<number[]>([])
      const [sortCol, setSortCol] = React.useState<number | null>(null)
      const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc')
      const [query, setQuery] = React.useState('')
      const [loadedBytes, setLoadedBytes] = React.useState(0)
      const [eof, setEof] = React.useState(false)
      const [loadingMore, setLoadingMore] = React.useState(false)
      const scrollRef = React.useRef<HTMLDivElement | null>(null)
      const parserRef = React.useRef<CsvStreamParser | null>(null)
      const pendingRef = React.useRef('')

      const ROW_HEIGHT = 28

      const rowsRef = React.useRef<string[][]>([])
      const eofRef = React.useRef(false)

      const appendChunk = React.useCallback((base64: string, size: number, isEof: boolean): void => {
        const bytes = decodeBase64(base64)
        const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
        const combined = pendingRef.current + text
        pendingRef.current = combined
        if (parserRef.current === null) {
          const detected = detectDelimiter(combined)
          setDelimiter(detected)
          parserRef.current = new CsvStreamParser(detected)
        }
        let next = [...rowsRef.current, ...parserRef.current.push(combined)]
        pendingRef.current = ''
        if (isEof) {
          next = [...next, ...parserRef.current.finish()]
          eofRef.current = true
        }
        if (next.length > CSV_ROW_CAP) {
          next = next.slice(0, CSV_ROW_CAP)
          eofRef.current = true
        }
        rowsRef.current = next
        setRows(next)
        setEof(eofRef.current)
        setLoadedBytes((prev) => prev + size)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      React.useEffect(() => {
        let active = true
        parserRef.current = null
        pendingRef.current = ''
        rowsRef.current = []
        eofRef.current = false
        setRows([])
        setError(null)
        setLoadedBytes(0)
        setEof(false)
        setSortCol(null)
        setQuery('')
        const load = async (): Promise<void> => {
          try {
            const initialBytes = Math.min(file.size, 1024 * 1024)
            const range = await api.readRange(file.path, 0, initialBytes)
            if (!active) return
            appendChunk(range.data, range.offset + range.data.length / 4 * 3, range.eof)
          } catch (reason) {
            if (active) setError(messageOf(reason))
          }
        }
        void load()
        return () => { active = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [file.path])

      const loadMore = async (): Promise<void> => {
        if (eof || loadingMore || rows.length >= CSV_ROW_CAP) return
        setLoadingMore(true)
        try {
          const range = await api.readRange(file.path, loadedBytes, DEFAULT_CHUNK_BYTES)
          appendChunk(range.data, range.data.length / 4 * 3, range.eof)
        } catch (reason) {
          setError(messageOf(reason))
        } finally {
          setLoadingMore(false)
        }
      }

      React.useEffect(() => {
        onStatus(rows.length > 0 ? `${rows.length} rows · ${delimiter}` : '')
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [rows.length, delimiter])

      const [scrollTop, setScrollTop] = React.useState(0)
      const onScroll = (): void => {
        const el = scrollRef.current
        if (el !== null) setScrollTop(el.scrollTop)
      }

      const dataRows = rows.slice(1)
      const sorted: string[][] = React.useMemo(() => {
        if (sortCol === null) return dataRows
        const direction = sortDir === 'asc' ? 1 : -1
        const rowsCopy = [...dataRows]
        rowsCopy.sort((a, b) => {
          const left = a[sortCol] ?? ''
          const right = b[sortCol] ?? ''
          const leftNum = Number(left)
          const rightNum = Number(right)
          if (left !== '' && right !== '' && Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
            return (leftNum - rightNum) * direction
          }
          return left.localeCompare(right) * direction
        })
        return rowsCopy
      }, [dataRows, sortCol, sortDir])

      const filtered: string[][] = React.useMemo(() => {
        if (query === '') return sorted
        const lower = query.toLowerCase()
        return sorted.filter((row) => row.some((cell) => cell.toLowerCase().includes(lower)))
      }, [sorted, query])

      if (error !== null) return React.createElement('div', { className: 'dsfv-center' }, error)
      if (rows.length === 0) return React.createElement('div', { className: 'dsfv-center' }, t('loading'))

      const header = rows[0] as string[]
      if (colWidths.length !== header.length) {
        setColWidths(header.map((_, index) => Math.max(120, Math.min(320, (header[index]?.length ?? 8) * 9 + 40))))
      }

      const visibleStart = Math.floor(scrollTop / ROW_HEIGHT)
      const visibleCount = Math.ceil((scrollRef.current?.clientHeight ?? 400) / ROW_HEIGHT) + 4
      const visibleRows = filtered.slice(visibleStart, visibleStart + visibleCount)

      const toggleSort = (column: number): void => {
        if (sortCol === column) {
          setSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'))
        } else {
          setSortCol(column)
          setSortDir('asc')
        }
      }

      const startResize = (column: number, event: MouseEvent): void => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = colWidths[column] ?? 160
        const onMove = (moveEvent: MouseEvent): void => {
          const next = Math.max(60, startWidth + (moveEvent.clientX - startX))
          setColWidths((widths) => widths.map((width, index) => (index === column ? next : width)))
        }
        const onUp = (): void => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      }

      return React.createElement(
        'div',
        { className: 'dsfv-renderer-stack' },
        React.createElement(
          'div',
          { className: 'dsfv-subtoolbar' },
          React.createElement('span', { className: 'dsfv-lang-badge' }, delimiter === '\t' ? 'TSV' : `CSV · "${delimiter}"`),
          React.createElement('input', {
            className: 'dsfv-search-input',
            type: 'search',
            placeholder: t('search'),
            value: query,
            onChange: (event: Event) => { setQuery((event.target as HTMLInputElement).value); setScrollTop(0); if (scrollRef.current !== null) scrollRef.current.scrollTop = 0 },
          }),
          React.createElement('span', { className: 'dsfv-meta' }, t('showingRows', { shown: String(filtered.length), size: formatBytes(file.size) })),
          !eof && rows.length < CSV_ROW_CAP
            ? React.createElement(ToolbarButton, { label: loadingMore ? t('loadingMore') : t('loadMore'), disabled: loadingMore, onClick: () => void loadMore() })
            : null,
        ),
        React.createElement(
          'div',
          { ref: scrollRef, className: 'dsfv-csv-scroll', onScroll },
          React.createElement(
            'table',
            { className: 'dsfv-csv-table' },
            React.createElement(
              'thead',
              null,
              React.createElement(
                'tr',
                null,
                React.createElement('th', { className: 'dsfv-csv-rownum', style: { width: 48 } }, '#'),
                header.map((cell, index) => React.createElement(
                  'th',
                  {
                    key: index,
                    className: 'dsfv-csv-th',
                    style: { width: colWidths[index] },
                    onClick: () => toggleSort(index),
                    title: sortCol === index ? (sortDir === 'asc' ? t('sortAsc') : t('sortDesc')) : cell,
                  },
                  React.createElement('span', { className: 'dsfv-csv-th-label' }, cell),
                  sortCol === index ? React.createElement('span', { className: 'dsfv-csv-sort', 'aria-hidden': true }, sortDir === 'asc' ? ' ▲' : ' ▼') : null,
                  React.createElement('span', {
                    className: 'dsfv-csv-resize',
                    onMouseDown: (event: MouseEvent) => startResize(index, event),
                  }),
                )),
              ),
            ),
            React.createElement(
              'tbody',
              null,
              visibleRows.map((row, offset) => {
                const rowIndex = visibleStart + offset
                return React.createElement(
                  'tr',
                  { key: rowIndex },
                  React.createElement('td', { className: 'dsfv-csv-rownum', style: { height: ROW_HEIGHT } }, String(rowIndex + 2)),
                  row.map((cell, cellIndex) => React.createElement('td', {
                    key: cellIndex,
                    style: { width: colWidths[cellIndex], height: ROW_HEIGHT },
                    title: cell,
                  }, cell)),
                )
              }),
            ),
          ),
        ),
        eof && rows.length >= CSV_ROW_CAP
          ? React.createElement('div', { className: 'dsfv-hint' }, t('truncatedNotice', { count: String(CSV_ROW_CAP) }))
          : null,
      )
    }

    // -----------------------------------------------------------------------
    // Markdown renderer (sanitized)
    // -----------------------------------------------------------------------
    let markdownItInstance: MarkdownIt | null = null
    function getMarkdownIt(): MarkdownIt {
      if (markdownItInstance === null) {
        markdownItInstance = new MarkdownIt({ html: false, linkify: true, breaks: true })
      }
      return markdownItInstance
    }

    function sanitizeHtml(html: string): string {
      return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'option', 'link', 'meta', 'base'],
        FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
      })
    }

    function MarkdownRenderer(props: { api: FileViewerApi; file: FileInfo; t: Translate; options: OpenOptions; onStatus: (status: string) => void }): React.ReactNode {
      const { api, file, t, options } = props
      const [text, setText] = React.useState<string | null>(null)
      const [error, setError] = React.useState<string | null>(null)
      const [mode, setMode] = React.useState<'preview' | 'source'>(options.renderer === 'markdown' ? 'preview' : 'preview')
      const [renderedHtml, setRenderedHtml] = React.useState<string | null>(null)
      const previewRef = React.useRef<HTMLDivElement | null>(null)

      React.useEffect(() => {
        let active = true
        setError(null)
        setText(null)
        setRenderedHtml(null)
        const load = async (): Promise<void> => {
          try {
            const cap = Math.min(file.size, 4 * 1024 * 1024)
            const range = await api.readRange(file.path, 0, cap)
            const decoded = new TextDecoder('utf-8', { fatal: false }).decode(decodeBase64(range.data))
            if (!active) return
            setText(decoded)
            const html = sanitizeHtml(getMarkdownIt().render(decoded))
            setRenderedHtml(html)
          } catch (reason) {
            if (active) setError(messageOf(reason))
          }
        }
        void load()
        return () => { active = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [file.path])

      // Resolve relative image paths against the markdown file's directory.
      React.useEffect(() => {
        if (previewRef.current === null) return
        const root = previewRef.current
        const dir = dirname(file.path)
        const images = root.querySelectorAll<HTMLImageElement>('img[src]')
        const jobs: Array<Promise<void>> = []
        images.forEach((image) => {
          const src = image.getAttribute('src') ?? ''
          if (/^(?:https?:|data:|blob:|#)/i.test(src)) return
          const resolved = dir === '' ? src : `${dir}/${src}`
          const job = api.readHead(resolved, 5 * 1024 * 1024).then((head) => {
            if (head.truncated) return
            const mime = detectMime(resolved, decodeBase64(head.data))
            if (mime.startsWith('image/')) {
              image.src = `data:${mime};base64,${head.data}`
            }
          }).catch(() => undefined)
          jobs.push(job)
        })
        void Promise.all(jobs)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [renderedHtml])

      if (error !== null) return React.createElement('div', { className: 'dsfv-center' }, error)
      if (text === null) return React.createElement('div', { className: 'dsfv-center' }, t('loading'))

      return React.createElement(
        'div',
        { className: 'dsfv-renderer-stack' },
        React.createElement(
          'div',
          { className: 'dsfv-subtoolbar' },
          React.createElement(ToolbarButton, { label: t('preview'), onClick: () => setMode('preview') }),
          React.createElement(ToolbarButton, { label: t('source'), onClick: () => setMode('source') }),
        ),
        mode === 'preview'
          ? React.createElement(
              'div',
              { className: 'dsfv-scroll' },
              renderedHtml === null
                ? React.createElement('div', { className: 'dsfv-center' }, t('loading'))
                : React.createElement('div', { ref: previewRef, className: 'dsfv-markdown', dangerouslySetInnerHTML: { __html: renderedHtml } }),
            )
          : React.createElement(
              'div',
              { className: 'dsfv-scroll' },
              React.createElement('pre', { className: 'dsfv-markdown-source' }, text),
            ),
      )
    }

    // -----------------------------------------------------------------------
    // JSON / YAML renderers (tree + source)
    // -----------------------------------------------------------------------
    interface DataRendererProps {
      api: FileViewerApi
      file: FileInfo
      t: Translate
      options: OpenOptions
      onStatus: (status: string) => void
    }
    interface TreeLikeProps extends DataRendererProps {
      parse: (text: string) => { ok: true; value: unknown; nodes: Array<{ path: string; key: string; value: unknown; kind: 'object' | 'array' | 'scalar'; size: number }> } | { ok: false; error: string }
    }

    function JsonTreeView(props: { value: unknown; t: Translate }): React.ReactNode {
      const { value, t } = props
      const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
      const rootRef = React.useRef<HTMLDivElement | null>(null)

      const toggle = (path: string): void => {
        setCollapsed((previous) => {
          const next = new Set(previous)
          if (next.has(path)) next.delete(path)
          else next.add(path)
          return next
        })
      }
      const expandAll = (): void => setCollapsed(new Set())
      const collapseAll = (): void => {
        const paths = new Set<string>()
        const walk = (current: unknown, path: string): void => {
          if (Array.isArray(current) || (typeof current === 'object' && current !== null)) {
            if (path !== '') paths.add(path)
            if (Array.isArray(current)) current.forEach((item, index) => walk(item, `${path}[${index}]`))
            else Object.entries(current as Record<string, unknown>).forEach(([key, child]) => walk(child, path === '' ? key : `${path}.${key}`))
          }
        }
        walk(value, '')
        setCollapsed(paths)
      }
      const copy = (text: string): void => { void navigator.clipboard?.writeText(text) }

      const kindOf = (item: unknown): 'object' | 'array' | 'scalar' => {
        if (Array.isArray(item)) return 'array'
        if (typeof item === 'object' && item !== null) return 'object'
        return 'scalar'
      }
      const sizeOf = (item: unknown): number => {
        if (Array.isArray(item)) return item.length
        if (typeof item === 'object' && item !== null) return Object.keys(item as Record<string, unknown>).length
        return 0
      }

      const renderChildren = (current: unknown, path: string, depth: number): React.ReactNode => {
        if (Array.isArray(current)) {
          return React.createElement(React.Fragment, null,
            current.map((item, index) => renderNode({ path: `${path}[${index}]`, key: String(index), value: item, kind: kindOf(item), size: sizeOf(item) }, depth)))
        }
        if (typeof current === 'object' && current !== null) {
          return React.createElement(React.Fragment, null,
            Object.entries(current as Record<string, unknown>).map(([key, item]) => renderNode({ path: `${path}.${key}`, key, value: item, kind: kindOf(item), size: sizeOf(item) }, depth)))
        }
        return null
      }

      const renderNode = (node: { path: string; key: string; value: unknown; kind: 'object' | 'array' | 'scalar'; size: number }, depth: number): React.ReactNode => {
        const isCollapsed = collapsed.has(node.path)
        const isContainer = node.kind !== 'scalar'
        const label = node.key === '' ? '$' : node.key
        return React.createElement(
          'div',
          { key: node.path, className: 'dsfv-json-node', style: { paddingLeft: `${depth * 16}px` } },
          isContainer
            ? React.createElement(
                'div',
                { className: 'dsfv-json-row' },
                React.createElement(
                  'button',
                  { type: 'button', className: 'dsfv-json-toggle', 'aria-expanded': !isCollapsed, onClick: () => toggle(node.path) },
                  isCollapsed ? '▸' : '▾',
                ),
                React.createElement('span', { className: 'dsfv-json-key' }, label),
                React.createElement('span', { className: 'dsfv-json-preview' }, node.kind === 'array' ? `[${node.size}]` : `{${node.size}}`),
                React.createElement(
                  'button',
                  { type: 'button', className: 'dsfv-json-copy', onClick: () => copy(node.path) },
                  t('copyJsonPath'),
                ),
              )
            : React.createElement(
                'div',
                { className: 'dsfv-json-row' },
                React.createElement('span', { className: 'dsfv-json-gutter' }, '·'),
                React.createElement('span', { className: 'dsfv-json-key' }, label),
                React.createElement('span', { className: `dsfv-json-value is${typeof node.value === 'string' ? 'String' : typeof node.value === 'number' ? 'Number' : typeof node.value === 'boolean' ? 'Boolean' : 'Null'}` }, scalarText(node.value)),
                React.createElement(
                  'button',
                  { type: 'button', className: 'dsfv-json-copy', onClick: () => copy(JSON.stringify(node.value)) },
                  t('copyValue'),
                ),
              ),
          isContainer && !isCollapsed
            ? renderChildren(node.value, node.path, depth + 1)
            : null,
        )
      }

      return React.createElement(
        'div',
        { className: 'dsfv-json-tree' },
        React.createElement(
          'div',
          { className: 'dsfv-json-actions' },
          React.createElement(ToolbarButton, { label: t('expandAll'), onClick: expandAll }),
          React.createElement(ToolbarButton, { label: t('collapseAll'), onClick: collapseAll }),
        ),
        React.createElement('div', { ref: rootRef, className: 'dsfv-json-nodes' }, renderNode({ path: '', key: '', value, kind: kindOf(value), size: sizeOf(value) }, 0)),
      )
    }

    function JsonYamlRenderer(props: TreeLikeProps): React.ReactNode {
      const { api, file, t, parse } = props
      const [mode, setMode] = React.useState<'tree' | 'source'>('tree')
      const [parsed, setParsed] = React.useState<{ ok: true; value: unknown; nodes: Array<{ path: string; key: string; value: unknown; kind: 'object' | 'array' | 'scalar'; size: number }> } | { ok: false; error: string } | null>(null)
      const [text, setText] = React.useState<string | null>(null)
      const [error, setError] = React.useState<string | null>(null)

      React.useEffect(() => {
        let active = true
        setError(null)
        setParsed(null)
        setText(null)
        const load = async (): Promise<void> => {
          try {
            const cap = Math.min(file.size, 8 * 1024 * 1024)
            const range = await api.readRange(file.path, 0, cap)
            const decoded = new TextDecoder('utf-8', { fatal: false }).decode(decodeBase64(range.data))
            if (!active) return
            setText(decoded)
            const result = parse(decoded)
            if (result.ok) setParsed(result)
            else setParsed({ ok: false, error: result.error })
          } catch (reason) {
            if (active) setError(messageOf(reason))
          }
        }
        void load()
        return () => { active = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [file.path])

      if (error !== null) return React.createElement('div', { className: 'dsfv-center' }, error)
      if (text === null) return React.createElement('div', { className: 'dsfv-center' }, t('loading'))

      const hljsLang = file.ext === 'yaml' || file.ext === 'yml' ? 'yaml' : 'json'
      const highlight = (line: string): string => {
        if (line.trim() === '') return line
        try {
          const result = hljs.highlight(line, { language: hljsLang, ignoreIllegals: true })
          return result.value
        } catch {
          return line
        }
      }
      const lines = text.split('\n')

      return React.createElement(
        'div',
        { className: 'dsfv-renderer-stack' },
        React.createElement(
          'div',
          { className: 'dsfv-subtoolbar' },
          React.createElement(ToolbarButton, { label: t('tree'), onClick: () => setMode('tree') }),
          React.createElement(ToolbarButton, { label: t('source'), onClick: () => setMode('source') }),
          parsed !== null && !parsed.ok
            ? React.createElement('span', { className: 'dsfv-meta dsfv-muted' }, t('reason'), ' ', parsed.error)
            : null,
        ),
        mode === 'tree' && parsed !== null && parsed.ok
          ? React.createElement('div', { className: 'dsfv-scroll' }, React.createElement(JsonTreeView, { value: parsed.value, t }))
          : React.createElement(
              'div',
              { className: 'dsfv-scroll' },
              React.createElement(
                'div',
                { className: 'dsfv-lines dsfv-code' },
                React.createElement(
                  'div',
                  { className: 'dsfv-line-gutter', 'aria-hidden': true },
                  lines.map((_, index) => React.createElement('div', { key: index, className: 'dsfv-gutter-line' }, String(index + 1))),
                ),
                React.createElement(
                  'div',
                  { className: 'dsfv-line-body dsfv-code-body' },
                  lines.map((line, index) => React.createElement(
                    'div',
                    { key: index, className: 'dsfv-line' },
                    React.createElement('span', { className: 'dsfv-code-hl', dangerouslySetInnerHTML: { __html: highlight(line) } }),
                  )),
                ),
              ),
            ),
      )
    }

    function JsonRenderer(props: DataRendererProps): React.ReactNode {
      return React.createElement(JsonYamlRenderer, { ...props, parse: (text) => {
        const result = parseJson(text)
        return result.ok
          ? { ok: true as const, value: result.value, nodes: result.nodes }
          : { ok: false as const, error: result.error }
      } })
    }

    function YamlRenderer(props: DataRendererProps): React.ReactNode {
      return React.createElement(JsonYamlRenderer, { ...props, parse: (text) => {
        try {
          const value = yamlLoad(text)
          return { ok: true as const, value, nodes: [] }
        } catch (error) {
          return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
        }
      } })
    }

    // -----------------------------------------------------------------------
    // Fallback renderer
    // -----------------------------------------------------------------------
    function FallbackRenderer(props: { api: FileViewerApi; file: FileInfo; t: Translate }): React.ReactNode {
      const { api, file, t } = props
      const binary = viewerStore.get().binary
      const openAsText = !binary && file.size <= 5 * 1024 * 1024

      return React.createElement(
        'div',
        { className: 'dsfv-fallback' },
        React.createElement('strong', null, t('previewUnavailable')),
        React.createElement(
          'dl',
          { className: 'dsfv-fallback-dl' },
          React.createElement('dt', null, t('filename')),
          React.createElement('dd', null, file.path),
          React.createElement('dt', null, t('type')),
          React.createElement('dd', null, file.mime),
          React.createElement('dt', null, t('size')),
          React.createElement('dd', null, formatBytes(file.size)),
        ),
        React.createElement(
          'div',
          { className: 'dsfv-error-actions' },
          React.createElement(ToolbarButton, { label: t('openExternal'), primary: true, onClick: () => void api.openExternal(file.path).catch(() => undefined) }),
          React.createElement(ToolbarButton, { label: t('revealInExplorer'), onClick: () => void api.openExternal(dirname(file.path) || file.path).catch(() => undefined) }),
          React.createElement(ToolbarButton, { label: t('copyPath'), onClick: () => void navigator.clipboard?.writeText(file.path) }),
          openAsText
            ? React.createElement(ToolbarButton, { label: t('openAsText'), onClick: () => viewerStore.set({ options: { ...viewerStore.get().options, renderer: 'text' } }) })
            : binary
              ? React.createElement('p', { className: 'dsfv-muted' }, t('openTextHint'))
              : null,
        ),
      )
    }

    // -----------------------------------------------------------------------
    // Produced-file chips (conversation.chat.turnTail chain entry)
    // -----------------------------------------------------------------------
    interface DeliverablesLocation { produced: Array<{ seq: number; path: string }> }
    function producedForClosing(data: DeliverablesLocation | undefined, seq: number): string[] {
      if (data === undefined) return []
      const paths: string[] = []
      const seen = new Set<string>()
      for (const produced of data.produced) {
        if (produced.seq > seq || seen.has(produced.path)) continue
        seen.add(produced.path)
        paths.push(produced.path)
      }
      return paths
    }

    // The Harness deliverables registry only records diff/edit tool cards, so
    // files written by run_code/bash never appear as produced files. As a
    // fallback, scan the assistant turn text (turn-tail finalized steps) for
    // file paths and surface them as chips too, so "对话里直接看文件" works
    // for every write tool.
    interface AssistantBlock { kind?: string; text?: string }
    interface TurnTailData {
      closing?: { blocks?: AssistantBlock[] } | null
    }
    function pathsFromAssistantText(data: TurnTailData | undefined): string[] {
      const blocks = data?.closing?.blocks
      if (blocks === undefined) return []
      const paths: string[] = []
      const seen = new Set<string>()
      const push = (candidate: string): void => {
        const trimmed = candidate.trim().replace(/[.,;:!?)\]'"]+$/, '')
        if (trimmed === '' || !trimmed.includes('/')) return
        if (/^(https?:|data:|blob:|file:|javascript:)/.test(trimmed)) return
        if (/[\s\\]/.test(trimmed)) return
        // Require a file extension or an absolute path, so tool words
        // (edit, bash, cat ...) and prose fragments never become chips.
        const hasExt = /\.[a-zA-Z0-9]{1,8}$/.test(trimmed)
        const isAbs = isAbsoluteLocalPath(trimmed)
        if (!hasExt && !isAbs) return
        if (seen.has(trimmed)) return
        seen.add(trimmed)
        paths.push(trimmed)
      }
      for (const block of blocks) {
        if (block.kind !== 'text' || block.text === undefined) continue
        // Markdown inline code / bare paths with at least one slash.
        const inline = block.text.matchAll(/`([^`]+)`/g)
        for (const match of inline) push(match[1] ?? '')
        const bare = block.text.matchAll(/(?:^|[\s(\[,>])([^\s(\[,>]+\/[^\s)\]<]*)/g)
        for (const match of bare) push(match[1] ?? '')
      }
      return paths
    }

    function selectProducedFiles(owner: { turn: { data: { get(key: string): unknown } }; seq: number }): string[] | null {
      const paths = producedForClosing(owner.turn.data.get('deliverables') as DeliverablesLocation | undefined, owner.seq)
      const tail = owner.turn.data.get('turn-tail') as TurnTailData | undefined
      for (const candidate of pathsFromAssistantText(tail)) {
        if (!paths.includes(candidate)) paths.push(candidate)
      }
      return paths.length === 0 ? null : paths
    }

    // Only render chips whose files actually exist on disk. The assistant-text
    // fallback can surface lookalike fragments, so verify each candidate with
    // a stat RPC before showing it. Paths may be relative to any workspace or
    // absolute, so try every known root before giving up.
    function useExistingFiles(paths: string[], api: FileViewerApi, cwd: string | undefined): string[] {
      const [existing, setExisting] = React.useState<string[]>([])
      React.useEffect(() => {
        let active = true
        const candidates = paths.map((path) => {
          const absolute = isAbsoluteLocalPath(path)
          if (absolute) return [path]
          const bases = [cwd]
          for (const root of knownWorkspaceRoots) {
            if (root !== undefined && root !== '' && !bases.includes(root)) bases.push(root)
          }
          return bases
            .filter((base): base is string => base !== undefined && base !== '')
            .map((base) => `${base.replace(/[\/]+$/, '')}/${path.replace(/^[\/]+/, '')}`)
        })
        void Promise.all(candidates.map(async (pathsForCandidate) => {
          for (const path of pathsForCandidate) {
            try {
              const meta = await api.stat(path)
              if (meta.exists && !meta.isDirectory) return path
            } catch {
              // try the next base
            }
          }
          return null
        })).then((results) => {
          if (!active) return
          const kept = results.filter((path): path is string => path !== null)
          if (kept.length > 0) setExisting(kept)
        })
        return () => { active = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [paths.join('|')])
      return existing
    }

    function ProducedFileChips(props: { matched: string[]; api: FileViewerApi; t: Translate; sessionId?: string; useSessions?: (selector: (snapshot: { byId?: Record<string, { cwd?: string } | undefined> }) => string | undefined) => string | undefined }): React.ReactNode {
      const { matched: paths, api, t, sessionId, useSessions } = props
      const cwd = useSessions?.((snapshot) => snapshot.byId?.[sessionId ?? '']?.cwd)
      const existing = useExistingFiles(paths, api, cwd)
      if (existing.length === 0) return null
      return React.createElement(
        'div',
        { className: 'dsfv-produced' },
        React.createElement('span', { className: 'dsfv-produced-label' }, t('produced')),
        React.createElement(
          'div',
          { className: 'dsfv-produced-row' },
          existing.map((path) => React.createElement(
            'button',
            {
              type: 'button',
              key: path,
              className: 'dsfv-produced-chip',
              title: path,
              onClick: () => api.openFile(path),
            },
            basename(path),
          )),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsfv-produced-folder',
              title: t('showInFolder'),
              onClick: () => {
                if (existing[0] !== undefined) {
                  viewerStore.set({ open: true, mode: 'browse', browsePath: dirname(existing[0]), browseEntries: null, browseError: null })
                  activateFileViewerTab()
                }
              },
            },
            t('showInFolder'),
          ),
        ),
      )
    }

    // -----------------------------------------------------------------------
    // Styles (theme tokens — automatic light/dark, Harness-native surfaces)
    // -----------------------------------------------------------------------
    function installStyle(): () => void {
      const css = [
        // Conversation view column (sibling of the "轨迹" tab) styled like the
        // Harness details panel: bg-base surface, header with title + close.
        // flex:1 fills the conversation viewArea (flex container); min-height:0
        // lets the inner scroll areas shrink correctly.
        '.dsfv-panel{--dsfv-bottom-clearance:calc(var(--dsh-composer-height,152px) + 16px);display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;width:100%;height:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);overflow:hidden}',
        '.dsfv-toolbar{border-bottom:1px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:8px;padding:14px 12px 12px;display:flex;flex:none}',
        '.dsfv-toolbar-file{display:flex;align-items:center;gap:10px;min-width:0}',
        '.dsfv-back-btn{font:inherit;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-radius:6px;padding:3px 8px;cursor:pointer;white-space:nowrap;flex:none}',
        '.dsfv-back-btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsfv-titlebar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;min-width:0}',
        '.dsfv-titlebar-path{display:flex;align-items:center;gap:8px;min-width:0;flex:1}',
        '.dsfv-titlebar-actions{display:flex;align-items:center;gap:4px;flex:none}',
        '.dsfv-path{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:520px}',
        '.dsfv-title{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;overflow:hidden;max-width:360px}',
        '.dsfv-close{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:transparent;border:none;border-radius:999px;flex:none;place-items:center;display:grid}',
        '.dsfv-close:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsfv-meta{font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
        '.dsfv-muted{color:var(--dsw-alias-label-tertiary)}',
        '.dsfv-toolbar-actions{display:flex;align-items:center;gap:4px;flex:none}',
        '.dsfv-toolbar-btn{font:inherit;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-radius:6px;padding:3px 8px;cursor:pointer;white-space:nowrap}',
        '.dsfv-toolbar-btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsfv-toolbar-btn.isPrimary{color:var(--dsw-alias-label-inverse);background:var(--dsw-alias-button-primary-fill)}',
        '.dsfv-toolbar-btn.isPrimary:hover{color:var(--dsw-alias-label-inverse);background:var(--dsw-alias-button-primary-hover)}',
        '.dsfv-toolbar-btn:disabled{opacity:.5;cursor:default}',
        '.dsfv-icon-btn{font:inherit;font-size:13px;line-height:1;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-radius:6px;padding:5px 7px;cursor:pointer}',
        '.dsfv-icon-btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsfv-icon-btn:disabled{opacity:.5;cursor:default}',
        '.dsfv-body{flex:1;min-height:0;display:flex;flex-direction:column}',
        '.dsfv-renderer{flex:1;min-height:0;display:flex;flex-direction:column}',
        '.dsfv-renderer-stack{flex:1;min-height:0;display:flex;flex-direction:column}',
        '.dsfv-subtoolbar{display:flex;align-items:center;gap:8px;padding:6px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;flex-wrap:wrap;min-height:34px}',
        '.dsfv-statusbar{display:flex;align-items:center;gap:16px;margin-bottom:var(--dsfv-bottom-clearance);padding:5px 14px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-tertiary);flex:none}',
        '.dsfv-status-extra{margin-left:auto;color:var(--dsw-alias-label-secondary)}',
        '.dsfv-center{box-sizing:border-box;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--dsw-alias-label-secondary);padding:24px 24px calc(24px + var(--dsfv-bottom-clearance));text-align:center}',
        '.dsfv-empty p{color:var(--dsw-alias-label-tertiary);max-width:420px}',
        '.dsfv-hint{background:var(--dsw-alias-state-warn-secondary);color:var(--dsw-alias-state-warn-label);font-size:12px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
        '.dsfv-error{padding:24px;display:flex;flex-direction:column;gap:8px;align-items:flex-start}',
        '.dsfv-error-actions{display:flex;gap:8px;margin-top:8px}',
        '.dsfv-scroll{flex:1;min-height:0;overflow:auto;position:relative}',
        '.dsfv-lines{display:flex;min-width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.55}',
        '.dsfv-lines.isWrap .dsfv-line-body{white-space:pre-wrap;word-break:break-all}',
        '.dsfv-line-gutter{flex:none;text-align:right;padding:8px 8px 8px 12px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);user-select:none;border-right:1px solid var(--dsw-alias-border-l1);position:sticky;left:0;z-index:1}',
        '.dsfv-gutter-line{padding-right:8px;min-width:36px}',
        '.dsfv-line-body{flex:1;padding:8px 12px;white-space:pre}',
        '.dsfv-line{min-height:1.55em}',
        '.dsfv-line.isMatch{background:var(--dsw-alias-state-warn-secondary)}',
        '.dsfv-line.isJump{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-inverse)}',
        '.dsfv-code .dsfv-code-hl{font-family:inherit}',
        '.dsfv-lang-badge{font-size:11px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover);border-radius:4px;padding:2px 6px;text-transform:uppercase;letter-spacing:.04em}',
        '.dsfv-search-input,.dsfv-jump-input,.dsfv-page-input{font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px;width:140px}',
        '.dsfv-jump-input{width:90px}.dsfv-page-input{width:56px}',
        '.dsfv-extra-status{padding:4px 12px;font-size:11px;color:var(--dsw-alias-label-tertiary);border-top:1px solid var(--dsw-alias-border-l1);flex:none}',
        '.dsfv-image-stage{flex:1;min-height:0;overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:grab;background:var(--dsw-alias-bg-base)}',
        '.dsfv-image{user-select:none;transition:transform .08s linear}',
        '.dsfv-zoom-label{font-size:12px;color:var(--dsw-alias-label-secondary);min-width:44px;text-align:center}',
        '.dsfv-pdf-stage{flex:1;min-height:0;overflow:auto;display:flex;justify-content:center;background:var(--dsw-alias-bg-base);padding:16px}',
        '.dsfv-pdf-canvas{box-shadow:0 2px 12px rgba(0,0,0,.25);background:#fff}',
        '.dsfv-csv-scroll{flex:1;min-height:0;overflow:auto}',
        '.dsfv-csv-table{border-collapse:separate;border-spacing:0;font-size:12px;min-width:max-content}',
        '.dsfv-csv-th{position:sticky;top:0;z-index:2;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l2);text-align:left;padding:6px 10px;font-weight:600;position:relative;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.dsfv-csv-th-label{display:inline-block;max-width:calc(100% - 6px);overflow:hidden;text-overflow:ellipsis;vertical-align:bottom}',
        '.dsfv-csv-resize{position:absolute;right:0;top:0;bottom:0;width:5px;cursor:col-resize;z-index:3}',
        '.dsfv-csv-resize:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsfv-csv-sort{color:var(--dsw-alias-state-business-primary)}',
        '.dsfv-csv-rownum{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);text-align:right;padding:0 8px;font-size:11px;border-bottom:1px solid var(--dsw-alias-border-l1);position:sticky;left:0;z-index:1}',
        '.dsfv-csv-table td{border-bottom:1px solid var(--dsw-alias-border-l1);padding:0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:480px;color:var(--dsw-alias-label-primary)}',
        '.dsfv-csv-table tbody tr:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsfv-markdown{max-width:860px;margin:0 auto;padding:24px 32px;font-size:14px;line-height:1.65;color:var(--dsw-alias-label-primary);overflow-wrap:break-word}',
        '.dsfv-markdown h1,.dsfv-markdown h2,.dsfv-markdown h3{margin:1.2em 0 .5em;line-height:1.3}',
        '.dsfv-markdown code{background:var(--dsw-alias-markdown-code-block);padding:2px 5px;border-radius:4px;font-size:13px}',
        '.dsfv-markdown pre{background:var(--dsw-alias-markdown-code-block);padding:12px;border-radius:8px;overflow:auto;border:1px solid var(--dsw-alias-border-l1)}',
        '.dsfv-markdown pre code{background:none;padding:0}',
        '.dsfv-markdown table{border-collapse:collapse;margin:1em 0}',
        '.dsfv-markdown th,.dsfv-markdown td{border:1px solid var(--dsw-alias-border-l2);padding:6px 10px}',
        '.dsfv-markdown blockquote{border-left:3px solid var(--dsw-alias-border-l3);margin:.6em 0;padding:.2em 1em;color:var(--dsw-alias-label-secondary)}',
        '.dsfv-markdown a{color:var(--dsw-alias-brand-primary)}',
        '.dsfv-markdown img{max-width:100%}',
        '.dsfv-markdown-source{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;padding:16px;white-space:pre-wrap;word-break:break-word}',
        '.dsfv-json-tree{flex:1;min-height:0;overflow:auto}',
        '.dsfv-json-actions{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
        '.dsfv-json-nodes{padding:8px 0 16px}',
        '.dsfv-json-row{display:flex;align-items:center;gap:6px;padding:2px 12px;font-size:12.5px}',
        '.dsfv-json-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsfv-json-toggle{font-size:10px;width:18px;height:18px;border:none;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}',
        '.dsfv-json-gutter{width:18px;color:var(--dsw-alias-label-tertiary);text-align:center}',
        '.dsfv-json-key{color:var(--dsw-alias-state-business-primary);white-space:nowrap}',
        '.dsfv-json-preview{color:var(--dsw-alias-label-tertiary);font-size:11px}',
        '.dsfv-json-value{white-space:nowrap}.dsfv-json-value.isString{color:var(--dsw-alias-state-success-primary)}.dsfv-json-value.isNumber{color:var(--dsw-alias-state-business-primary)}.dsfv-json-value.isBoolean{color:var(--dsw-alias-state-warn-primary)}.dsfv-json-value.isNull{color:var(--dsw-alias-label-tertiary)}',
        '.dsfv-json-copy{font-size:10px;color:var(--dsw-alias-label-tertiary);background:none;border:1px solid transparent;border-radius:4px;padding:1px 5px;cursor:pointer;margin-left:auto}',
        '.dsfv-json-copy:hover{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l2)}',
        '.dsfv-browser{flex:1;min-height:0;display:flex;flex-direction:column}',
        '.dsfv-browser-nav{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;flex-wrap:wrap}',
        '.dsfv-crumb{font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:flex;align-items:center;gap:2px;padding:2px 4px;border-radius:4px}',
        '.dsfv-crumb:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsfv-crumb.isCurrent{color:var(--dsw-alias-label-primary);font-weight:600}',
        '.dsfv-crumb-sep{color:var(--dsw-alias-label-tertiary)}',
        '.dsfv-filelist{box-sizing:border-box;list-style:none;margin:0;padding:6px 0 calc(6px + var(--dsfv-bottom-clearance));scroll-padding-bottom:var(--dsfv-bottom-clearance);overflow:auto;flex:1}',
        '.dsfv-file-row{display:flex;align-items:center;gap:10px;width:100%;padding:5px 16px;border:none;background:none;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}',
        '.dsfv-file-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsfv-file-icon{color:var(--dsw-alias-label-tertiary);width:14px;flex:none}',
        '.dsfv-file-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.dsfv-file-size{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none}',
        '.dsfv-fallback{padding:32px;display:flex;flex-direction:column;gap:12px;align-items:flex-start;overflow:auto}',
        '.dsfv-fallback-dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;font-size:13px}',
        '.dsfv-fallback-dl dt{color:var(--dsw-alias-label-tertiary)}',
        '.dsfv-fallback-dl dd{margin:0;color:var(--dsw-alias-label-primary);word-break:break-all}',
        '.dsfv-produced{display:flex;align-items:flex-start;gap:8px;margin-top:14px;font-size:13px}',
        '.dsfv-produced-label{color:var(--dsw-alias-label-tertiary);flex:none;padding-top:2px}',
        '.dsfv-produced-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}',
        '.dsfv-produced-chip{font:inherit;font-size:12.5px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border:none;border-radius:6px;padding:2px 8px;cursor:pointer;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.dsfv-produced-chip:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}',
        '.dsfv-produced-folder{font:inherit;font-size:12px;color:var(--dsw-alias-label-tertiary);background:none;border:none;padding:2px 4px;cursor:pointer}',
        '.dsfv-produced-folder:hover{color:var(--dsw-alias-label-secondary);text-decoration:underline}',
        '.dsfv-line-gutter .dsfv-gutter-line{font-size:inherit}',
      ].join('')
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-file-viewer'
      style.dataset.pluginCss = 'dsh-file-viewer/styles'
      style.textContent = css
      document.head.append(style)
      return () => style.remove()
    }

    // -----------------------------------------------------------------------
    // Viewer and browser-side content registries exposed through ctx.provide.
    // -----------------------------------------------------------------------
    const viewerRegistry = new RendererRegistry()
    const viewerContentProviders = new FileViewerContentRegistry()

    // -----------------------------------------------------------------------
    // Plugin body
    // -----------------------------------------------------------------------
    function apply(ctx: HostCtxLike): void {
      const t = ctx.locale.bind(NS)
      const sessions = ctx.get<SessionsLike>('sessions')
      const api = createApi(ctx, sessions, viewerContentProviders)

      // Remember every known workspace root so relative chip paths can be
      // resolved even when the current session's cwd differs.
      const workspacesService = ctx.get<{ list: { getSnapshot(): { items: Array<{ path: string }> } } }>('workspaces')
      const workspaceItems = workspacesService?.list.getSnapshot().items ?? []
      knownWorkspaceRoots.length = 0
      knownWorkspaceRoots.push(...workspaceItems.map((workspace) => workspace.path))

      // Bridge for the workspace-row "浏览" menu item (patched into
      // dsh-client-ui-workspace by scripts/patch-workspace-menu.mjs): the
      // patched handler passes a workspace id (or, as a fallback, an absolute
      // path) and we open the viewer as a conversation view rooted there.
      // The "文件查看器" tab is registered under conversation.view; switching
      // tabs is a chatStore action owned by the conversation plugin, so we
      // ask the user's active session to activate our tab through the layout
      // (the tab button itself remains the manual fallback).
      window.__dsfvBrowseWorkspace = (workspaceIdOrPath: string): void => {
        const workspaces = ctx.get<{ list: { getSnapshot(): { items: Array<{ workspaceId: string; path: string }> } } }>('workspaces')
        const items = workspaces?.list.getSnapshot().items ?? []
        const match = items.find((workspace) => workspace.workspaceId === workspaceIdOrPath)
        const path = match?.path ?? (isAbsoluteLocalPath(workspaceIdOrPath) ? workspaceIdOrPath : undefined)
        if (path === undefined) return
        viewerStore.set({ open: true, mode: 'browse', browsePath: path, browseEntries: null, browseError: null, file: null, error: null, loading: false, status: '', binary: false })
        activateFileViewerTab()
      }

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-file-viewer: dictionaries')
      ctx.effect(installStyle, 'dsh-file-viewer: client styles')

      ctx.provide('fileViewer', {
        openFile: (path: string, options?: OpenOptions) => api.openFile(path, options),
        registerContentProvider: api.registerContentProvider,
        stat: api.stat,
        readRange: api.readRange,
        readHead: api.readHead,
        list: api.list,
        openExternal: api.openExternal,
      })

      // Register the viewer as a conversation view tab (sibling of the
      // "对话" and "轨迹" tabs). The conversation plugin renders its
      // conversation.view children into the center column and lists them as
      // tabs in the session header when there is more than one.
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'dsh-file-viewer',
        order: 20,
        locale: NS,
        label: () => t('viewFile'),
        inject: () => ({ api }),
      }, FileViewerPanel))

      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        select: selectProducedFiles,
        priority: -1,
        locale: NS,
        inject: () => ({ api }),
      }, ProducedFileChips))
    }

    module.exports.inject = inject
    module.exports.apply = apply
    return module.exports
  },
})
