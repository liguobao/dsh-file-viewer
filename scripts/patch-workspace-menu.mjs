#!/usr/bin/env node
/**
 * Minimal compatibility layer: add a "浏览文件 / Browse files" entry to each
 * workspace row's "…" menu in the Harness sidebar.
 *
 * The workspace browser (`@deepseek-ai/dsh-client-ui-workspace`) renders its
 * row menu from a hardcoded item list — the slot system exposes no hook for
 * third-party menu items. Rather than forking the package, this script applies
 * three surgical, guarded edits to the installed client bundle:
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

const CANDIDATE_ROOTS = [
  process.env.DSH_NODE_MODULES,
  join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules'),
  '/home/liguobao/.nvm/versions/node/v22.23.0/lib/node_modules/@deepseek-ai/dsh/node_modules',
  join(process.env.HOME ?? '', '.dsh', 'profiles', 'web', 'node_modules'),
].filter(Boolean)

const REL = '@deepseek-ai/dsh-client-ui-workspace/lib/client.js'

const MENU_ITEM = `{\n\t\t\t\tid: "browse",\n\t\t\t\tlabel: t("browseFiles"),\n\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpen16, {})\n\t\t\t}, {`

async function resolveTarget() {
  for (const root of CANDIDATE_ROOTS) {
    const candidate = join(root, REL)
    try {
      await access(candidate)
      return candidate
    } catch {
      // try the next root
    }
  }
  throw new Error(`Cannot locate ${REL} under any candidate root:\n  ${CANDIDATE_ROOTS.join('\n  ')}`)
}

/** Replace the first occurrence of `needle` with `replacement`, asserting it existed. */
function replaceOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle)
  if (index === -1) throw new Error(`Patch anchor missing for ${label}. The installed dsh-client-ui-workspace bundle changed; update this script.`)
  return source.slice(0, index) + replacement + source.slice(index + needle.length)
}

async function main() {
  const target = await resolveTarget()
  const original = await readFile(target, 'utf8')

  if (original.includes('__dsfvBrowseWorkspace')) {
    console.log('already patched:', target)
    return
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

  // Atomic write: temp file + rename breaks pnpm hardlinks so the store copy
  // (shared with other profiles) stays untouched.
  const temp = `${target}.dsfv-patch.tmp`
  await writeFile(temp, next, 'utf8')
  await rename(temp, target)

  console.log(`patched ${target}`)
  console.log('  + workspace menu item "browse" (label: browseFiles)')
  console.log('  + onSelect branch -> window.__dsfvBrowseWorkspace(row.workspaceId)')
  console.log('  + zh/en dictionary keys')
  console.log('Refresh the web page to pick up the new bundle rev.')
}

main().catch((error) => {
  console.error('patch failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
