# DSH File Viewer

English | [中文](README.zh.md)

**Online:** [dsh.r2049.cn](https://dsh.r2049.cn)

A universal, read-only file preview layer for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
open and inspect files right inside the web UI — no external application needed.

> **Preview ≠ Execute.** The viewer is strictly read-only: previewing a file never
> runs shell commands, scripts, macros, or HTML. SVG is rendered through `<img>`,
> and Markdown is sanitized before display.

## Supported file types

| Type | Renderer |
|---|---|
| PNG / JPG / GIF / WEBP / SVG / BMP | Image (fit, zoom, pan, dimensions) |
| PDF | PDF.js (page nav, page input, zoom, fit width/page) |
| CSV / TSV | Data table (delimiter auto-detect, sticky header, row numbers, search, sort, column resize, windowed rows, chunked loading) |
| TXT / LOG / OUT / INI / CONF | Text (line numbers, wrap, search, font size, chunk navigation) |
| JS / TS / Python / Go / Rust / Java / C/C++ / C# / Shell / HTML / CSS / SQL / … | Code (highlight.js, read-only) |
| Markdown | Preview (sanitized) + Source |
| JSON / JSONL | Tree (expand/collapse, copy value/path) + Source |
| YAML | Source + parsed Tree |
| anything else | Fallback (metadata + Open externally / Reveal / Copy path / optional Open as text) |

## How it works

- **Host half** (`dist/index.js`) registers the `/fileviewer` loopback RPC
  channel and exposes both a `fileViewerContent` provider registry and a
  `fileViewerHost` bounded service for trusted transport plugins. The viewer does
  not assume content lives in a local folder: other host plugins can register
  readers for locators such as `artifact://run/report.json`, object storage,
  generated output, or remote APIs. A boundary-checked `ctx.fs` provider is
  installed only when that service is available, preserving local-file
  compatibility without making it a hard dependency.
- **Client half** (`dist/client.js`) provides the `fileViewer` service
  (`ctx.get('fileViewer')` → `openFile(path, { line, renderer })`) and renders
  a **right-docked viewer column** (styled like the Harness details panel)
  through the `shell.overlay` slot. It opens from:
  - produced-file chips in the conversation (`conversation.chat.turnTail`,
    priority -1 — clicking an agent-generated file previews it in-app), or
  - the **"浏览文件 / Browse files"** entry added to each workspace row's
    "…" menu (see the compatibility patch below).
- **Workspace "…" menu patch** (`scripts/patch-workspace-menu.mjs`): the
  workspace browser renders its row menu from a hardcoded list with no slot
  hook, so this script applies three guarded, idempotent edits to the
  installed `@deepseek-ai/dsh-client-ui-workspace` client bundle: a
  `browseFiles` menu item (zh/en labels), an `onSelect` branch calling
  `window.__dsfvBrowseWorkspace(workspaceId)`, and the two dictionary keys.
  It aborts loudly on version drift and can be re-run safely after Harness
  updates (`node scripts/patch-workspace-menu.mjs`).
- **Large-file strategy**: `< 5 MB` whole-file, `5–50 MB` chunked streaming,
  `> 50 MB` head-only with explicit "Load more / Go to end" navigation. Range
  reads are capped (8 MiB per call) and text/CSV rows are windowed, so a
  500 MB log never lands in browser memory.
- **Theming**: styles use `--dsw-alias-*` tokens and match Harness's details
  panel proportions, so light/dark follow the Harness theme automatically.

## Public API

```ts
// client side, any web plugin:
const fileViewer = ctx.get('fileViewer')
fileViewer.openFile('/workspace/output/report.csv')
fileViewer.openFile('artifact://run-42/report.csv')
fileViewer.openFile('/workspace/src/main.ts', { line: 125 })
fileViewer.openFile('/workspace/data.bin', { renderer: 'text' }) // force a renderer
```

### Provide content from another host plugin

Register a provider once, then open its locators from any client plugin. The
provider owns locator matching, authorization, metadata, and range reads; the
viewer owns preview selection, bounded RPC transfer, and rendering.

```ts
import type { FileViewerContentRegistry } from 'dsh-file-viewer'
const report = new TextEncoder().encode('{"status":"ok"}')

ctx.inject(['fileViewerContent'], runtime => {
  const content = runtime.get<FileViewerContentRegistry>('fileViewerContent')!
  runtime.effect(() => content.register({
    id: 'run-artifacts',
    supports: locator => locator.startsWith('artifact://'),
    async stat(locator) {
      if (locator !== 'artifact://run-42/report.json') return undefined
      return {
        name: 'report.json',
        mime: 'application/json',
        size: report.byteLength,
      }
    },
    async read(locator, { offset, length }) {
      if (locator !== 'artifact://run-42/report.json') throw new Error('Not found')
      return report.slice(offset, offset + length)
    },
  }), 'register run artifact viewer')
})
```

Providers may additionally implement `list()` for directory-like locators and
`openExternal()` for source-specific hand-off. `register()` returns an
unregister function, making provider lifetime follow the supplying plugin.

Trusted transport plugins can inject `fileViewerHost` and forward an explicit
allowlist of its endpoints. This is how `dsh-remote` previews files on a Remote
Host: access checks remain owned by the selected File Viewer content provider,
while the transport applies its own authentication, size limits, and method
allowlist. `openExternal` is intentionally not part of that remote surface.

Browser-only plugins can register the same reader directly on the client
service—no host RPC or local path is required:

```ts
import type { FileViewerClientService } from 'dsh-file-viewer'
const markdown = new TextEncoder().encode('# Live preview')

ctx.inject(['fileViewer'], runtime => {
  const viewer = runtime.get<FileViewerClientService>('fileViewer')!
  runtime.effect(() => viewer.registerContentProvider({
    id: 'live-preview',
    supports: locator => locator === 'memory://preview.md',
    async stat() { return { name: 'preview.md', size: markdown.byteLength } },
    async read(_locator, { offset, length }) {
      return markdown.slice(offset, offset + length)
    },
  }), 'register live preview')
  viewer.openFile('memory://preview.md')
})
```

## Configuration

```yaml
# cordis.patch.yml / settings
- id: dsh-file-viewer
  name: dsh-file-viewer
  config:
    enabled: true
    extraRoots:
      - /srv/data          # optional extra directories the viewer may read
```

## Development

```bash
npm install            # (use a reachable registry if npmjs TLS is flaky)
npm run build          # declarations + esbuild → dist/types + dist/index.js + dist/client.js
npm run check          # tsc (strict) over src and tests
npm test               # vitest: mime, renderer, paths, large-file, csv, json, file-service
```

### Install into a DSH profile

```bash
# from the repo root (the profile resolves relative specs from your cwd)
dsh plugin --profile web add /path/to/dsh-file-viewer
# compatibility patch: add "浏览文件" to each workspace's "…" menu
node scripts/patch-workspace-menu.mjs
# then restart the web service (preflight on 43124 → 43123), see
# scripts/restart-dsh-web.sh for the safe pattern used in this repo.
```

Client-only changes hot-reload via `dsh-client-hmr`; node-half changes need a
web restart. Re-run `scripts/patch-workspace-menu.mjs` after any Harness
update that reinstalls `@deepseek-ai/dsh-client-ui-workspace`.

## Security notes

- Path validation is enforced host-side on realpath'd targets against allowed
  roots (workspace paths, known session cwd paths, the host cwd, and configured
  extra roots via `fs.contains`) by the optional local-files provider. Custom providers
  are responsible for authorization within their own locator namespace.
- Markdown is rendered with `html: false` and sanitized with DOMPurify
  (scripts, iframes, event handlers and `javascript:` URLs removed).
- SVG is never injected as HTML — it is displayed through `<img>`.
- Binary detection: NUL scan + magic bytes; "Open as text" is always an
  explicit user action.
- Per-renderer error boundaries: a broken PDF/JSON can never crash the
  Harness UI.

## License

MIT
