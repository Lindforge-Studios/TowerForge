import { type TowerAttackKind } from "../simulation/types.js";
export { NAVIGATION_MECHANICS_SCHEMA } from "./navigation-mechanics.js";
export { ELEVATION_MECHANICS_SCHEMA } from "./elevation-mechanics.js";
export { TERRAFORMING_MECHANICS_SCHEMA } from "./terraforming-mechanics.js";
export { ROGUELITE_MECHANICS_SCHEMA } from "./roguelite-mechanics.js";
export { HEROES_MECHANICS_SCHEMA } from "./heroes-mechanics.js";
export { LOGISTICS_MECHANICS_SCHEMA } from "./logistics-mechanics.js";
/**
 * A machine-readable description of the content schema's closed sets and per-shape field
 * constraints — the single source of truth for what `validateGameContentRegistry` (validate.ts)
 * actually enforces. Consumed by:
 *   - validate.ts, for the two closed-set enumerations (attack kinds, ability ids) instead of a
 *     second hardcoded copy of the same facts.
 *   - the MCP `describe_schema` tool (packages/mcp/tools.mjs), so an AI agent can learn the exact
 *     shape of a tower/ability BEFORE authoring one, instead of guessing and iterating against
 *     validate_project errors.
 *
 * Kept honest by schema-descriptor.test.ts, which builds a minimal-valid fixture per attack kind
 * and ability from exactly these `requiredFields` and asserts it passes validateGameContentRegistry
 * with zero errors — and that omitting any one required field produces one. If validate.ts's
 * per-kind checks ever drift from this file, that test fails.
 *
 * Scope: this file documents the RUNTIME-ENFORCED contract (what validate.ts actually checks),
 * not the full TypeScript field shape — non-enforced-but-typed fields (e.g. pulse's `dotDuration`,
 * sniper's `rangeByLevel`) are listed under `otherFields` for documentation only.
 */
export type FieldConstraint = {
    name: string;
    kind: "number";
    positive?: boolean;
    lessThanOne?: boolean;
} | {
    name: string;
    kind: "numberArray";
    exactLength?: number;
} | {
    name: string;
    kind: "towerIdRefArray";
} | {
    name: string;
    kind: "resourceBagArray";
} | {
    name: string;
    kind: "pipelineDelivery";
} | {
    name: string;
    kind: "towerEffectArray";
} | {
    name: string;
    kind: "string";
};
export interface AttackKindDescriptor {
    kind: TowerAttackKind;
    /** Fields validateGameContentRegistry actively enforces for this kind. */
    requiredFields: FieldConstraint[];
    /** Fields the TS shape carries that are NOT independently validated (documentation only). */
    otherFields: string[];
}
export declare const TARGET_MODE_SCHEMA: Readonly<{
    selectable: ("first" | "last" | "closest" | "furthest" | "strongest" | "weakest")[];
    legacyAliases: {
        fastest_ahead: string;
        largest_hp: string;
    };
    supportedAttackKinds: readonly ["single", "sniper", "antiair", "splash", "pipeline"];
    tieBreak: "enemy id ascending";
}>;
/**
 * Public, machine-readable R0B contract for the bounded modifier pipeline.
 * Runtime allowlists and the per-resolution budget are imported directly from
 * simulation/modifiers.ts so authoring discovery cannot drift from execution.
 */
export declare const MODIFIER_SPEC_SCHEMA: Readonly<{
    schemaVersion: 1;
    requiredFields: readonly ["id", "target", "stage", "operation", "value"];
    targets: "damage"[];
    stages: ("tower_upgrade" | "meta" | "run" | "spatial" | "temporary")[];
    operations: ("flat" | "multiplier" | "additive_ratio")[];
    maxPerResolution: 64;
    pipelineOrder: readonly ["base", "tower_upgrade", "meta", "run", "spatial", "temporary"];
    withinStageOrder: readonly ["flat", "additive_ratio", "multiplier", "id_binary_ascending"];
}>;
/**
 * Public damage envelope. The pure resolver applies authored armor before per-entity
 * resistances; shields and HP remain at the entity mutation boundary.
 */
export declare const DAMAGE_PACKET_SCHEMA: Readonly<{
    schemaVersion: 1;
    requiredFields: readonly ["amount", "source", "target"];
    optionalFields: readonly ["damageType", "tags", "modifiers"];
    sourceKinds: readonly ["tower", "ability", "tower_script", "status", "enemy", "leak", "reaction"];
    targetKinds: readonly ["enemy", "tower", "hero", "core"];
    tags: ("reaction" | "area" | "over_time" | "armor_piercing")[];
    pipelineOrder: readonly ["modifiers", "marks", "armor_matrix", "entity_resistance", "legacy_pierce_only", "shield", "entity_hp", "reactions"];
}>;
/**
 * Public R1 combat-module authoring contract. The compatibility fields at the end preserve the
 * smaller R1.2a descriptor while the structured sections give Studio/MCP enough information to
 * build an exact, capability-aware shield editor without duplicating engine rules.
 */
export declare const COMBAT_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 3;
    moduleId: "combat";
    supportedModuleSchemaVersions: readonly [1, 2, 3];
    profile: {
        additionalProperties: boolean;
        optionalFields: readonly ["shields", "damageTypes", "armorTypes", "armorAssignments", "marks"];
        shields: {
            additionalProperties: boolean;
            targetKinds: readonly ["enemies", "towers"];
            enemies: string;
            towers: string;
        };
    };
    shieldDefinition: {
        requiredFields: readonly ["capacity"];
        optionalFields: readonly ["regeneration"];
        additionalProperties: boolean;
    };
    regeneration: {
        requiredFields: readonly ["ratePerUnit"];
        optionalFields: readonly ["delayAfterDamage"];
        additionalProperties: boolean;
    };
    semanticBounds: {
        capacity: {
            exclusiveMinimum: number;
            maximum: 1000000000000;
        };
        ratePerUnit: {
            exclusiveMinimum: number;
            maximum: 1000000000;
        };
        delayAfterDamage: {
            minimum: number;
            maximum: 1000000000;
        };
    };
    runtimeSnapshot: {
        path: string;
        optionalUnlessActive: boolean;
        schemaVersion: number;
        legacyShieldOnlySchemaVersion: number;
        fields: readonly ["schemaVersion", "shields", "marks"];
        targetStateFields: readonly ["current", "capacity", "regenerationDelayRemaining"];
        keysAreRuntimeInstanceIds: boolean;
    };
    events: {
        enemyShieldChanged: string[];
        towerShieldChanged: string[];
        causes: readonly ["damage", "regeneration", "script"];
    };
    towerScript: {
        minimumSchemaVersion: number;
        events: readonly ["enemyShieldChanged", "towerShieldChanged"];
        actions: readonly ["restoreEnemyShield", "restoreTowerShield"];
        enemyTargets: ("self" | "eventEnemy" | "allEnemies")[];
        towerTargets: ("self" | "eventTower" | "allTowers")[];
        amount: string;
    };
    damageTypes: {
        minimumModuleSchemaVersion: number;
        shape: string;
        definition: {
            requiredFields: readonly ["label"];
            additionalProperties: boolean;
        };
        fallbackDamageTypeId: string;
    };
    armorTypes: {
        minimumModuleSchemaVersion: number;
        shape: string;
        definition: {
            requiredFields: readonly ["label", "multipliers"];
            optionalFields: readonly ["defaultMultiplier"];
            additionalProperties: boolean;
            multipliers: string;
        };
    };
    armorAssignments: {
        minimumModuleSchemaVersion: number;
        additionalProperties: boolean;
        targetKinds: readonly ["enemies"];
        enemies: string;
    };
    armorMatrix: {
        limits: Readonly<{
            damageTypes: 256;
            armorTypes: 256;
            assignments: 4096;
            matrixEntries: 16384;
            multiplier: 1000000;
            labelLength: 128;
        }>;
        order: string;
        armorPiercingCompatibility: string;
    };
    marks: {
        minimumModuleSchemaVersion: number;
        additionalProperties: boolean;
        limits: Readonly<{
            definitions: 256;
            sourceBindings: 4096;
            runtimeApplications: 16384;
            applicationsPerSource: 16;
            filterDamageTypes: 256;
            labelLength: 128;
            duration: 1000000000;
            maxStacks: 256;
            multiplier: 1000000;
        }>;
        definitions: string;
        definitionRequiredFields: readonly ["label", "duration", "maxStacks", "multiplier", "consumePolicy"];
        definitionOptionalFields: readonly ["damageTypes"];
        consumePolicies: readonly ["retain", "consume_one", "consume_all"];
        bindingKinds: readonly ["towers", "abilities", "towerScripts"];
        applicationRequiredFields: readonly ["markId"];
        applicationOptionalFields: readonly ["stacks"];
    };
    profileFields: readonly ["shields", "damageTypes", "armorTypes", "armorAssignments", "marks"];
    targetKinds: readonly ["enemies", "towers"];
    definitionFields: readonly ["capacity", "regeneration"];
    regenerationFields: readonly ["ratePerUnit", "delayAfterDamage"];
    limits: Readonly<{
        capacity: 1000000000000;
        ratePerUnit: 1000000000;
        delayAfterDamage: 1000000000;
    }>;
    runtimeStateFields: readonly ["current", "capacity", "regenerationDelayRemaining"];
    changeCauses: readonly ["damage", "regeneration", "script"];
}>;
/** @deprecated Use COMBAT_MECHANICS_SCHEMA. */
export declare const COMBAT_SHIELD_SCHEMA: Readonly<{
    schemaVersion: 3;
    moduleId: "combat";
    supportedModuleSchemaVersions: readonly [1, 2, 3];
    profile: {
        additionalProperties: boolean;
        optionalFields: readonly ["shields", "damageTypes", "armorTypes", "armorAssignments", "marks"];
        shields: {
            additionalProperties: boolean;
            targetKinds: readonly ["enemies", "towers"];
            enemies: string;
            towers: string;
        };
    };
    shieldDefinition: {
        requiredFields: readonly ["capacity"];
        optionalFields: readonly ["regeneration"];
        additionalProperties: boolean;
    };
    regeneration: {
        requiredFields: readonly ["ratePerUnit"];
        optionalFields: readonly ["delayAfterDamage"];
        additionalProperties: boolean;
    };
    semanticBounds: {
        capacity: {
            exclusiveMinimum: number;
            maximum: 1000000000000;
        };
        ratePerUnit: {
            exclusiveMinimum: number;
            maximum: 1000000000;
        };
        delayAfterDamage: {
            minimum: number;
            maximum: 1000000000;
        };
    };
    runtimeSnapshot: {
        path: string;
        optionalUnlessActive: boolean;
        schemaVersion: number;
        legacyShieldOnlySchemaVersion: number;
        fields: readonly ["schemaVersion", "shields", "marks"];
        targetStateFields: readonly ["current", "capacity", "regenerationDelayRemaining"];
        keysAreRuntimeInstanceIds: boolean;
    };
    events: {
        enemyShieldChanged: string[];
        towerShieldChanged: string[];
        causes: readonly ["damage", "regeneration", "script"];
    };
    towerScript: {
        minimumSchemaVersion: number;
        events: readonly ["enemyShieldChanged", "towerShieldChanged"];
        actions: readonly ["restoreEnemyShield", "restoreTowerShield"];
        enemyTargets: ("self" | "eventEnemy" | "allEnemies")[];
        towerTargets: ("self" | "eventTower" | "allTowers")[];
        amount: string;
    };
    damageTypes: {
        minimumModuleSchemaVersion: number;
        shape: string;
        definition: {
            requiredFields: readonly ["label"];
            additionalProperties: boolean;
        };
        fallbackDamageTypeId: string;
    };
    armorTypes: {
        minimumModuleSchemaVersion: number;
        shape: string;
        definition: {
            requiredFields: readonly ["label", "multipliers"];
            optionalFields: readonly ["defaultMultiplier"];
            additionalProperties: boolean;
            multipliers: string;
        };
    };
    armorAssignments: {
        minimumModuleSchemaVersion: number;
        additionalProperties: boolean;
        targetKinds: readonly ["enemies"];
        enemies: string;
    };
    armorMatrix: {
        limits: Readonly<{
            damageTypes: 256;
            armorTypes: 256;
            assignments: 4096;
            matrixEntries: 16384;
            multiplier: 1000000;
            labelLength: 128;
        }>;
        order: string;
        armorPiercingCompatibility: string;
    };
    marks: {
        minimumModuleSchemaVersion: number;
        additionalProperties: boolean;
        limits: Readonly<{
            definitions: 256;
            sourceBindings: 4096;
            runtimeApplications: 16384;
            applicationsPerSource: 16;
            filterDamageTypes: 256;
            labelLength: 128;
            duration: 1000000000;
            maxStacks: 256;
            multiplier: 1000000;
        }>;
        definitions: string;
        definitionRequiredFields: readonly ["label", "duration", "maxStacks", "multiplier", "consumePolicy"];
        definitionOptionalFields: readonly ["damageTypes"];
        consumePolicies: readonly ["retain", "consume_one", "consume_all"];
        bindingKinds: readonly ["towers", "abilities", "towerScripts"];
        applicationRequiredFields: readonly ["markId"];
        applicationOptionalFields: readonly ["stacks"];
    };
    profileFields: readonly ["shields", "damageTypes", "armorTypes", "armorAssignments", "marks"];
    targetKinds: readonly ["enemies", "towers"];
    definitionFields: readonly ["capacity", "regeneration"];
    regenerationFields: readonly ["ratePerUnit", "delayAfterDamage"];
    limits: Readonly<{
        capacity: 1000000000000;
        ratePerUnit: 1000000000;
        delayAfterDamage: 1000000000;
    }>;
    runtimeStateFields: readonly ["current", "capacity", "regenerationDelayRemaining"];
    changeCauses: readonly ["damage", "regeneration", "script"];
}>;
/** Public closed authoring contract for the independently versioned reactions v1 module. */
export declare const REACTIONS_MECHANICS_SCHEMA: Readonly<{
    schemaVersion: 1;
    moduleId: "reactions";
    supportedModuleSchemaVersions: readonly [1];
    dependency: {
        moduleId: string;
        supportedModuleSchemaVersions: readonly [2, 3];
    };
    profile: {
        additionalProperties: boolean;
        requiredFields: readonly ["reactions"];
        optionalFields: readonly ["exposures"];
    };
    limits: Readonly<{
        exposureDefinitions: 256;
        damageTypeApplicationBindings: 256;
        applicationsPerDamageType: 16;
        totalExposureApplications: 4096;
        reactionDefinitions: 256;
        requirementsPerReaction: 8;
        effectsPerReaction: 8;
        totalReactionEffects: 2048;
        runtimeExposureApplications: 16384;
        labelLength: 128;
        idTagUtf8Bytes: 128;
        duration: 1000000000;
        maxStacks: 256;
        flatDamage: 1000000000000;
        sourceMultiplier: 1000000;
        radius: 64;
        targetsPerEffect: 64;
        maxDepth: 4;
        secondaryPacketsPerRoot: 256;
    }>;
    runtimeSnapshot: {
        path: string;
        schemaVersion: number;
        optionalUnlessActive: boolean;
    };
    towerScript: {
        minimumSchemaVersion: number;
    };
}>;
export declare const ATTACK_KIND_SCHEMA: Record<TowerAttackKind, AttackKindDescriptor>;
export declare const TOWER_PIPELINE_SCHEMA: Readonly<{
    semantics: "targeting selects primary enemies; delivery expands them; effects run in declaration order";
    deliveryKinds: readonly ["single", "multi", "cone", "area", "chain", "aura"];
    targeting: {
        classes: string[];
        mode: readonly ["first", "last", "closest", "furthest", "strongest", "weakest", "fastest_ahead", "largest_hp"];
        maxTargets: string;
    };
    delivery: {
        single: {};
        multi: {};
        cone: {
            angleDegrees: string;
        };
        area: {
            radius: string;
            secondaryMultiplier: string;
        };
        chain: {
            maxJumps: string;
            jumpRadius: string;
            damageFalloff: string;
        };
        aura: {};
    };
    effects: {
        damage: {
            amount: string;
            amountByLevel: string;
            damageType: string;
            armorPiercing: string;
        };
        status: {
            status: string;
        };
        resource: {
            resources: string;
        };
        displacement: {
            kind: string;
            mode: string;
            distance: string;
            stopAtBlocker: string;
        };
    };
}>;
export declare const ATTACK_KIND_IDS: TowerAttackKind[];
/**
 * The three engine-implemented ability presets — a closed union distinct from the now-open
 * `MissionAbilityId` (any string, so an author can declare a custom ability via `effects`; see
 * types.ts). Indexing ABILITY_SCHEMA/PRESET_ABILITY_IDS is exhaustively safe against this type.
 */
export type PresetAbilityId = "path_water" | "strike" | "freeze";
export interface AbilityDescriptor {
    id: PresetAbilityId;
    requiredFields: FieldConstraint[];
    otherFields: string[];
}
export declare const ABILITY_SCHEMA: Record<PresetAbilityId, AbilityDescriptor>;
export declare const ABILITY_IDS: PresetAbilityId[];
/**
 * The effect vocabulary any ability (preset or custom) can compose via `effects: AbilityEffect[]`.
 * A custom ability declares one or more of these — no engine code needed. `status` reuses the
 * exact same StatusEffectSpec a tower's `attack.statusOnHit` carries (stun/slow/poison).
 */
export declare const ABILITY_EFFECT_SCHEMA: {
    damage: {
        requiredFields: {
            name: string;
            kind: "number";
            positive: true;
        }[];
    };
    status: {
        note: string;
    };
    displacement: {
        kind: string;
        mode: string;
        distance: string;
        stopAtBlocker: string;
    };
};
/** The rule enforced for every currency-typed resource bag (tower cost, enemy reward, etc.). */
export declare const CURRENCY_RULES: {
    idPattern: string;
    primaryRequired: "coins";
    note: string;
};
export declare const DIFFICULTY_SCHEMA: Readonly<{
    semantics: "A selected difficulty modifies launch-time inputs; missions are not cloned and the engine owns no persistence.";
    requiredFields: string[];
    multiplierFields: {
        enemyHpMultiplier: string;
        enemySpeedMultiplier: string;
        enemyRewardMultiplier: string;
        coreDamageMultiplier: string;
        startingResourceMultiplier: string;
        coreHpMultiplier: string;
    };
    defaultRule: "defaultDifficultyId must reference one difficulties[] entry";
    example: {
        defaultDifficultyId: string;
        difficulties: ({
            id: string;
            label: string;
            enemyHpMultiplier?: undefined;
            enemySpeedMultiplier?: undefined;
            startingResourceMultiplier?: undefined;
        } | {
            id: string;
            label: string;
            enemyHpMultiplier: number;
            enemySpeedMultiplier: number;
            startingResourceMultiplier: number;
        })[];
    };
}>;
export declare const META_PROGRESSION_SCHEMA: Readonly<{
    semantics: "The engine consumes selected upgrade levels; generated players own the versioned local profile and rewards.";
    rootFields: {
        currencies: string;
        upgrades: string;
        rewardsByMission: string;
    };
    currency: {
        requiredFields: string[];
        idPattern: string;
        optionalFields: string[];
    };
    upgrade: {
        requiredFields: string[];
        rules: string[];
    };
    effects: {
        towerDamage: {
            multiplierPerLevel: string;
        };
        towerFireRate: {
            multiplierPerLevel: string;
        };
        startingResource: {
            resourceId: string;
            amountPerLevel: string;
        };
        coreHp: {
            amountPerLevel: string;
        };
    };
    missionRewards: {
        firstClear: string;
        repeatClear: string;
        perStar: string;
    };
    example: {
        currencies: {
            id: string;
            label: string;
        }[];
        upgrades: {
            reinforced_core: {
                id: string;
                label: string;
                maxLevel: number;
                costs: {
                    forge_shards: number;
                }[];
                effects: {
                    kind: string;
                    amountPerLevel: number;
                }[];
            };
        };
        rewardsByMission: {
            tutorial_01: {
                firstClear: {
                    forge_shards: number;
                };
                perStar: {
                    forge_shards: number;
                };
            };
        };
    };
}>;
/** Mission-local economy fields shared by validation, Studio authoring, and agent schema discovery. */
export declare const MISSION_ECONOMY_SCHEMA: {
    readonly perWaveStart: {
        readonly kind: "resourceBag";
        readonly note: "Granted whenever a wave starts.";
    };
    readonly perWaveClear: {
        readonly kind: "resourceBag";
        readonly note: "Granted once for each cleared wave.";
    };
    readonly passivePerTimeUnit: {
        readonly kind: "resourceBag";
        readonly note: "Continuous income after the first wave starts.";
    };
    readonly interestRate: {
        readonly kind: "number";
        readonly minimum: 0;
        readonly note: "Fraction of current resources granted on wave clear.";
    };
    readonly interestCap: {
        readonly kind: "resourceBag";
        readonly note: "Optional per-currency cap on one interest grant.";
    };
    readonly earlyStartBonusPerUnit: {
        readonly kind: "resourceBag";
        readonly note: "Multiplied by skipped prep time when starting early.";
    };
    readonly sellRefundRatio: {
        readonly kind: "number";
        readonly minimum: 0;
        readonly maximum: 1;
        readonly default: 0.7;
        readonly note: "Refund of placement + upgrade investment.";
    };
};
export declare const MISSION_OBJECTIVES_SCHEMA: {
    readonly semantics: "All victory objectives must complete. Any failure condition ends the mission. Core depletion always loses. Missing/empty victory defaults to clearWaves.";
    readonly victory: {
        readonly clearWaves: {
            readonly fields: readonly ["id", "label?"];
        };
        readonly surviveSeconds: {
            readonly fields: readonly ["id", "label?", "seconds>0"];
        };
        readonly killCount: {
            readonly fields: readonly ["id", "label?", "count>0", "enemyTypeId?"];
        };
        readonly accumulateResource: {
            readonly fields: readonly ["id", "label?", "resourceId", "amount>0"];
        };
    };
    readonly failure: {
        readonly maxLeaks: {
            readonly fields: readonly ["id", "label?", "maxLeaks>=0"];
        };
        readonly timeLimit: {
            readonly fields: readonly ["id", "label?", "seconds>0"];
        };
    };
    readonly stars: {
        readonly coreHpAtLeast: {
            readonly fields: readonly ["id", "label", "amount>=0"];
        };
        readonly maxLeaks: {
            readonly fields: readonly ["id", "label", "maxLeaks>=0"];
        };
        readonly timeAtMost: {
            readonly fields: readonly ["id", "label", "seconds>0"];
        };
        readonly resourceAtLeast: {
            readonly fields: readonly ["id", "label", "resourceId", "amount>0"];
        };
    };
};
