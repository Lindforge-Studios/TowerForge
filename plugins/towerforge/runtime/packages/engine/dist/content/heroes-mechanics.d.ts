import type { GameContentRegistry } from "./registry.js";
import { type MovementProfileV1 } from "./navigation-mechanics.js";
/** Closed structural budgets for the first opt-in hero roster schema. */
export declare const HEROES_LIMITS: Readonly<{
    definitions: 32;
    idUtf8Bytes: 128;
    labelUtf8Bytes: 128;
}>;
export interface HeroUnitDefinitionV1 {
    readonly label: string;
    readonly spawn: "core";
}
export interface HeroesProfileV1 {
    readonly selectedHeroId: string;
    readonly definitions: Readonly<Record<string, HeroUnitDefinitionV1>>;
}
export interface ActiveHeroesMechanicsV1 extends HeroesProfileV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
}
export interface HeroMovementDefinitionV2 {
    readonly movementProfileId: string;
    readonly speed: number;
}
export interface HeroUnitDefinitionV2 {
    readonly label: string;
    readonly spawn: "core";
    readonly movement: HeroMovementDefinitionV2;
}
export interface HeroesProfileV2 {
    readonly selectedHeroId: string;
    readonly definitions: Readonly<Record<string, HeroUnitDefinitionV2>>;
    readonly movementProfiles: Readonly<Record<string, MovementProfileV1>>;
}
export interface ActiveHeroesMechanicsV2 extends HeroesProfileV2 {
    readonly schemaVersion: 2;
    readonly profileId: string;
}
export type ActiveHeroesMechanics = ActiveHeroesMechanicsV1 | ActiveHeroesMechanicsV2;
/** Capability-aware authoring descriptor shared by Studio and MCP. */
export declare const HEROES_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 2;
    moduleId: "heroes";
    supportedModuleSchemaVersions: readonly [1, 2];
    profile: Readonly<{
        requiredFields: readonly ["selectedHeroId", "definitions"];
        optionalFields: readonly [];
        additionalProperties: false;
    }>;
    definition: Readonly<{
        requiredFields: readonly ["label", "spawn"];
        optionalFields: readonly [];
        additionalProperties: false;
        spawnValues: readonly ["core"];
    }>;
    versions: Readonly<{
        1: Readonly<{
            profile: Readonly<{
                requiredFields: readonly ["selectedHeroId", "definitions"];
                optionalFields: readonly [];
                additionalProperties: false;
            }>;
            definition: Readonly<{
                requiredFields: readonly ["label", "spawn"];
                optionalFields: readonly [];
                additionalProperties: false;
                spawnValues: readonly ["core"];
            }>;
        }>;
        2: Readonly<{
            profile: Readonly<{
                requiredFields: readonly ["selectedHeroId", "definitions", "movementProfiles"];
                optionalFields: readonly [];
                additionalProperties: false;
            }>;
            definition: Readonly<{
                requiredFields: readonly ["label", "spawn", "movement"];
                optionalFields: readonly [];
                additionalProperties: false;
                spawnValues: readonly ["core"];
            }>;
            movement: Readonly<{
                requiredFields: readonly ["movementProfileId", "speed"];
                optionalFields: readonly [];
                additionalProperties: false;
                speed: Readonly<{
                    exclusiveMinimum: 0;
                    maximum: 20;
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
        }>;
    }>;
    limits: Readonly<{
        definitions: 32;
        idUtf8Bytes: 128;
        labelUtf8Bytes: 128;
    }>;
    runtimeSnapshot: Readonly<{
        path: "snapshot.heroes";
        schemaVersions: readonly [1, 2];
        optionalUnlessActive: true;
        versions: Readonly<{
            1: Readonly<{
                unitFields: readonly ["id", "definitionId", "label", "coord"];
            }>;
            2: Readonly<{
                unitFields: readonly ["id", "definitionId", "label", "coord", "movement"];
                movementFields: readonly ["targetCoord", "nextCoord", "edgeProgress"];
            }>;
        }>;
    }>;
}>;
export declare class HeroesProfileValidationError extends Error {
    readonly fieldPath: string;
    constructor(fieldPath: string, message: string);
}
/** Normalize the closed structural shape. The selected-definition reference is semantic. */
export declare function normalizeHeroesProfileV1(input: unknown, root?: string): HeroesProfileV1;
/** Normalize the closed R5.1B movement-enabled profile without activating navigation. */
export declare function normalizeHeroesProfileV2(input: unknown, root?: string): HeroesProfileV2;
/** Resolve a detached profile only when the mission genuinely selected a supported heroes version. */
export declare function resolveActiveHeroesMechanics(content: GameContentRegistry, missionId: string): ActiveHeroesMechanics | undefined;
