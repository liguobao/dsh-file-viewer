// src/index.ts
import s from "@deepseek-ai/schemastery";

// src/core/format.ts
function basename(path) {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at === -1 ? path : path.slice(at + 1);
}
function extname(path) {
  const base = basename(path);
  const at = base.lastIndexOf(".");
  if (at <= 0 || at === base.length - 1) return "";
  return base.slice(at + 1).toLowerCase();
}

// src/core/mime.ts
var EXTENSION_MIME = {
  // images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  // documents
  pdf: "application/pdf",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  jsonl: "application/x-ndjson",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  xml: "application/xml",
  // plain text / logs
  txt: "text/plain",
  text: "text/plain",
  log: "text/plain",
  out: "text/plain",
  ini: "text/plain",
  conf: "text/plain",
  cfg: "text/plain",
  env: "text/plain",
  gitignore: "text/plain",
  lock: "text/plain",
  // source code
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  jsx: "text/jsx",
  ts: "text/typescript",
  mts: "text/typescript",
  cts: "text/typescript",
  tsx: "text/tsx",
  py: "text/x-python",
  go: "text/x-go",
  rs: "text/x-rust",
  java: "text/x-java",
  c: "text/x-c",
  h: "text/x-c",
  cpp: "text/x-c++",
  cc: "text/x-c++",
  cxx: "text/x-c++",
  hpp: "text/x-c++",
  cs: "text/x-csharp",
  sh: "text/x-shellscript",
  bash: "text/x-shellscript",
  zsh: "text/x-shellscript",
  fish: "text/x-shellscript",
  ps1: "text/x-powershell",
  psd1: "text/x-powershell",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  scss: "text/x-scss",
  less: "text/x-less",
  sql: "text/x-sql",
  r: "text/x-r",
  lua: "text/x-lua",
  rb: "text/x-ruby",
  php: "text/x-php",
  vue: "text/x-vue",
  svelte: "text/x-svelte",
  swift: "text/x-swift",
  kotlin: "text/x-kotlin",
  kt: "text/x-kotlin",
  dart: "text/x-dart",
  scala: "text/x-scala",
  groovy: "text/x-groovy",
  diff: "text/x-diff",
  patch: "text/x-diff",
  // archives / binaries
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  gz2: "application/x-7z-compressed",
  "7z": "application/x-7z-compressed",
  exe: "application/octet-stream",
  dll: "application/octet-stream",
  so: "application/octet-stream",
  dylib: "application/octet-stream",
  bin: "application/octet-stream",
  dat: "application/octet-stream",
  db: "application/octet-stream",
  sqlite: "application/octet-stream",
  sqlite3: "application/octet-stream",
  ipynb: "application/x-ipynb+json",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  wasm: "application/wasm"
};
function mimeFromExtension(path) {
  const ext = extname2(path);
  return EXTENSION_MIME[ext] ?? "application/octet-stream";
}
function extname2(path) {
  const at = path.lastIndexOf("/");
  const base = at === -1 ? path : path.slice(at + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

// src/core/paths.ts
function normalizeRequestPath(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("A file path is required.");
  }
  const trimmed = input.trim();
  if (trimmed.includes("\0")) {
    throw new Error("The path contains a NUL byte.");
  }
  if (trimmed.length > 4096) {
    throw new Error("The path is too long.");
  }
  return trimmed;
}
function isPathInside(root, candidate) {
  const r = comparisonPath(root);
  const c = comparisonPath(candidate);
  if (c === r) return true;
  return c.startsWith(`${r}/`);
}
function resolveSegments(path) {
  const segments = normalizeSeparators(path).split("/");
  const out = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out;
}
function normalizeSeparators(path) {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}
function normalizeRootPath(path) {
  const trimmed = path.trim();
  if (trimmed === "") return "";
  const driveRoot = trimmed.match(/^([A-Za-z]:)([/\\])?$/);
  if (driveRoot !== null) return `${driveRoot[1]}${driveRoot[2] ?? "/"}`;
  if (/^[/\\]+$/.test(trimmed)) return trimmed.startsWith("\\") ? "\\" : "/";
  return trimmed.replace(/[/\\]+$/, "");
}
function comparisonPath(path) {
  const normalized = resolveSegments(path).join("/");
  return isWindowsLikePath(path) ? normalized.toLowerCase() : normalized;
}
function isWindowsLikePath(path) {
  return /^[A-Za-z]:[/\\]/.test(path) || path.startsWith("\\\\") || path.startsWith("//");
}

// src/server/file-service.ts
var MAX_RANGE_BYTES = 8 * 1024 * 1024;
var MAX_HEAD_BYTES = 1024 * 1024;
function ok(value) {
  return { ok: true, value };
}
function fail(message, code = "internal") {
  return { ok: false, error: { code, message, details: {} } };
}
function record(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The request payload is invalid.");
  }
  return value;
}
var FileViewerService = class {
  constructor(deps) {
    this.deps = deps;
  }
  async handle(endpoint, payload, signal) {
    try {
      switch (endpoint) {
        case "stat":
          return ok(await this.stat(payload, signal));
        case "readRange":
          return ok(await this.readRange(payload, signal));
        case "readHead":
          return ok(await this.readHead(payload, signal));
        case "list":
          return ok(await this.list(payload, signal));
        case "openExternal":
          return ok(await this.openExternal(payload, signal));
        default:
          return fail(`Unknown endpoint: ${endpoint}`, "bad-request");
      }
    } catch (error) {
      if (signal.aborted) return fail("The request was aborted.", "cancelled");
      const message = error instanceof Error ? error.message : String(error);
      this.deps.log?.("warn", "fileviewer rpc failed", { endpoint, message });
      return fail(message);
    }
  }
  resolve(rawLocator) {
    const locator = normalizeRequestPath(rawLocator);
    const provider = this.deps.providers.resolve(locator);
    if (provider === void 0) throw new Error(`No content provider is registered for: ${locator}`);
    return { locator, provider };
  }
  async statProvider(locator, provider, signal) {
    return provider.stat(locator, signal);
  }
  async stat(payload, signal) {
    const { locator, provider } = this.resolve(record(payload).path);
    const info = await this.statProvider(locator, provider, signal);
    if (info === void 0) {
      return {
        path: locator,
        name: basename(locator),
        ext: extname(locator),
        mime: mimeFromExtension(locator),
        size: 0,
        mtimeMs: void 0,
        isDirectory: false,
        exists: false
      };
    }
    return {
      path: locator,
      name: info.name,
      ext: extname(info.name),
      mime: info.mime ?? mimeFromExtension(info.name),
      size: info.isDirectory === true ? 0 : info.size,
      mtimeMs: info.mtimeMs,
      isDirectory: info.isDirectory === true,
      exists: true
    };
  }
  async readRange(payload, signal) {
    const input = record(payload);
    const { locator, provider } = this.resolve(input.path);
    const offset = Number(input.offset);
    const length = Number(input.length);
    if (!Number.isInteger(offset) || offset < 0) throw new Error("A non-negative integer offset is required.");
    if (!Number.isInteger(length) || length <= 0) throw new Error("A positive integer length is required.");
    const info = await this.statProvider(locator, provider, signal);
    if (info === void 0) throw new Error("The content does not exist.");
    if (info.isDirectory === true) throw new Error("A directory cannot be read as content.");
    const capped = Math.min(length, MAX_RANGE_BYTES);
    const data = await provider.read(locator, { offset, length: capped, signal });
    if (data.byteLength > capped) throw new Error(`Content provider "${provider.id}" returned more bytes than requested.`);
    return {
      data: Buffer.from(data).toString("base64"),
      offset,
      size: info.size,
      eof: offset + data.byteLength >= info.size
    };
  }
  async readHead(payload, signal) {
    const input = record(payload);
    const requested = Number(input.maxBytes);
    const maxBytes = Math.min(Number.isFinite(requested) && requested > 0 ? requested : MAX_HEAD_BYTES, MAX_HEAD_BYTES);
    const { locator, provider } = this.resolve(input.path);
    const info = await this.statProvider(locator, provider, signal);
    if (info === void 0) throw new Error("The content does not exist.");
    if (info.isDirectory === true) return { data: "", size: 0, truncated: false };
    const data = await provider.read(locator, { offset: 0, length: maxBytes, signal });
    if (data.byteLength > maxBytes) throw new Error(`Content provider "${provider.id}" returned more bytes than requested.`);
    return {
      data: Buffer.from(data).toString("base64"),
      size: info.size,
      truncated: data.byteLength < info.size
    };
  }
  async list(payload, signal) {
    const { locator, provider } = this.resolve(record(payload).path);
    const info = await this.statProvider(locator, provider, signal);
    if (info === void 0) throw new Error("The directory does not exist.");
    if (info.isDirectory !== true) throw new Error("The locator is not a directory.");
    if (provider.list === void 0) throw new Error(`Content provider "${provider.id}" does not support directory listing.`);
    const listing = await provider.list(locator, signal);
    return {
      path: locator,
      entries: listing.map((entry) => ({
        name: entry.name,
        path: entry.locator,
        isDirectory: entry.isDirectory === true,
        size: entry.isDirectory === true ? 0 : entry.size,
        mtimeMs: entry.mtimeMs
      }))
    };
  }
  async openExternal(payload, signal) {
    const { locator, provider } = this.resolve(record(payload).path);
    if (provider.openExternal === void 0) throw new Error(`Content provider "${provider.id}" does not support external open.`);
    await provider.openExternal(locator, signal);
    return { opened: true };
  }
};

// src/server/content-provider.ts
var FileViewerContentRegistry = class {
  providers = [];
  register(provider) {
    if (provider.id.trim() === "") throw new Error("A content provider id is required.");
    if (this.providers.some((candidate) => candidate === provider || candidate.id === provider.id)) {
      throw new Error(`A content provider named "${provider.id}" is already registered.`);
    }
    this.providers.push(provider);
    return () => {
      const index = this.providers.indexOf(provider);
      if (index >= 0) this.providers.splice(index, 1);
    };
  }
  resolve(locator) {
    let selected;
    let selectedPriority = Number.NEGATIVE_INFINITY;
    for (const provider of this.providers) {
      if (!provider.supports(locator)) continue;
      const priority = provider.priority ?? 0;
      if (priority >= selectedPriority) {
        selected = provider;
        selectedPriority = priority;
      }
    }
    return selected;
  }
  list() {
    return [...this.providers];
  }
};

// src/server/local-file-provider.ts
import { open, stat as fsStat } from "node:fs/promises";
var LocalFileContentProvider = class {
  constructor(options) {
    this.options = options;
  }
  id = "local-files";
  priority = -1e3;
  /** This is the fallback provider; registry precedence lets custom sources win. */
  supports() {
    return true;
  }
  async stat(locator, signal) {
    const { path } = await this.resolveChecked(locator, signal);
    const info = await fsStat(path).catch(() => void 0);
    if (info === void 0) return void 0;
    return {
      name: basename(path),
      size: info.isDirectory() ? 0 : info.size,
      mime: mimeFromExtension(path),
      mtimeMs: info.mtimeMs,
      isDirectory: info.isDirectory()
    };
  }
  async read(locator, request) {
    const { path } = await this.resolveChecked(locator, request.signal);
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(request.length);
      const { bytesRead } = await handle.read(buffer, 0, request.length, request.offset);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
  async list(locator, signal) {
    const { target, path } = await this.resolveChecked(locator, signal);
    const info = await fsStat(path).catch(() => void 0);
    if (info === void 0) throw new Error("The directory does not exist.");
    if (!info.isDirectory()) throw new Error("The locator is not a directory.");
    const listing = await this.options.fs.listDir(target, signal);
    const entries = [];
    for (const entry of listing) {
      const childPath = this.options.fs.processPath(entry.target);
      const isDirectory = entry.type === "directory";
      let size = entry.size;
      let mtimeMs;
      try {
        const statInfo = await fsStat(childPath);
        if (size === void 0) size = statInfo.isDirectory() ? 0 : statInfo.size;
        mtimeMs = statInfo.mtimeMs;
      } catch {
      }
      entries.push({
        locator: childPath,
        name: entry.name,
        size: size ?? 0,
        mime: mimeFromExtension(childPath),
        mtimeMs,
        isDirectory
      });
    }
    return entries;
  }
  async openExternal(locator, signal) {
    const { path } = await this.resolveChecked(locator, signal);
    const sessionController = this.currentSessionController();
    if (sessionController !== void 0) {
      const result = await sessionController.openWorkspacePath({ path }, signal);
      if (isRpcResult(result) && !result.ok) {
        throw new Error(result.error.message ?? "External open failed.");
      }
      return;
    }
    const apiProxy = this.currentApiProxy();
    if (apiProxy === void 0) throw new Error("External open is not available.");
    await apiProxy.host.openPath({ rpcId: "file-viewer-open", payload: { path } }, signal);
  }
  async resolveChecked(locator, signal) {
    let target;
    try {
      target = await this.options.fs.resolve(locator, { signal });
    } catch (error) {
      throw new Error(`Cannot resolve locator: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const root of await this.allowedRoots()) {
      let rootTarget;
      try {
        rootTarget = await this.options.fs.resolve(root, { signal });
      } catch {
        continue;
      }
      if (this.options.fs.contains(rootTarget, target) || isPathInside(rootTarget.targetKey, target.targetKey)) {
        return { target, path: this.options.fs.processPath(target) };
      }
    }
    throw new Error("Access denied: the locator is outside the allowed workspaces.");
  }
  async allowedRoots() {
    const roots = new Set(this.options.roots.map(normalizeRootPath).filter((root) => root !== ""));
    const workspaceRegistry = this.currentWorkspaceRegistry();
    if (workspaceRegistry !== void 0) {
      try {
        for (const workspace of workspaceRegistry.list()) {
          const root = typeof workspace?.path === "string" ? normalizeRootPath(workspace.path) : "";
          if (root !== "") roots.add(root);
        }
      } catch {
      }
    }
    const sessions = this.currentSessions();
    if (sessions !== void 0) {
      try {
        for (const session of sessions.list()) {
          const cwd = session?.header?.cwd ?? session?.cwd;
          const root = typeof cwd === "string" ? normalizeRootPath(cwd) : "";
          if (root !== "") roots.add(root);
        }
      } catch {
      }
    }
    const apiProxy = this.currentApiProxy();
    if (apiProxy !== void 0) {
      try {
        const response = await apiProxy.workspace.list({ rpcId: "file-viewer-roots", payload: {} });
        if (response.result.ok && response.result.value !== void 0) {
          for (const workspace of response.result.value.items) {
            const root = normalizeRootPath(workspace.path);
            if (root !== "") roots.add(root);
          }
        }
      } catch {
      }
      try {
        const response = await apiProxy.sessions?.list({ rpcId: "file-viewer-session-roots", payload: {} });
        if (response?.result.ok && response.result.value !== void 0) {
          for (const session of response.result.value.items) {
            if (session.cwd === void 0) continue;
            const root = normalizeRootPath(session.cwd);
            if (root !== "") roots.add(root);
          }
        }
      } catch {
      }
    }
    return [...roots];
  }
  currentApiProxy() {
    return typeof this.options.apiProxy === "function" ? this.options.apiProxy() : this.options.apiProxy;
  }
  currentWorkspaceRegistry() {
    return typeof this.options.workspaceRegistry === "function" ? this.options.workspaceRegistry() : this.options.workspaceRegistry;
  }
  currentSessions() {
    return typeof this.options.sessions === "function" ? this.options.sessions() : this.options.sessions;
  }
  currentSessionController() {
    return typeof this.options.sessionController === "function" ? this.options.sessionController() : this.options.sessionController;
  }
};
function isRpcResult(value) {
  return typeof value === "object" && value !== null && typeof value.ok === "boolean";
}

// src/index.ts
var name = "dsh-file-viewer";
var Config = s.object({
  enabled: s.boolean(),
  extraRoots: s.array(s.string())
});
function resolveConfig(input = {}) {
  const extraRoots = (input.extraRoots ?? []).map(normalizeRootPath).filter((root) => root !== "");
  return { enabled: input.enabled ?? true, extraRoots };
}
function apply(ctx, input = {}) {
  const providers = new FileViewerContentRegistry();
  const service = new FileViewerService({
    providers,
    log: (level, message, fields) => ctx.logger[level](`dsh-file-viewer: ${message}`, fields)
  });
  ctx.provide("fileViewerContent", providers);
  ctx.inject(["connection"], (runtime) => {
    void activate(runtime, input, providers, service);
  });
}
async function activate(ctx, input, providers, service) {
  const config = resolveConfig(input);
  if (!config.enabled) {
    ctx.logger.debug("dsh-file-viewer disabled by config");
    return;
  }
  const settings = ctx.get("settings");
  const settingsScope = settings?.register("dsh-file-viewer", Config, {
    base: input,
    applies: "restart",
    validate: (value) => {
      resolveConfig(value);
    }
  });
  const merged = resolveConfig(settingsScope?.get() ?? input);
  if (!merged.enabled) {
    ctx.logger.debug("dsh-file-viewer disabled by settings");
    return;
  }
  ctx.provide("fileViewerHost", service);
  const fs = ctx.get("fs");
  const connection = ctx.get("connection");
  if (connection?.rpc === void 0) {
    ctx.logger.warn("dsh-file-viewer: the connection RPC registry is unavailable; the viewer is disabled");
    return;
  }
  let unregisterLocalFiles;
  if (fs !== void 0) {
    const roots = /* @__PURE__ */ new Set([process.cwd(), ...merged.extraRoots]);
    unregisterLocalFiles = providers.register(new LocalFileContentProvider({
      fs,
      apiProxy: () => ctx.get("apiProxy"),
      workspaceRegistry: () => ctx.get("workspaceRegistry"),
      sessions: () => ctx.get("sessions"),
      sessionController: () => ctx.get("sessionController"),
      roots: [...roots].map(normalizeRootPath).filter(Boolean)
    }));
  } else {
    ctx.logger.info("dsh-file-viewer: ctx.fs is unavailable; waiting for registered content providers");
  }
  await ctx.effect(() => {
    const dispose = connection.rpc.handle(
      "/fileviewer",
      (endpoint, payload, signal) => service.handle(endpoint, payload, signal),
      { authority: "loopback" }
    );
    ctx.logger.debug("dsh-file-viewer: /fileviewer channel registered");
    return async () => {
      unregisterLocalFiles?.();
      await dispose();
    };
  }, "dsh-file-viewer: rpc channel");
}
export {
  Config,
  FileViewerContentRegistry,
  FileViewerService,
  apply,
  name
};
//# sourceMappingURL=index.js.map
