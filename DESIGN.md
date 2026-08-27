# DSH File Viewer — Architecture & Design

A universal file preview layer inside DeepSeek Harness, built as a first-class
DSH plugin. This document records the results of studying the real DSH plugin
architecture (Step 1) and the resulting design (Step 2).

---

## 1. How DeepSeek Harness plugins work (studied from the actual code)

All findings below come from reading the installed packages under
`@deepseek-ai/dsh` (v0.1.0-rc.6) and the local dev checkout
`deepseek-harness-remote` (a working third-party plugin), NOT from
assumptions.

### 1.1 Plugin package shape

A DSH plugin is an npm package with two halves (model: `dsh-remote`):

- **Node half** (`exports["."]`, e.g. `dist/index.js`): a cordis plugin.
  Exports `name`, `apply(ctx, config)`, optional `Config` (schemastery schema)
  and `inject` (service names). `apply` registers services/RPC into the host.
- **Client half** (`exports["./client"]`, e.g. `dist/client.js`): a browser
  bundle whose entry calls `window.__ModuleLoader__.load({ id, factory })`.
  `factory(require)` returns `{ apply, inject }`; `apply(ctx)` registers
  UI into slots. `require` is the module-table require — `react` and any
  `@deepseek-ai/*` package listed in `dsh.client.inject` are resolvable.
- **package.json** declares:
  - `"dsh": { "client": { "inject": [...], "platform": "web" }, "bundle": { "patch": "./cordis.patch.yml" } }`
  - `dsh.client.inject` = packages whose client modules the bundle `require`s
    at runtime (they become seeds in the browser module table).
  - `dsh.bundle.patch` = a YAML patch layer applied when the package joins a
    profile's bundle stack.

### 1.2 Enabling a plugin

- Install into a profile: `dsh plugin --profile web add <pkg>` (pnpm
  forwarder). A dependency whose manifest declares `dsh.bundle` is added to
  `dsh.profile.bundles` in the profile's `package.json`.
- The bundle's `cordis.patch.yml` uses the loader patch syntax to insert the
  plugin entry into the composed config, e.g.:

  ```yaml
  - insert:
      - id: dsh-file-viewer
        name: dsh-file-viewer
        config:
          enabled: true
  ```

- Boot order/composition: profile bundles (dsh-base, dsh-web-app, …) →
  each bundle's patch → user `cordis.patch.yml` → `--patch` overlays.
- The web host composes every enabled client plugin into `window.__DSH_BOOT__`
  and serves each bundle at `/plugins/<id>/client.js`.
- **Client-only changes hot-reload** (`dsh-client-hmr` is active in this
  profile). Node-half changes require a web restart.

### 1.3 UI integration — the slot system (`@deepseek-ai/dsh-client-ui-slots`)

UI is composed through a typed slot registry. Packages declare slots by
merging into `SlotMap`; plugin entries register components into declared
slots. The composed props of an entry are the intersection of several shares;
plugins practically need:

```ts
ctx.slots.inject('slot.name', () => ctx.slots.register({
  name: 'slot.name',
  id: 'unique-id',          // list slots
  order: 10,                // list ordering
  locale: 'my.namespace',   // puts typed `t` on props
  inject: () => ({ api }),  // business face
  // chain slots: select(owner) => matched | null, priority
}, Component))
```

Relevant slots for a file viewer (verified in the installed types):

| Slot | Kind | Scope | Use for us |
|---|---|---|---|
| `shell.overlay` | list | root | the right-docked viewer column (click-through layer; the panel is additive) |
| `conversation.chat.turnTail` | chain | session | produced-file chips → open in viewer (occupied by ui-deliverables at priority 0; chain = ascending priority, first non-null `select` wins, so priority -1 replaces it intentionally) |
| workspace "…" menu | — | — | NOT a slot: ui-workspace's row menu is hardcoded → minimal patch script adds a "浏览文件" item (see §2.3) |
| `settings.plugin.item` | keyed | root | settings card (P2) |

Other shares: `locale.register(ns, {zh, en})` + `locale.bind(ns)` for i18n;
`ctx.provide(name, value)` / `ctx.get(name)` for cross-plugin services
(single-provider: a second `provide` of the same name throws — so we cannot
re-provide `chatFileMentions`, which ui-deliverables owns).

### 1.4 File access

- **Host**: `ctx.fs` (`@deepseek-ai/dsh-fs` interface, `dsh-fs-local`
  backend) — `resolve(path, {cwd})` (canonical `FsTarget`), `contains(parent,
  child)` (boundary test), `stat`, `lstat`, `readBytes(target, signal,
  maxBytes)` (hard-capped read — never buffers unbounded files),
  `streamText`, `listDir`, `processPath(target)`.
- **Host→client RPC extension**: `ctx.connection.rpc.handle(channel, handler,
  { authority: 'loopback' })` returns a disposer; handler returns
  `RpcResult` (`{ok:true,value}` | `{ok:false,error:{code,message,details}}`).
  Client side: `ctx.connection.rpc.call(channel, endpoint, payload)`.
- **Client**: `ctx.workspaces.listDirectory(path)` (directory listing),
  `ctx.workspaces.openPath(path)` (OS open), `ctx.sessions.list` (session
  cwd), `resolveWorkspacePath(cwd, path)` from `dsh-client-runtime/client`.
- **Allowed roots** (host): every workspace path
  (`ctx.apiProxy.workspace.list()`), known session cwd paths
  (`ctx.apiProxy.sessions.list()`), the host process cwd, and configured extra
  roots. `ctx.fs.resolve` + `contains` enforce the boundary (symlink-safe:
  resolve follows symlinks, so an inside symlink pointing outside fails the
  containment check).

### 1.5 Theme & locale

- Theme: `--dsw-alias-*` CSS variables (both palettes ship; `body[data-ds-dark-theme]`
  switches). Plugins style with these tokens only — automatic light/dark
  support. Token vocabulary (verified): `label-primary/-secondary/-tertiary/-dimmed`,
  `bg-base`, `bg-layer-1/2/3`, `bg-overlay`, `border-l1…l4`, `interactive-bg-hover/-active`,
  `state-error-primary`, `state-warn-*`, `state-success-*`, `state-business-*`, etc.
- Locale: `ctx.locale.register(ns, { zh, en })`; `t(key, {params})`.

### 1.6 Reusable components / constraints

- React 18.2, `React.createElement` in client bundles (no JSX in the loader
  factory pattern). Client bundles are single-file iife scripts; the factory
  receives `require` (module table).
- ui-deliverables chips & ui-primitives markdown exist but are not a stable
  plugin API — we implement our own renderers (self-contained deps).
- Error isolation: every renderer is wrapped in a React error boundary; a
  crash must never take down the harness UI.

---

## 2. DSH File Viewer design

### 2.1 Package layout

```text
dsh-file-viewer/
├── package.json            # dsh.bundle.patch + dsh.client + exports (node + client)
├── cordis.patch.yml        # insert dsh-file-viewer into the profile tree
├── tsconfig.json / tsconfig.test.json
├── vitest.config.ts
├── scripts/build.mjs       # esbuild: dist/index.js (node) + dist/client.js (browser)
├── src/
│   ├── index.ts            # node half: apply(); registers /fileviewer + fileViewerHost
│   ├── public.d.ts         # public API surface
│   ├── core/               # pure logic — node-safe, unit-tested
│   │   ├── mime.ts         # MIME detection: extension + magic bytes (never ext-only)
│   │   ├── renderer.ts     # RendererRegistry decision: mime → ext → content hint; priority
│   │   ├── large-file.ts   # <5MB normal / 5–50MB stream / >50MB large
│   │   ├── csv.ts          # delimiter auto-detect + quote-aware chunk parser
│   │   ├── paths.ts        # path normalization + root-boundary validation
│   │   ├── json.ts         # safe parse + tree path builder
│   │   └── format.ts       # bytes/time/basename formatting
│   └── server/
│       └── file-service.ts # host RPC implementation over ctx.fs + roots
└── tests/                  # vitest suites (see §7)
```

### 2.2 Host half — `/fileviewer` RPC (loopback)

The same bounded service is provided to trusted plugins as `fileViewerHost`.
Transport plugins such as `dsh-remote` may forward a strict endpoint subset;
provider authorization and root checks stay inside File Viewer.

| Endpoint | Payload | Returns |
|---|---|---|
| `stat` | `{ path }` | `FileMeta { path, name, ext, mime, size, mtimeMs, isDirectory, exists }` |
| `readRange` | `{ path, offset, length }` | `{ data(base64), offset, size, eof }` |
| `readHead` | `{ path, maxBytes }` | `{ data(base64), size, truncated }` |
| `list` | `{ path }` | `{ path, entries: [{name, path, isDirectory, size, mtimeMs}] }` |
| `openExternal` | `{ path }` | `{ opened: true }` (via `apiProxy.host.openPath`) |

Every endpoint: `resolve` via `ctx.fs`, boundary-check against allowed roots,
reject otherwise (`bad-request` / `internal` codes, message-carrying).
`readRange` uses Node `fs.open`/`fs.read` on `processPath(target)` (bounded by
`length`, capped at 8 MiB per call).

### 2.3 Client half

- **Services injected**: `['connection', 'slots', 'locale', 'sessions', 'workspaces']`.
- **`ctx.provide('fileViewer', api)`** — `api.openFile(path, { line?, renderer? })`
  (+ `stat`, `readRange`, `readHead`, `list`) — the public plugin API.
- **`shell.overlay` entry** (`id: 'dsh-file-viewer'`): a **right-docked
  viewer column** mirroring the Harness details panel (border-left on
  `--dsw-alias-border-l1`, Harness toolbar/statusbar proportions) — toolbar
  (name / type / size / Refresh / Open externally / Copy path / Close), body
  (active renderer inside an error boundary; browse mode lists through the
  boundary-checked `/fileviewer` RPC, starting at the workspace root), status
  bar (encoding, size, mtime, line info). Closed with Esc or the close button;
  the layer stays click-through so the app underneath remains usable.
- **Workspace "…" menu entry**: ui-workspace's row menu
  (`ProjectRowItem` → `workspaceMenuItems`) has no slot hook, so
  `scripts/patch-workspace-menu.mjs` applies three guarded, idempotent edits
  to the installed bundle: a `browseFiles` menu item, an `onSelect` branch
  calling `window.__dsfvBrowseWorkspace(workspaceId)` (installed by this
  plugin's client), and zh/en dictionary keys. Version drift aborts loudly.
- **`conversation.chat.turnTail` chain entry** (priority -1): produced-file
  chips (from the turn's `deliverables` location data) whose click opens the
  docked DSH File Viewer instead of the OS. Replaces ui-deliverables' chips
  deliberately (the viewer is the intended destination).
- **Large-file strategy** (core/large-file.ts):
  - `< 5 MB` normal — whole-file read.
  - `5–50 MB` stream — chunked reads (256 KiB), incremental render.
  - `> 50 MB` large — head chunk only + "Load more / Go to end" chunk
    navigation; UI shows the total size warning.
- **Renderer registry** (core/renderer.ts): registry of `FileRenderer`
  `{ id, priority, canHandle(file, hint) }`; resolution = highest-priority
  match over mime → extension → content; `openFile(..., { renderer })` forces.

### 2.4 Renderers

| Renderer | Input | Notes |
|---|---|---|
| Image | base64 → `img`/blob URL | fit / 100% / zoom ± / reset / pan; SVG via `<img>` (no script execution) |
| PDF | whole bytes → pdf.js | page nav, page input, zoom, fit-width/page, lazy per-page render |
| CSV | chunked | delimiter auto (` , ; \t | `), quote-aware, sticky header, row numbers, search, sort, column resize, windowed rows ("Showing X of Y") |
| Text/Log | chunked | line numbers, word wrap, search, copy, font size, chunk navigation for large files |
| Code | chunked | highlight.js (curated langs), line numbers, wrap, go-to-line, read-only |
| Markdown | chunked | Preview/Source; markdown-it `html:false` + DOMPurify + `javascript:` URL filter; relative image paths resolved against the file's dir via RPC |
| JSON | whole (≤ cap) | Tree (expand/collapse/copy path/value) + Source; malformed → text fallback |
| YAML | whole | Source + parsed Tree (js-yaml); parse failure → text fallback |
| Fallback | stat only | "Preview unavailable" + name/type/size + Open externally/Reveal/Copy path; "Open as text" only on explicit click |

### 2.5 Security

- Path traversal: client pre-checks; host `resolve`+`contains` against roots
  (final authority); symlink escape rejected.
- No `dangerouslySetInnerHTML` except DOMPurify-sanitized markdown.
- SVG never injected as HTML (rendered through `<img>`).
- Preview never executes anything (no shell/JS/Python/macros; iframes none).
- Large files never fully buffered client- or server-side (`readRange` caps;
  `readBytes`-style hard caps server-side).

### 2.6 Error handling & robustness

- One error boundary per renderer (bad PDF / malformed JSON / huge file →
  friendly panel + Retry / Open externally; the harness UI never crashes).
- Client RPC retries on the known 405 "route not yet registered" race
  (pattern from dsh-remote).
- `dsh-remote` registers a high-priority browser content provider only while
  Remote mode is active. It unregisters after Local fallback, so the same UI
  resolves local and remote paths without weakening either Host boundary.
- File-change detection: refresh button; on `stat` mismatch show
  "File changed on disk — Reload" (no forced auto-reload while reading).

### 2.7 Tests (vitest)

`mime` (magic bytes + ext), `renderer` (detection/priority/forced), `paths`
(traversal, boundary), `large-file` (thresholds), `csv` (delimiters, quoting,
chunk boundaries, CRLF, malformed), `json` (valid/malformed/tree), plus a
`file-service` integration suite against real temp files (stat/readRange/
readHead/boundary rejection/missing file).

---

## 3. Build & verification loop

1. `npm i` (dev: typescript, esbuild, vitest; runtime: pdfjs-dist,
   markdown-it, dompurify, highlight.js — all bundled into `dist/client.js`).
2. `npm run build` → `dist/types` + `dist/index.js` + `dist/client.js`.
3. `npm run check` (tsc) + `npm test` (vitest).
4. Install into the web profile: link this repo into
   `~/.dsh/profiles/web/package.json` dependencies, add `dsh-file-viewer` to
   `dsh.profile.bundles`, `pnpm install`, then restart the web service via the
   preflight script pattern (port 43124 preflight → 43123).
