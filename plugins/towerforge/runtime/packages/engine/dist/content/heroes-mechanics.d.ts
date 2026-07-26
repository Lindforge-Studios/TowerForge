import type { GameContentRegistry } from "./registry.js";
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
/** Capability-aware authoring descriptor shared by Studio and MCP. */
export declare const HEROES_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 1;
    moduleId: "heroes";
    supportedModuleSchemaVersions: readonly [1];
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
    limits: Readonly<{
        definitions: 32;
        idUtf8Bytes: 128;
        labelUtf8Bytes: 128;
    }>;
    runtimeSnapshot: Readonly<{
        path: "snapshot.heroes";
        schemaVersion: 1;
        optionalUnlessActive: true;
        unitFields: readonly ["id", "definitionId", "label", "coord"];
    }>;
}>;
export declare class HeroesProfileValidationError extends Error {
    readonly fieldPath: string;
    constructor(fieldPath: string, message: string);
}
/** Normalize the closed structural shape. The selected-definition reference is semantic. */
export declare function normalizeHeroesProfileV1(input: unknown, root?: string): HeroesProfileV1;
/** Resolve a detached profile only when the mission genuinely selected supported heroes v1. */
export declare function resolveActiveHeroesMechanics(content: GameContentRegistry, missionId: string): ActiveHeroesMechanicsV1 | undefined;
