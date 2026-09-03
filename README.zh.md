# DSH File Viewer

[English](README.md) | 中文

**在线使用：** [dsh.r2049.cn](https://dsh.r2049.cn)

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的通用只读文件预览层：无需打开外部应用，即可在 Web 界面中查看文件。

> **预览不等于执行。** 查看器严格只读：预览文件不会执行 Shell 命令、脚本、宏或 HTML。SVG 通过 `<img>` 显示，Markdown 会在展示前进行安全清理。

## 支持的文件类型

| 类型 | 渲染方式 |
|---|---|
| PNG / JPG / GIF / WEBP / SVG / BMP | 图片（适应窗口、缩放、拖动、尺寸信息） |
| PDF | PDF.js（翻页、页码输入、缩放、适应宽度/页面） |
| CSV / TSV | 数据表格（自动识别分隔符、固定表头、行号、搜索、排序、调整列宽、窗口化行、分块加载） |
| TXT / LOG / OUT / INI / CONF | 文本（行号、自动换行、搜索、字号、分块导航） |
| JS / TS / Python / Go / Rust / Java / C/C++ / C# / Shell / HTML / CSS / SQL / … | 源码（highlight.js 语法高亮，只读） |
| Markdown | 安全预览 + 源码 |
| JSON / JSONL | 树形视图（展开/折叠、复制值或路径）+ 源码 |
| YAML | 源码 + 解析后的树形视图 |
| 其他格式 | 后备视图（元数据、外部打开、定位文件、复制路径、可选“作为文本打开”） |

## 工作原理

- **Host 端**（`dist/index.js`）注册 `/fileviewer` 认证 RPC 通道，并提供 `fileViewerContent` 内容提供器注册表，以及供受信任传输插件使用的受限 `fileViewerHost` 服务。内容不必来自本地目录：其他 Host 插件可以为 `artifact://run/report.json`、对象存储、生成产物或远程 API 等 locator 注册读取器。只有在 `ctx.fs` 可用时，插件才会安装带边界校验的本地文件提供器；在 DSH v0.1.2 中，它会从 `ctx.workspaceRegistry` 发现 workspace roots，从 `ctx.sessions` 发现实时 session cwd，并通过 `ctx.sessionController` 执行原生外部打开。
- **Client 端**（`dist/client.js`）提供 `fileViewer` 服务（`ctx.get('fileViewer')` → `openFile(path, { line, renderer })`），并将文件查看器作为与“对话”“轨迹”并列的 Harness Tab 展示。可以从对话中的产物文件标签，或 Workspace 行“…”菜单中的**浏览文件 / Browse files**入口打开。
- **Workspace“…”菜单补丁**（`scripts/patch-workspace-menu.mjs`）：由于 Workspace 行菜单目前没有 Slot，此脚本会对 `deepseek-harness` 新版源码 checkout（已针对 dsh-v0.1.2-rc.1 验证）或已安装的 `@deepseek-ai/dsh-client-ui-workspace` 客户端包执行带守卫、可重复运行的修改，加入浏览文件入口及中英文文案。Harness 更新后可以安全地重新运行；若上游结构发生变化，脚本会明确报错并停止。
- **大文件策略**：小于 5 MB 时整文件读取；5–50 MB 分块流式读取；大于 50 MB 默认只读取开头，并提供“加载更多 / 跳到末尾”。单次范围读取上限为 8 MiB，文本和 CSV 行采用窗口化渲染，因此不会把 500 MB 日志一次性载入浏览器内存。
- **主题**：样式只使用 `--dsw-alias-*` 变量并遵循 Harness 面板比例，可自动适配明暗主题。

## 兼容性

`dsh-file-viewer` v0.3.2 起同时支持 DSH v0.1.1-rc.2 和采用破坏性新包图的
v0.1.2，包括 `dsh-v0.1.2-rc.1`。在 rc2 上，Host RPC 通道会显式声明仅允许
loopback，Workspace 发现使用旧版 `apiProxy` fallback；在 v0.1.2 上则会额外使用
`ctx.workspaceRegistry`、`ctx.sessions` 和 `ctx.sessionController`。Client 元数据
只依赖两代包图共有的包，再由它们的传递依赖提供各版本对应的运行时服务。
在 v0.1.2-rc.1 上，查看器还会接收 `conversation.view` focus request，并将其中
不透明的 focus 值作为文件 locator 打开。

DSH 和 React 包在本插件中是由宿主提供的 optional peer dependencies。
v0.1.2-rc.1 profile 关闭了 peer 自动安装（`autoInstallPeers: false`），因此安装
本插件时不应额外安装或要求 profile 再声明一份内置平台包。

Workspace 行的“浏览文件”入口仍是兼容补丁，因为上游
`@deepseek-ai/dsh-client-ui-workspace` 还没有第三方菜单 Slot。每次更新 Harness
后请重新运行 `scripts/patch-workspace-menu.mjs`；脚本可重复运行，遇到版本漂移会
明确报错并停止。

## 公共 API

```ts
// Client 端，供任意 Web 插件使用
const fileViewer = ctx.get('fileViewer')
fileViewer.openFile('/workspace/output/report.csv')
fileViewer.openFile('artifact://run-42/report.csv')
fileViewer.openFile('/workspace/src/main.ts', { line: 125 })
fileViewer.openFile('/workspace/data.bin', { renderer: 'text' }) // 强制使用文本渲染器
```

### 从其他 Host 插件提供内容

注册内容提供器后，任何 Client 插件都可以打开它所支持的 locator。内容提供器负责 locator 匹配、授权、元数据和范围读取；查看器负责选择预览方式、执行有界 RPC 传输并完成渲染。

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

内容提供器还可以实现 `list()`，为目录型 locator 提供列表；也可以实现 `openExternal()`，完成来源相关的外部交接。`register()` 会返回注销函数，使提供器生命周期与供应插件保持一致。

受信任的传输插件可以注入 `fileViewerHost`，并转发明确允许的端点集合。`dsh-remote` 正是通过这种方式预览远端 Host 文件：访问检查仍由所选 File Viewer 内容提供器负责，传输层则执行自身的身份验证、大小限制和方法白名单。远端接口不会暴露 `openExternal`。

纯浏览器插件也可以直接在 Client 服务上注册相同的读取器，无需 Host RPC 或本地路径：

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

## 配置

```yaml
# cordis.patch.yml / 设置
- id: dsh-file-viewer
  name: dsh-file-viewer
  config:
    enabled: true
    extraRoots:
      - /srv/data          # 可选的额外可读目录
```

## 开发

```bash
npm install
npm run build          # 类型声明 + esbuild → dist/types + dist/index.js + dist/client.js
npm run check          # 对 src 和 tests 执行严格 TypeScript 检查
npm test               # vitest：mime、renderer、paths、large-file、csv、json、file-service
```

### 安装到 DSH Profile

```bash
# 在仓库根目录执行；Profile 会从当前目录解析相对路径
dsh plugin --profile web add /path/to/dsh-file-viewer
# 兼容补丁：在每个 Workspace 的“…”菜单中加入“浏览文件”
# 针对 v0.1.2 源码 checkout：
DSH_HARNESS_SOURCE=/path/to/deepseek-harness node scripts/patch-workspace-menu.mjs
# 或针对已安装的 profile 包：
node scripts/patch-workspace-menu.mjs
# 然后重启 Web 服务。安全重启流程见 scripts/restart-dsh-web.sh。
```

仅修改 Client 时可通过 `dsh-client-hmr` 热更新；修改 Node 端后需要重启 Web 服务。Harness 更新并重新安装 `@deepseek-ai/dsh-client-ui-workspace` 后，请再次运行 `scripts/patch-workspace-menu.mjs`。

## 安全说明

- 可选的本地文件提供器会在 Host 端对真实路径执行允许根目录校验（DSH v0.1.2 workspace 路径、实时 session cwd、Host cwd 和配置的额外 roots，经 `fs.contains` 校验）。自定义提供器必须在自己的 locator 命名空间内负责授权。
- Markdown 使用 `html: false` 渲染，并通过 DOMPurify 移除脚本、iframe、事件处理器和 `javascript:` URL。
- SVG 不会作为 HTML 注入，只通过 `<img>` 显示。
- 插件会通过 NUL 扫描和魔数识别二进制文件；“作为文本打开”始终需要用户明确操作。
- 每个渲染器都有独立错误边界；损坏的 PDF/JSON 不会导致 Harness 界面崩溃。

## 许可证

MIT
