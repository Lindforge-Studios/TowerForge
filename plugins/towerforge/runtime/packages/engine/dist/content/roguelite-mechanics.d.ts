import type { ModifierSpec } from "../simulation/modifiers.js";
import type { RogueliteSnapshotV1, TowerState } from "../simulation/types.js";
import type { GameContentRegistry } from "./registry.js";
/** Closed authoring and runtime budgets for opt-in tower-tag synergies. */
export declare const ROGUELITE_SYNERGY_LIMITS: Readonly<{
    towerTypesWithTags: 4096;
    tagsPerTower: 16;
    totalTowerTagRefs: 16384;
    tagUtf8Bytes: 128;
    synergyDefinitions: 32;
    synergyIdUtf8Bytes: 128;
    labelUtf8Bytes: 256;
    tiersPerSynergy: 8;
    requiredCount: 65536;
    modifiersPerTier: 4;
    totalProfileModifiers: 32;
    flatAbsoluteValue: 1000000000000;
    additiveRatioMinimum: -1;
    additiveRatioMaximum: 1000;
    multiplierMinimum: 0;
    multiplierMaximum: 1000;
}>;
/** Capability-aware descriptor shared by validation, Studio, and MCP. */
export declare const ROGUELITE_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 1;
    moduleId: "roguelite";
    supportedModuleSchemaVersions: readonly [1];
    profile: Readonly<{
        requiredFields: readonly ["synergies"];
        optionalFields: readonly [];
        additionalProperties: false;
    }>;
    towerTags: Readonly<{
        field: "tags";
        optional: true;
        itemType: "string";
        uniqueItems: true;
    }>;
    synergy: Readonly<{
        requiredFields: readonly ["label", "tag", "tiers"];
        optionalFields: readonly ["tierMode"];
        additionalProperties: false;
        tierModes: readonly ["highest", "cumulative"];
    }>;
    tiers: Readonly<{
        requiredFields: readonly ["requiredCount", "modifiers"];
        optionalFields: readonly [];
        additionalProperties: false;
    }>;
    modifier: Readonly<{
        requiredFields: readonly ["target", "operation", "value"];
        optionalFields: readonly [];
        additionalProperties: false;
        targets: readonly ["damage"];
        operations: readonly ["flat", "additive_ratio", "multiplier"];
        stage: "run";
    }>;
    limits: Readonly<{
        towerTypesWithTags: 4096;
        tagsPerTower: 16;
        totalTowerTagRefs: 16384;
        tagUtf8Bytes: 128;
        synergyDefinitions: 32;
        synergyIdUtf8Bytes: 128;
        labelUtf8Bytes: 256;
        tiersPerSynergy: 8;
        requiredCount: 65536;
        modifiersPerTier: 4;
        totalProfileModifiers: 32;
        flatAbsoluteValue: 1000000000000;
        additiveRatioMinimum: -1;
        additiveRatioMaximum: 1000;
        multiplierMinimum: 0;
        multiplierMaximum: 1000;
    }>;
    runtimeSnapshot: Readonly<{
        path: "snapshot.roguelite";
        schemaVersion: 1;
        optionalUnlessActive: true;
        fields: readonly ["schemaVersion", "synergies"];
    }>;
}>;
export type SynergyTierMode = "highest" | "cumulative";
export type SynergyModifierOperationV1 = "flat" | "additive_ratio" | "multiplier";
export interface SynergyModifierV1 {
    readonly target: "damage";
    readonly operation: SynergyModifierOperationV1;
    readonly value: number;
}
export interface SynergyTierV1 {
    readonly requiredCount: number;
    readonly modifiers: readonly SynergyModifierV1[];
}
export interface SynergyDefinitionV1 {
    readonly label: string;
    readonly tag: string;
    readonly tierMode?: SynergyTierMode;
    readonly tiers: readonly SynergyTierV1[];
}
export interface RogueliteMechanicsProfileV1 {
    readonly synergies: Readonly<Record<string, SynergyDefinitionV1>>;
}
export interface ActiveRogueliteMechanicsV1 extends RogueliteMechanicsProfileV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
    readonly towerTagsByTypeId: Readonly<Record<string, readonly string[]>>;
}
export declare class RogueliteProfileValidationError extends Error {
    readonly fieldPath: string;
    constructor(fieldPath: string, message: string);
}
/** Validate and normalize one optional tower tag list. */
export declare function normalizeTowerTagsV1(value: unknown, path?: string): readonly string[];
/** Validate and detach an exact closed roguelite v1 profile. */
export declare function normalizeRogueliteProfileV1(value: unknown): RogueliteMechanicsProfileV1;
/** Resolve a detached profile only when the mission genuinely activates roguelite v1. */
export declare function resolveActiveRogueliteMechanics(content: GameContentRegistry, missionId: string): ActiveRogueliteMechanicsV1 | undefined;
export interface DerivedRogueliteSynergyStateV1 {
    readonly snapshot: RogueliteSnapshotV1;
    readonly damageModifiers: readonly ModifierSpec[];
}
/** Derive runtime state from authoritative placed towers; nothing is checkpointed separately. */
export declare function deriveRogueliteSynergyStateV1(active: ActiveRogueliteMechanicsV1, towers: readonly TowerState[]): DerivedRogueliteSynergyStateV1;
