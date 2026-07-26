import { type ModifierSpec } from "../simulation/modifiers.js";
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
/** Closed authoring/runtime budgets for roguelite v2 artifacts and boss loot. */
export declare const ROGUELITE_ARTIFACT_LIMITS: Readonly<{
    definitions: 256;
    slotsPerTower: 8;
    totalSlots: 4096;
    modifiersPerArtifact: 8;
    totalArtifactModifiers: 1024;
    lootTables: 64;
    rollsPerTable: 8;
    entriesPerTable: 128;
    weight: 1000000;
    totalTableWeight: 4294967295;
    idUtf8Bytes: 128;
    labelUtf8Bytes: 256;
}>;
export declare const ROGUELITE_ARTIFACT_INVENTORY_LIMIT = 10000;
/** Closed authoring/runtime budgets for opt-in roguelite v3 wave draft. */
export declare const ROGUELITE_DRAFT_LIMITS: Readonly<{
    definitions: 256;
    pools: 32;
    entriesPerPool: 128;
    effectsPerCard: 4;
    totalEffects: 1024;
    offerSize: 3;
    selections: 10000;
    weight: 1000000;
    totalPoolWeight: 4294967295;
    idUtf8Bytes: 128;
    tagUtf8Bytes: 128;
    labelUtf8Bytes: 256;
}>;
export declare const ROGUELITE_DAMAGE_MODIFIER_RESERVE: Readonly<{
    towerUpgrade: 0;
    meta: 1;
    spatial: 2;
    temporary: 0;
    total: 3;
}>;
/** Capability-aware descriptor shared by validation, Studio, and MCP. */
export declare const ROGUELITE_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 4;
    moduleId: "roguelite";
    supportedModuleSchemaVersions: readonly [1, 2, 3, 4];
    profile: Readonly<{
        requiredFields: readonly ["synergies"];
        optionalFields: readonly ["artifacts", "draft", "campaign"];
        additionalProperties: false;
    }>;
    profileVersions: Readonly<{
        1: Readonly<{
            requiredFields: readonly ["synergies"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
        2: Readonly<{
            requiredFields: readonly ["synergies", "artifacts"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
        3: Readonly<{
            requiredFields: readonly ["synergies"];
            optionalFields: readonly ["artifacts", "draft"];
            additionalProperties: false;
        }>;
        4: Readonly<{
            requiredFields: readonly ["synergies"];
            optionalFields: readonly ["artifacts", "draft", "campaign"];
            additionalProperties: false;
        }>;
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
    artifacts: Readonly<{
        requiredFields: readonly ["definitions", "towerSlots", "bossLootTables"];
        optionalFields: readonly [];
        additionalProperties: false;
        definition: Readonly<{
            requiredFields: readonly ["label", "slotType", "modifiers"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
        towerSlot: Readonly<{
            requiredFields: readonly ["slotId", "slotType"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
        lootTable: Readonly<{
            requiredFields: readonly ["rolls", "entries"];
            optionalFields: readonly ["noDropWeight"];
            additionalProperties: false;
        }>;
        lootEntry: Readonly<{
            requiredFields: readonly ["artifactId", "weight"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
    }>;
    draft: Readonly<{
        requiredFields: readonly ["definitions", "pools", "defaultPoolId"];
        optionalFields: readonly [];
        additionalProperties: false;
        definition: Readonly<{
            requiredFields: readonly ["label", "effects"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
        effect: Readonly<{
            requiredFields: readonly ["kind", "scope", "modifier"];
            optionalFields: readonly [];
            additionalProperties: false;
            kinds: readonly ["modifier"];
        }>;
        scope: Readonly<{
            kinds: readonly ["all_towers", "tower_type", "tower_tag"];
        }>;
        pool: Readonly<{
            requiredFields: readonly ["entries"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
        poolEntry: Readonly<{
            requiredFields: readonly ["cardId", "weight"];
            optionalFields: readonly [];
            additionalProperties: false;
        }>;
        offerSize: 3;
        sampling: "weighted_without_replacement";
    }>;
    campaign: Readonly<{
        requiredFields: readonly ["schemaVersion"];
        optionalFields: readonly [];
        additionalProperties: false;
        supportedSchemaVersions: readonly [1];
        graph: Readonly<{
            schemaVersion: 1;
            root: Readonly<{
                requiredFields: readonly ["schemaVersion", "rogueliteProfileId", "entryNodeIds", "nodes"];
                optionalFields: readonly [];
                additionalProperties: false;
            }>;
            nodeVariants: Readonly<{
                battle: Readonly<{
                    types: readonly ["battle", "elite", "boss"];
                    requiredFields: readonly ["id", "type", "missionId", "regionId", "x", "y", "difficulty", "nextNodeIds"];
                    optionalFields: readonly [];
                    additionalProperties: false;
                }>;
                structural: Readonly<{
                    types: readonly ["merchant", "event"];
                    requiredFields: readonly ["id", "type", "label", "regionId", "x", "y", "difficulty", "nextNodeIds"];
                    optionalFields: readonly [];
                    additionalProperties: false;
                }>;
            }>;
        }>;
    }>;
    limits: Readonly<{
        synergies: Readonly<{
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
        artifacts: Readonly<{
            definitions: 256;
            slotsPerTower: 8;
            totalSlots: 4096;
            modifiersPerArtifact: 8;
            totalArtifactModifiers: 1024;
            lootTables: 64;
            rollsPerTable: 8;
            entriesPerTable: 128;
            weight: 1000000;
            totalTableWeight: 4294967295;
            idUtf8Bytes: 128;
            labelUtf8Bytes: 256;
        }>;
        draft: Readonly<{
            definitions: 256;
            pools: 32;
            entriesPerPool: 128;
            effectsPerCard: 4;
            totalEffects: 1024;
            offerSize: 3;
            selections: 10000;
            weight: 1000000;
            totalPoolWeight: 4294967295;
            idUtf8Bytes: 128;
            tagUtf8Bytes: 128;
            labelUtf8Bytes: 256;
        }>;
        damageResolution: Readonly<{
            maximum: 64;
            reserved: Readonly<{
                towerUpgrade: 0;
                meta: 1;
                spatial: 2;
                temporary: 0;
                total: 3;
            }>;
        }>;
    }>;
    runtimeSnapshot: Readonly<{
        path: "snapshot.roguelite";
        supportedSchemaVersions: readonly [1, 2, 3, 4];
        optionalUnlessActive: true;
        fieldsByVersion: Readonly<{
            1: readonly ["schemaVersion", "synergies"];
            2: readonly ["schemaVersion", "synergies", "artifacts"];
            3: readonly ["schemaVersion", "synergies", "artifacts"];
            4: readonly ["schemaVersion", "synergies", "draft"];
        }>;
        optionalFieldsByVersion: Readonly<{
            4: readonly ["artifacts"];
        }>;
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
export interface ArtifactDefinitionV2 {
    readonly label: string;
    readonly slotType: string;
    readonly modifiers: readonly SynergyModifierV1[];
}
export interface ArtifactTowerSlotV2 {
    readonly slotId: string;
    readonly slotType: string;
}
export interface ArtifactLootEntryV2 {
    readonly artifactId: string;
    readonly weight: number;
}
export interface ArtifactBossLootTableV2 {
    readonly rolls: number;
    readonly noDropWeight?: number;
    readonly entries: readonly ArtifactLootEntryV2[];
}
export interface RogueliteArtifactsDefinitionV2 {
    readonly definitions: Readonly<Record<string, ArtifactDefinitionV2>>;
    readonly towerSlots: Readonly<Record<string, readonly ArtifactTowerSlotV2[]>>;
    readonly bossLootTables: Readonly<Record<string, ArtifactBossLootTableV2>>;
}
export interface RogueliteMechanicsProfileV2 extends RogueliteMechanicsProfileV1 {
    readonly artifacts: RogueliteArtifactsDefinitionV2;
}
export type DraftScopeV3 = {
    readonly kind: "all_towers";
} | {
    readonly kind: "tower_type";
    readonly towerTypeId: string;
} | {
    readonly kind: "tower_tag";
    readonly tag: string;
};
export interface DraftModifierEffectV3 {
    readonly kind: "modifier";
    readonly scope: DraftScopeV3;
    readonly modifier: SynergyModifierV1;
}
export interface DraftCardDefinitionV3 {
    readonly label: string;
    readonly effects: readonly DraftModifierEffectV3[];
}
export interface DraftPoolEntryV3 {
    readonly cardId: string;
    readonly weight: number;
}
export interface DraftPoolV3 {
    readonly entries: readonly DraftPoolEntryV3[];
}
export interface RogueliteDraftDefinitionV3 {
    readonly definitions: Readonly<Record<string, DraftCardDefinitionV3>>;
    readonly pools: Readonly<Record<string, DraftPoolV3>>;
    readonly defaultPoolId: string;
}
export interface RogueliteMechanicsProfileV3 extends RogueliteMechanicsProfileV1 {
    readonly artifacts?: RogueliteArtifactsDefinitionV2;
    readonly draft?: RogueliteDraftDefinitionV3;
}
export interface RogueliteCampaignMarkerV1 {
    readonly schemaVersion: 1;
}
export interface RogueliteMechanicsProfileV4 extends RogueliteMechanicsProfileV3 {
    readonly campaign?: RogueliteCampaignMarkerV1;
}
export interface ActiveRogueliteMechanicsV1 extends RogueliteMechanicsProfileV1 {
    readonly schemaVersion: 1;
    readonly profileId: string;
    readonly towerTagsByTypeId: Readonly<Record<string, readonly string[]>>;
    readonly artifacts?: undefined;
    readonly draft?: undefined;
}
export interface ActiveRogueliteMechanicsV2 extends RogueliteMechanicsProfileV2 {
    readonly schemaVersion: 2;
    readonly profileId: string;
    readonly towerTagsByTypeId: Readonly<Record<string, readonly string[]>>;
    readonly draft?: undefined;
}
export interface ActiveRogueliteMechanicsV3 extends RogueliteMechanicsProfileV3 {
    readonly schemaVersion: 3;
    readonly profileId: string;
    readonly towerTagsByTypeId: Readonly<Record<string, readonly string[]>>;
}
export interface ActiveRogueliteMechanicsV4 extends RogueliteMechanicsProfileV4 {
    readonly schemaVersion: 4;
    readonly profileId: string;
    readonly towerTagsByTypeId: Readonly<Record<string, readonly string[]>>;
}
export type ActiveRogueliteMechanics = ActiveRogueliteMechanicsV1 | ActiveRogueliteMechanicsV2 | ActiveRogueliteMechanicsV3 | ActiveRogueliteMechanicsV4;
export declare function rogueliteSynergyWorstCaseModifierCount(synergies: Readonly<Record<string, SynergyDefinitionV1>>): number;
export declare function assertRogueliteV2ModifierBudget(profile: RogueliteMechanicsProfileV2): void;
/** Guard the shared resolver against the worst authored v3 run stack for one mission. */
export declare function assertRogueliteV3ModifierBudget(profile: RogueliteMechanicsProfileV3, content: GameContentRegistry, missionId: string): void;
export declare class RogueliteProfileValidationError extends Error {
    readonly fieldPath: string;
    constructor(fieldPath: string, message: string);
}
/** Validate and normalize one optional tower tag list. */
export declare function normalizeTowerTagsV1(value: unknown, path?: string): readonly string[];
/** Validate and detach an exact closed roguelite v1 profile. */
export declare function normalizeRogueliteProfileV1(value: unknown): RogueliteMechanicsProfileV1;
/** Validate and detach the exact closed artifact domain nested in a roguelite v2 profile. */
export declare function normalizeRogueliteArtifactsV2(value: unknown): RogueliteArtifactsDefinitionV2;
/** Validate and detach an exact closed roguelite v2 profile. */
export declare function normalizeRogueliteProfileV2(value: unknown): RogueliteMechanicsProfileV2;
/** Validate and detach the exact closed wave-draft domain nested in roguelite v3. */
export declare function normalizeRogueliteDraftV3(value: unknown): RogueliteDraftDefinitionV3;
/** Validate and detach an exact closed roguelite v3 profile. */
export declare function normalizeRogueliteProfileV3(value: unknown): RogueliteMechanicsProfileV3;
/** Validate and detach the exact closed roguelite v4 profile and its inert campaign marker. */
export declare function normalizeRogueliteProfileV4(value: unknown): RogueliteMechanicsProfileV4;
/** Resolve a detached profile only when the mission genuinely activates a supported roguelite version. */
export declare function resolveActiveRogueliteMechanics(content: GameContentRegistry, missionId: string): ActiveRogueliteMechanics | undefined;
export interface DerivedRogueliteSynergyStateV1 {
    readonly snapshot: RogueliteSnapshotV1;
    readonly damageModifiers: readonly ModifierSpec[];
}
/** Derive runtime state from authoritative placed towers; nothing is checkpointed separately. */
export declare function deriveRogueliteSynergyStateV1(active: ActiveRogueliteMechanics, towers: readonly TowerState[]): DerivedRogueliteSynergyStateV1;
