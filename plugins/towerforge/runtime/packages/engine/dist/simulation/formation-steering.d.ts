import { type FormationRoleV1, type FormationSteeringDefinitionV1 } from "../content/enemy-behaviors-mechanics.js";
import type { GridCoord, GridDefinition } from "./types.js";
export interface FormationSteeringCandidateV1 {
    readonly coord: GridCoord;
    readonly remainingCostMilli: number;
}
export interface FormationSteeringSelfV1 {
    readonly enemyId: string;
    readonly cohortId: string;
    readonly role: FormationRoleV1;
}
export interface FormationSteeringNeighborV1 {
    readonly enemyId: string;
    readonly role: FormationRoleV1;
    readonly anchorCoord: GridCoord;
    readonly remainingCostMilli: number;
}
export interface FormationSteeringRequestV1 {
    readonly schemaVersion: 1;
    readonly grid: GridDefinition;
    readonly currentCoord: GridCoord;
    readonly canonicalNextCoord: GridCoord;
    readonly candidates: readonly FormationSteeringCandidateV1[];
    readonly self: FormationSteeringSelfV1;
    readonly neighbors: readonly FormationSteeringNeighborV1[];
    readonly steering: FormationSteeringDefinitionV1;
}
export interface FormationSteeringResultV1 {
    readonly schemaVersion: 1;
    readonly nextCoord: GridCoord;
    readonly neighborIds: readonly string[];
    readonly score: number;
}
export interface FormationSteeringRuntimeStatsV1 {
    readonly bucketBuildCount: number;
    readonly bucketEntryCount: number;
    readonly fieldReadCount: number;
    readonly plannerInvocationCount: number;
    readonly neighborEntriesInspected: number;
    readonly maximumNeighborCount: number;
}
/** Pure bounded formation chooser over a host-proven equal-optimal flow candidate set. */
export declare function selectFormationSteeringNextV1(request: FormationSteeringRequestV1): FormationSteeringResultV1;
