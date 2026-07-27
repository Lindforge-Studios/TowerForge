import type { GameContentRegistry } from "./registry.js";
import type { DisplacementEffectV1 } from "../simulation/types.js";
/** Closed structural and runtime budgets for opt-in tile displacement physics v1. */
export declare const PHYSICS_LIMITS: Readonly<{
    displacementDistance: 8;
    displacementEffectsPerSource: 8;
    displacementTargetsPerActivation: 64;
    immuneEnemyTypeIds: 4096;
    fallHazardTerrainTags: 64;
    idOrTagUtf8Bytes: 128;
    stepsPerEffectApplication: 8;
    stepAttemptsPerActivation: 4096;
    stepAttemptsPerTick: 32768;
}>;
/** Capability-aware authoring descriptor shared by Studio and MCP surfaces. */
export declare const PHYSICS_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 1;
    moduleId: "physics";
    supportedModuleSchemaVersions: readonly [1];
    profile: Readonly<{
        requiredFields: readonly [];
        optionalFields: readonly ["displacementImmuneEnemyTypeIds", "fallImmuneEnemyTypeIds", "fallHazardTerrainTags"];
        additionalProperties: false;
    }>;
    effect: Readonly<{
        kind: "displacement";
        requiredFields: readonly ["kind", "mode", "distance", "stopAtBlocker"];
        optionalFields: readonly [];
        additionalProperties: false;
        kinds: readonly ["displacement"];
        modes: readonly ["push", "pull"];
    }>;
    displacementEffect: Readonly<{
        kind: "displacement";
        requiredFields: readonly ["kind", "mode", "distance", "stopAtBlocker"];
        optionalFields: readonly [];
        additionalProperties: false;
        kinds: readonly ["displacement"];
        modes: readonly ["push", "pull"];
    }>;
    limits: Readonly<{
        displacementDistance: 8;
        displacementEffectsPerSource: 8;
        displacementTargetsPerActivation: 64;
        immuneEnemyTypeIds: 4096;
        fallHazardTerrainTags: 64;
        idOrTagUtf8Bytes: 128;
        stepsPerEffectApplication: 8;
        stepAttemptsPerActivation: 4096;
        stepAttemptsPerTick: 32768;
    }>;
    runtimeSnapshot: null;
}>;
export interface PhysicsProfileV1 {
    readonly displacementImmuneEnemyTypeIds?: readonly string[];
    readonly fallImmuneEnemyTypeIds?: readonly string[];
    readonly fallHazardTerrainTags?: readonly string[];
}
export interface ActivePhysicsMechanicsV1 extends PhysicsProfileV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
    readonly displacementImmuneEnemyTypeIds: readonly string[];
    readonly fallImmuneEnemyTypeIds: readonly string[];
    readonly fallHazardTerrainTags: readonly string[];
}
export type OwnDataEffectInspection = Readonly<{
    ok: false;
}> | Readonly<{
    ok: true;
    kind: unknown;
    record: Readonly<Record<string, unknown>>;
}>;
/**
 * Inspect an authored effect without executing property accessors. Only a plain, symbol-free
 * object whose enumerable own properties are all data descriptors is admitted. The returned
 * record is a detached frozen copy, so validation and runtime dispatch share one fail-closed
 * trust boundary before inspecting `kind` or any effect field.
 */
export declare function inspectOwnDataEffect(value: unknown): OwnDataEffectInspection;
/** Parse the exact closed DisplacementEffectV1 shape into detached immutable data. */
export declare function parseDisplacementEffectV1(value: unknown): Readonly<DisplacementEffectV1> | undefined;
/** Resolve a detached, frozen profile only when the mission capability is genuinely active. */
export declare function resolveActivePhysicsMechanics(content: GameContentRegistry, missionId: string): ActivePhysicsMechanicsV1 | undefined;
