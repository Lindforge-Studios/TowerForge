import type { GameContentRegistry } from "../content/registry.js";
export interface CanonicalStringifyOptions {
    /** Maximum nesting depth, with the root value at depth zero. */
    readonly maxDepth?: number;
    /** Maximum number of visited containers and primitive values. */
    readonly maxNodes?: number;
    /** Maximum UTF-8 byte length of the canonical result. */
    readonly maxBytes?: number;
}
export interface CanonicalJsonMetrics {
    readonly bytes: number;
    readonly nodes: number;
}
export declare function canonicalStringify(value: unknown, options?: CanonicalStringifyOptions): string;
/** Exact metrics from the same strict traversal used by canonicalStringify. */
export declare function canonicalJsonMetrics(value: unknown, options?: CanonicalStringifyOptions): CanonicalJsonMetrics;
export declare function stableDigest(value: unknown, options?: CanonicalStringifyOptions): string;
/**
 * Digest every registry domain that can affect deterministic simulation.
 * Presentation-only data and the derived map factory closure are intentionally
 * excluded. The projection is rebuilt on every call because registries are mutable.
 */
export declare function getSimulationContentDigest(content: GameContentRegistry): string;
