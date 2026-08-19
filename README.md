# DSH File Viewer

A universal file preview layer for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
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
  channel: `stat`, `readRange`, `readHead`, `list`, `openExternal`, backed by
  `ctx.fs`. Every path is realpathed and boundary-checked against the allowed
  roots (workspace directories + host cwd + configured `extraRoots`), so
  traversal and symlink escapes are rejected.
- **Client half** (`dist/client.js`) provides the `fileViewer` service
  (`ctx.get('fileViewer')` → `openFile(path, { line, renderer })`) and renders
  a full-frame panel through the `shell.overlay` slot, a sidebar entry
  (`sidebar.footer.action`), and produced-file chips in the conversation
  (`conversation.chat.turnTail`) that open the viewer instead of the OS.
- **Large-file strategy**: `< 5 MB` whole-file, `5–50 MB` chunked streaming,
  `> 50 MB` head-only with explicit "Load more / Go to end" navigation. Range
  reads are capped (8 MiB per call) and text/CSV rows are windowed, so a
  500 MB log never lands in browser memory.
- **Theming**: styles use `--dsw-alias-*` tokens, so light/dark follow the
  Harness theme automatically.

## Public API

```ts
// client side, any web plugin:
const fileViewer = ctx.get('fileViewer')
fileViewer.openFile('/workspace/output/report.csv')
fileViewer.openFile('/workspace/src/main.ts', { line: 125 })
fileViewer.openFile('/workspace/data.bin', { renderer: 'text' }) // force a renderer
```

Other plugins can extend the renderer registry:

```ts
// client side: register a custom renderer rule with priority
import { RendererRegistry } from 'dsh-file-viewer/core'
viewerRegistry.register({ id: 'nifti', priority: 500, extensions: ['nii', 'nii.gz'] })
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
npm run build          # esbuild → dist/index.js + dist/client.js
npm run check          # tsc (strict) over src and tests
npm test               # vitest: mime, renderer, paths, large-file, csv, json, file-service
```

### Install into a DSH profile

```bash
# from the repo root (the profile resolves relative specs from your cwd)
dsh plugin --profile web add /path/to/dsh-file-viewer
# then restart the web service (preflight on 43124 → 43123), see
# scripts/restart-dsh-web.sh for the safe pattern used in this repo.
```

Client-only changes hot-reload via `dsh-client-hmr`; node-half changes need a
web restart.

## Security notes

- Path validation is enforced host-side on realpath'd targets against allowed
  roots (`fs.contains`); the client pre-check is defense-in-depth only.
- Markdown is rendered with `html: false` and sanitized with DOMPurify
  (scripts, iframes, event handlers and `javascript:` URLs removed).
- SVG is never injected as HTML — it is displayed through `<img>`.
- Binary detection: NUL scan + magic bytes; "Open as text" is always an
  explicit user action.
- Per-renderer error boundaries: a broken PDF/JSON can never crash the
  Harness UI.

## License

MIT
