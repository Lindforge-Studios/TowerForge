import type { DynamicFlowNavigationProfileV1 } from "../content/navigation-mechanics.js";
import type { TowerScriptDefinition } from "../scripting/types.js";
import type { GridCoord, GridPathRoute } from "./types.js";
export type DynamicTerraformingSpawnSourceKind = "wave_spawn" | "death_spawn" | "phase_spawn" | "script_spawn";
export interface DynamicTerraformingSpawnProvenance {
    readonly kind: DynamicTerraformingSpawnSourceKind;
    readonly movementProfileId: string;
    readonly routeId: string;
    readonly goal: GridCoord;
    readonly coord: GridCoord;
    readonly subjectId: string;
}
interface ReachabilityEnemyDefinition {
    readonly spawnOnDeath?: {
        readonly enemyId: string;
        readonly count: number;
    };
    readonly phaseSpawns?: readonly {
        readonly enemyId: string;
        readonly count: number;
        readonly routeIds?: readonly string[];
    }[];
}
type ReachabilityScriptDefinition = Pick<TowerScriptDefinition, "schemaVersion" | "id" | "enabled" | "bindings" | "handlers">;
export interface DynamicTerraformingSpawnProvenanceRequest {
    readonly profile: DynamicFlowNavigationProfileV1;
    readonly routes: readonly GridPathRoute[];
    readonly waves: readonly {
        readonly groups: readonly {
            readonly enemyId: string;
            readonly routeId?: string;
        }[];
    }[];
    readonly enemyTypes: Readonly<Record<string, ReachabilityEnemyDefinition>>;
    readonly scripts: Readonly<Record<string, ReachabilityScriptDefinition>>;
    readonly mission: {
        readonly id: string;
        readonly mapId: string;
        readonly waveSetId: string;
        readonly buildTowerIds: readonly string[];
        readonly abilityIds: readonly string[];
    };
    readonly initialReachableTerrainIds: readonly string[];
    readonly terraformTransitionTerrainById: Readonly<Record<string, string>>;
}
/**
 * Collects the deterministic, mission-reachable dynamic spawn graph without consulting a
 * resolver or mutating runtime state. The returned provenance is intentionally richer than the
 * work-set key so independent authored causes remain visible while spawn cycles stay bounded.
 */
export declare function collectDynamicTerraformingSpawnProvenance(request: DynamicTerraformingSpawnProvenanceRequest): readonly DynamicTerraformingSpawnProvenance[];
export {};
