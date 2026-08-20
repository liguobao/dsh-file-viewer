/**
 * Path safety: normalization and root-boundary validation. The host is the
 * final authority (it realpaths through ctx.fs and checks containment), but
 * these helpers give the client a cheap pre-check and give the host a
 * consistent vocabulary, and they are fully unit-tested.
 */
/** Reject unsafe request inputs before they reach the host. */
export declare function normalizeRequestPath(input: unknown): string;
/**
 * Lexical containment test (POSIX): is `candidate` equal to `root` or inside
 * it? Dot segments (`.`, `..`) are resolved before comparing. The host uses
 * realpath+contains as the final authority; this is the portable pre-check
 * and the unit-test surface for boundary logic.
 */
export declare function isPathInside(root: string, candidate: string): boolean;
/** Normalize separators to forward slashes and collapse duplicate slashes. */
export declare function normalizeSeparators(path: string): string;
/** Check a candidate path against a list of allowed roots (any root passes). */
export declare function isInsideAnyRoot(roots: readonly string[], candidate: string): boolean;
/** Join segments safely: the result must stay inside `root`. */
export declare function safeJoin(root: string, ...segments: string[]): string;
/** True when a path contains traversal segments (`..`). */
export declare function hasTraversal(path: string): boolean;
