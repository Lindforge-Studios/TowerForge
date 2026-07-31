import { type DynamicAuthoredLineOfSightIndexV1 } from "./destructible-line-of-sight.js";
import type { GridMap } from "./map.js";
import type { GridCoord, TerrainTypeDefinition } from "./types.js";
export type LineOfSightReasonV1 = "clear" | "terrain_tag" | "elevation" | "ray_budget_exceeded" | "operation_budget_exceeded";
export interface LineOfSightBlockerV1 {
    readonly coord: GridCoord;
    readonly terrainId: string;
    readonly elevation: number;
    readonly tag?: string;
}
export interface LineOfSightAnalysisRowV1 {
    readonly target: GridCoord;
    readonly visible: boolean;
    readonly reason: LineOfSightReasonV1;
    readonly blocker?: LineOfSightBlockerV1;
}
export interface LineOfSightAnalysisV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
    readonly source: GridCoord;
    readonly rows: readonly LineOfSightAnalysisRowV1[];
    readonly coverage: {
        readonly requestedTargets: number;
        readonly analyzedTargets: number;
        readonly cellInspections: number;
        readonly budgetExceeded: boolean;
    };
}
export interface LineOfSightAnalysisV2 {
    readonly schemaVersion: 2;
    readonly profiles: Readonly<{
        readonly elevation?: string;
        readonly ballistics: string;
    }>;
    readonly source: GridCoord;
    readonly rows: readonly LineOfSightAnalysisRowV2[];
    readonly coverage: LineOfSightAnalysisV1["coverage"];
}
export interface LineOfSightAnalysisRequestV1 {
    readonly source: GridCoord;
    readonly targets: readonly GridCoord[];
}
export interface LineOfSightRuntimeProfileV2 {
    readonly profileId: string;
    readonly terrainBlockerTags: readonly string[];
}
interface TraceResult {
    readonly row: LineOfSightAnalysisRowV1;
    readonly cellInspections: number;
    readonly budgetExceeded: boolean;
}
export type LineOfSightReasonV2 = LineOfSightReasonV1 | "destructible";
export interface LineOfSightBlockerV2 extends LineOfSightBlockerV1 {
    readonly objectId?: string;
    readonly definitionId?: string;
    readonly blockerHeight?: number;
}
export interface LineOfSightAnalysisRowV2 {
    readonly target: GridCoord;
    readonly visible: boolean;
    readonly reason: LineOfSightReasonV2;
    readonly blocker?: LineOfSightBlockerV2;
}
export interface LineOfSightTraceResultV2 {
    readonly row: LineOfSightAnalysisRowV2;
    readonly cellInspections: number;
    readonly budgetExceeded: boolean;
}
export interface LineOfSightLegacyPolicyV1 {
    readonly terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>;
    readonly terrainBlockerTags: readonly string[];
}
export declare function normalizeLineOfSightAnalysisRequestV1(value: unknown, map: GridMap): LineOfSightAnalysisRequestV1;
export declare function traceLineOfSight(map: GridMap, terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>, terrainBlockerTags: readonly string[], source: GridCoord, target: GridCoord, remainingCellInspections?: number): TraceResult;
/**
 * Generalized source/target-exclusive LoS trace. When no dynamic index is supplied, the existing
 * public wrapper remains the exact implementation and result contract.
 */
export declare function traceLineOfSightV2(map: GridMap, legacyPolicy: LineOfSightLegacyPolicyV1 | undefined, dynamicIndex: DynamicAuthoredLineOfSightIndexV1 | undefined, source: GridCoord, target: GridCoord, remainingCellInspections?: number): LineOfSightTraceResultV2;
export declare function analyzeLineOfSightTargets(map: GridMap, terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>, profile: LineOfSightRuntimeProfileV2, request: LineOfSightAnalysisRequestV1): LineOfSightAnalysisV1;
/** Compute-only dynamic diagnostics; no index or result state is persisted by the simulation. */
export declare function analyzeLineOfSightTargetsV2(map: GridMap, legacyPolicy: LineOfSightLegacyPolicyV1 | undefined, dynamicIndex: DynamicAuthoredLineOfSightIndexV1, profiles: LineOfSightAnalysisV2["profiles"], request: LineOfSightAnalysisRequestV1): LineOfSightAnalysisV2;
export {};
