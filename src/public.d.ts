/**
 * Public API surface of dsh-file-viewer (node half).
 *
 * The host half registers the `/fileviewer` RPC channel; the client half
 * provides the `fileViewer` service (`ctx.get('fileViewer')`) with
 * `openFile(path, options)`.
 */

import type { Config, FileViewerHostService } from './index.js'

export { name, Config } from './index.js'
export { FileViewerContentRegistry } from './server/content-provider.js'
export type {
  FileViewerContentEntry,
  FileViewerContentMeta,
  FileViewerContentProvider,
  FileViewerReadRequest,
} from './server/content-provider.js'
export { FileViewerService } from './server/file-service.js'
export type { FileMetaWire, DirEntryWire } from './server/file-service.js'
export type { FileViewerClientService, FileViewerHeadWire, FileViewerRangeWire } from './client-api.js'
export type { RendererId, FileInfo, OpenOptions, RendererRegistration, RendererRegistry } from './core/renderer.js'
export type { LargeFileMode, LoadPlan } from './core/large-file.js'
export { classifySize, initialLoadPlan, allowWholeRead } from './core/large-file.js'
export { detectMime, mimeFromExtension, looksBinary } from './core/mime.js'
export { parseCsv, detectDelimiter, CsvStreamParser } from './core/csv.js'
export { parseJson, buildJsonTree, scalarText, getByPath } from './core/json.js'
export { normalizeRequestPath, isAbsoluteLocalPath, isPathInside, isInsideAnyRoot, safeJoin, hasTraversal } from './core/paths.js'
export type { Config, FileViewerHostService }
