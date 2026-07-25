import { TOWER_TARGET_MODES } from "../simulation/types.js";
import { MAX_MODIFIERS_PER_RESOLUTION, MODIFIER_OPERATION_ORDER, MODIFIER_STAGE_ORDER, MODIFIER_TARGETS } from "../simulation/modifiers.js";
import { DAMAGE_TAGS } from "../simulation/damage.js";
import { TOWER_SCRIPT_EVENT_FIELDS, TOWER_SCRIPT_TARGETS } from "../scripting/schema-descriptor.js";
import { ARMOR_MATRIX_LIMITS, MARK_LIMITS, REACTION_LIMITS, SHIELD_LIMITS } from "./mechanics.js";
export { NAVIGATION_MECHANICS_SCHEMA } from "./navigation-mechanics.js";
export { ELEVATION_MECHANICS_SCHEMA } from "./elevation-mechanics.js";
export { TERRAFORMING_MECHANICS_SCHEMA } from "./terraforming-mechanics.js";
export const TARGET_MODE_SCHEMA = Object.freeze({
    selectable: TOWER_TARGET_MODES.filter((mode) => mode !== "fastest_ahead" && mode !== "largest_hp"),
    legacyAliases: { fastest_ahead: "first (armored first)", largest_hp: "strongest" },
    supportedAttackKinds: ["single", "sniper", "antiair", "splash", "pipeline"],
    tieBreak: "enemy id ascending"
});
/**
 * Public, machine-readable R0B contract for the bounded modifier pipeline.
 * Runtime allowlists and the per-resolution budget are imported directly from
 * simulation/modifiers.ts so authoring discovery cannot drift from execution.
 */
export const MODIFIER_SPEC_SCHEMA = Object.freeze({
    schemaVersion: 1,
    requiredFields: ["id", "target", "stage", "operation", "value"],
    targets: [...MODIFIER_TARGETS],
    stages: [...MODIFIER_STAGE_ORDER],
    operations: [...MODIFIER_OPERATION_ORDER],
    maxPerResolution: MAX_MODIFIERS_PER_RESOLUTION,
    pipelineOrder: ["base", ...MODIFIER_STAGE_ORDER],
    withinStageOrder: [...MODIFIER_OPERATION_ORDER, "id_binary_ascending"]
});
/**
 * Public damage envelope. The pure resolver applies authored armor before per-entity
 * resistances; shields and HP remain at the entity mutation boundary.
 */
export const DAMAGE_PACKET_SCHEMA = Object.freeze({
    schemaVersion: 1,
    requiredFields: ["amount", "source", "target"],
    optionalFields: ["damageType", "tags", "modifiers"],
    sourceKinds: ["tower", "ability", "tower_script", "status", "enemy", "leak", "reaction"],
    targetKinds: ["enemy", "tower", "core"],
    tags: [...DAMAGE_TAGS],
    pipelineOrder: [
        "modifiers",
        "marks",
        "armor_matrix",
        "entity_resistance",
        "legacy_pierce_only",
        "shield",
        "entity_hp",
        "reactions"
    ]
});
/**
 * Public R1 combat-module authoring contract. The compatibility fields at the end preserve the
 * smaller R1.2a descriptor while the structured sections give Studio/MCP enough information to
 * build an exact, capability-aware shield editor without duplicating engine rules.
 */
export const COMBAT_MECHANICS_SCHEMA = Object.freeze({
    schemaVersion: 3,
    moduleId: "combat",
    supportedModuleSchemaVersions: [1, 2, 3],
    profile: {
        additionalProperties: false,
        optionalFields: ["shields", "damageTypes", "armorTypes", "armorAssignments", "marks"],
        shields: {
            additionalProperties: false,
            targetKinds: ["enemies", "towers"],
            enemies: "record keyed by existing enemy type id",
            towers: "record keyed by existing destructible tower type id"
        }
    },
    shieldDefinition: {
        requiredFields: ["capacity"],
        optionalFields: ["regeneration"],
        additionalProperties: false
    },
    regeneration: {
        requiredFields: ["ratePerUnit"],
        optionalFields: ["delayAfterDamage"],
        additionalProperties: false
    },
    semanticBounds: {
        capacity: { exclusiveMinimum: 0, maximum: SHIELD_LIMITS.capacity },
        ratePerUnit: { exclusiveMinimum: 0, maximum: SHIELD_LIMITS.ratePerUnit },
        delayAfterDamage: { minimum: 0, maximum: SHIELD_LIMITS.delayAfterDamage }
    },
    runtimeSnapshot: {
        path: "snapshot.combat",
        optionalUnlessActive: true,
        schemaVersion: 2,
        legacyShieldOnlySchemaVersion: 1,
        fields: ["schemaVersion", "shields", "marks"],
        targetStateFields: ["current", "capacity", "regenerationDelayRemaining"],
        keysAreRuntimeInstanceIds: true
    },
    events: {
        enemyShieldChanged: TOWER_SCRIPT_EVENT_FIELDS.enemyShieldChanged.filter((field) => field !== "type"),
        towerShieldChanged: TOWER_SCRIPT_EVENT_FIELDS.towerShieldChanged.filter((field) => field !== "type"),
        causes: ["damage", "regeneration", "script"]
    },
    towerScript: {
        minimumSchemaVersion: 3,
        events: ["enemyShieldChanged", "towerShieldChanged"],
        actions: ["restoreEnemyShield", "restoreTowerShield"],
        enemyTargets: [...TOWER_SCRIPT_TARGETS.enemy],
        towerTargets: [...TOWER_SCRIPT_TARGETS.tower],
        amount: "finite expression >= 0; clamps at capacity; never creates a missing shield"
    },
    damageTypes: {
        minimumModuleSchemaVersion: 2,
        shape: "record keyed by author-defined damage type id",
        definition: { requiredFields: ["label"], additionalProperties: false },
        fallbackDamageTypeId: "physical"
    },
    armorTypes: {
        minimumModuleSchemaVersion: 2,
        shape: "record keyed by author-defined armor type id",
        definition: {
            requiredFields: ["label", "multipliers"],
            optionalFields: ["defaultMultiplier"],
            additionalProperties: false,
            multipliers: "record keyed only by declared damage type id"
        }
    },
    armorAssignments: {
        minimumModuleSchemaVersion: 2,
        additionalProperties: false,
        targetKinds: ["enemies"],
        enemies: "record keyed by existing enemy type id with a declared armor type id value"
    },
    armorMatrix: {
        limits: ARMOR_MATRIX_LIMITS,
        order: "source modifiers -> marks -> armor matrix -> entity resistance -> legacy pierce_only adapter -> shield -> HP",
        armorPiercingCompatibility: "armor_piercing bypasses only legacy pierce_only and never bypasses the authored matrix"
    },
    marks: {
        minimumModuleSchemaVersion: 3,
        additionalProperties: false,
        limits: MARK_LIMITS,
        definitions: "record keyed by author-defined mark id",
        definitionRequiredFields: ["label", "duration", "maxStacks", "multiplier", "consumePolicy"],
        definitionOptionalFields: ["damageTypes"],
        consumePolicies: ["retain", "consume_one", "consume_all"],
        bindingKinds: ["towers", "abilities", "towerScripts"],
        applicationRequiredFields: ["markId"],
        applicationOptionalFields: ["stacks"]
    },
    // R1.2a compatibility view. New consumers should prefer the structured sections above.
    profileFields: ["shields", "damageTypes", "armorTypes", "armorAssignments", "marks"],
    targetKinds: ["enemies", "towers"],
    definitionFields: ["capacity", "regeneration"],
    regenerationFields: ["ratePerUnit", "delayAfterDamage"],
    limits: SHIELD_LIMITS,
    runtimeStateFields: ["current", "capacity", "regenerationDelayRemaining"],
    changeCauses: ["damage", "regeneration", "script"]
});
/** @deprecated Use COMBAT_MECHANICS_SCHEMA. */
export const COMBAT_SHIELD_SCHEMA = COMBAT_MECHANICS_SCHEMA;
/** Public closed authoring contract for the independently versioned reactions v1 module. */
export const REACTIONS_MECHANICS_SCHEMA = Object.freeze({
    schemaVersion: 1,
    moduleId: "reactions",
    supportedModuleSchemaVersions: [1],
    dependency: {
        moduleId: "combat",
        supportedModuleSchemaVersions: [2, 3]
    },
    profile: {
        additionalProperties: false,
        requiredFields: ["reactions"],
        optionalFields: ["exposures"]
    },
    limits: REACTION_LIMITS,
    runtimeSnapshot: {
        path: "snapshot.reactions",
        schemaVersion: 1,
        optionalUnlessActive: true
    },
    towerScript: {
        minimumSchemaVersion: 5
    }
});
// Every damaging kind may additionally carry `damageType?: string` and `statusOnHit?: {...}`;
// every kind may carry `upgradeCosts?: ResourceCost[]` — all validated generically, not per-kind,
// so they are not repeated in each entry's requiredFields below.
export const ATTACK_KIND_SCHEMA = {
    single: {
        kind: "single",
        requiredFields: [
            { name: "fireRate", kind: "number", positive: true },
            { name: "damagePerStack", kind: "number", positive: true },
            { name: "maxStacks", kind: "number", positive: true }
        ],
        // `chain` is the first composable delivery modifier: optional { maxJumps, jumpRadius,
        // damageFalloff } (all positive numbers) — the shot jumps hop-by-hop to nearby ground
        // enemies, reusing the same resistance/armor/statusOnHit resolution as the primary hit.
        otherFields: ["startingStacks", "upgradeCost", "chain"]
    },
    pulse: {
        kind: "pulse",
        requiredFields: [
            { name: "pulseRate", kind: "number", positive: true },
            { name: "pulseDamage", kind: "number" },
            { name: "dotDamagePerUnit", kind: "number" }
        ],
        otherFields: ["dotDuration", "pulseRateByLevel"]
    },
    sniper: {
        kind: "sniper",
        requiredFields: [
            { name: "interval", kind: "number", positive: true },
            { name: "damage", kind: "number", positive: true }
        ],
        otherFields: ["targetPriority", "rangeByLevel"]
    },
    antiair: {
        kind: "antiair",
        requiredFields: [
            { name: "fireRate", kind: "number", positive: true },
            { name: "damage", kind: "number", positive: true },
            { name: "maxTargetsByLevel", kind: "numberArray" },
            { name: "upgradeCosts", kind: "resourceBagArray" }
        ],
        otherFields: []
    },
    splash: {
        kind: "splash",
        requiredFields: [
            { name: "interval", kind: "number", positive: true },
            { name: "damage", kind: "number", positive: true },
            { name: "splashDamage", kind: "number" },
            { name: "armoredChipDamage", kind: "number" },
            { name: "splashRadius", kind: "number" },
            { name: "slowFactor", kind: "number", positive: true, lessThanOne: true },
            { name: "slowDuration", kind: "number", positive: true }
        ],
        otherFields: ["intervalByLevel", "affectsClasses"]
    },
    support: {
        kind: "support",
        requiredFields: [
            { name: "auraRadius", kind: "number", positive: true },
            { name: "unlocksTowerIds", kind: "towerIdRefArray" }
        ],
        otherFields: ["auraRadiusByLevel"]
    },
    support_buff: {
        kind: "support_buff",
        requiredFields: [
            { name: "auraRadius", kind: "number", positive: true },
            { name: "fireRateMultiplierByLevel", kind: "numberArray", exactLength: 3 },
            { name: "affectsTowerIds", kind: "towerIdRefArray" }
        ],
        otherFields: []
    },
    pipeline: {
        kind: "pipeline",
        requiredFields: [
            { name: "interval", kind: "number", positive: true },
            { name: "delivery", kind: "pipelineDelivery" },
            { name: "effects", kind: "towerEffectArray" }
        ],
        otherFields: ["intervalByLevel", "rangeByLevel", "targeting", "upgradeCosts"]
    }
};
export const TOWER_PIPELINE_SCHEMA = Object.freeze({
    semantics: "targeting selects primary enemies; delivery expands them; effects run in declaration order",
    deliveryKinds: ["single", "multi", "area", "chain", "aura"],
    targeting: { classes: ["ground", "flying"], mode: TOWER_TARGET_MODES, maxTargets: ">0 integer" },
    delivery: {
        single: {},
        multi: {},
        area: { radius: ">0", secondaryMultiplier: ">=0 optional" },
        chain: { maxJumps: ">0 integer", jumpRadius: ">0", damageFalloff: ">0 optional" },
        aura: {}
    },
    effects: {
        damage: { amount: ">=0", amountByLevel: "number[] optional", damageType: "string optional", armorPiercing: "boolean optional" },
        status: { status: "StatusEffectSpec" },
        resource: { resources: "ResourceBag" },
        displacement: {
            kind: "displacement",
            mode: "push | pull",
            distance: "positive safe integer <= 8",
            stopAtBlocker: "boolean"
        }
    }
});
export const ATTACK_KIND_IDS = Object.keys(ATTACK_KIND_SCHEMA);
// Every ability additionally carries `cooldown` (validated non-negative) and `radius` (validated
// positive), common to all ids, so they are not repeated below. A custom (non-preset) ability
// instead declares `effects: AbilityEffect[]` — see ABILITY_EFFECT_SCHEMA below.
export const ABILITY_SCHEMA = {
    path_water: {
        id: "path_water",
        requiredFields: [{ name: "duration", kind: "number", positive: true }],
        otherFields: []
    },
    strike: {
        id: "strike",
        requiredFields: [{ name: "damage", kind: "number", positive: true }],
        otherFields: []
    },
    freeze: {
        id: "freeze",
        requiredFields: [{ name: "duration", kind: "number", positive: true }],
        otherFields: ["stunDuration"]
    }
};
export const ABILITY_IDS = Object.keys(ABILITY_SCHEMA);
/**
 * The effect vocabulary any ability (preset or custom) can compose via `effects: AbilityEffect[]`.
 * A custom ability declares one or more of these — no engine code needed. `status` reuses the
 * exact same StatusEffectSpec a tower's `attack.statusOnHit` carries (stun/slow/poison).
 */
export const ABILITY_EFFECT_SCHEMA = {
    damage: { requiredFields: [{ name: "amount", kind: "number", positive: true }] },
    status: {
        note: "status: { stun?: number; slow?: { factor: number (<1); duration: number }; poison?: { dps: number; duration: number }; slowAffectsClasses?: ('ground'|'flying')[] } — slow defaults to ground; stun/poison retain all-class behavior."
    },
    displacement: {
        kind: "displacement",
        mode: "push | pull",
        distance: "positive safe integer <= 8",
        stopAtBlocker: "boolean"
    }
};
/** The rule enforced for every currency-typed resource bag (tower cost, enemy reward, etc.). */
export const CURRENCY_RULES = {
    idPattern: "^[A-Za-z0-9_]+$",
    primaryRequired: "coins",
    note: "Any number of author-defined currencies beyond the required primary \"coins\"."
};
export const DIFFICULTY_SCHEMA = Object.freeze({
    semantics: "A selected difficulty modifies launch-time inputs; missions are not cloned and the engine owns no persistence.",
    requiredFields: ["id", "label"],
    multiplierFields: {
        enemyHpMultiplier: ">0 optional",
        enemySpeedMultiplier: ">0 optional",
        enemyRewardMultiplier: "finite optional",
        coreDamageMultiplier: "finite optional",
        startingResourceMultiplier: ">0 optional",
        coreHpMultiplier: ">0 optional"
    },
    defaultRule: "defaultDifficultyId must reference one difficulties[] entry",
    example: {
        defaultDifficultyId: "normal",
        difficulties: [
            { id: "normal", label: "Normal" },
            { id: "veteran", label: "Veteran", enemyHpMultiplier: 1.25, enemySpeedMultiplier: 1.1, startingResourceMultiplier: 0.85 }
        ]
    }
});
export const META_PROGRESSION_SCHEMA = Object.freeze({
    semantics: "The engine consumes selected upgrade levels; generated players own the versioned local profile and rewards.",
    rootFields: {
        currencies: "MetaCurrencyDefinition[]",
        upgrades: "Record<upgradeId, MetaUpgradeDefinition>",
        rewardsByMission: "Record<missionId, MissionMetaRewardDefinition>"
    },
    currency: { requiredFields: ["id", "label"], idPattern: "^[A-Za-z0-9_]+$", optionalFields: ["color"] },
    upgrade: {
        requiredFields: ["id", "label", "maxLevel", "costs", "effects"],
        rules: ["record key equals id", "maxLevel is a positive integer", "costs has exactly maxLevel entries", "effects is non-empty"]
    },
    effects: {
        towerDamage: { multiplierPerLevel: "finite" },
        towerFireRate: { multiplierPerLevel: "finite" },
        startingResource: { resourceId: "runtime currency id", amountPerLevel: "finite" },
        coreHp: { amountPerLevel: "finite" }
    },
    missionRewards: {
        firstClear: "meta currency bag optional",
        repeatClear: "meta currency bag optional",
        perStar: "meta currency bag optional"
    },
    example: {
        currencies: [{ id: "forge_shards", label: "Forge Shards" }],
        upgrades: {
            reinforced_core: {
                id: "reinforced_core",
                label: "Reinforced Core",
                maxLevel: 2,
                costs: [{ forge_shards: 1 }, { forge_shards: 3 }],
                effects: [{ kind: "coreHp", amountPerLevel: 2 }]
            }
        },
        rewardsByMission: { tutorial_01: { firstClear: { forge_shards: 2 }, perStar: { forge_shards: 1 } } }
    }
});
/** Mission-local economy fields shared by validation, Studio authoring, and agent schema discovery. */
export const MISSION_ECONOMY_SCHEMA = {
    perWaveStart: { kind: "resourceBag", note: "Granted whenever a wave starts." },
    perWaveClear: { kind: "resourceBag", note: "Granted once for each cleared wave." },
    passivePerTimeUnit: { kind: "resourceBag", note: "Continuous income after the first wave starts." },
    interestRate: { kind: "number", minimum: 0, note: "Fraction of current resources granted on wave clear." },
    interestCap: { kind: "resourceBag", note: "Optional per-currency cap on one interest grant." },
    earlyStartBonusPerUnit: { kind: "resourceBag", note: "Multiplied by skipped prep time when starting early." },
    sellRefundRatio: { kind: "number", minimum: 0, maximum: 1, default: 0.7, note: "Refund of placement + upgrade investment." }
};
export const MISSION_OBJECTIVES_SCHEMA = {
    semantics: "All victory objectives must complete. Any failure condition ends the mission. Core depletion always loses. Missing/empty victory defaults to clearWaves.",
    victory: {
        clearWaves: { fields: ["id", "label?"] },
        surviveSeconds: { fields: ["id", "label?", "seconds>0"] },
        killCount: { fields: ["id", "label?", "count>0", "enemyTypeId?"] },
        accumulateResource: { fields: ["id", "label?", "resourceId", "amount>0"] }
    },
    failure: {
        maxLeaks: { fields: ["id", "label?", "maxLeaks>=0"] },
        timeLimit: { fields: ["id", "label?", "seconds>0"] }
    },
    stars: {
        coreHpAtLeast: { fields: ["id", "label", "amount>=0"] },
        maxLeaks: { fields: ["id", "label", "maxLeaks>=0"] },
        timeAtMost: { fields: ["id", "label", "seconds>0"] },
        resourceAtLeast: { fields: ["id", "label", "resourceId", "amount>0"] }
    }
};
