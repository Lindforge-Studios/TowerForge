import type { GameContentRegistry } from "../content/registry.js";
export interface CanonicalStringifyOptions {
    /** Maximum nesting depth, with the root value at depth zero. */
    readonly maxDepth?: number;
    /** Maximum number of visited containers and primitive values. */
    readonly maxNodes?: number;
    /** Maximum UTF-8 byte length of the canonical result. */
    readonly maxBytes?: number;
}
/**
 * Serialize the strict JSON value subset used by deterministic simulation state.
 *
 * Unlike JSON.stringify, this function never coerces, drops, or invokes values.
 * Object properties are read from own data descriptors and sorted by binary
 * UTF-16 order so integer-like keys do not receive special enumeration order.
 */
export declare function canonicalStringify(value: unknown, options?: CanonicalStringifyOptions): string;
export declare function stableDigest(value: unknown, options?: CanonicalStringifyOptions): string;
/**
 * Digest every registry domain that can affect deterministic simulation.
 * Presentation-only data and the derived map factory closure are intentionally
 * excluded. The projection is rebuilt on every call because registries are mutable.
 */
export declare function getSimulationContentDigest(content: GameContentRegistry): string;
