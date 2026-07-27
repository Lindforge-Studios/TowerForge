import type { DisplacementEffectV1, GridCoord } from "./types.js";
import type { GridTopology } from "./topology.js";
export type DisplacementMode = "push" | "pull";
export type DisplacementCandidateClassification = "open" | "blocked" | "fall_hazard";
export type DisplacementStopReason = "completed" | "same_source_target" | "blocked" | "atomic_blocked" | "no_strict_neighbor" | "fall_hazard";
export interface DisplacementPlanRequest {
    readonly topology: GridTopology;
    readonly sourceCoord: GridCoord;
    readonly targetCoord: GridCoord;
    readonly effect: DisplacementEffectV1;
    readonly classifyCandidate: (coord: GridCoord, stepIndex: number) => DisplacementCandidateClassification;
}
export interface DisplacementPlan {
    readonly from: GridCoord;
    readonly to: GridCoord;
    readonly requestedDistance: number;
    readonly movedDistance: number;
    readonly steps: readonly GridCoord[];
    readonly fell: boolean;
    readonly stopReason: DisplacementStopReason;
}
/** Pure bounded tile-step planner. Geometry is selected before candidate classification. */
export declare function planTileDisplacement(request: DisplacementPlanRequest): DisplacementPlan;
