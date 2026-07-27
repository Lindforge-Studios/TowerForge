import { ARMOR_MATRIX_LIMITS, MARK_LIMITS, SHIELD_LIMITS, resolveCapabilitySet } from "./mechanics.js";
function emptyRecord() {
    return Object.create(null);
}
function plainRecord(value, label, allowNullPrototype = false) {
    let prototype;
    let descriptors;
    try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
            ? Object.getOwnPropertyDescriptors(value)
            : {};
    }
    catch {
        throw new Error(`${label} could not be inspected safely.`);
    }
    if (value === null
        || typeof value !== "object"
        || Array.isArray(value)
        || (prototype !== Object.prototype && !(allowNullPrototype && prototype === null))) {
        throw new Error(`${label} must be a plain object with own data fields.`);
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new Error(`${label} contains unsupported symbol fields.`);
    }
    const detached = {};
    for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
            throw new Error(`${label}.${key} must be an enumerable own data property.`);
        }
        Object.defineProperty(detached, key, {
            value: descriptor.value,
            enumerable: true,
            configurable: true,
            writable: true
        });
    }
    return detached;
}
function normalizeAssignedEnemyResistances(assignments, damageTypes, content) {
    const normalized = emptyRecord();
    for (const enemyTypeId of Object.keys(assignments).sort()) {
        const raw = content.enemies[enemyTypeId]?.resistances;
        const values = raw === undefined
            ? {}
            : plainRecord(raw, `Enemy "${enemyTypeId}" resistances`, true);
        const detached = emptyRecord();
        for (const damageTypeId of Object.keys(values).sort()) {
            const multiplier = values[damageTypeId];
            if (!Object.prototype.hasOwnProperty.call(damageTypes, damageTypeId)) {
                throw new Error(`Enemy "${enemyTypeId}" resistance references unknown damage type "${damageTypeId}".`);
            }
            if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier < 0) {
                throw new Error(`Enemy "${enemyTypeId}" resistance "${damageTypeId}" must be a finite non-negative number.`);
            }
            Object.defineProperty(detached, damageTypeId, { value: multiplier, enumerable: true });
        }
        Object.defineProperty(normalized, enemyTypeId, {
            value: Object.freeze(detached),
            enumerable: true
        });
    }
    return Object.freeze(normalized);
}
function exactKeys(value, allowed, label) {
    const allowedKeys = new Set(allowed);
    if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
        throw new Error(`${label} contains an unsupported field for its schema version.`);
    }
}
function boundedNumber(value, maximum, allowZero, label, domain) {
    if (typeof value !== "number"
        || !Number.isFinite(value)
        || (allowZero ? value < 0 : value <= 0)
        || value > maximum) {
        throw new Error(`${label} is outside the supported ${domain} range.`);
    }
    return value;
}
function labelValue(value, label) {
    if (typeof value !== "string"
        || value.length === 0
        || value.length > ARMOR_MATRIX_LIMITS.labelLength) {
        throw new Error(`${label} must be a non-empty label of at most ${ARMOR_MATRIX_LIMITS.labelLength} characters.`);
    }
    return value;
}
function normalizeRegeneration(value, label) {
    if (value === undefined)
        return undefined;
    const regeneration = plainRecord(value, label);
    exactKeys(regeneration, ["ratePerUnit", "delayAfterDamage"], label);
    const ratePerUnit = boundedNumber(regeneration.ratePerUnit, SHIELD_LIMITS.ratePerUnit, false, `${label}.ratePerUnit`, "shield");
    const delayAfterDamage = regeneration.delayAfterDamage === undefined
        ? undefined
        : boundedNumber(regeneration.delayAfterDamage, SHIELD_LIMITS.delayAfterDamage, true, `${label}.delayAfterDamage`, "shield");
    return Object.freeze({
        ratePerUnit,
        ...(delayAfterDamage === undefined ? {} : { delayAfterDamage })
    });
}
function normalizeShieldDefinitions(value, targetKind, content, label) {
    if (value === undefined)
        return Object.freeze(emptyRecord());
    const definitions = plainRecord(value, label);
    const normalized = emptyRecord();
    for (const targetId of Object.keys(definitions).sort()) {
        const definition = plainRecord(definitions[targetId], `${label}.${targetId}`);
        exactKeys(definition, ["capacity", "regeneration"], `${label}.${targetId}`);
        const capacity = boundedNumber(definition.capacity, SHIELD_LIMITS.capacity, false, `${label}.${targetId}.capacity`, "shield");
        const regeneration = normalizeRegeneration(definition.regeneration, `${label}.${targetId}.regeneration`);
        if (targetKind === "enemy") {
            if (!Object.prototype.hasOwnProperty.call(content.enemies, targetId)) {
                throw new Error("Active combat shield references an unknown enemy type.");
            }
        }
        else {
            const tower = Object.prototype.hasOwnProperty.call(content.towers, targetId)
                ? content.towers[targetId]
                : undefined;
            if (!tower)
                throw new Error("Active combat shield references an unknown tower type.");
            if (typeof tower.maxHp !== "number" || !Number.isFinite(tower.maxHp) || tower.maxHp <= 0) {
                throw new Error("Active combat shield requires a destructible tower with maxHp greater than zero.");
            }
        }
        Object.defineProperty(normalized, targetId, {
            value: Object.freeze({
                capacity,
                ...(regeneration === undefined ? {} : { regeneration })
            }),
            enumerable: true
        });
    }
    return Object.freeze(normalized);
}
function normalizeShields(value, content) {
    if (value === undefined) {
        return Object.freeze({
            enemies: Object.freeze(emptyRecord()),
            towers: Object.freeze(emptyRecord())
        });
    }
    const shields = plainRecord(value, "Active combat shields");
    exactKeys(shields, ["enemies", "towers"], "Active combat shields");
    return Object.freeze({
        enemies: normalizeShieldDefinitions(shields.enemies, "enemy", content, "Active combat enemy shields"),
        towers: normalizeShieldDefinitions(shields.towers, "tower", content, "Active combat tower shields")
    });
}
function normalizeDamageTypes(value) {
    if (value === undefined)
        return Object.freeze(emptyRecord());
    const definitions = plainRecord(value, "Active combat damage types");
    if (Object.keys(definitions).length > ARMOR_MATRIX_LIMITS.damageTypes) {
        throw new Error(`Active combat damage types exceed the ${ARMOR_MATRIX_LIMITS.damageTypes} definition limit.`);
    }
    const normalized = emptyRecord();
    for (const damageTypeId of Object.keys(definitions).sort()) {
        if (damageTypeId.trim().length === 0)
            throw new Error("Active combat damage type ids must be non-empty.");
        const definition = plainRecord(definitions[damageTypeId], `Active combat damageTypes.${damageTypeId}`);
        exactKeys(definition, ["label"], `Active combat damageTypes.${damageTypeId}`);
        Object.defineProperty(normalized, damageTypeId, {
            value: Object.freeze({ label: labelValue(definition.label, `Damage type "${damageTypeId}" label`) }),
            enumerable: true
        });
    }
    return Object.freeze(normalized);
}
function normalizeArmorTypes(value, damageTypes) {
    if (value === undefined)
        return Object.freeze(emptyRecord());
    const definitions = plainRecord(value, "Active combat armor types");
    if (Object.keys(definitions).length > ARMOR_MATRIX_LIMITS.armorTypes) {
        throw new Error(`Active combat armor types exceed the ${ARMOR_MATRIX_LIMITS.armorTypes} definition limit.`);
    }
    const normalized = emptyRecord();
    let matrixEntries = 0;
    for (const armorTypeId of Object.keys(definitions).sort()) {
        if (armorTypeId.trim().length === 0)
            throw new Error("Active combat armor type ids must be non-empty.");
        const definition = plainRecord(definitions[armorTypeId], `Active combat armorTypes.${armorTypeId}`);
        exactKeys(definition, ["label", "defaultMultiplier", "multipliers"], `Active combat armorTypes.${armorTypeId}`);
        const multipliers = plainRecord(definition.multipliers, `Active combat armorTypes.${armorTypeId}.multipliers`);
        matrixEntries += Object.keys(multipliers).length;
        if (matrixEntries > ARMOR_MATRIX_LIMITS.matrixEntries) {
            throw new Error(`Active combat armor matrix exceeds the ${ARMOR_MATRIX_LIMITS.matrixEntries} entry limit.`);
        }
        const normalizedMultipliers = emptyRecord();
        for (const damageTypeId of Object.keys(multipliers).sort()) {
            if (!Object.prototype.hasOwnProperty.call(damageTypes, damageTypeId)) {
                throw new Error(`Active combat armor matrix references unknown damage type "${damageTypeId}".`);
            }
            Object.defineProperty(normalizedMultipliers, damageTypeId, {
                value: boundedNumber(multipliers[damageTypeId], ARMOR_MATRIX_LIMITS.multiplier, true, `Active combat armorTypes.${armorTypeId}.multipliers.${damageTypeId}`, "armor"),
                enumerable: true
            });
        }
        const defaultMultiplier = definition.defaultMultiplier === undefined
            ? undefined
            : boundedNumber(definition.defaultMultiplier, ARMOR_MATRIX_LIMITS.multiplier, true, `Active combat armorTypes.${armorTypeId}.defaultMultiplier`, "armor");
        Object.defineProperty(normalized, armorTypeId, {
            value: Object.freeze({
                label: labelValue(definition.label, `Armor type "${armorTypeId}" label`),
                ...(defaultMultiplier === undefined ? {} : { defaultMultiplier }),
                multipliers: Object.freeze(normalizedMultipliers)
            }),
            enumerable: true
        });
    }
    return Object.freeze(normalized);
}
function normalizeEnemyArmorAssignments(value, content, armorTypes) {
    if (value === undefined)
        return Object.freeze(emptyRecord());
    const assignments = plainRecord(value, "Active combat armor assignments");
    exactKeys(assignments, ["enemies"], "Active combat armor assignments");
    if (assignments.enemies === undefined)
        return Object.freeze(emptyRecord());
    const enemies = plainRecord(assignments.enemies, "Active combat enemy armor assignments");
    if (Object.keys(enemies).length > ARMOR_MATRIX_LIMITS.assignments) {
        throw new Error(`Active combat enemy armor assignments exceed the ${ARMOR_MATRIX_LIMITS.assignments} assignment limit.`);
    }
    const normalized = emptyRecord();
    for (const enemyTypeId of Object.keys(enemies).sort()) {
        const armorTypeId = enemies[enemyTypeId];
        if (!Object.prototype.hasOwnProperty.call(content.enemies, enemyTypeId)) {
            throw new Error(`Active combat armor assignment references unknown enemy "${enemyTypeId}".`);
        }
        if (typeof armorTypeId !== "string"
            || !Object.prototype.hasOwnProperty.call(armorTypes, armorTypeId)) {
            throw new Error(`Active combat armor assignment references unknown armor type "${String(armorTypeId)}".`);
        }
        Object.defineProperty(normalized, enemyTypeId, { value: armorTypeId, enumerable: true });
    }
    return Object.freeze(normalized);
}
function markNumber(value, label, maximum, integer = false) {
    if (typeof value !== "number"
        || !Number.isFinite(value)
        || value <= 0
        || value > maximum
        || (integer && !Number.isSafeInteger(value))) {
        throw new Error(`${label} is outside the supported mark range.`);
    }
    return value;
}
function normalizeMarkDefinitions(value, damageTypes) {
    const definitions = plainRecord(value, "Active combat mark definitions");
    if (Object.keys(definitions).length > MARK_LIMITS.definitions) {
        throw new Error(`Active combat mark definitions exceed the ${MARK_LIMITS.definitions} definition limit.`);
    }
    const normalized = emptyRecord();
    for (const markId of Object.keys(definitions).sort()) {
        if (markId.trim().length === 0)
            throw new Error("Active combat mark ids must be non-empty.");
        const definition = plainRecord(definitions[markId], `Active combat marks.definitions.${markId}`);
        exactKeys(definition, ["label", "duration", "maxStacks", "multiplier", "consumePolicy", "damageTypes"], `Active combat marks.definitions.${markId}`);
        for (const required of ["label", "duration", "maxStacks", "multiplier", "consumePolicy"]) {
            if (!Object.prototype.hasOwnProperty.call(definition, required)) {
                throw new Error(`Active combat marks.definitions.${markId}.${required} is required.`);
            }
        }
        const label = definition.label;
        if (typeof label !== "string" || label.length === 0 || label.length > MARK_LIMITS.labelLength) {
            throw new Error(`Active combat mark "${markId}" label must contain 1..${MARK_LIMITS.labelLength} characters.`);
        }
        const duration = markNumber(definition.duration, `Mark "${markId}" duration`, MARK_LIMITS.duration);
        const maxStacks = markNumber(definition.maxStacks, `Mark "${markId}" maxStacks`, MARK_LIMITS.maxStacks, true);
        const multiplier = markNumber(definition.multiplier, `Mark "${markId}" multiplier`, MARK_LIMITS.multiplier);
        if (multiplier <= 1)
            throw new Error(`Mark "${markId}" multiplier must be greater than one.`);
        const consumePolicy = definition.consumePolicy;
        if (consumePolicy !== "retain" && consumePolicy !== "consume_one" && consumePolicy !== "consume_all") {
            throw new Error(`Mark "${markId}" consume policy is unsupported.`);
        }
        let normalizedDamageTypes;
        if (definition.damageTypes !== undefined) {
            if (!Array.isArray(definition.damageTypes)
                || definition.damageTypes.length === 0
                || definition.damageTypes.length > MARK_LIMITS.filterDamageTypes) {
                throw new Error(`Mark "${markId}" damage type filter exceeds the supported limit.`);
            }
            const values = [];
            const seenDamageTypes = new Set();
            for (let index = 0; index < definition.damageTypes.length; index += 1) {
                const descriptor = Object.getOwnPropertyDescriptor(definition.damageTypes, String(index));
                const damageTypeId = descriptor && "value" in descriptor ? descriptor.value : undefined;
                if (typeof damageTypeId !== "string"
                    || damageTypeId.trim().length === 0
                    || !Object.prototype.hasOwnProperty.call(damageTypes, damageTypeId)) {
                    throw new Error(`Mark "${markId}" references an unknown damage type.`);
                }
                if (seenDamageTypes.has(damageTypeId)) {
                    throw new Error(`Mark "${markId}" damage type filter contains duplicate damage type "${damageTypeId}".`);
                }
                seenDamageTypes.add(damageTypeId);
                values.push(damageTypeId);
            }
            normalizedDamageTypes = Object.freeze(values);
        }
        Object.defineProperty(normalized, markId, {
            value: Object.freeze({
                label,
                duration,
                maxStacks,
                multiplier,
                consumePolicy,
                ...(normalizedDamageTypes === undefined ? {} : { damageTypes: normalizedDamageTypes })
            }),
            enumerable: true
        });
    }
    return Object.freeze(normalized);
}
function normalizeMarkApplications(value, label, definitions) {
    if (!Array.isArray(value) || value.length > MARK_LIMITS.applicationsPerSource) {
        throw new Error(`${label} must contain at most ${MARK_LIMITS.applicationsPerSource} mark applications.`);
    }
    const normalized = [];
    const seenMarkIds = new Set();
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
            throw new Error(`${label}[${index}] must be an enumerable own data property.`);
        }
        const application = plainRecord(descriptor.value, `${label}[${index}]`);
        exactKeys(application, ["markId", "stacks"], `${label}[${index}]`);
        const markId = application.markId;
        if (typeof markId !== "string" || !Object.prototype.hasOwnProperty.call(definitions, markId)) {
            throw new Error(`${label}[${index}] references an unknown mark.`);
        }
        if (seenMarkIds.has(markId)) {
            throw new Error(`${label}[${index}] duplicates mark "${markId}" for the same source.`);
        }
        seenMarkIds.add(markId);
        const stacks = application.stacks === undefined
            ? undefined
            : markNumber(application.stacks, `${label}[${index}].stacks`, definitions[markId].maxStacks, true);
        normalized.push(Object.freeze({ markId, ...(stacks === undefined ? {} : { stacks }) }));
    }
    normalized.sort((left, right) => left.markId < right.markId ? -1 : left.markId > right.markId ? 1 : 0);
    return Object.freeze(normalized);
}
function normalizeMarkBindings(value, definitions, content) {
    const emptyBindings = () => Object.freeze(emptyRecord());
    if (value === undefined) {
        return Object.freeze({ towers: emptyBindings(), abilities: emptyBindings(), towerScripts: emptyBindings() });
    }
    const bindings = plainRecord(value, "Active combat mark bindings");
    exactKeys(bindings, ["towers", "abilities", "towerScripts"], "Active combat mark bindings");
    let sourceCount = 0;
    const group = (groupName, known) => {
        if (bindings[groupName] === undefined)
            return emptyBindings();
        const sources = plainRecord(bindings[groupName], `Active combat mark bindings.${groupName}`);
        sourceCount += Object.keys(sources).length;
        if (sourceCount > MARK_LIMITS.sourceBindings) {
            throw new Error(`Active combat mark bindings exceed the ${MARK_LIMITS.sourceBindings} source limit.`);
        }
        const normalized = emptyRecord();
        for (const sourceId of Object.keys(sources).sort()) {
            if (!Object.prototype.hasOwnProperty.call(known, sourceId)) {
                throw new Error(`Active combat mark bindings.${groupName} references unknown source "${sourceId}".`);
            }
            Object.defineProperty(normalized, sourceId, {
                value: normalizeMarkApplications(sources[sourceId], `Active combat mark bindings.${groupName}.${sourceId}`, definitions),
                enumerable: true
            });
        }
        return Object.freeze(normalized);
    };
    return Object.freeze({
        towers: group("towers", content.towers),
        abilities: group("abilities", content.abilities),
        towerScripts: group("towerScripts", content.scripts)
    });
}
function normalizeMarks(value, damageTypes, content) {
    if (value === undefined) {
        return Object.freeze({
            definitions: Object.freeze(emptyRecord()),
            bindings: Object.freeze({
                towers: Object.freeze(emptyRecord()),
                abilities: Object.freeze(emptyRecord()),
                towerScripts: Object.freeze(emptyRecord())
            })
        });
    }
    const marks = plainRecord(value, "Active combat marks");
    exactKeys(marks, ["definitions", "bindings"], "Active combat marks");
    if (!Object.prototype.hasOwnProperty.call(marks, "definitions")) {
        throw new Error("Active combat marks.definitions is required.");
    }
    const definitions = normalizeMarkDefinitions(marks.definitions, damageTypes);
    return Object.freeze({
        definitions,
        bindings: normalizeMarkBindings(marks.bindings, definitions, content)
    });
}
/**
 * Safely detach one active combat profile. Inactive modules are an exact legacy no-op.
 */
export function resolveActiveCombatMechanics(content, missionId) {
    const mission = content.missions[missionId];
    if (!mission)
        return undefined;
    const capability = resolveCapabilitySet(content.mechanics, mission.mechanics).combat;
    if (!capability.active)
        return undefined;
    if (typeof capability.profileId !== "string") {
        throw new Error("Active combat capability has no profile id.");
    }
    const catalog = plainRecord(content.mechanics, "Active mechanics catalog");
    exactKeys(catalog, ["schemaVersion", "modules"], "Active mechanics catalog");
    if (catalog.schemaVersion !== 1)
        throw new Error("Active mechanics catalog must use schema version 1.");
    const modules = plainRecord(catalog.modules, "Active mechanics modules");
    const module = plainRecord(modules.combat, "Active combat mechanics module");
    exactKeys(module, ["schemaVersion", "enabled", "profiles"], "Active combat mechanics module");
    const schemaVersion = module.schemaVersion;
    if ((schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3) || module.enabled !== true) {
        throw new Error("Active combat mechanics module must be enabled schema version 1, 2, or 3.");
    }
    const profiles = plainRecord(module.profiles, "Active combat mechanics profiles");
    if (!Object.prototype.hasOwnProperty.call(profiles, capability.profileId)) {
        throw new Error("Active combat mechanics profile does not exist.");
    }
    const profile = plainRecord(profiles[capability.profileId], "Active combat mechanics profile");
    exactKeys(profile, schemaVersion === 1
        ? ["shields"]
        : schemaVersion === 2
            ? ["shields", "damageTypes", "armorTypes", "armorAssignments"]
            : ["shields", "damageTypes", "armorTypes", "armorAssignments", "marks"], "Active combat mechanics profile");
    const shields = normalizeShields(profile.shields, content);
    const damageTypes = schemaVersion === 1 ? Object.freeze(emptyRecord()) : normalizeDamageTypes(profile.damageTypes);
    const armorTypes = schemaVersion === 1 ? Object.freeze(emptyRecord()) : normalizeArmorTypes(profile.armorTypes, damageTypes);
    const enemyArmorAssignments = schemaVersion === 1
        ? Object.freeze(emptyRecord())
        : normalizeEnemyArmorAssignments(profile.armorAssignments, content, armorTypes);
    if (Object.keys(enemyArmorAssignments).length > 0
        && !Object.prototype.hasOwnProperty.call(damageTypes, "physical")) {
        throw new Error("Active combat armor assignments require the implicit physical damage type to be declared.");
    }
    const enemyResistances = normalizeAssignedEnemyResistances(enemyArmorAssignments, damageTypes, content);
    const marks = schemaVersion === 3
        ? normalizeMarks(profile.marks, damageTypes, content)
        : normalizeMarks(undefined, damageTypes, content);
    return Object.freeze({
        schemaVersion,
        shields,
        damageTypes,
        armorTypes,
        enemyArmorAssignments,
        enemyResistances,
        marks
    });
}
/** Stateless lookup used by every damage delivery through the shared resolver boundary. */
export function resolveEnemyArmorMatrix(mechanics, enemyTypeId) {
    if (!mechanics)
        return undefined;
    const armorTypeId = mechanics.enemyArmorAssignments[enemyTypeId];
    if (typeof armorTypeId !== "string")
        return undefined;
    const definition = mechanics.armorTypes[armorTypeId];
    if (!definition)
        return undefined;
    return Object.freeze({
        armorTypeId,
        ...(definition.defaultMultiplier === undefined ? {} : { defaultMultiplier: definition.defaultMultiplier }),
        multipliers: definition.multipliers
    });
}
export function combatShieldDefinitions(mechanics) {
    return mechanics?.shields;
}
