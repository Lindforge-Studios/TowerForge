import { type BallisticsArcClearanceV1, type BallisticsTrajectoryV1 } from "../content/ballistics-mechanics.js";
import type { GridMap } from "./map.js";
import type { GridCoord, TerrainTypeDefinition } from "./types.js";
export interface ProjectileClearanceCollisionV1 {
    readonly blockerCoord: GridCoord;
    readonly terrainId: string;
    readonly blockerTag: string;
    readonly blockerElevation: number;
    readonly elapsedUnits: number;
}
export interface ProjectileClearanceTraceRequestV1 {
    readonly sourceCoord: GridCoord;
    readonly targetCoord: GridCoord;
    readonly sourceElevation: number;
    readonly targetElevation: number;
    readonly trajectory: BallisticsTrajectoryV1;
    readonly travelTimeUnits: number;
    readonly maxAltitude?: number;
}
export type ProjectileClearanceTraceV1 = {
    readonly ok: true;
    readonly cellInspections: number;
    readonly collision?: ProjectileClearanceCollisionV1;
} | {
    readonly ok: false;
    readonly cellInspections: number;
    readonly reason: "ray_budget_exceeded" | "operation_budget_exceeded";
};
export declare function projectileAltitudeAtProgress(sourceElevation: number, targetElevation: number, trajectory: BallisticsTrajectoryV1, maxAltitude: number | undefined, progress: number): number;
/**
 * Captures one launch-time clearance trace over the topology-owned line. Runtime terrain changes
 * cannot rewrite an already launched projectile's collision provenance.
 */
export declare function traceProjectileClearanceV1(map: GridMap, terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>, clearance: BallisticsArcClearanceV1, request: ProjectileClearanceTraceRequestV1, remainingCellInspections: number): ProjectileClearanceTraceV1;
