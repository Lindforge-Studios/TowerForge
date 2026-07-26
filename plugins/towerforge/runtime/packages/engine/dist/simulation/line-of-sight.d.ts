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
export declare function normalizeLineOfSightAnalysisRequestV1(value: unknown, map: GridMap): LineOfSightAnalysisRequestV1;
export declare function traceLineOfSight(map: GridMap, terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>, terrainBlockerTags: readonly string[], source: GridCoord, target: GridCoord, remainingCellInspections?: number): TraceResult;
export declare function analyzeLineOfSightTargets(map: GridMap, terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>, profile: LineOfSightRuntimeProfileV2, request: LineOfSightAnalysisRequestV1): LineOfSightAnalysisV1;
export {};
