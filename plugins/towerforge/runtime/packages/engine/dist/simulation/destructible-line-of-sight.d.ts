import type { GridMap } from "./map.js";
import type { GridCoord } from "./types.js";
export interface DynamicAuthoredLineOfSightBlockerV1 {
    readonly objectId: string;
    readonly definitionId: string;
    readonly coord: GridCoord;
    readonly blockerHeight: number;
}
/** Opaque, immutable handle for authored dynamic LoS blockers. */
export interface DynamicAuthoredLineOfSightIndexV1 {
    readonly schemaVersion: 1;
}
/** Build a detached, canonical O(1) cell lookup without caching mutable terrain elevation. */
export declare function buildDynamicAuthoredLineOfSightIndexV1(map: GridMap, value: readonly DynamicAuthoredLineOfSightBlockerV1[]): DynamicAuthoredLineOfSightIndexV1;
/** Internal pure lookup used by the generalized LoS tracer. */
export declare function dynamicAuthoredLineOfSightBlockerAtV1(map: GridMap, index: DynamicAuthoredLineOfSightIndexV1, coord: GridCoord): DynamicAuthoredLineOfSightBlockerV1 | undefined;
