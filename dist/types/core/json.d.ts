/**
 * JSON parsing helpers for the JSON/YAML tree views: safe parsing plus a
 * flat "path → value" projection used to render expandable trees and to
 * copy values / paths.
 */
export type JsonScalar = string | number | boolean | null;
export interface JsonNode {
    /** Path from the root, e.g. `user.settings[0].name`. */
    path: string;
    /** Display key of this node (object key or array index). */
    key: string;
    value: unknown;
    kind: 'object' | 'array' | 'scalar';
    /** Children count for objects/arrays (0 for scalars). */
    size: number;
}
export type JsonParseResult = {
    ok: true;
    value: unknown;
    nodes: JsonNode[];
} | {
    ok: false;
    error: string;
};
/** Parse JSON, returning a structured error message instead of throwing. */
export declare function parseJson(text: string): JsonParseResult;
/** Flatten a parsed JSON value into path-addressed nodes (depth-first). */
export declare function buildJsonTree(value: unknown, prefix?: string): JsonNode[];
/** Render a scalar for display. */
export declare function scalarText(value: unknown): string;
/** Look up a value by dotted path inside a parsed JSON value. */
export declare function getByPath(value: unknown, path: string): unknown;
