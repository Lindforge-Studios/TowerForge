import { resolveCapabilitySet, SHIELD_LIMITS } from "./mechanics.js";
export const ENEMY_BEHAVIORS_LIMITS = Object.freeze({
    bossesPerProfile: 256,
    componentsPerRoot: 32,
    towerBindingsPerProfile: 256,
    cohortsPerProfile: 64,
    membersPerCohort: 256,
    formationAssignmentsPerProfile: 4_096,
    neighborRadius: 2,
    steeringWeight: 1_000,
    tagsPerComponent: 32,
    priorityTagsPerBinding: 32,
    idOrTagUtf8Bytes: 128,
    labelUtf8Bytes: 256,
    maxHp: 1_000_000_000_000,
    hitRegionOffset: 4,
    hitRegionRadius: 8
});
export const BOSS_COMPONENT_ABILITY_IDS = Object.freeze([
    "towerAttack", "towerDisrupt", "healAura"
]);
export const FORMATION_ROLES = Object.freeze(["vanguard", "body", "support"]);
export class EnemyBehaviorsProfileValidationError extends Error {
}
function utf8Bytes(value) {
    return new TextEncoder().encode(value).length;
}
function recordDescriptors(value, path, maximumEntries) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new EnemyBehaviorsProfileValidationError(`${path} must be a plain object.`);
    }
    let prototype;
    let descriptors;
    try {
        prototype = Object.getPrototypeOf(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    }
    catch {
        throw new EnemyBehaviorsProfileValidationError(`${path} could not be inspected safely.`);
    }
    if (prototype !== Object.prototype && prototype !== null) {
        throw new EnemyBehaviorsProfileValidationError(`${path} must be a plain object with no custom prototype.`);
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new EnemyBehaviorsProfileValidationError(`${path} rejects symbol fields.`);
    }
    const keys = Object.keys(descriptors);
    if (maximumEntries !== undefined && keys.length > maximumEntries) {
        throw new EnemyBehaviorsProfileValidationError(`${path} exceeds the maximum limit of ${maximumEntries} entries.`);
    }
    return { keys, descriptors };
}
function record(value, path, maximumEntries) {
    const { keys, descriptors } = recordDescriptors(value, path, maximumEntries);
    const detached = Object.create(null);
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            throw new EnemyBehaviorsProfileValidationError(`${path}.${key} must be an enumerable own data property; accessors are forbidden.`);
        }
        Object.defineProperty(detached, key, { value: descriptor.value, enumerable: true });
    }
    return detached;
}
function closed(value, required, optional, path) {
    const allowed = new Set([...required, ...optional]);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            throw new EnemyBehaviorsProfileValidationError(`${path} is closed; unknown field "${key}".`);
        }
    }
    for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            throw new EnemyBehaviorsProfileValidationError(`${path}.${key} is required.`);
        }
    }
}
function boundedString(value, path, maximumBytes) {
    if (typeof value !== "string" || value.length === 0 || value !== value.trim()
        || /[\u0000-\u001f\u007f]/.test(value) || utf8Bytes(value) > maximumBytes) {
        throw new EnemyBehaviorsProfileValidationError(`${path} must be a bounded non-empty UTF-8 string of at most ${maximumBytes} bytes.`);
    }
    return value;
}
function finite(value, path, minimum, maximum, exclusiveMinimum = false) {
    if (typeof value !== "number" || !Number.isFinite(value)
        || (exclusiveMinimum ? value <= minimum : value < minimum) || value > maximum) {
        throw new EnemyBehaviorsProfileValidationError(`${path} must be finite and in the supported range.`);
    }
    return value;
}
function integer(value, path, minimum, maximum) {
    const normalized = finite(value, path, minimum, maximum);
    if (!Number.isSafeInteger(normalized)) {
        throw new EnemyBehaviorsProfileValidationError(`${path} must be an integer in ${minimum}..${maximum}.`);
    }
    return normalized;
}
function denseStringSet(value, path, maximumLength, allowed, allowEmpty = true) {
    if (!Array.isArray(value)) {
        throw new EnemyBehaviorsProfileValidationError(`${path} must be a dense array.`);
    }
    let descriptors;
    try {
        if (Object.getPrototypeOf(value) !== Array.prototype)
            throw new Error();
        descriptors = Object.getOwnPropertyDescriptors(value);
    }
    catch {
        throw new EnemyBehaviorsProfileValidationError(`${path} could not be inspected safely as a dense array.`);
    }
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < (allowEmpty ? 0 : 1) || length > maximumLength
        || Object.getOwnPropertySymbols(descriptors).length > 0
        || Object.keys(descriptors).filter((key) => key !== "length").length !== length) {
        throw new EnemyBehaviorsProfileValidationError(`${path} must be a bounded dense array.`);
    }
    const result = [];
    const seen = new Set();
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            throw new EnemyBehaviorsProfileValidationError(`${path}[${index}] must be an enumerable own data property.`);
        }
        const item = boundedString(descriptor.value, `${path}[${index}]`, ENEMY_BEHAVIORS_LIMITS.idOrTagUtf8Bytes);
        if (allowed && !allowed.includes(item)) {
            throw new EnemyBehaviorsProfileValidationError(`${path}[${index}] contains unsupported value "${item}".`);
        }
        if (seen.has(item))
            throw new EnemyBehaviorsProfileValidationError(`${path} contains duplicate value "${item}".`);
        seen.add(item);
        result.push(item);
    }
    return Object.freeze(result);
}
function normalizeShield(value, path) {
    const shield = record(value, path);
    closed(shield, ["capacity"], ["regeneration"], path);
    const capacity = finite(shield.capacity, `${path}.capacity`, 0, SHIELD_LIMITS.capacity, true);
    if (shield.regeneration === undefined)
        return Object.freeze({ capacity });
    const regeneration = record(shield.regeneration, `${path}.regeneration`);
    closed(regeneration, ["ratePerUnit"], ["delayAfterDamage"], `${path}.regeneration`);
    const ratePerUnit = finite(regeneration.ratePerUnit, `${path}.regeneration.ratePerUnit`, 0, SHIELD_LIMITS.ratePerUnit, true);
    const delayAfterDamage = regeneration.delayAfterDamage === undefined
        ? undefined
        : finite(regeneration.delayAfterDamage, `${path}.regeneration.delayAfterDamage`, 0, SHIELD_LIMITS.delayAfterDamage);
    return Object.freeze({
        capacity,
        regeneration: Object.freeze({
            ratePerUnit,
            ...(delayAfterDamage === undefined ? {} : { delayAfterDamage })
        })
    });
}
function normalizeComponent(value, path) {
    const component = record(value, path);
    closed(component, ["maxHp", "hitRegion"], ["label", "tags", "shield", "armorTypeId", "disablesAbilities"], path);
    const hitRegion = record(component.hitRegion, `${path}.hitRegion`);
    closed(hitRegion, ["kind", "offsetX", "offsetY", "radius"], [], `${path}.hitRegion`);
    if (hitRegion.kind !== "circle") {
        throw new EnemyBehaviorsProfileValidationError(`${path}.hitRegion.kind must be "circle".`);
    }
    const normalizedHitRegion = Object.freeze({
        kind: "circle",
        offsetX: finite(hitRegion.offsetX, `${path}.hitRegion.offsetX`, -ENEMY_BEHAVIORS_LIMITS.hitRegionOffset, ENEMY_BEHAVIORS_LIMITS.hitRegionOffset),
        offsetY: finite(hitRegion.offsetY, `${path}.hitRegion.offsetY`, -ENEMY_BEHAVIORS_LIMITS.hitRegionOffset, ENEMY_BEHAVIORS_LIMITS.hitRegionOffset),
        radius: finite(hitRegion.radius, `${path}.hitRegion.radius`, 0, ENEMY_BEHAVIORS_LIMITS.hitRegionRadius, true)
    });
    const label = component.label === undefined
        ? undefined
        : boundedString(component.label, `${path}.label`, ENEMY_BEHAVIORS_LIMITS.labelUtf8Bytes);
    const tags = component.tags === undefined
        ? undefined
        : denseStringSet(component.tags, `${path}.tags`, ENEMY_BEHAVIORS_LIMITS.tagsPerComponent);
    const armorTypeId = component.armorTypeId === undefined
        ? undefined
        : boundedString(component.armorTypeId, `${path}.armorTypeId`, ENEMY_BEHAVIORS_LIMITS.idOrTagUtf8Bytes);
    const disablesAbilities = component.disablesAbilities === undefined
        ? undefined
        : denseStringSet(component.disablesAbilities, `${path}.disablesAbilities`, BOSS_COMPONENT_ABILITY_IDS.length, BOSS_COMPONENT_ABILITY_IDS);
    return Object.freeze({
        maxHp: finite(component.maxHp, `${path}.maxHp`, 0, ENEMY_BEHAVIORS_LIMITS.maxHp, true),
        hitRegion: normalizedHitRegion,
        ...(label === undefined ? {} : { label }),
        ...(tags === undefined ? {} : { tags }),
        ...(component.shield === undefined ? {} : { shield: normalizeShield(component.shield, `${path}.shield`) }),
        ...(armorTypeId === undefined ? {} : { armorTypeId }),
        ...(disablesAbilities === undefined ? {} : { disablesAbilities })
    });
}
/** Closed hostile-data-safe parser that returns detached, binary-ordered, deeply frozen own data. */
export function normalizeEnemyBehaviorsProfileV1(value) {
    const profile = record(value, "enemyBehaviors profile");
    closed(profile, [], ["bosses", "targeting", "formations"], "enemyBehaviors profile");
    if (profile.bosses === undefined && profile.formations === undefined) {
        throw new EnemyBehaviorsProfileValidationError("enemyBehaviors profile requires at least one of bosses or formations.");
    }
    if (profile.targeting !== undefined && profile.bosses === undefined) {
        throw new EnemyBehaviorsProfileValidationError("enemyBehaviors profile.targeting requires bosses.");
    }
    let bosses;
    if (profile.bosses !== undefined) {
        const bossesInput = record(profile.bosses, "enemyBehaviors profile.bosses", ENEMY_BEHAVIORS_LIMITS.bossesPerProfile);
        const bossIds = Object.keys(bossesInput).sort();
        if (bossIds.length === 0) {
            throw new EnemyBehaviorsProfileValidationError("enemyBehaviors profile.bosses must contain at least one boss.");
        }
        const normalizedBosses = Object.create(null);
        for (const bossId of bossIds) {
            boundedString(bossId, "enemyBehaviors boss id", ENEMY_BEHAVIORS_LIMITS.idOrTagUtf8Bytes);
            const bossPath = `enemyBehaviors profile.bosses.${bossId}`;
            const boss = record(bossesInput[bossId], bossPath);
            closed(boss, ["components"], [], bossPath);
            const componentsInput = record(boss.components, `${bossPath}.components`, ENEMY_BEHAVIORS_LIMITS.componentsPerRoot);
            const componentIds = Object.keys(componentsInput).sort();
            if (componentIds.length === 0) {
                throw new EnemyBehaviorsProfileValidationError(`${bossPath}.components must contain at least one component.`);
            }
            const components = Object.create(null);
            for (const componentId of componentIds) {
                boundedString(componentId, `${bossPath} component id`, ENEMY_BEHAVIORS_LIMITS.idOrTagUtf8Bytes);
                Object.defineProperty(components, componentId, {
                    value: normalizeComponent(componentsInput[componentId], `${bossPath}.components.${componentId}`),
                    enumerable: true
                });
            }
            Object.defineProperty(normalizedBosses, bossId, {
                value: Object.freeze({ components: Object.freeze(components) }),
                enumerable: true
            });
        }
        bosses = Object.freeze(normalizedBosses);
    }
    let targeting;
    if (profile.targeting !== undefined) {
        const targetingInput = record(profile.targeting, "enemyBehaviors profile.targeting");
        closed(targetingInput, ["towers"], [], "enemyBehaviors profile.targeting");
        const towersInput = record(targetingInput.towers, "enemyBehaviors profile.targeting.towers", ENEMY_BEHAVIORS_LIMITS.towerBindingsPerProfile);
        const towers = Object.create(null);
        for (const towerId of Object.keys(towersInput).sort()) {
            boundedString(towerId, "enemyBehaviors targeting tower id", ENEMY_BEHAVIORS_LIMITS.idOrTagUtf8Bytes);
            const bindingPath = `enemyBehaviors profile.targeting.towers.${towerId}`;
            const binding = record(towersInput[towerId], bindingPath);
            closed(binding, ["priorityTags"], [], bindingPath);
            Object.defineProperty(towers, towerId, {
                value: Object.freeze({
                    priorityTags: denseStringSet(binding.priorityTags, `${bindingPath}.priorityTags`, ENEMY_BEHAVIORS_LIMITS.priorityTagsPerBinding, undefined, false)
                }),
                enumerable: true
            });
        }
        targeting = Object.freeze({ towers: Object.freeze(towers) });
    }
    let formations;
    if (profile.formations !== undefined) {
        const formationsInput = record(profile.formations, "enemyBehaviors profile.formations");
        closed(formationsInput, ["cohorts"], [], "enemyBehaviors profile.formations");
        const cohortsInput = record(formationsInput.cohorts, "enemyBehaviors profile.formations.cohorts", ENEMY_BEHAVIORS_LIMITS.cohortsPerProfile);
        const cohortIds = Object.keys(cohortsInput).sort();
        if (cohortIds.length === 0) {
            throw new EnemyBehaviorsProfileValidationError("enemyBehaviors profile.formations.cohorts must contain at least one cohort.");
        }
        const normalizedCohorts = Object.create(null);
        const assignedEnemyIds = new Set();
        let assignmentCount = 0;
        for (const cohortId of cohortIds) {
            boundedString(cohortId, "enemyBehaviors formation cohort id", ENEMY_BEHAVIORS_LIMITS.idOrTagUtf8Bytes);
            const cohortPath = `enemyBehaviors profile.formations.cohorts.${cohortId}`;
            const cohort = record(cohortsInput[cohortId], cohortPath);
            closed(cohort, ["members", "steering"], [], cohortPath);
            const membersInspection = recordDescriptors(cohort.members, `${cohortPath}.members`, ENEMY_BEHAVIORS_LIMITS.membersPerCohort);
            const memberIds = [...membersInspection.keys].sort();
            if (memberIds.length === 0) {
                throw new EnemyBehaviorsProfileValidationError(`${cohortPath}.members must contain at least one member.`);
            }
            assignmentCount += memberIds.length;
            if (assignmentCount > ENEMY_BEHAVIORS_LIMITS.formationAssignmentsPerProfile) {
                throw new EnemyBehaviorsProfileValidationError(`enemyBehaviors formation assignments exceed the maximum limit of ${ENEMY_BEHAVIORS_LIMITS.formationAssignmentsPerProfile}.`);
            }
            const membersInput = Object.create(null);
            for (const enemyTypeId of memberIds) {
                const descriptor = membersInspection.descriptors[enemyTypeId];
                if (!descriptor?.enumerable || !("value" in descriptor)) {
                    throw new EnemyBehaviorsProfileValidationError(`${cohortPath}.members.${enemyTypeId} must be an enumerable own data property; accessors are forbidden.`);
                }
                Object.defineProperty(membersInput, enemyTypeId, { value: descriptor.value, enumerable: true });
            }
            const members = Object.create(null);
            for (const enemyTypeId of memberIds) {
                boundedString(enemyTypeId, `${cohortPath} member enemy id`, ENEMY_BEHAVIORS_LIMITS.idOrTagUtf8Bytes);
                if (assignedEnemyIds.has(enemyTypeId)) {
                    throw new EnemyBehaviorsProfileValidationError(`enemyBehaviors formations contain duplicate enemy assignment "${enemyTypeId}".`);
                }
                assignedEnemyIds.add(enemyTypeId);
                const role = membersInput[enemyTypeId];
                if (typeof role !== "string" || !FORMATION_ROLES.includes(role)) {
                    throw new EnemyBehaviorsProfileValidationError(`${cohortPath}.members.${enemyTypeId} has an unsupported formation role.`);
                }
                Object.defineProperty(members, enemyTypeId, { value: role, enumerable: true });
            }
            const steeringPath = `${cohortPath}.steering`;
            const steeringInput = record(cohort.steering, steeringPath);
            closed(steeringInput, ["neighborRadius", "cohesionWeight", "separationWeight", "roleWeight"], [], steeringPath);
            const neighborRadius = integer(steeringInput.neighborRadius, `${steeringPath}.neighborRadius`, 1, ENEMY_BEHAVIORS_LIMITS.neighborRadius);
            const cohesionWeight = integer(steeringInput.cohesionWeight, `${steeringPath}.cohesionWeight`, 0, ENEMY_BEHAVIORS_LIMITS.steeringWeight);
            const separationWeight = integer(steeringInput.separationWeight, `${steeringPath}.separationWeight`, 0, ENEMY_BEHAVIORS_LIMITS.steeringWeight);
            const roleWeight = integer(steeringInput.roleWeight, `${steeringPath}.roleWeight`, 0, ENEMY_BEHAVIORS_LIMITS.steeringWeight);
            if (cohesionWeight === 0 && separationWeight === 0 && roleWeight === 0) {
                throw new EnemyBehaviorsProfileValidationError(`${steeringPath} requires at least one positive steering weight.`);
            }
            Object.defineProperty(normalizedCohorts, cohortId, {
                value: Object.freeze({
                    members: Object.freeze(members),
                    steering: Object.freeze({ neighborRadius, cohesionWeight, separationWeight, roleWeight })
                }),
                enumerable: true
            });
        }
        formations = Object.freeze({ cohorts: Object.freeze(normalizedCohorts) });
    }
    return Object.freeze({
        ...(bosses === undefined ? {} : { bosses }),
        ...(targeting === undefined ? {} : { targeting }),
        ...(formations === undefined ? {} : { formations })
    });
}
export function resolveActiveEnemyBehaviorsV1(content, missionId) {
    const mission = content.missions[missionId];
    const capability = mission ? resolveCapabilitySet(content.mechanics, mission.mechanics).enemyBehaviors : undefined;
    if (!mission || !capability?.active || !capability.profileId)
        return undefined;
    const module = content.mechanics.modules.enemyBehaviors;
    if (!module || module.schemaVersion !== 1 || module.enabled !== true)
        return undefined;
    const profile = module.profiles[capability.profileId];
    if (profile === undefined)
        return undefined;
    try {
        return Object.freeze({
            schemaVersion: 1,
            profileId: capability.profileId,
            ...normalizeEnemyBehaviorsProfileV1(profile)
        });
    }
    catch {
        return undefined;
    }
}
