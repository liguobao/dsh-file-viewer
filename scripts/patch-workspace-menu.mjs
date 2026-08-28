#!/usr/bin/env node
/**
 * Minimal compatibility layer: add a "浏览文件 / Browse files" entry to each
 * workspace row's "…" menu in the Harness sidebar.
 *
 * The workspace browser (`@deepseek-ai/dsh-client-ui-workspace`) renders its
 * row menu from a hardcoded item list — the slot system exposes no hook for
 * third-party menu items. Rather than forking the package, this script applies
 * surgical, guarded edits to a Harness source checkout when available, or to
 * an installed client bundle as a fallback:
 *
 *   1. a "browse" menu item (label from the workspace dictionary, folder icon)
 *   2. an onSelect branch calling `window.__dsfvBrowseWorkspace(workspaceId)`
 *      (installed by the dsh-file-viewer client)
 *   3. the `browseFiles` dictionary key in both zh and en
 *
 * It is idempotent and aborts loudly if an anchor is missing (version drift),
 * so it can be re-run safely after Harness updates.
 */

import { readFile, writeFile, rename, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ROWS_REL = 'packages/client/ui-workspace/src/client/rows/Rows.tsx'
const SOURCE_LOCALES_REL = 'packages/client/ui-workspace/src/client/locales.ts'
const BUNDLE_REL = '@deepseek-ai/dsh-client-ui-workspace/lib/client.js'

const SOURCE_ROOTS = [
  process.env.DSH_HARNESS_SOURCE,
  join(REPO_ROOT, '..', 'deepseek-harness'),
].filter(Boolean)

const CANDIDATE_ROOTS = [
  process.env.DSH_NODE_MODULES,
  join(REPO_ROOT, 'node_modules'),
  '/home/liguobao/.nvm/versions/node/v22.23.0/lib/node_modules/@deepseek-ai/dsh/node_modules',
  join(process.env.HOME ?? '', '.dsh', 'profiles', 'web', 'node_modules'),
].filter(Boolean)

const MENU_ITEM = `{\n\t\t\t\tid: "browse",\n\t\t\t\tlabel: t("browseFiles"),\n\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpen16, {})\n\t\t\t}, {`

async function resolveTarget() {
  const explicit = process.env.DSH_WORKSPACE_MENU_TARGET
  if (explicit !== undefined && explicit !== '') {
    await access(explicit)
    return explicit.endsWith('Rows.tsx')
      ? { kind: 'source', rows: explicit, locales: join(dirname(dirname(explicit)), 'locales.ts') }
      : { kind: 'bundle', path: explicit }
  }
  for (const root of SOURCE_ROOTS) {
    const rows = join(root, SOURCE_ROWS_REL)
    const locales = join(root, SOURCE_LOCALES_REL)
    try {
      await access(rows)
      await access(locales)
      return { kind: 'source', rows, locales }
    } catch {
      // try the next checkout
    }
  }
  for (const root of CANDIDATE_ROOTS) {
    const candidate = join(root, BUNDLE_REL)
    try {
      await access(candidate)
      return { kind: 'bundle', path: candidate }
    } catch {
      // try the next root
    }
  }
  throw new Error(
    `Cannot locate ${SOURCE_ROWS_REL} under a source checkout or ${BUNDLE_REL} under node_modules.\n`
    + `Source roots:\n  ${SOURCE_ROOTS.join('\n  ')}\n`
    + `Node module roots:\n  ${CANDIDATE_ROOTS.join('\n  ')}`,
  )
}

/** Replace the first occurrence of `needle` with `replacement`, asserting it existed. */
function replaceOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle)
  if (index === -1) throw new Error(`Patch anchor missing for ${label}. The installed dsh-client-ui-workspace bundle changed; update this script.`)
  return source.slice(0, index) + replacement + source.slice(index + needle.length)
}

async function writeAtomic(target, content) {
  const temp = `${target}.dsfv-patch.tmp`
  await writeFile(temp, content, 'utf8')
  await rename(temp, target)
}

function patchBundle(original) {
  if (original.includes('__dsfvBrowseWorkspace')) {
    return { next: original, changed: false }
  }

  let next = original

  // 1. menu item (insert a "browse" entry ahead of "rename")
  next = replaceOnce(
    next,
    'const workspaceMenuItems = [{',
    `const workspaceMenuItems = [${MENU_ITEM}`,
    'workspaceMenuItems declaration',
  )

  // 2. onSelect branch (runs before the rename/delete guard)
  next = next.replace(
    /(\s*)if \(id !== "rename" && id !== "delete"\) return;/,
    '$1if (id === "browse") { window.__dsfvBrowseWorkspace?.(row.workspaceId ?? ""); return; }\n$1if (id !== "rename" && id !== "delete") return;',
  )
  if (!next.includes('window.__dsfvBrowseWorkspace')) {
    throw new Error('Patch anchor missing for onSelect handler. The installed bundle changed; update this script.')
  }

  // 3. dictionary keys (zh + en)
  next = replaceOnce(next, '"rename": "重命名"', '"browseFiles": "浏览文件",\n\t\t\t"rename": "重命名"', 'zh dictionary')
  next = replaceOnce(next, '"rename": "Rename"', '"browseFiles": "Browse files",\n\t\t\t"rename": "Rename"', 'en dictionary')

  return { next, changed: true }
}

function patchSourceRows(original) {
  let next = original
  let changed = false

  const oldMenuDoc = 'except workspace Rename/Delete and session Rename/Fork/Archive; the session'
  if (next.includes(oldMenuDoc)) {
    next = next.replace(oldMenuDoc, 'except workspace Browse/Rename/Delete and session Rename/Fork/Archive; the session')
    changed = true
  }

  if (original.includes('__dsfvBrowseWorkspace')) {
    return { next, changed }
  }

  next = replaceOnce(
    next,
    "  const workspaceMenuItems = [\n    { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },",
    "  const workspaceMenuItems = [\n    { id: 'browse', label: t('browseFiles'), icon: <IconFolderOpen16 /> },\n    { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },",
    'source workspaceMenuItems declaration',
  )
  changed = true

  next = replaceOnce(
    next,
    "              /* v8 ignore next -- Menu can emit only the rename and delete rows supplied above. */\n              if (id !== 'rename' && id !== 'delete') return",
    "              /* v8 ignore next -- Menu can emit only the browse, rename and delete rows supplied above. */\n              if (id === 'browse') {\n                (window as Window & { __dsfvBrowseWorkspace?: (workspaceIdOrPath: string) => void }).__dsfvBrowseWorkspace?.(row.workspaceId ?? '')\n                return\n              }\n              if (id !== 'rename' && id !== 'delete') return",
    'source onSelect handler',
  )

  return { next, changed }
}

function patchSourceLocales(original) {
  if (original.includes("'browseFiles': '浏览文件'") && original.includes("'browseFiles': 'Browse files'")) {
    return { next: original, changed: false }
  }
  let next = original
  if (!next.includes("'browseFiles': '浏览文件'")) {
    next = replaceOnce(next, "  'rename': '重命名',", "  'browseFiles': '浏览文件',\n  'rename': '重命名',", 'source zh dictionary')
  }
  if (!next.includes("'browseFiles': 'Browse files'")) {
    next = replaceOnce(next, "  'rename': 'Rename',", "  'browseFiles': 'Browse files',\n  'rename': 'Rename',", 'source en dictionary')
  }
  return { next, changed: true }
}

async function patchSource(target) {
  const [rowsOriginal, localesOriginal] = await Promise.all([
    readFile(target.rows, 'utf8'),
    readFile(target.locales, 'utf8'),
  ])
  const rows = patchSourceRows(rowsOriginal)
  const locales = patchSourceLocales(localesOriginal)
  if (!rows.changed && !locales.changed) {
    console.log('already patched:', target.rows)
    console.log('already patched:', target.locales)
    return
  }
  if (rows.changed) {
    await writeAtomic(target.rows, rows.next)
    console.log(`patched ${target.rows}`)
  } else {
    console.log('already patched:', target.rows)
  }
  if (locales.changed) {
    await writeAtomic(target.locales, locales.next)
    console.log(`patched ${target.locales}`)
  } else {
    console.log('already patched:', target.locales)
  }
  console.log('  + workspace menu item "browse" (label: browseFiles)')
  console.log('  + onSelect branch -> window.__dsfvBrowseWorkspace(row.workspaceId)')
  console.log('  + zh/en dictionary keys')
  console.log('Rebuild the workspace package, then refresh the web page to pick up the new bundle rev.')
}

async function patchInstalledBundle(target) {
  const original = await readFile(target.path, 'utf8')
  const { next, changed } = patchBundle(original)
  if (!changed) {
    console.log('already patched:', target.path)
    return
  }

  // Atomic write: temp file + rename breaks pnpm hardlinks so the store copy
  // (shared with other profiles) stays untouched.
  await writeAtomic(target.path, next)

  console.log(`patched ${target.path}`)
  console.log('  + workspace menu item "browse" (label: browseFiles)')
  console.log('  + onSelect branch -> window.__dsfvBrowseWorkspace(row.workspaceId)')
  console.log('  + zh/en dictionary keys')
  console.log('Refresh the web page to pick up the new bundle rev.')
}

async function main() {
  const target = await resolveTarget()
  if (target.kind === 'source') await patchSource(target)
  else await patchInstalledBundle(target)
}

main().catch((error) => {
  console.error('patch failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
