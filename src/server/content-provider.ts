/**
 * Pluggable content source contract for the File Viewer host.
 *
 * Providers own locator resolution and access control. A locator can be a
 * normal path, a URI such as `artifact://run/output.json`, or any other stable
 * string understood by the provider that claims it.
 */

export interface FileViewerContentMeta {
  name: string
  size: number
  mime?: string
  mtimeMs?: number
  isDirectory?: boolean
}

export interface FileViewerContentEntry extends FileViewerContentMeta {
  locator: string
}

export interface FileViewerReadRequest {
  offset: number
  length: number
  signal: AbortSignal
}

export interface FileViewerContentProvider {
  /** Unique diagnostic name for this provider. */
  id: string
  /** Higher values win when more than one provider supports a locator. */
  priority?: number
  /** Return true when this provider owns the locator. */
  supports(locator: string): boolean
  /** Return undefined when the locator is owned but does not exist. */
  stat(locator: string, signal: AbortSignal): Promise<FileViewerContentMeta | undefined>
  /** Return at most `request.length` bytes starting at `request.offset`. */
  read(locator: string, request: FileViewerReadRequest): Promise<Uint8Array>
  /** Optional directory support. */
  list?(locator: string, signal: AbortSignal): Promise<FileViewerContentEntry[]>
  /** Optional hand-off to a native/external application. */
  openExternal?(locator: string, signal: AbortSignal): Promise<void>
  /** Whether File Viewer may offer browser-side Save As for this locator. */
  saveAsAllowed?(locator: string): boolean | { allowed: boolean; maxBytes?: number }
}

/**
 * Runtime registry exposed to other host plugins as `fileViewerContent`.
 * Higher-priority registrations take precedence, so a specific provider can
 * override a broad fallback such as the optional local-files provider.
 */
export class FileViewerContentRegistry {
  private readonly providers: FileViewerContentProvider[] = []

  register(provider: FileViewerContentProvider): () => void {
    if (provider.id.trim() === '') throw new Error('A content provider id is required.')
    if (this.providers.some((candidate) => candidate === provider || candidate.id === provider.id)) {
      throw new Error(`A content provider named "${provider.id}" is already registered.`)
    }
    this.providers.push(provider)
    return () => {
      const index = this.providers.indexOf(provider)
      if (index >= 0) this.providers.splice(index, 1)
    }
  }

  resolve(locator: string): FileViewerContentProvider | undefined {
    let selected: FileViewerContentProvider | undefined
    let selectedPriority = Number.NEGATIVE_INFINITY
    for (const provider of this.providers) {
      if (!provider.supports(locator)) continue
      const priority = provider.priority ?? 0
      if (priority >= selectedPriority) {
        selected = provider
        selectedPriority = priority
      }
    }
    return selected
  }

  list(): readonly FileViewerContentProvider[] {
    return [...this.providers]
  }
}
