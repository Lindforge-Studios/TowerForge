import { SHIELD_LIMITS } from "./mechanics.js";
import { MOVEMENT_PROFILE_V1_SCHEMA, NAVIGATION_LIMITS, NavigationProfileValidationError, normalizeMovementProfileV1, resolveActiveNavigationMechanics } from "./navigation-mechanics.js";
/** Closed structural budgets for the first opt-in hero roster schema. */
export const HEROES_LIMITS = Object.freeze({
    definitions: 32,
    idUtf8Bytes: 128,
    labelUtf8Bytes: 128
});
/** Closed budgets for the independently optional v5 hero skill-tree extension. */
export const HERO_SKILL_TREE_LIMITS = Object.freeze({
    descriptionUtf8Bytes: 512,
    nodes: 32,
    prerequisitesPerNode: 8,
    effectsPerNode: 4,
    effectsPerTree: 32,
    points: 65_536
});
/** Closed budgets for the independently optional v6 passive tower-damage aura. */
export const HERO_PASSIVE_AURA_LIMITS = Object.freeze({
    radius: NAVIGATION_LIMITS.activeMapCells,
    effectsPerAura: 4,
    flatAbsoluteValue: 1_000_000_000_000,
    additiveRatioMinimum: -1,
    additiveRatioMaximum: 1_000,
    multiplierMinimum: 0,
    multiplierMaximum: 1_000
});
/** Closed budgets for the independently optional v7 dynamic-enemy hold. */
export const HERO_BLOCKING_LIMITS = Object.freeze({
    blockCapacity: 64,
    movementProfileIds: NAVIGATION_LIMITS.movementProfiles
});
const HERO_ABILITY_COOLDOWN_MAX = 86_400;
const PROFILE_SCHEMA = Object.freeze({
    requiredFields: Object.freeze(["selectedHeroId", "definitions"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false
});
const DEFINITION_SCHEMA = Object.freeze({
    requiredFields: Object.freeze(["label", "spawn"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    spawnValues: Object.freeze(["core"])
});
const PROFILE_SCHEMA_V2 = Object.freeze({
    requiredFields: Object.freeze(["selectedHeroId", "definitions", "movementProfiles"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false
});
const DEFINITION_SCHEMA_V2 = Object.freeze({
    requiredFields: Object.freeze(["label", "spawn", "movement"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    spawnValues: Object.freeze(["core"])
});
const MOVEMENT_SCHEMA_V2 = Object.freeze({
    requiredFields: Object.freeze(["movementProfileId", "speed"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    speed: Object.freeze({ exclusiveMinimum: 0, maximum: 20 })
});
const DEFINITION_SCHEMA_V3 = Object.freeze({
    requiredFields: Object.freeze(["label", "spawn", "movement", "durability"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    spawnValues: Object.freeze(["core"])
});
const DURABILITY_SCHEMA_V3 = Object.freeze({
    requiredFields: Object.freeze(["maxHp", "shield"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    maxHp: Object.freeze({ exclusiveMinimum: 0, maximum: SHIELD_LIMITS.capacity })
});
const SHIELD_SCHEMA_V3 = Object.freeze({
    nullable: true,
    requiredFields: Object.freeze(["capacity"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    capacity: Object.freeze({ exclusiveMinimum: 0, maximum: SHIELD_LIMITS.capacity })
});
const DEFINITION_SCHEMA_V4 = Object.freeze({
    requiredFields: Object.freeze(["label", "spawn", "movement", "durability", "mana", "activeAbility"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    spawnValues: Object.freeze(["core"])
});
const DEFINITION_SCHEMA_V5 = Object.freeze({
    requiredFields: Object.freeze([
        "label", "spawn", "movement", "durability", "mana", "activeAbility", "skillTree"
    ]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    spawnValues: Object.freeze(["core"])
});
const DEFINITION_SCHEMA_V6 = Object.freeze({
    requiredFields: Object.freeze([
        "label", "spawn", "movement", "durability", "mana", "activeAbility", "skillTree", "passiveAura"
    ]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    spawnValues: Object.freeze(["core"])
});
const DEFINITION_SCHEMA_V7 = Object.freeze({
    requiredFields: Object.freeze([
        "label", "spawn", "movement", "durability", "mana", "activeAbility", "skillTree", "passiveAura", "blocking"
    ]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    spawnValues: Object.freeze(["core"])
});
const BLOCKING_SCHEMA_V7 = Object.freeze({
    nullable: true,
    requiredFields: Object.freeze(["blockCapacity", "movementProfileIds"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    blockCapacity: Object.freeze({
        integer: true,
        minimum: 1,
        maximum: HERO_BLOCKING_LIMITS.blockCapacity
    }),
    movementProfileIds: Object.freeze({
        minimumItems: 1,
        maximumItems: HERO_BLOCKING_LIMITS.movementProfileIds,
        uniqueItems: true,
        itemUtf8Bytes: HEROES_LIMITS.idUtf8Bytes
    })
});
const PASSIVE_AURA_SCHEMA_V6 = Object.freeze({
    nullable: true,
    requiredFields: Object.freeze(["id", "label", "radius", "effects"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    radius: Object.freeze({ integer: true, minimum: 0, maximum: HERO_PASSIVE_AURA_LIMITS.radius }),
    effects: Object.freeze({ minimumItems: 1, maximumItems: HERO_PASSIVE_AURA_LIMITS.effectsPerAura })
});
const PASSIVE_AURA_EFFECT_SCHEMA_V6 = Object.freeze({
    requiredFields: Object.freeze(["kind", "scope", "modifier"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    kindValues: Object.freeze(["modifier"]),
    scopeValues: Object.freeze(["tower_damage"])
});
const PASSIVE_AURA_MODIFIER_SCHEMA_V6 = Object.freeze({
    requiredFields: Object.freeze(["target", "operation", "value"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    targetValues: Object.freeze(["damage"]),
    operationValues: Object.freeze(["flat", "additive_ratio", "multiplier"]),
    valueByOperation: Object.freeze({
        flat: Object.freeze({
            minimum: -HERO_PASSIVE_AURA_LIMITS.flatAbsoluteValue,
            maximum: HERO_PASSIVE_AURA_LIMITS.flatAbsoluteValue
        }),
        additive_ratio: Object.freeze({
            minimum: HERO_PASSIVE_AURA_LIMITS.additiveRatioMinimum,
            maximum: HERO_PASSIVE_AURA_LIMITS.additiveRatioMaximum
        }),
        multiplier: Object.freeze({
            minimum: HERO_PASSIVE_AURA_LIMITS.multiplierMinimum,
            maximum: HERO_PASSIVE_AURA_LIMITS.multiplierMaximum
        })
    })
});
const SKILL_TREE_SCHEMA_V5 = Object.freeze({
    nullable: true,
    requiredFields: Object.freeze(["points", "nodes"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false
});
const SKILL_POINTS_SCHEMA_V5 = Object.freeze({
    requiredFields: Object.freeze(["starting", "perInterwave"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    starting: Object.freeze({ integer: true, minimum: 0, maximum: HERO_SKILL_TREE_LIMITS.points }),
    perInterwave: Object.freeze({ integer: true, minimum: 0, maximum: HERO_SKILL_TREE_LIMITS.points })
});
const SKILL_NODE_SCHEMA_V5 = Object.freeze({
    requiredFields: Object.freeze(["label", "description", "cost", "requires", "effects"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    cost: Object.freeze({ integer: true, minimum: 1, maximum: HERO_SKILL_TREE_LIMITS.points })
});
const SKILL_EFFECT_SCHEMA_V5 = Object.freeze({
    requiredFields: Object.freeze(["kind", "scope", "modifier"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    kindValues: Object.freeze(["modifier"]),
    scopeValues: Object.freeze(["hero_ability_damage"])
});
const SKILL_MODIFIER_SCHEMA_V5 = Object.freeze({
    requiredFields: Object.freeze(["target", "operation", "value"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    targetValues: Object.freeze(["damage"]),
    operationValues: Object.freeze(["flat", "additive_ratio", "multiplier"])
});
const MANA_SCHEMA_V4 = Object.freeze({
    requiredFields: Object.freeze(["max", "starting", "regenerationPerUnit"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    max: Object.freeze({ exclusiveMinimum: 0, maximum: SHIELD_LIMITS.capacity }),
    starting: Object.freeze({ minimum: 0, maximumFrom: "mana.max" }),
    regenerationPerUnit: Object.freeze({ minimum: 0, maximum: SHIELD_LIMITS.capacity })
});
const ACTIVE_ABILITY_SCHEMA_V4 = Object.freeze({
    requiredFields: Object.freeze(["id", "label", "target", "manaCost", "cooldown", "range", "damage"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    targetValues: Object.freeze(["enemy"]),
    manaCost: Object.freeze({ exclusiveMinimum: 0, maximumFrom: "mana.max" }),
    cooldown: Object.freeze({ minimum: 0, maximum: HERO_ABILITY_COOLDOWN_MAX }),
    range: Object.freeze({ integer: true, minimum: 0, maximum: NAVIGATION_LIMITS.activeMapCells }),
    damage: Object.freeze({ exclusiveMinimum: 0, maximum: SHIELD_LIMITS.capacity })
});
/** Capability-aware authoring descriptor shared by Studio and MCP. */
export const HEROES_MECHANICS_SCHEMA = Object.freeze({
    schemaVersion: 7,
    moduleId: "heroes",
    supportedModuleSchemaVersions: Object.freeze([1, 2, 3, 4, 5, 6, 7]),
    profile: PROFILE_SCHEMA,
    definition: DEFINITION_SCHEMA,
    versions: Object.freeze({
        1: Object.freeze({ profile: PROFILE_SCHEMA, definition: DEFINITION_SCHEMA }),
        2: Object.freeze({
            profile: PROFILE_SCHEMA_V2,
            definition: DEFINITION_SCHEMA_V2,
            movement: MOVEMENT_SCHEMA_V2,
            movementProfile: MOVEMENT_PROFILE_V1_SCHEMA
        }),
        3: Object.freeze({
            profile: PROFILE_SCHEMA_V2,
            definition: DEFINITION_SCHEMA_V3,
            movement: MOVEMENT_SCHEMA_V2,
            movementProfile: MOVEMENT_PROFILE_V1_SCHEMA,
            durability: DURABILITY_SCHEMA_V3,
            shield: SHIELD_SCHEMA_V3
        }),
        4: Object.freeze({
            profile: PROFILE_SCHEMA_V2,
            definition: DEFINITION_SCHEMA_V4,
            movement: MOVEMENT_SCHEMA_V2,
            movementProfile: MOVEMENT_PROFILE_V1_SCHEMA,
            durability: DURABILITY_SCHEMA_V3,
            shield: SHIELD_SCHEMA_V3,
            mana: MANA_SCHEMA_V4,
            activeAbility: ACTIVE_ABILITY_SCHEMA_V4
        }),
        5: Object.freeze({
            profile: PROFILE_SCHEMA_V2,
            definition: DEFINITION_SCHEMA_V5,
            movement: MOVEMENT_SCHEMA_V2,
            movementProfile: MOVEMENT_PROFILE_V1_SCHEMA,
            durability: DURABILITY_SCHEMA_V3,
            shield: SHIELD_SCHEMA_V3,
            mana: MANA_SCHEMA_V4,
            activeAbility: ACTIVE_ABILITY_SCHEMA_V4,
            skillTree: SKILL_TREE_SCHEMA_V5,
            skillPoints: SKILL_POINTS_SCHEMA_V5,
            skillNode: SKILL_NODE_SCHEMA_V5,
            skillEffect: SKILL_EFFECT_SCHEMA_V5,
            skillModifier: SKILL_MODIFIER_SCHEMA_V5
        }),
        6: Object.freeze({
            profile: PROFILE_SCHEMA_V2,
            definition: DEFINITION_SCHEMA_V6,
            movement: MOVEMENT_SCHEMA_V2,
            movementProfile: MOVEMENT_PROFILE_V1_SCHEMA,
            durability: DURABILITY_SCHEMA_V3,
            shield: SHIELD_SCHEMA_V3,
            mana: MANA_SCHEMA_V4,
            activeAbility: ACTIVE_ABILITY_SCHEMA_V4,
            skillTree: SKILL_TREE_SCHEMA_V5,
            skillPoints: SKILL_POINTS_SCHEMA_V5,
            skillNode: SKILL_NODE_SCHEMA_V5,
            skillEffect: SKILL_EFFECT_SCHEMA_V5,
            skillModifier: SKILL_MODIFIER_SCHEMA_V5,
            passiveAura: PASSIVE_AURA_SCHEMA_V6,
            passiveAuraEffect: PASSIVE_AURA_EFFECT_SCHEMA_V6,
            passiveAuraModifier: PASSIVE_AURA_MODIFIER_SCHEMA_V6
        }),
        7: Object.freeze({
            profile: PROFILE_SCHEMA_V2,
            definition: DEFINITION_SCHEMA_V7,
            movement: MOVEMENT_SCHEMA_V2,
            movementProfile: MOVEMENT_PROFILE_V1_SCHEMA,
            durability: DURABILITY_SCHEMA_V3,
            shield: SHIELD_SCHEMA_V3,
            mana: MANA_SCHEMA_V4,
            activeAbility: ACTIVE_ABILITY_SCHEMA_V4,
            skillTree: SKILL_TREE_SCHEMA_V5,
            skillPoints: SKILL_POINTS_SCHEMA_V5,
            skillNode: SKILL_NODE_SCHEMA_V5,
            skillEffect: SKILL_EFFECT_SCHEMA_V5,
            skillModifier: SKILL_MODIFIER_SCHEMA_V5,
            passiveAura: PASSIVE_AURA_SCHEMA_V6,
            passiveAuraEffect: PASSIVE_AURA_EFFECT_SCHEMA_V6,
            passiveAuraModifier: PASSIVE_AURA_MODIFIER_SCHEMA_V6,
            blocking: BLOCKING_SCHEMA_V7,
            limits: Object.freeze({
                blockCapacity: Object.freeze({ minimum: 1, maximum: HERO_BLOCKING_LIMITS.blockCapacity }),
                movementProfileIds: HERO_BLOCKING_LIMITS.movementProfileIds
            })
        })
    }),
    limits: HEROES_LIMITS,
    runtimeSnapshot: Object.freeze({
        path: "snapshot.heroes",
        schemaVersions: Object.freeze([1, 2, 3, 4, 5, 6, 7]),
        optionalUnlessActive: true,
        versions: Object.freeze({
            1: Object.freeze({ unitFields: Object.freeze(["id", "definitionId", "label", "coord"]) }),
            2: Object.freeze({
                unitFields: Object.freeze(["id", "definitionId", "label", "coord", "movement"]),
                movementFields: Object.freeze(["targetCoord", "nextCoord", "edgeProgress"])
            }),
            3: Object.freeze({
                unitFields: Object.freeze(["id", "definitionId", "label", "coord", "movement", "durability"]),
                movementFields: Object.freeze(["targetCoord", "nextCoord", "edgeProgress"]),
                durabilityFields: Object.freeze(["hp", "maxHp", "shield", "defeated"])
            }),
            4: Object.freeze({
                unitFields: Object.freeze([
                    "id", "definitionId", "label", "coord", "movement", "durability", "mana", "activeAbility"
                ]),
                movementFields: Object.freeze(["targetCoord", "nextCoord", "edgeProgress"]),
                durabilityFields: Object.freeze(["hp", "maxHp", "shield", "defeated"]),
                manaFields: Object.freeze(["current", "max", "regenerationPerUnit"]),
                activeAbilityFields: Object.freeze([
                    "id", "label", "target", "manaCost", "cooldown", "cooldownRemaining", "range", "damage", "ready"
                ])
            }),
            5: Object.freeze({
                unitFields: Object.freeze([
                    "id", "definitionId", "label", "coord", "movement", "durability", "mana", "activeAbility", "skills"
                ]),
                movementFields: Object.freeze(["targetCoord", "nextCoord", "edgeProgress"]),
                durabilityFields: Object.freeze(["hp", "maxHp", "shield", "defeated"]),
                manaFields: Object.freeze(["current", "max", "regenerationPerUnit"]),
                activeAbilityFields: Object.freeze([
                    "id", "label", "target", "manaCost", "cooldown", "cooldownRemaining", "range", "damage", "ready"
                ]),
                skillsFields: Object.freeze([
                    "availablePoints", "startingPoints", "pointsPerInterwave", "maximumEarnablePoints",
                    "managementAvailable", "nodes"
                ])
            }),
            6: Object.freeze({
                unitFields: Object.freeze([
                    "id", "definitionId", "label", "coord", "movement", "durability", "mana", "activeAbility",
                    "skills", "passiveAura"
                ]),
                movementFields: Object.freeze(["targetCoord", "nextCoord", "edgeProgress"]),
                durabilityFields: Object.freeze(["hp", "maxHp", "shield", "defeated"]),
                manaFields: Object.freeze(["current", "max", "regenerationPerUnit"]),
                activeAbilityFields: Object.freeze([
                    "id", "label", "target", "manaCost", "cooldown", "cooldownRemaining", "range", "damage", "ready"
                ]),
                skillsNullable: true,
                passiveAuraFields: Object.freeze(["id", "label", "radius", "active", "affectedTowerIds"])
            }),
            7: Object.freeze({
                unitFields: Object.freeze([
                    "id", "definitionId", "label", "coord", "movement", "durability", "mana", "activeAbility",
                    "skills", "passiveAura", "blocking"
                ]),
                movementFields: Object.freeze(["targetCoord", "nextCoord", "edgeProgress"]),
                durabilityFields: Object.freeze(["hp", "maxHp", "shield", "defeated"]),
                manaFields: Object.freeze(["current", "max", "regenerationPerUnit"]),
                activeAbilityFields: Object.freeze([
                    "id", "label", "target", "manaCost", "cooldown", "cooldownRemaining", "range", "damage", "ready"
                ]),
                skillsNullable: true,
                passiveAuraNullable: true,
                blockingFields: Object.freeze(["blockCapacity", "active", "blockedEnemyIds"])
            })
        })
    })
});
export class HeroesProfileValidationError extends Error {
    fieldPath;
    constructor(fieldPath, message) {
        super(message);
        this.name = "HeroesProfileValidationError";
        this.fieldPath = fieldPath;
    }
}
function utf8ByteLength(value) {
    let bytes = 0;
    for (const character of value) {
        const point = character.codePointAt(0);
        bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }
    return bytes;
}
/** Stable collision-safe runtime id for one authored skill modifier. */
export function heroSkillModifierIdV5(skillId, effectIndex) {
    return `heroes:skill:${utf8ByteLength(skillId)}:${skillId}:effect:${effectIndex}`;
}
/** Stable collision-safe runtime id for one selected hero aura modifier. */
export function heroPassiveAuraModifierIdV6(heroDefinitionId, auraId, effectIndex) {
    return `heroes:aura:hero:${utf8ByteLength(heroDefinitionId)}:${heroDefinitionId}`
        + `:aura:${utf8ByteLength(auraId)}:${auraId}:effect:${String(effectIndex).padStart(2, "0")}`;
}
function dataRecord(value, fieldPath, label) {
    let prototype;
    let descriptors;
    let array = false;
    try {
        array = value !== null && typeof value === "object" && Array.isArray(value);
        if (value !== null && typeof value === "object" && !array) {
            prototype = Object.getPrototypeOf(value);
            descriptors = Object.getOwnPropertyDescriptors(value);
            // Re-check inside the guard so a Proxy that revokes itself while exposing descriptors
            // is rejected as an unsafe inspection rather than accepted or leaked as a raw TypeError.
            array = Array.isArray(value);
        }
        else {
            prototype = null;
            descriptors = {};
        }
    }
    catch {
        throw new HeroesProfileValidationError(fieldPath, `${label} could not be inspected safely.`);
    }
    if (value === null || typeof value !== "object" || array || prototype !== Object.prototype) {
        throw new HeroesProfileValidationError(fieldPath, `${label} must be a plain own-data object.`);
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new HeroesProfileValidationError(fieldPath, `${label} must not contain symbol fields.`);
    }
    const result = {};
    for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            throw new HeroesProfileValidationError(`${fieldPath}.${key}`, `${label} fields must be enumerable own data.`);
        }
        Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
    }
    return result;
}
function exactFields(value, required, fieldPath, label) {
    for (const field of required) {
        if (!Object.prototype.hasOwnProperty.call(value, field)) {
            throw new HeroesProfileValidationError(`${fieldPath}.${field}`, `${label} is missing required own field "${field}".`);
        }
    }
    const allowed = new Set(required);
    const unknown = Object.keys(value).find((field) => !allowed.has(field));
    if (unknown !== undefined) {
        throw new HeroesProfileValidationError(`${fieldPath}.${unknown}`, `${label} contains unknown field "${unknown}".`);
    }
}
function boundedText(value, maximum, fieldPath, label) {
    if (typeof value !== "string" || value.length === 0 || value !== value.trim()
        || utf8ByteLength(value) > maximum) {
        throw new HeroesProfileValidationError(fieldPath, `${label} must contain 1..${maximum} UTF-8 bytes without surrounding whitespace.`);
    }
    return value;
}
function dataArray(value, fieldPath, label) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
        throw new HeroesProfileValidationError(fieldPath, `${label} must be a plain dense array.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new HeroesProfileValidationError(fieldPath, `${label} must not contain symbol fields.`);
    }
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !("value" in lengthDescriptor)
        || typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value)) {
        throw new HeroesProfileValidationError(fieldPath, `${label} has an invalid length.`);
    }
    const length = lengthDescriptor.value;
    if (Object.keys(descriptors).length !== length + 1) {
        throw new HeroesProfileValidationError(fieldPath, `${label} must be dense and contain no extra fields.`);
    }
    const result = [];
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            throw new HeroesProfileValidationError(`${fieldPath}[${index}]`, `${label} entries must be enumerable own data.`);
        }
        result.push(descriptor.value);
    }
    return result;
}
function boundedInteger(value, minimum, maximum, fieldPath, label) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new HeroesProfileValidationError(fieldPath, `${label} must be an integer inside [${minimum}, ${maximum}].`);
    }
    return value;
}
/** Normalize the closed structural shape. The selected-definition reference is semantic. */
export function normalizeHeroesProfileV1(input, root = "profile") {
    const profile = dataRecord(input, root, "Heroes profile");
    exactFields(profile, HEROES_MECHANICS_SCHEMA.profile.requiredFields, root, "Heroes profile");
    const selectedHeroId = boundedText(profile.selectedHeroId, HEROES_LIMITS.idUtf8Bytes, `${root}.selectedHeroId`, "Selected hero id");
    const rawDefinitions = dataRecord(profile.definitions, `${root}.definitions`, "Heroes definitions");
    const definitionIds = Object.keys(rawDefinitions).sort(compareBinary);
    if (definitionIds.length < 1 || definitionIds.length > HEROES_LIMITS.definitions) {
        throw new HeroesProfileValidationError(`${root}.definitions`, `Heroes definitions must contain 1..${HEROES_LIMITS.definitions} entries.`);
    }
    const definitions = {};
    for (const heroId of definitionIds) {
        boundedText(heroId, HEROES_LIMITS.idUtf8Bytes, `${root}.definitions.${heroId}`, "Hero id");
        const rawDefinition = dataRecord(rawDefinitions[heroId], `${root}.definitions.${heroId}`, `Hero definition "${heroId}"`);
        exactFields(rawDefinition, HEROES_MECHANICS_SCHEMA.definition.requiredFields, `${root}.definitions.${heroId}`, `Hero definition "${heroId}"`);
        const label = boundedText(rawDefinition.label, HEROES_LIMITS.labelUtf8Bytes, `${root}.definitions.${heroId}.label`, "Hero label");
        if (rawDefinition.spawn !== "core") {
            throw new HeroesProfileValidationError(`${root}.definitions.${heroId}.spawn`, "Hero spawn must be the supported value \"core\".");
        }
        Object.defineProperty(definitions, heroId, {
            value: Object.freeze({ label, spawn: "core" }),
            enumerable: true
        });
    }
    return Object.freeze({ selectedHeroId, definitions: Object.freeze(definitions) });
}
/** Normalize the closed R5.1B movement-enabled profile without activating navigation. */
export function normalizeHeroesProfileV2(input, root = "profile") {
    const profile = dataRecord(input, root, "Heroes profile");
    exactFields(profile, PROFILE_SCHEMA_V2.requiredFields, root, "Heroes profile");
    const selectedHeroId = boundedText(profile.selectedHeroId, HEROES_LIMITS.idUtf8Bytes, `${root}.selectedHeroId`, "Selected hero id");
    const rawMovementProfiles = dataRecord(profile.movementProfiles, `${root}.movementProfiles`, "Heroes movement profiles");
    const movementProfileIds = Object.keys(rawMovementProfiles).sort(compareBinary);
    if (movementProfileIds.length < 1 || movementProfileIds.length > NAVIGATION_LIMITS.movementProfiles) {
        throw new HeroesProfileValidationError(`${root}.movementProfiles`, `Heroes movement profiles must contain 1..${NAVIGATION_LIMITS.movementProfiles} entries.`);
    }
    const movementProfiles = {};
    for (const movementProfileId of movementProfileIds) {
        boundedText(movementProfileId, HEROES_LIMITS.idUtf8Bytes, `${root}.movementProfiles.${movementProfileId}`, "Movement profile id");
        let normalized;
        try {
            normalized = normalizeMovementProfileV1(rawMovementProfiles[movementProfileId], `${root}.movementProfiles.${movementProfileId}`);
        }
        catch (error) {
            if (error instanceof NavigationProfileValidationError) {
                throw new HeroesProfileValidationError(error.fieldPath, error.message);
            }
            throw error;
        }
        Object.defineProperty(movementProfiles, movementProfileId, {
            value: normalized,
            enumerable: true
        });
    }
    const rawDefinitions = dataRecord(profile.definitions, `${root}.definitions`, "Heroes definitions");
    const definitionIds = Object.keys(rawDefinitions).sort(compareBinary);
    if (definitionIds.length < 1 || definitionIds.length > HEROES_LIMITS.definitions) {
        throw new HeroesProfileValidationError(`${root}.definitions`, `Heroes definitions must contain 1..${HEROES_LIMITS.definitions} entries.`);
    }
    const definitions = {};
    for (const heroId of definitionIds) {
        boundedText(heroId, HEROES_LIMITS.idUtf8Bytes, `${root}.definitions.${heroId}`, "Hero id");
        const definitionRoot = `${root}.definitions.${heroId}`;
        const rawDefinition = dataRecord(rawDefinitions[heroId], definitionRoot, `Hero definition "${heroId}"`);
        exactFields(rawDefinition, DEFINITION_SCHEMA_V2.requiredFields, definitionRoot, `Hero definition "${heroId}"`);
        const label = boundedText(rawDefinition.label, HEROES_LIMITS.labelUtf8Bytes, `${definitionRoot}.label`, "Hero label");
        if (rawDefinition.spawn !== "core") {
            throw new HeroesProfileValidationError(`${definitionRoot}.spawn`, "Hero spawn must be the supported value \"core\".");
        }
        const movementRoot = `${definitionRoot}.movement`;
        const movement = dataRecord(rawDefinition.movement, movementRoot, `Hero movement "${heroId}"`);
        exactFields(movement, MOVEMENT_SCHEMA_V2.requiredFields, movementRoot, `Hero movement "${heroId}"`);
        const movementProfileId = boundedText(movement.movementProfileId, HEROES_LIMITS.idUtf8Bytes, `${movementRoot}.movementProfileId`, "Hero movement profile id");
        const speed = movement.speed;
        if (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0 || speed > 20) {
            throw new HeroesProfileValidationError(`${movementRoot}.speed`, "Hero movement speed must be finite and inside (0, 20].");
        }
        Object.defineProperty(definitions, heroId, {
            value: Object.freeze({
                label,
                spawn: "core",
                movement: Object.freeze({ movementProfileId, speed })
            }),
            enumerable: true
        });
    }
    return Object.freeze({
        selectedHeroId,
        definitions: Object.freeze(definitions),
        movementProfiles: Object.freeze(movementProfiles)
    });
}
/** Normalize the closed R5.2A durability profile while retaining the v2 movement contract. */
export function normalizeHeroesProfileV3(input, root = "profile") {
    const profile = dataRecord(input, root, "Heroes profile");
    exactFields(profile, PROFILE_SCHEMA_V2.requiredFields, root, "Heroes profile");
    const selectedHeroId = boundedText(profile.selectedHeroId, HEROES_LIMITS.idUtf8Bytes, `${root}.selectedHeroId`, "Selected hero id");
    const rawMovementProfiles = dataRecord(profile.movementProfiles, `${root}.movementProfiles`, "Heroes movement profiles");
    const movementProfileIds = Object.keys(rawMovementProfiles).sort(compareBinary);
    if (movementProfileIds.length < 1 || movementProfileIds.length > NAVIGATION_LIMITS.movementProfiles) {
        throw new HeroesProfileValidationError(`${root}.movementProfiles`, `Heroes movement profiles must contain 1..${NAVIGATION_LIMITS.movementProfiles} entries.`);
    }
    const movementProfiles = {};
    for (const movementProfileId of movementProfileIds) {
        boundedText(movementProfileId, HEROES_LIMITS.idUtf8Bytes, `${root}.movementProfiles.${movementProfileId}`, "Movement profile id");
        let normalized;
        try {
            normalized = normalizeMovementProfileV1(rawMovementProfiles[movementProfileId], `${root}.movementProfiles.${movementProfileId}`);
        }
        catch (error) {
            if (error instanceof NavigationProfileValidationError) {
                throw new HeroesProfileValidationError(error.fieldPath, error.message);
            }
            throw error;
        }
        Object.defineProperty(movementProfiles, movementProfileId, { value: normalized, enumerable: true });
    }
    const rawDefinitions = dataRecord(profile.definitions, `${root}.definitions`, "Heroes definitions");
    const definitionIds = Object.keys(rawDefinitions).sort(compareBinary);
    if (definitionIds.length < 1 || definitionIds.length > HEROES_LIMITS.definitions) {
        throw new HeroesProfileValidationError(`${root}.definitions`, `Heroes definitions must contain 1..${HEROES_LIMITS.definitions} entries.`);
    }
    const definitions = {};
    for (const heroId of definitionIds) {
        boundedText(heroId, HEROES_LIMITS.idUtf8Bytes, `${root}.definitions.${heroId}`, "Hero id");
        const definitionRoot = `${root}.definitions.${heroId}`;
        const rawDefinition = dataRecord(rawDefinitions[heroId], definitionRoot, `Hero definition "${heroId}"`);
        exactFields(rawDefinition, DEFINITION_SCHEMA_V3.requiredFields, definitionRoot, `Hero definition "${heroId}"`);
        const label = boundedText(rawDefinition.label, HEROES_LIMITS.labelUtf8Bytes, `${definitionRoot}.label`, "Hero label");
        if (rawDefinition.spawn !== "core") {
            throw new HeroesProfileValidationError(`${definitionRoot}.spawn`, "Hero spawn must be the supported value \"core\".");
        }
        const movementRoot = `${definitionRoot}.movement`;
        const movement = dataRecord(rawDefinition.movement, movementRoot, `Hero movement "${heroId}"`);
        exactFields(movement, MOVEMENT_SCHEMA_V2.requiredFields, movementRoot, `Hero movement "${heroId}"`);
        const movementProfileId = boundedText(movement.movementProfileId, HEROES_LIMITS.idUtf8Bytes, `${movementRoot}.movementProfileId`, "Hero movement profile id");
        const speed = movement.speed;
        if (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0 || speed > 20) {
            throw new HeroesProfileValidationError(`${movementRoot}.speed`, "Hero movement speed must be finite and inside (0, 20].");
        }
        const durabilityRoot = `${definitionRoot}.durability`;
        const durability = dataRecord(rawDefinition.durability, durabilityRoot, `Hero durability "${heroId}"`);
        exactFields(durability, DURABILITY_SCHEMA_V3.requiredFields, durabilityRoot, `Hero durability "${heroId}"`);
        const maxHp = durability.maxHp;
        if (typeof maxHp !== "number" || !Number.isFinite(maxHp) || maxHp <= 0 || maxHp > SHIELD_LIMITS.capacity) {
            throw new HeroesProfileValidationError(`${durabilityRoot}.maxHp`, `Hero durability maxHp must be finite and inside (0, ${SHIELD_LIMITS.capacity}].`);
        }
        let shield = null;
        if (durability.shield !== null) {
            const shieldRoot = `${durabilityRoot}.shield`;
            const rawShield = dataRecord(durability.shield, shieldRoot, `Hero shield "${heroId}"`);
            exactFields(rawShield, SHIELD_SCHEMA_V3.requiredFields, shieldRoot, `Hero shield "${heroId}"`);
            const capacity = rawShield.capacity;
            if (typeof capacity !== "number" || !Number.isFinite(capacity) || capacity <= 0 || capacity > SHIELD_LIMITS.capacity) {
                throw new HeroesProfileValidationError(`${shieldRoot}.capacity`, `Hero shield capacity must be finite and inside (0, ${SHIELD_LIMITS.capacity}].`);
            }
            shield = Object.freeze({ capacity });
        }
        Object.defineProperty(definitions, heroId, {
            value: Object.freeze({
                label,
                spawn: "core",
                movement: Object.freeze({ movementProfileId, speed }),
                durability: Object.freeze({ maxHp, shield })
            }),
            enumerable: true
        });
    }
    return Object.freeze({
        selectedHeroId,
        definitions: Object.freeze(definitions),
        movementProfiles: Object.freeze(movementProfiles)
    });
}
/** Normalize the closed R5.3A single targeted active-ability profile. */
export function normalizeHeroesProfileV4(input, root = "profile") {
    const profile = dataRecord(input, root, "Heroes profile");
    exactFields(profile, PROFILE_SCHEMA_V2.requiredFields, root, "Heroes profile");
    const rawDefinitions = dataRecord(profile.definitions, `${root}.definitions`, "Heroes definitions");
    const legacyDefinitions = {};
    for (const heroId of Object.keys(rawDefinitions).sort(compareBinary)) {
        const definitionRoot = `${root}.definitions.${heroId}`;
        const rawDefinition = dataRecord(rawDefinitions[heroId], definitionRoot, `Hero definition "${heroId}"`);
        exactFields(rawDefinition, DEFINITION_SCHEMA_V4.requiredFields, definitionRoot, `Hero definition "${heroId}"`);
        Object.defineProperty(legacyDefinitions, heroId, {
            value: {
                label: rawDefinition.label,
                spawn: rawDefinition.spawn,
                movement: rawDefinition.movement,
                durability: rawDefinition.durability
            },
            enumerable: true
        });
    }
    const durable = normalizeHeroesProfileV3({
        selectedHeroId: profile.selectedHeroId,
        definitions: legacyDefinitions,
        movementProfiles: profile.movementProfiles
    }, root);
    const definitions = {};
    for (const heroId of Object.keys(durable.definitions).sort(compareBinary)) {
        const definitionRoot = `${root}.definitions.${heroId}`;
        const rawDefinition = dataRecord(rawDefinitions[heroId], definitionRoot, `Hero definition "${heroId}"`);
        const manaRoot = `${definitionRoot}.mana`;
        const rawMana = dataRecord(rawDefinition.mana, manaRoot, `Hero mana "${heroId}"`);
        exactFields(rawMana, MANA_SCHEMA_V4.requiredFields, manaRoot, `Hero mana "${heroId}"`);
        const max = rawMana.max;
        const starting = rawMana.starting;
        const regenerationPerUnit = rawMana.regenerationPerUnit;
        if (typeof max !== "number" || !Number.isFinite(max) || max <= 0 || max > SHIELD_LIMITS.capacity) {
            throw new HeroesProfileValidationError(manaRoot + ".max", "Hero mana max must be finite and positive within the maximum range.");
        }
        if (typeof starting !== "number" || !Number.isFinite(starting) || starting < 0 || starting > max) {
            throw new HeroesProfileValidationError(manaRoot + ".starting", "Hero starting mana must be finite inside the authored mana range.");
        }
        if (typeof regenerationPerUnit !== "number" || !Number.isFinite(regenerationPerUnit)
            || regenerationPerUnit < 0 || regenerationPerUnit > SHIELD_LIMITS.capacity) {
            throw new HeroesProfileValidationError(manaRoot + ".regenerationPerUnit", "Hero mana regeneration must be finite inside the supported range.");
        }
        const abilityRoot = `${definitionRoot}.activeAbility`;
        const rawAbility = dataRecord(rawDefinition.activeAbility, abilityRoot, `Hero active ability "${heroId}"`);
        exactFields(rawAbility, ACTIVE_ABILITY_SCHEMA_V4.requiredFields, abilityRoot, `Hero active ability "${heroId}"`);
        const id = boundedText(rawAbility.id, HEROES_LIMITS.idUtf8Bytes, abilityRoot + ".id", "Hero ability id");
        const label = boundedText(rawAbility.label, HEROES_LIMITS.labelUtf8Bytes, abilityRoot + ".label", "Hero ability label");
        if (rawAbility.target !== "enemy") {
            throw new HeroesProfileValidationError(abilityRoot + ".target", "Hero active ability target field must be enemy.");
        }
        const manaCost = rawAbility.manaCost;
        if (typeof manaCost !== "number" || !Number.isFinite(manaCost) || manaCost <= 0 || manaCost > max) {
            throw new HeroesProfileValidationError(abilityRoot + ".manaCost", "Hero ability mana cost must be finite and positive inside the mana range.");
        }
        const cooldown = rawAbility.cooldown;
        if (typeof cooldown !== "number" || !Number.isFinite(cooldown)
            || cooldown < 0 || cooldown > HERO_ABILITY_COOLDOWN_MAX) {
            throw new HeroesProfileValidationError(abilityRoot + ".cooldown", "Hero ability cooldown must be finite inside the supported range.");
        }
        const range = rawAbility.range;
        if (typeof range !== "number" || !Number.isSafeInteger(range)
            || range < 0 || range > NAVIGATION_LIMITS.activeMapCells) {
            throw new HeroesProfileValidationError(abilityRoot + ".range", "Hero ability range must be an integer inside the supported range.");
        }
        const damage = rawAbility.damage;
        if (typeof damage !== "number" || !Number.isFinite(damage) || damage <= 0 || damage > SHIELD_LIMITS.capacity) {
            throw new HeroesProfileValidationError(abilityRoot + ".damage", "Hero ability damage must be finite and positive within the maximum range.");
        }
        Object.defineProperty(definitions, heroId, {
            value: Object.freeze({
                ...durable.definitions[heroId],
                mana: Object.freeze({ max, starting, regenerationPerUnit }),
                activeAbility: Object.freeze({ id, label, target: "enemy", manaCost, cooldown, range, damage })
            }),
            enumerable: true
        });
    }
    return Object.freeze({
        selectedHeroId: durable.selectedHeroId,
        definitions: Object.freeze(definitions),
        movementProfiles: durable.movementProfiles
    });
}
/** Normalize the closed nullable R5.4A battle-local skill-tree profile. */
export function normalizeHeroesProfileV5(input, root = "profile") {
    const profile = dataRecord(input, root, "Heroes profile");
    exactFields(profile, PROFILE_SCHEMA_V2.requiredFields, root, "Heroes profile");
    const rawDefinitions = dataRecord(profile.definitions, `${root}.definitions`, "Heroes definitions");
    const legacyDefinitions = {};
    for (const heroId of Object.keys(rawDefinitions).sort(compareBinary)) {
        const definitionRoot = `${root}.definitions.${heroId}`;
        const rawDefinition = dataRecord(rawDefinitions[heroId], definitionRoot, `Hero definition "${heroId}"`);
        exactFields(rawDefinition, DEFINITION_SCHEMA_V5.requiredFields, definitionRoot, `Hero definition "${heroId}"`);
        Object.defineProperty(legacyDefinitions, heroId, {
            value: {
                label: rawDefinition.label,
                spawn: rawDefinition.spawn,
                movement: rawDefinition.movement,
                durability: rawDefinition.durability,
                mana: rawDefinition.mana,
                activeAbility: rawDefinition.activeAbility
            },
            enumerable: true
        });
    }
    const abilityProfile = normalizeHeroesProfileV4({
        selectedHeroId: profile.selectedHeroId,
        definitions: legacyDefinitions,
        movementProfiles: profile.movementProfiles
    }, root);
    const definitions = {};
    for (const heroId of Object.keys(abilityProfile.definitions).sort(compareBinary)) {
        const definitionRoot = `${root}.definitions.${heroId}`;
        const rawDefinition = dataRecord(rawDefinitions[heroId], definitionRoot, `Hero definition "${heroId}"`);
        let skillTree = null;
        if (rawDefinition.skillTree !== null) {
            const treeRoot = `${definitionRoot}.skillTree`;
            const rawTree = dataRecord(rawDefinition.skillTree, treeRoot, `Hero skill tree "${heroId}"`);
            exactFields(rawTree, SKILL_TREE_SCHEMA_V5.requiredFields, treeRoot, `Hero skill tree "${heroId}"`);
            const pointsRoot = `${treeRoot}.points`;
            const rawPoints = dataRecord(rawTree.points, pointsRoot, `Hero skill points "${heroId}"`);
            exactFields(rawPoints, SKILL_POINTS_SCHEMA_V5.requiredFields, pointsRoot, `Hero skill points "${heroId}"`);
            const points = Object.freeze({
                starting: boundedInteger(rawPoints.starting, 0, HERO_SKILL_TREE_LIMITS.points, `${pointsRoot}.starting`, "Starting hero skill points"),
                perInterwave: boundedInteger(rawPoints.perInterwave, 0, HERO_SKILL_TREE_LIMITS.points, `${pointsRoot}.perInterwave`, "Interwave hero skill points")
            });
            const rawNodes = dataRecord(rawTree.nodes, `${treeRoot}.nodes`, `Hero skill nodes "${heroId}"`);
            const skillIds = Object.keys(rawNodes).sort(compareBinary);
            if (skillIds.length < 1 || skillIds.length > HERO_SKILL_TREE_LIMITS.nodes) {
                throw new HeroesProfileValidationError(`${treeRoot}.nodes`, `Hero skill tree nodes must contain 1..${HERO_SKILL_TREE_LIMITS.nodes} entries.`);
            }
            const nodes = {};
            let totalEffects = 0;
            for (const skillId of skillIds) {
                boundedText(skillId, HEROES_LIMITS.idUtf8Bytes, `${treeRoot}.nodes.${skillId}`, "Hero skill id");
                const nodeRoot = `${treeRoot}.nodes.${skillId}`;
                const rawNode = dataRecord(rawNodes[skillId], nodeRoot, `Hero skill node "${skillId}"`);
                exactFields(rawNode, SKILL_NODE_SCHEMA_V5.requiredFields, nodeRoot, `Hero skill node "${skillId}"`);
                const rawRequires = dataArray(rawNode.requires, `${nodeRoot}.requires`, `Hero skill requirements "${skillId}"`);
                if (rawRequires.length > HERO_SKILL_TREE_LIMITS.prerequisitesPerNode) {
                    throw new HeroesProfileValidationError(`${nodeRoot}.requires`, `Hero skill prerequisites exceed ${HERO_SKILL_TREE_LIMITS.prerequisitesPerNode} entries.`);
                }
                const requires = rawRequires.map((requiredId, index) => boundedText(requiredId, HEROES_LIMITS.idUtf8Bytes, `${nodeRoot}.requires[${index}]`, "Hero skill prerequisite id")).sort(compareBinary);
                const rawEffects = dataArray(rawNode.effects, `${nodeRoot}.effects`, `Hero skill effects "${skillId}"`);
                if (rawEffects.length < 1 || rawEffects.length > HERO_SKILL_TREE_LIMITS.effectsPerNode) {
                    throw new HeroesProfileValidationError(`${nodeRoot}.effects`, `Hero skill effects must contain 1..${HERO_SKILL_TREE_LIMITS.effectsPerNode} entries.`);
                }
                totalEffects += rawEffects.length;
                if (totalEffects > HERO_SKILL_TREE_LIMITS.effectsPerTree) {
                    throw new HeroesProfileValidationError(`${treeRoot}.nodes`, `Hero skill tree effects exceed ${HERO_SKILL_TREE_LIMITS.effectsPerTree} entries.`);
                }
                const effects = rawEffects.map((rawEffect, index) => {
                    const effectRoot = `${nodeRoot}.effects[${index}]`;
                    const effect = dataRecord(rawEffect, effectRoot, `Hero skill effect "${skillId}"`);
                    exactFields(effect, SKILL_EFFECT_SCHEMA_V5.requiredFields, effectRoot, `Hero skill effect "${skillId}"`);
                    if (effect.kind !== "modifier") {
                        throw new HeroesProfileValidationError(`${effectRoot}.kind`, "Hero skill effect kind must be modifier.");
                    }
                    if (effect.scope !== "hero_ability_damage") {
                        throw new HeroesProfileValidationError(`${effectRoot}.scope`, "Hero skill modifier scope must be hero_ability_damage.");
                    }
                    const modifierRoot = `${effectRoot}.modifier`;
                    const rawModifier = dataRecord(effect.modifier, modifierRoot, `Hero skill modifier "${skillId}"`);
                    exactFields(rawModifier, SKILL_MODIFIER_SCHEMA_V5.requiredFields, modifierRoot, `Hero skill modifier "${skillId}"`);
                    if (rawModifier.target !== "damage") {
                        throw new HeroesProfileValidationError(`${modifierRoot}.target`, "Hero skill modifier target must be damage.");
                    }
                    if (rawModifier.operation !== "flat" && rawModifier.operation !== "additive_ratio"
                        && rawModifier.operation !== "multiplier") {
                        throw new HeroesProfileValidationError(`${modifierRoot}.operation`, "Hero skill modifier operation is unsupported.");
                    }
                    if (typeof rawModifier.value !== "number" || !Number.isFinite(rawModifier.value)) {
                        throw new HeroesProfileValidationError(`${modifierRoot}.value`, "Hero skill modifier value must be finite.");
                    }
                    return Object.freeze({
                        kind: "modifier",
                        scope: "hero_ability_damage",
                        modifier: Object.freeze({
                            target: "damage",
                            operation: rawModifier.operation,
                            value: Object.is(rawModifier.value, -0) ? 0 : rawModifier.value
                        })
                    });
                });
                Object.defineProperty(nodes, skillId, {
                    value: Object.freeze({
                        label: boundedText(rawNode.label, HEROES_LIMITS.labelUtf8Bytes, `${nodeRoot}.label`, "Hero skill label"),
                        description: boundedText(rawNode.description, HERO_SKILL_TREE_LIMITS.descriptionUtf8Bytes, `${nodeRoot}.description`, "Hero skill description"),
                        cost: boundedInteger(rawNode.cost, 1, HERO_SKILL_TREE_LIMITS.points, `${nodeRoot}.cost`, "Hero skill cost"),
                        requires: Object.freeze(requires),
                        effects: Object.freeze(effects)
                    }),
                    enumerable: true
                });
            }
            skillTree = Object.freeze({ points, nodes: Object.freeze(nodes) });
        }
        Object.defineProperty(definitions, heroId, {
            value: Object.freeze({ ...abilityProfile.definitions[heroId], skillTree }),
            enumerable: true
        });
    }
    return Object.freeze({
        selectedHeroId: abilityProfile.selectedHeroId,
        definitions: Object.freeze(definitions),
        movementProfiles: abilityProfile.movementProfiles
    });
}
/** Normalize the closed nullable R5.5A passive tower-damage aura profile. */
export function normalizeHeroesProfileV6(input, root = "profile") {
    const profile = dataRecord(input, root, "Heroes profile");
    exactFields(profile, PROFILE_SCHEMA_V2.requiredFields, root, "Heroes profile");
    const rawDefinitions = dataRecord(profile.definitions, `${root}.definitions`, "Heroes definitions");
    const legacyDefinitions = {};
    for (const heroId of Object.keys(rawDefinitions).sort(compareBinary)) {
        const definitionRoot = `${root}.definitions.${heroId}`;
        const rawDefinition = dataRecord(rawDefinitions[heroId], definitionRoot, `Hero definition "${heroId}"`);
        exactFields(rawDefinition, DEFINITION_SCHEMA_V6.requiredFields, definitionRoot, `Hero definition "${heroId}"`);
        Object.defineProperty(legacyDefinitions, heroId, {
            value: {
                label: rawDefinition.label,
                spawn: rawDefinition.spawn,
                movement: rawDefinition.movement,
                durability: rawDefinition.durability,
                mana: rawDefinition.mana,
                activeAbility: rawDefinition.activeAbility,
                skillTree: rawDefinition.skillTree
            },
            enumerable: true
        });
    }
    const skillProfile = normalizeHeroesProfileV5({
        selectedHeroId: profile.selectedHeroId,
        definitions: legacyDefinitions,
        movementProfiles: profile.movementProfiles
    }, root);
    const definitions = {};
    for (const heroId of Object.keys(skillProfile.definitions).sort(compareBinary)) {
        const definitionRoot = `${root}.definitions.${heroId}`;
        const rawDefinition = dataRecord(rawDefinitions[heroId], definitionRoot, `Hero definition "${heroId}"`);
        let passiveAura = null;
        if (rawDefinition.passiveAura !== null) {
            const auraRoot = `${definitionRoot}.passiveAura`;
            const rawAura = dataRecord(rawDefinition.passiveAura, auraRoot, `Hero passive aura "${heroId}"`);
            exactFields(rawAura, PASSIVE_AURA_SCHEMA_V6.requiredFields, auraRoot, `Hero passive aura "${heroId}"`);
            const id = boundedText(rawAura.id, HEROES_LIMITS.idUtf8Bytes, `${auraRoot}.id`, "Required hero passive aura id");
            const label = boundedText(rawAura.label, HEROES_LIMITS.labelUtf8Bytes, `${auraRoot}.label`, "Required hero passive aura label");
            const radius = boundedInteger(rawAura.radius, 0, HERO_PASSIVE_AURA_LIMITS.radius, `${auraRoot}.radius`, "Hero passive aura radius");
            const rawEffects = dataArray(rawAura.effects, `${auraRoot}.effects`, `Hero passive aura effects "${heroId}"`);
            if (rawEffects.length < 1 || rawEffects.length > HERO_PASSIVE_AURA_LIMITS.effectsPerAura) {
                throw new HeroesProfileValidationError(`${auraRoot}.effects`, `Hero passive aura effects must contain 1..${HERO_PASSIVE_AURA_LIMITS.effectsPerAura} entries; `
                    + `the maximum is ${HERO_PASSIVE_AURA_LIMITS.effectsPerAura}.`);
            }
            const effects = rawEffects.map((rawEffect, effectIndex) => {
                const effectRoot = `${auraRoot}.effects[${effectIndex}]`;
                const effect = dataRecord(rawEffect, effectRoot, `Hero passive aura effect "${heroId}"`);
                exactFields(effect, PASSIVE_AURA_EFFECT_SCHEMA_V6.requiredFields, effectRoot, `Hero passive aura effect "${heroId}"`);
                if (effect.kind !== "modifier") {
                    throw new HeroesProfileValidationError(`${effectRoot}.kind`, "Hero passive aura effect kind is unsupported; it must be modifier.");
                }
                if (effect.scope !== "tower_damage") {
                    throw new HeroesProfileValidationError(`${effectRoot}.scope`, "Hero passive aura modifier scope must be tower_damage.");
                }
                const modifierRoot = `${effectRoot}.modifier`;
                const rawModifier = dataRecord(effect.modifier, modifierRoot, `Hero passive aura modifier "${heroId}"`);
                exactFields(rawModifier, PASSIVE_AURA_MODIFIER_SCHEMA_V6.requiredFields, modifierRoot, `Hero passive aura modifier "${heroId}"`);
                if (rawModifier.target !== "damage") {
                    throw new HeroesProfileValidationError(`${modifierRoot}.target`, "Hero passive aura target must be damage.");
                }
                const operation = rawModifier.operation;
                if (operation !== "flat" && operation !== "additive_ratio" && operation !== "multiplier") {
                    throw new HeroesProfileValidationError(`${modifierRoot}.operation`, "Hero passive aura operation is unsupported.");
                }
                const value = rawModifier.value;
                if (typeof value !== "number" || !Number.isFinite(value)) {
                    throw new HeroesProfileValidationError(`${modifierRoot}.value`, "Hero passive aura modifier value must be finite.");
                }
                const valid = operation === "flat"
                    ? Math.abs(value) <= HERO_PASSIVE_AURA_LIMITS.flatAbsoluteValue
                    : operation === "additive_ratio"
                        ? value >= HERO_PASSIVE_AURA_LIMITS.additiveRatioMinimum
                            && value <= HERO_PASSIVE_AURA_LIMITS.additiveRatioMaximum
                        : value >= HERO_PASSIVE_AURA_LIMITS.multiplierMinimum
                            && value <= HERO_PASSIVE_AURA_LIMITS.multiplierMaximum;
                if (!valid) {
                    throw new HeroesProfileValidationError(`${modifierRoot}.value`, `Hero passive aura ${operation} value exceeds the supported damage modifier range.`);
                }
                return Object.freeze({
                    kind: "modifier",
                    scope: "tower_damage",
                    modifier: Object.freeze({
                        target: "damage",
                        operation,
                        value: Object.is(value, -0) ? 0 : value
                    })
                });
            });
            passiveAura = Object.freeze({ id, label, radius, effects: Object.freeze(effects) });
        }
        Object.defineProperty(definitions, heroId, {
            value: Object.freeze({ ...skillProfile.definitions[heroId], passiveAura }),
            enumerable: true
        });
    }
    return Object.freeze({
        selectedHeroId: skillProfile.selectedHeroId,
        definitions: Object.freeze(definitions),
        movementProfiles: skillProfile.movementProfiles
    });
}
/** Normalize the closed nullable R5.6A dynamic-enemy blocking profile. */
export function normalizeHeroesProfileV7(input, root = "profile") {
    const profile = dataRecord(input, root, "Heroes profile");
    exactFields(profile, PROFILE_SCHEMA_V2.requiredFields, root, "Heroes profile");
    const rawDefinitions = dataRecord(profile.definitions, `${root}.definitions`, "Heroes definitions");
    const v6Definitions = {};
    for (const heroId of Object.keys(rawDefinitions).sort(compareBinary)) {
        const definitionRoot = `${root}.definitions.${heroId}`;
        const rawDefinition = dataRecord(rawDefinitions[heroId], definitionRoot, `Hero definition "${heroId}"`);
        exactFields(rawDefinition, DEFINITION_SCHEMA_V7.requiredFields, definitionRoot, `Hero definition "${heroId}"`);
        Object.defineProperty(v6Definitions, heroId, {
            value: {
                label: rawDefinition.label,
                spawn: rawDefinition.spawn,
                movement: rawDefinition.movement,
                durability: rawDefinition.durability,
                mana: rawDefinition.mana,
                activeAbility: rawDefinition.activeAbility,
                skillTree: rawDefinition.skillTree,
                passiveAura: rawDefinition.passiveAura
            },
            enumerable: true
        });
    }
    const auraProfile = normalizeHeroesProfileV6({
        selectedHeroId: profile.selectedHeroId,
        definitions: v6Definitions,
        movementProfiles: profile.movementProfiles
    }, root);
    const definitions = {};
    for (const heroId of Object.keys(auraProfile.definitions).sort(compareBinary)) {
        const definitionRoot = `${root}.definitions.${heroId}`;
        const rawDefinition = dataRecord(rawDefinitions[heroId], definitionRoot, `Hero definition "${heroId}"`);
        let blocking = null;
        if (rawDefinition.blocking !== null) {
            const blockingRoot = `${definitionRoot}.blocking`;
            const rawBlocking = dataRecord(rawDefinition.blocking, blockingRoot, `Hero blocking "${heroId}"`);
            exactFields(rawBlocking, BLOCKING_SCHEMA_V7.requiredFields, blockingRoot, `Hero blocking "${heroId}"`);
            const blockCapacity = boundedInteger(rawBlocking.blockCapacity, 1, HERO_BLOCKING_LIMITS.blockCapacity, `${blockingRoot}.blockCapacity`, "Hero block capacity");
            const rawMovementProfileIds = dataArray(rawBlocking.movementProfileIds, `${blockingRoot}.movementProfileIds`, `Hero blocking movement profile ids "${heroId}"`);
            if (rawMovementProfileIds.length < 1
                || rawMovementProfileIds.length > HERO_BLOCKING_LIMITS.movementProfileIds) {
                throw new HeroesProfileValidationError(`${blockingRoot}.movementProfileIds`, `Hero blocking movement profile ids must contain 1..${HERO_BLOCKING_LIMITS.movementProfileIds} entries.`);
            }
            const movementProfileIds = rawMovementProfileIds.map((movementProfileId, index) => boundedText(movementProfileId, HEROES_LIMITS.idUtf8Bytes, `${blockingRoot}.movementProfileIds[${index}]`, "Hero blocking movement profile id")).sort(compareBinary);
            for (let index = 1; index < movementProfileIds.length; index += 1) {
                if (movementProfileIds[index - 1] === movementProfileIds[index]) {
                    throw new HeroesProfileValidationError(`${blockingRoot}.movementProfileIds[${index}]`, `Hero blocking movement profile ids must be unique; duplicate "${movementProfileIds[index]}".`);
                }
            }
            blocking = Object.freeze({ blockCapacity, movementProfileIds: Object.freeze(movementProfileIds) });
        }
        Object.defineProperty(definitions, heroId, {
            value: Object.freeze({ ...auraProfile.definitions[heroId], blocking }),
            enumerable: true
        });
    }
    return Object.freeze({
        selectedHeroId: auraProfile.selectedHeroId,
        definitions: Object.freeze(definitions),
        movementProfiles: auraProfile.movementProfiles
    });
}
/** Reserve only the modifiers of the selected, non-null active v6 aura. */
export function activeHeroAuraModifierReserve(content, missionId) {
    const active = resolveActiveHeroesMechanics(content, missionId);
    if (active?.schemaVersion !== 6 && active?.schemaVersion !== 7)
        return 0;
    return active.definitions[active.selectedHeroId]?.passiveAura?.effects.length ?? 0;
}
/** Validate graph references and mission-dependent point budgets after structural normalization. */
export function validateHeroSkillTreeSemanticsV5(profile, root = "profile", missionWaveCounts = []) {
    const issues = [];
    for (const [heroId, definition] of Object.entries(profile.definitions)) {
        const tree = definition.skillTree;
        if (!tree)
            continue;
        const treeRoot = `${root}.definitions.${heroId}.skillTree`;
        const nodeIds = new Set(Object.keys(tree.nodes));
        for (const [skillId, node] of Object.entries(tree.nodes)) {
            const seen = new Set();
            for (let index = 0; index < node.requires.length; index += 1) {
                const requiredId = node.requires[index];
                const fieldPath = `${treeRoot}.nodes.${skillId}.requires[${index}]`;
                if (seen.has(requiredId)) {
                    issues.push({ fieldPath, message: `Hero skill prerequisite "${requiredId}" is duplicated.` });
                }
                else {
                    seen.add(requiredId);
                }
                if (requiredId === skillId) {
                    issues.push({ fieldPath, message: `Hero skill "${skillId}" cannot require itself.` });
                }
                else if (!nodeIds.has(requiredId)) {
                    issues.push({ fieldPath, message: `Hero skill prerequisite references unknown skill "${requiredId}".` });
                }
            }
        }
        const visiting = new Set();
        const visited = new Set();
        const visit = (skillId) => {
            if (visited.has(skillId))
                return;
            if (visiting.has(skillId)) {
                issues.push({
                    fieldPath: `${treeRoot}.nodes.${skillId}.requires`,
                    message: `Hero skill tree contains a prerequisite cycle involving "${skillId}".`
                });
                return;
            }
            visiting.add(skillId);
            for (const requiredId of tree.nodes[skillId]?.requires ?? []) {
                if (nodeIds.has(requiredId) && requiredId !== skillId)
                    visit(requiredId);
            }
            visiting.delete(skillId);
            visited.add(skillId);
        };
        for (const skillId of Object.keys(tree.nodes))
            visit(skillId);
        for (const waveCount of missionWaveCounts) {
            const interwaves = Math.max(0, waveCount - 1);
            const maximumEarnable = tree.points.starting + tree.points.perInterwave * interwaves;
            if (!Number.isSafeInteger(maximumEarnable) || maximumEarnable > HERO_SKILL_TREE_LIMITS.points) {
                issues.push({
                    fieldPath: `${treeRoot}.points`,
                    message: `Hero skill points exceed the mission maximum of ${HERO_SKILL_TREE_LIMITS.points}.`
                });
                break;
            }
        }
        if (heroId === profile.selectedHeroId) {
            const orderedEffects = Object.entries(tree.nodes).flatMap(([skillId, node]) => (node.effects.map((effect, effectIndex) => ({
                id: heroSkillModifierIdV5(skillId, effectIndex),
                operation: effect.modifier.operation,
                value: effect.modifier.value,
                fieldPath: `${treeRoot}.nodes.${skillId}.effects[${effectIndex}].modifier.value`
            })))).sort((left, right) => {
                const operationOrder = (operation) => (operation === "flat" ? 0 : operation === "additive_ratio" ? 1 : 2);
                return operationOrder(left.operation) - operationOrder(right.operation)
                    || compareBinary(left.id, right.id);
            });
            let resolvedDamage = definition.activeAbility.damage;
            let additiveRatioAnchor = resolvedDamage;
            for (const effect of orderedEffects) {
                if (effect.operation === "flat") {
                    resolvedDamage += effect.value;
                    additiveRatioAnchor = resolvedDamage;
                }
                else if (effect.operation === "additive_ratio") {
                    resolvedDamage += additiveRatioAnchor * effect.value;
                }
                else {
                    resolvedDamage *= effect.value;
                }
                if (!Number.isFinite(resolvedDamage)) {
                    issues.push({
                        fieldPath: effect.fieldPath,
                        message: "Hero skill modifier sequence overflows the finite DamageResolver range."
                    });
                    break;
                }
            }
        }
    }
    return Object.freeze(issues.map((issue) => Object.freeze(issue)));
}
function ownData(value, key) {
    if (value === null || typeof value !== "object")
        return undefined;
    try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
    }
    catch {
        return undefined;
    }
}
/** Resolve a detached profile only when the mission genuinely selected a supported heroes version. */
export function resolveActiveHeroesMechanics(content, missionId) {
    const capability = content.missions[missionId]?.capabilities.heroes;
    if (!capability?.active || capability.profileId === undefined)
        return undefined;
    const module = ownData(ownData(content.mechanics, "modules"), "heroes");
    const schemaVersion = ownData(module, "schemaVersion");
    if ((schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== 4
        && schemaVersion !== 5 && schemaVersion !== 6 && schemaVersion !== 7)
        || ownData(module, "enabled") !== true) {
        return undefined;
    }
    const profile = ownData(ownData(module, "profiles"), capability.profileId);
    let normalized;
    try {
        normalized = schemaVersion === 1
            ? normalizeHeroesProfileV1(profile, `modules.heroes.profiles.${capability.profileId}`)
            : schemaVersion === 2
                ? normalizeHeroesProfileV2(profile, `modules.heroes.profiles.${capability.profileId}`)
                : schemaVersion === 3
                    ? normalizeHeroesProfileV3(profile, `modules.heroes.profiles.${capability.profileId}`)
                    : schemaVersion === 4
                        ? normalizeHeroesProfileV4(profile, `modules.heroes.profiles.${capability.profileId}`)
                        : schemaVersion === 5
                            ? normalizeHeroesProfileV5(profile, `modules.heroes.profiles.${capability.profileId}`)
                            : schemaVersion === 6
                                ? normalizeHeroesProfileV6(profile, `modules.heroes.profiles.${capability.profileId}`)
                                : normalizeHeroesProfileV7(profile, `modules.heroes.profiles.${capability.profileId}`);
    }
    catch {
        return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(normalized.definitions, normalized.selectedHeroId))
        return undefined;
    if (schemaVersion === 2 || schemaVersion === 3 || schemaVersion === 4 || schemaVersion === 5
        || schemaVersion === 6 || schemaVersion === 7) {
        const moving = normalized;
        const definition = moving.definitions[moving.selectedHeroId];
        if (!definition || !Object.prototype.hasOwnProperty.call(moving.movementProfiles, definition.movement.movementProfileId)) {
            return undefined;
        }
        if (schemaVersion === 5 || schemaVersion === 6 || schemaVersion === 7) {
            const v5 = moving;
            if (validateHeroSkillTreeSemanticsV5(v5, `modules.heroes.profiles.${capability.profileId}`, [content.missions[missionId]?.waves.length ?? 0]).length > 0)
                return undefined;
            if (schemaVersion === 7) {
                const v7 = v5;
                const blocking = v7.definitions[v7.selectedHeroId]?.blocking;
                if (blocking !== null) {
                    let navigation;
                    try {
                        navigation = resolveActiveNavigationMechanics(content, missionId);
                    }
                    catch {
                        return undefined;
                    }
                    if (navigation?.mode !== "dynamic_flow"
                        || blocking === undefined
                        || blocking.movementProfileIds.some((movementProfileId) => (!Object.prototype.hasOwnProperty.call(navigation.movementProfiles, movementProfileId))))
                        return undefined;
                }
                return Object.freeze({
                    schemaVersion: 7,
                    profileId: capability.profileId,
                    selectedHeroId: v7.selectedHeroId,
                    definitions: v7.definitions,
                    movementProfiles: v7.movementProfiles
                });
            }
            return schemaVersion === 5
                ? Object.freeze({
                    schemaVersion: 5,
                    profileId: capability.profileId,
                    selectedHeroId: v5.selectedHeroId,
                    definitions: v5.definitions,
                    movementProfiles: v5.movementProfiles
                })
                : Object.freeze({
                    schemaVersion: 6,
                    profileId: capability.profileId,
                    selectedHeroId: v5.selectedHeroId,
                    definitions: v5.definitions,
                    movementProfiles: v5.movementProfiles
                });
        }
        return schemaVersion === 2
            ? Object.freeze({
                schemaVersion: 2,
                profileId: capability.profileId,
                selectedHeroId: moving.selectedHeroId,
                definitions: moving.definitions,
                movementProfiles: moving.movementProfiles
            })
            : schemaVersion === 3
                ? Object.freeze({
                    schemaVersion: 3,
                    profileId: capability.profileId,
                    selectedHeroId: moving.selectedHeroId,
                    definitions: moving.definitions,
                    movementProfiles: moving.movementProfiles
                })
                : Object.freeze({
                    schemaVersion: 4,
                    profileId: capability.profileId,
                    selectedHeroId: moving.selectedHeroId,
                    definitions: moving.definitions,
                    movementProfiles: moving.movementProfiles
                });
    }
    return Object.freeze({
        schemaVersion: 1,
        profileId: capability.profileId,
        selectedHeroId: normalized.selectedHeroId,
        definitions: normalized.definitions
    });
}
function compareBinary(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
