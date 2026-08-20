import type { OpenOptions } from './core/renderer.js'
import type { FileViewerContentProvider } from './server/content-provider.js'
import type { DirEntryWire, FileMetaWire } from './server/file-service.js'

export interface FileViewerRangeWire {
  data: string
  offset: number
  size: number
  eof: boolean
}

export interface FileViewerHeadWire {
  data: string
  size: number
  truncated: boolean
}

/** Client service exposed as `ctx.get('fileViewer')`. */
export interface FileViewerClientService {
  openFile(locator: string, options?: OpenOptions): void
  /** Register a browser-side reader; returns an unregister function. */
  registerContentProvider(provider: FileViewerContentProvider): () => void
  stat(locator: string): Promise<FileMetaWire>
  readRange(locator: string, offset: number, length: number): Promise<FileViewerRangeWire>
  readHead(locator: string, maxBytes: number): Promise<FileViewerHeadWire>
  list(locator: string): Promise<{ path: string; entries: DirEntryWire[] }>
  openExternal(locator: string): Promise<{ opened: true }>
}
