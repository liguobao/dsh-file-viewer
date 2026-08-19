/**
 * Public API surface of dsh-file-viewer (node half).
 *
 * The host half registers the `/fileviewer` RPC channel; the client half
 * provides the `fileViewer` service (`ctx.get('fileViewer')`) with
 * `openFile(path, options)`.
 */

import type { Config } from './index.js'

export { name, Config } from './index.js'
export type { FileMetaWire, DirEntryWire, FileViewerService } from './server/file-service.js'
export type { RendererId, FileInfo, OpenOptions, RendererRegistration, RendererRegistry } from './core/renderer.js'
export type { LargeFileMode, LoadPlan } from './core/large-file.js'
export { classifySize, initialLoadPlan, allowWholeRead } from './core/large-file.js'
export { detectMime, mimeFromExtension, looksBinary } from './core/mime.js'
export { parseCsv, detectDelimiter, CsvStreamParser } from './core/csv.js'
export { parseJson, buildJsonTree, scalarText, getByPath } from './core/json.js'
export { normalizeRequestPath, isPathInside, isInsideAnyRoot, safeJoin, hasTraversal } from './core/paths.js'
export type { Config }
