import type { GameContentRegistry } from "./registry.js";
/** Closed authoring and runtime budgets for opt-in deterministic projectile ballistics v1. */
export declare const BALLISTICS_LIMITS: Readonly<{
    towerBindingsPerProfile: 256;
    activeProjectiles: 4096;
    impactsPerTick: 4096;
    travelTimeUnits: 1000000;
    maxAltitude: 1000000;
    idUtf8Bytes: 128;
}>;
/** Independent authoring and runtime budgets for deterministic arc-clearance v1. */
export declare const ARC_CLEARANCE_LIMITS: Readonly<{
    terrainBlockerTags: 64;
    terrainTagUtf8Bytes: 128;
    maximumBlockerHeight: 1000000;
    terrainDefinitions: 256;
    terrainTagsPerDefinition: 64;
    terrainTagsAcrossDefinitions: 8192;
    maximumRayDistance: 256;
    cellInspectionsPerTick: 1048576;
}>;
/** Independent content and runtime budgets for bounded topology ricochet v1. */
export declare const RICOCHET_LIMITS: Readonly<{
    terrainSurfaceTags: 64;
    armorTypeSurfaces: 64;
    maxBouncesPerProjectile: 4;
    maximumReflectedRayDistance: 256;
    enemyCandidatesPerCell: 16;
    ricochetsPerTick: 4096;
    cellInspectionsPerTick: 1048576;
    surfaceIdUtf8Bytes: 128;
}>;
/** Independent content and runtime budgets for opt-in destructible environment objects v1. */
export declare const DESTRUCTIBLE_ENVIRONMENT_LIMITS: Readonly<{
    definitionsPerProfile: 256;
    placementsPerMap: 4096;
    idUtf8Bytes: 128;
    maxHp: 1000000000;
    maximumBlockerHeight: 1000000;
    objectsPerCell: 1;
}>;
export declare const BALLISTICS_TRAJECTORIES: readonly ["direct", "arc"];
/** Capability-aware descriptor shared by engine, Studio and MCP authoring surfaces. */
export declare const BALLISTICS_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 1;
    moduleId: "ballistics";
    supportedModuleSchemaVersions: readonly [1];
    profile: Readonly<{
        requiredFields: readonly ["projectiles"];
        optionalFields: readonly [];
        additionalProperties: false;
    }>;
    projectiles: Readonly<{
        requiredFields: readonly ["towers"];
        optionalFields: readonly ["clearance", "ricochet", "destructibles"];
        additionalProperties: false;
    }>;
    clearance: Readonly<{
        requiredFields: readonly ["terrainBlockerHeights"];
        optionalFields: readonly [];
        additionalProperties: false;
        terrainBlockerHeights: Readonly<{
            kind: "record";
            key: "terrainTag";
            value: Readonly<{
                type: "number";
                minimum: 0;
                maximum: 1000000;
            }>;
        }>;
        limits: Readonly<{
            terrainBlockerTags: 64;
            terrainTagUtf8Bytes: 128;
            maximumBlockerHeight: 1000000;
            terrainDefinitions: 256;
            terrainTagsPerDefinition: 64;
            terrainTagsAcrossDefinitions: 8192;
            maximumRayDistance: 256;
            cellInspectionsPerTick: 1048576;
        }>;
    }>;
    ricochet: Readonly<{
        requiredFields: readonly [];
        optionalFields: readonly ["terrainTags", "armorTypes"];
        additionalProperties: false;
        surfaceRecord: Readonly<{
            kind: "record";
            value: Readonly<{
                const: true;
            }>;
        }>;
        limits: Readonly<{
            terrainSurfaceTags: 64;
            armorTypeSurfaces: 64;
            maxBouncesPerProjectile: 4;
            maximumReflectedRayDistance: 256;
            enemyCandidatesPerCell: 16;
            ricochetsPerTick: 4096;
            cellInspectionsPerTick: 1048576;
            surfaceIdUtf8Bytes: 128;
        }>;
    }>;
    destructibles: Readonly<{
        requiredFields: readonly ["definitions"];
        optionalFields: readonly [];
        additionalProperties: false;
        definition: Readonly<{
            requiredFields: readonly ["maxHp", "hitRegion"];
            optionalFields: readonly ["armorTypeId", "onDestroyed"];
            additionalProperties: false;
        }>;
        hitRegion: Readonly<{
            requiredFields: readonly ["kind", "blockerHeight", "blocksLineOfSight"];
            optionalFields: readonly [];
            additionalProperties: false;
            kinds: readonly ["tile"];
        }>;
        onDestroyed: Readonly<{
            requiredFields: readonly ["terrainTransitionId"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
        limits: Readonly<{
            definitionsPerProfile: 256;
            placementsPerMap: 4096;
            idUtf8Bytes: 128;
            maxHp: 1000000000;
            maximumBlockerHeight: 1000000;
            objectsPerCell: 1;
        }>;
    }>;
    towerBinding: Readonly<{
        requiredFields: readonly ["trajectory", "travelTimeUnits"];
        optionalFields: readonly ["maxAltitude", "ricochet"];
        additionalProperties: false;
    }>;
    towerRicochet: Readonly<{
        requiredFields: readonly ["maxBounces", "rangeCells"];
        optionalFields: readonly [];
        additionalProperties: false;
    }>;
    trajectories: readonly ["direct", "arc"];
    limits: Readonly<{
        towerBindingsPerProfile: 256;
        activeProjectiles: 4096;
        impactsPerTick: 4096;
        travelTimeUnits: 1000000;
        maxAltitude: 1000000;
        idUtf8Bytes: 128;
    }>;
}>;
export type BallisticsTrajectoryV1 = (typeof BALLISTICS_TRAJECTORIES)[number];
export interface BallisticsTowerBindingV1 {
    readonly trajectory: BallisticsTrajectoryV1;
    readonly travelTimeUnits: number;
    readonly maxAltitude?: number;
    readonly ricochet?: BallisticsTowerRicochetV1;
}
export interface BallisticsTowerRicochetV1 {
    readonly maxBounces: number;
    readonly rangeCells: number;
}
export interface BallisticsProfileV1 {
    readonly projectiles: {
        readonly towers: Readonly<Record<string, BallisticsTowerBindingV1>>;
        readonly clearance?: BallisticsArcClearanceV1;
        readonly ricochet?: BallisticsRicochetSurfacesV1;
        readonly destructibles?: BallisticsDestructibleCatalogV1;
    };
}
export interface BallisticsArcClearanceV1 {
    readonly terrainBlockerHeights: Readonly<Record<string, number>>;
}
export interface BallisticsRicochetSurfacesV1 {
    readonly terrainTags?: Readonly<Record<string, true>>;
    readonly armorTypes?: Readonly<Record<string, true>>;
}
export interface BallisticsDestructibleHitRegionV1 {
    readonly kind: "tile";
    readonly blockerHeight: number;
    readonly blocksLineOfSight: boolean;
}
export interface BallisticsDestructibleOnDestroyedV1 {
    readonly terrainTransitionId: string;
}
export interface BallisticsDestructibleDefinitionV1 {
    readonly maxHp: number;
    readonly hitRegion: BallisticsDestructibleHitRegionV1;
    readonly armorTypeId?: string;
    readonly onDestroyed?: BallisticsDestructibleOnDestroyedV1;
}
export interface BallisticsDestructibleCatalogV1 {
    readonly definitions: Readonly<Record<string, BallisticsDestructibleDefinitionV1>>;
}
export interface ActiveBallisticsMechanicsV1 extends BallisticsProfileV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
}
export declare class BallisticsProfileValidationError extends Error {
}
/** Parse detached, binary-ordered and deeply frozen ballistics v1 own data. */
export declare function normalizeBallisticsProfileV1(value: unknown): BallisticsProfileV1;
/** Resolve a ballistics profile only when the mission-selected v1 capability is active. */
export declare function resolveActiveBallisticsMechanics(content: GameContentRegistry, missionId: string): ActiveBallisticsMechanicsV1 | undefined;
