// Build the two halves of the dsh-file-viewer plugin:
//   dist/index.js  — node half (cordis plugin; host side)
//   dist/client.js — browser bundle (window.__ModuleLoader__.load factory)
import { join, dirname } from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [join(root, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  sourcemap: true,
  outfile: join(root, 'dist/index.js'),
  external: ['@deepseek-ai/*'],
})

// Inline the PDF.js worker source as a string so the single client bundle
// needs no second file: served from a Blob URL at runtime.
const pdfWorkerSource = await readFile(join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), 'utf8')

await build({
  entryPoints: [join(root, 'src/client.ts')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  minifySyntax: true,
  sourcemap: true,
  define: {
    DSH_FILE_VIEWER_PDF_WORKER_SOURCE: JSON.stringify(pdfWorkerSource),
  },
  outfile: join(root, 'dist/client.js'),
})

console.log(`built dist/index.js + dist/client.js (pdf worker ${(pdfWorkerSource.length / 1024).toFixed(0)} KiB inlined)`)
