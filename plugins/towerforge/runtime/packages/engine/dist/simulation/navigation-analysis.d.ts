import type { GridCoord, NavigationFieldSnapshotV1 } from "./types.js";
export interface NavigationAnalysisRequestV1 {
    /** Optional field-diagnostic filter; placement rows still preserve every live required path. */
    readonly movementProfileIds?: readonly string[];
    /** Optional field-diagnostic filter; placement rows still preserve every live required path. */
    readonly routeIds?: readonly string[];
    readonly towerTypeId?: string;
    readonly coordinates?: readonly GridCoord[];
}
export interface NavigationPlacementAnalysisRowV1 {
    readonly coord: GridCoord;
    readonly ok: boolean;
    readonly reasonKey?: string;
    readonly blockingPair?: {
        readonly movementProfileId: string;
        readonly routeId: string;
    };
}
export interface NavigationAnalysisV1 {
    readonly schemaVersion: 1;
    readonly mode: "dynamic_flow";
    readonly profileId: string;
    readonly fields: readonly NavigationFieldSnapshotV1[];
    readonly placementRows: readonly NavigationPlacementAnalysisRowV1[];
}
export declare const NAVIGATION_ANALYSIS_SCHEMA: Readonly<{
    schemaVersion: 1;
    request: Readonly<{
        explicitCoordinateSubset: true;
        maxCoordinates: 4096;
    }>;
    result: Readonly<{
        placementOrder: "r,q";
        blockingPairOrder: "binary";
    }>;
}>;
export interface NavigationAnalysisValidationContext {
    readonly width: number;
    readonly height: number;
    readonly movementProfileIds: readonly string[];
    readonly routeIds: readonly string[];
    readonly towerTypeIds: readonly string[];
}
export interface NormalizedNavigationAnalysisRequestV1 {
    readonly movementProfileIds: readonly string[];
    readonly routeIds: readonly string[];
    readonly towerTypeId?: string;
    readonly coordinates: readonly GridCoord[];
}
/** Strictly detach and canonicalize one active dynamic-flow analysis request. */
export declare function normalizeNavigationAnalysisRequestV1(value: NavigationAnalysisRequestV1, context: NavigationAnalysisValidationContext): NormalizedNavigationAnalysisRequestV1;
