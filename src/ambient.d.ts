/**
 * Ambient module declarations for build-time-only imports:
 *  - esbuild `?raw` string imports (inlined PDF worker source)
 *  - highlight.js per-language modules (no bundled .d.ts per language)
 * These files are bundled by esbuild; the declarations only serve tsc.
 */

declare module '*?raw' {
  const content: string
  export default content
}

declare module 'highlight.js/lib/languages/*' {
  import type { LanguageFn } from 'highlight.js'
  const language: LanguageFn
  export default language
}
