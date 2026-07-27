import type { DynamicFlowNavigationProfileV1 } from "../content/navigation-mechanics.js";
import type { DynamicTerraformingSpawnObligation, DynamicTerraformingSpawnProvenance } from "./navigation-reachability.js";
import type { GridCoord, GridPathRoute } from "./types.js";
export type DynamicTerraformingSafetySourceKind = "route_source" | "route_goal" | "wave_spawn" | "death_spawn" | "phase_spawn" | "script_spawn" | "pending_death_spawn" | "live_current" | "live_next";
export interface DynamicTerraformingSafetySource {
    readonly kind: DynamicTerraformingSafetySourceKind;
    readonly movementProfileId: string;
    readonly routeId: string;
    readonly goal: GridCoord;
    readonly coord: GridCoord;
    readonly subjectId: string;
}
export interface DynamicTerraformingSafetyGroup {
    readonly key: string;
    readonly movementProfileId: string;
    readonly goal: GridCoord;
    readonly routeId: string;
    readonly sources: readonly DynamicTerraformingSafetySource[];
}
export interface PreparedDynamicTerraformingSafetySet {
    readonly groups: readonly DynamicTerraformingSafetyGroup[];
    readonly obligations?: readonly DynamicTerraformingSpawnObligation[];
    readonly sourceCount: number;
    readonly fieldCount: number;
    readonly obligationCount?: number;
    readonly observationCount?: number;
    readonly combinedFieldCells: number;
}
export interface DynamicTerraformingSafetyBudgetInput {
    readonly sourceCount: number;
    readonly fieldCount: number;
    readonly obligationCount?: number;
    readonly observationCount?: number;
    readonly mapCellCount: number;
}
export interface DynamicTerraformingSafetyEnemy {
    readonly id: string;
    readonly typeId: string;
    readonly hp: number;
    readonly routeId?: string;
    readonly navigation?: {
        readonly currentCoord: GridCoord;
        readonly nextCoord?: GridCoord;
        readonly edgeProgress: number;
    };
}
export interface PrepareDynamicTerraformingSafetySetRequest {
    readonly profile: DynamicFlowNavigationProfileV1;
    readonly routes: readonly GridPathRoute[];
    readonly spawnProvenance: readonly DynamicTerraformingSpawnProvenance[];
    readonly spawnObligations?: readonly DynamicTerraformingSpawnObligation[];
    readonly enemies: readonly DynamicTerraformingSafetyEnemy[];
    readonly mapCellCount: number;
}
export declare function assertDynamicTerraformingSafetyBudget(input: DynamicTerraformingSafetyBudgetInput): void;
/** Builds the canonical solver-free safety input and enforces all C2 navigation budgets. */
export declare function prepareDynamicTerraformingSafetySet(input: PrepareDynamicTerraformingSafetySetRequest): PreparedDynamicTerraformingSafetySet;
