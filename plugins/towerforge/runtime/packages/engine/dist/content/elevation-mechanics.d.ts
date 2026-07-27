import type { GameContentRegistry } from "./registry.js";
export { ELEVATION_LIMITS } from "../simulation/map.js";
/** Closed R3.2 LoS budgets. They are engine contracts, not UI hints. */
export declare const LINE_OF_SIGHT_LIMITS: Readonly<{
    activeMapCells: 65536;
    terrainBlockerTags: 64;
    terrainTagUtf8Bytes: 128;
    terrainDefinitions: 256;
    terrainTagsPerDefinition: 64;
    terrainTagsAcrossDefinitions: 8192;
    maximumRayDistance: 256;
    candidatesPerAcquisition: 4096;
    analysisTargets: 4096;
    cellInspectionsPerOperation: 1048576;
}>;
/** Closed R3.3 high-ground authoring/runtime budgets. */
export declare const HIGH_GROUND_LIMITS: Readonly<{
    maximumEffectiveElevationDelta: 64;
    rangeBonusPerElevation: 16;
    damageBonusBasisPointsPerElevation: 10000;
    totalRangeBonus: 64;
    totalDamageBonusBasisPoints: 100000;
    modifiersPerDamagePacket: 1;
}>;
export declare const ELEVATION_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 3;
    moduleId: "elevation";
    supportedModuleSchemaVersions: readonly [1, 2, 3];
    profile: Readonly<{
        requiredFields: readonly [];
        optionalFields: readonly ["lineOfSight", "highGround"];
        additionalProperties: false;
        versions: Readonly<{
            1: Readonly<{
                requiredFields: readonly [];
                optionalFields: readonly [];
                additionalProperties: false;
            }>;
            2: Readonly<{
                requiredFields: readonly [];
                optionalFields: readonly ["lineOfSight"];
                additionalProperties: false;
            }>;
            3: Readonly<{
                requiredFields: readonly [];
                optionalFields: readonly ["lineOfSight", "highGround"];
                additionalProperties: false;
            }>;
        }>;
        lineOfSight: Readonly<{
            requiredFields: readonly ["terrainBlockerTags"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
        highGround: Readonly<{
            requiredFields: readonly ["maximumEffectiveElevationDelta", "rangeBonusPerElevation", "damageBonusBasisPointsPerElevation"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
    }>;
    map: Readonly<{
        field: "elevationOverrides";
        coordinateField: "elevation";
        implicitDefault: 0;
        canonicalOrder: readonly ["r", "q"];
        zeroOverridesOmitted: true;
    }>;
    limits: Readonly<{
        lineOfSight: Readonly<{
            activeMapCells: 65536;
            terrainBlockerTags: 64;
            terrainTagUtf8Bytes: 128;
            terrainDefinitions: 256;
            terrainTagsPerDefinition: 64;
            terrainTagsAcrossDefinitions: 8192;
            maximumRayDistance: 256;
            candidatesPerAcquisition: 4096;
            analysisTargets: 4096;
            cellInspectionsPerOperation: 1048576;
        }>;
        highGround: Readonly<{
            maximumEffectiveElevationDelta: 64;
            rangeBonusPerElevation: 16;
            damageBonusBasisPointsPerElevation: 10000;
            totalRangeBonus: 64;
            totalDamageBonusBasisPoints: 100000;
            modifiersPerDamagePacket: 1;
        }>;
        overridesPerMap: 65536;
        minimum: -1000000;
        maximum: 1000000;
    }>;
    runtimeSnapshot: Readonly<{
        path: "snapshot.elevation";
        schemaVersion: 1;
        optionalUnlessActive: true;
        fields: readonly ["schemaVersion", "defaultElevation", "overrides"];
    }>;
}>;
export interface ElevationLineOfSightProfileV2 {
    readonly terrainBlockerTags: readonly string[];
}
export interface ElevationHighGroundProfileV3 {
    readonly maximumEffectiveElevationDelta: number;
    readonly rangeBonusPerElevation: number;
    readonly damageBonusBasisPointsPerElevation: number;
}
export interface ActiveElevationMechanicsV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
}
export interface ActiveElevationMechanicsV2 {
    readonly schemaVersion: 2;
    readonly profileId: string;
    readonly lineOfSight?: ElevationLineOfSightProfileV2;
}
export interface ActiveElevationMechanicsV3 {
    readonly schemaVersion: 3;
    readonly profileId: string;
    readonly lineOfSight?: ElevationLineOfSightProfileV2;
    readonly highGround?: ElevationHighGroundProfileV3;
}
export type ActiveElevationMechanics = ActiveElevationMechanicsV1 | ActiveElevationMechanicsV2 | ActiveElevationMechanicsV3;
/** Resolve only the enabled, selected and supported mission-level opt-in switch. */
export declare function resolveActiveElevationMechanics(content: GameContentRegistry, missionId: string): ActiveElevationMechanics | undefined;
export declare function resolveActiveLineOfSightMechanics(content: GameContentRegistry, missionId: string): (ElevationLineOfSightProfileV2 & {
    readonly profileId: string;
}) | undefined;
export declare function resolveActiveHighGroundMechanics(content: GameContentRegistry, missionId: string): (ElevationHighGroundProfileV3 & {
    readonly profileId: string;
}) | undefined;
