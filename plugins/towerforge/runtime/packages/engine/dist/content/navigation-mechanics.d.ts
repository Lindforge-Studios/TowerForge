import type { GameContentRegistry } from "./registry.js";
/** Closed R2 navigation budgets. These are content/runtime contracts, not UI hints. */
export declare const NAVIGATION_LIMITS: Readonly<{
    movementProfiles: 32;
    enemyAssignments: 4096;
    routeEndpointPairs: 64;
    uniqueGoals: 64;
    cachedProfileGoalPairs: 256;
    activeMapCells: 65536;
    materializedFieldCells: 4194304;
    terrainOverridesPerProfile: 256;
    terrainOverridesAcrossProfiles: 8192;
    terrainDefinitions: 256;
    terrainTagsPerDefinition: 64;
    terrainTagsAcrossDefinitions: 8192;
    terrainTagUtf8Bytes: 128;
    terrainCost: 1000000;
    idUtf8Bytes: 128;
    labelLength: 128;
    liveEnemyStates: 16384;
    placementAnalysisCoordinates: 4096;
    placementAnalysisRelaxations: 8388608;
}>;
export type NavigationModeV1 = "authored_routes" | "dynamic_flow";
export type NavigationTerrainModeV1 = "respect_walkable" | "ignore_walkable";
export type NavigationTowerOccupancyV1 = "blocked" | "ignored";
export interface MovementProfileV1 {
    readonly label: string;
    readonly terrainMode: NavigationTerrainModeV1;
    readonly towerOccupancy: NavigationTowerOccupancyV1;
    readonly defaultTerrainCost: number | null;
    readonly terrainCosts?: Readonly<Record<string, number | null>>;
}
export interface AuthoredRoutesNavigationProfileV1 {
    readonly mode: "authored_routes";
}
export interface DynamicFlowNavigationProfileV1 {
    readonly mode: "dynamic_flow";
    readonly defaultMovementProfileId: string;
    readonly movementProfiles: Readonly<Record<string, MovementProfileV1>>;
    readonly enemyMovementProfiles?: Readonly<Record<string, string>>;
}
export type NavigationProfileV1 = AuthoredRoutesNavigationProfileV1 | DynamicFlowNavigationProfileV1;
export type ActiveNavigationMechanicsV1 = NavigationProfileV1 & {
    readonly schemaVersion: 1;
    readonly profileId: string;
};
/** Closed descriptor for the shared deterministic movement-profile value shape. */
export declare const MOVEMENT_PROFILE_V1_SCHEMA: Readonly<{
    requiredFields: readonly ["label", "terrainMode", "towerOccupancy", "defaultTerrainCost"];
    optionalFields: readonly ["terrainCosts"];
    additionalProperties: false;
    label: Readonly<{
        minLength: 1;
        maxLength: 128;
    }>;
    terrainModeValues: readonly ["respect_walkable", "ignore_walkable"];
    towerOccupancyValues: readonly ["blocked", "ignored"];
    defaultTerrainCost: Readonly<{
        integer: true;
        minimum: 1;
        maximum: 1000000;
        nullable: true;
    }>;
    terrainCosts: Readonly<{
        maximumEntries: 256;
        values: Readonly<{
            integer: true;
            minimum: 1;
            maximum: 1000000;
            nullable: true;
        }>;
    }>;
}>;
/** Machine-readable authoring descriptor shared with future Studio/MCP surfaces. */
export declare const NAVIGATION_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 1;
    moduleId: "navigation";
    supportedModuleSchemaVersions: readonly [1];
    profile: Readonly<{
        additionalProperties: false;
        discriminator: "mode";
        modes: Readonly<{
            authored_routes: Readonly<{
                requiredFields: readonly ["mode"];
                optionalFields: readonly [];
            }>;
            dynamic_flow: Readonly<{
                requiredFields: readonly ["mode", "defaultMovementProfileId", "movementProfiles"];
                optionalFields: readonly ["enemyMovementProfiles"];
            }>;
        }>;
    }>;
    movementProfile: Readonly<{
        requiredFields: readonly ["label", "terrainMode", "towerOccupancy", "defaultTerrainCost"];
        optionalFields: readonly ["terrainCosts"];
        additionalProperties: false;
        label: Readonly<{
            minLength: 1;
            maxLength: 128;
        }>;
        terrainModeValues: readonly ["respect_walkable", "ignore_walkable"];
        towerOccupancyValues: readonly ["blocked", "ignored"];
        defaultTerrainCost: Readonly<{
            integer: true;
            minimum: 1;
            maximum: 1000000;
            nullable: true;
        }>;
        terrainCosts: Readonly<{
            maximumEntries: 256;
            values: Readonly<{
                integer: true;
                minimum: 1;
                maximum: 1000000;
                nullable: true;
            }>;
        }>;
    }>;
    limits: Readonly<{
        movementProfiles: 32;
        enemyAssignments: 4096;
        routeEndpointPairs: 64;
        uniqueGoals: 64;
        cachedProfileGoalPairs: 256;
        activeMapCells: 65536;
        materializedFieldCells: 4194304;
        terrainOverridesPerProfile: 256;
        terrainOverridesAcrossProfiles: 8192;
        terrainDefinitions: 256;
        terrainTagsPerDefinition: 64;
        terrainTagsAcrossDefinitions: 8192;
        terrainTagUtf8Bytes: 128;
        terrainCost: 1000000;
        idUtf8Bytes: 128;
        labelLength: 128;
        liveEnemyStates: 16384;
        placementAnalysisCoordinates: 4096;
        placementAnalysisRelaxations: 8388608;
    }>;
    runtimeSnapshot: Readonly<{
        path: "snapshot.navigation";
        schemaVersion: 1;
        modes: readonly ["dynamic_flow"];
        optionalUnlessActiveDynamicFlow: true;
    }>;
}>;
export declare class NavigationProfileValidationError extends Error {
    readonly fieldPath: string;
    constructor(fieldPath: string, message: string);
}
/** Normalize one closed movement profile for navigation-owned and other opt-in modules. */
export declare function normalizeMovementProfileV1(value: unknown, fieldPath?: string): MovementProfileV1;
/**
 * Safely detaches one navigation v1 profile into canonical binary-key order.
 * Cross-project references are intentionally resolved by content validation/resolution.
 */
export declare function normalizeNavigationProfileV1(value: unknown): NavigationProfileV1;
/** Resolves and safely detaches the mission-selected navigation profile. */
export declare function resolveActiveNavigationMechanics(content: GameContentRegistry, missionId: string): ActiveNavigationMechanicsV1 | undefined;
