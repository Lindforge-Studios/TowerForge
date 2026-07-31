import { resolveModifiers } from "./modifiers.js";
import { ARMOR_MATRIX_LIMITS, MARK_LIMITS } from "../content/mechanics.js";
export const DAMAGE_TAGS = Object.freeze(["area", "over_time", "armor_piercing", "reaction"]);
function normalizeMarks(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        throw new Error("Damage marks must be an array.");
    if (value.length > MARK_LIMITS.definitions) {
        throw new Error(`Damage marks exceed the maximum limit of ${MARK_LIMITS.definitions}.`);
    }
    const normalized = [];
    const seen = new Set();
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
            throw new Error(`Damage mark ${index} must be an enumerable own data property.`);
        }
        const mark = ownDataRecord(descriptor.value, `Damage mark ${index}`);
        const allowed = new Set(["markId", "stacks", "multiplier", "consumePolicy", "damageTypes"]);
        if (Object.keys(mark).some((key) => !allowed.has(key))) {
            throw new Error(`Damage mark ${index} contains an unsupported field.`);
        }
        const markId = mark.markId;
        if (typeof markId !== "string" || markId.trim().length === 0) {
            throw new Error(`Damage mark ${index} needs a non-empty mark id.`);
        }
        if (seen.has(markId))
            throw new Error(`Damage mark id "${markId}" is duplicated.`);
        seen.add(markId);
        const stacks = mark.stacks;
        if (!Number.isSafeInteger(stacks) || stacks <= 0 || stacks > MARK_LIMITS.maxStacks) {
            throw new Error(`Damage mark "${markId}" stacks are outside the supported range.`);
        }
        const multiplier = mark.multiplier;
        if (typeof multiplier !== "number"
            || !Number.isFinite(multiplier)
            || multiplier <= 1
            || multiplier > MARK_LIMITS.multiplier) {
            throw new Error(`Damage mark "${markId}" multiplier is outside the supported range.`);
        }
        const consumePolicy = mark.consumePolicy;
        if (consumePolicy !== "retain" && consumePolicy !== "consume_one" && consumePolicy !== "consume_all") {
            throw new Error(`Damage mark "${markId}" consume policy is unsupported.`);
        }
        let damageTypes;
        if (mark.damageTypes !== undefined) {
            if (!Array.isArray(mark.damageTypes)
                || mark.damageTypes.length === 0
                || mark.damageTypes.length > MARK_LIMITS.filterDamageTypes) {
                throw new Error(`Damage mark "${markId}" damage type filter exceeds the supported limit.`);
            }
            const filters = [];
            const seenDamageTypes = new Set();
            for (let filterIndex = 0; filterIndex < mark.damageTypes.length; filterIndex += 1) {
                const filterDescriptor = Object.getOwnPropertyDescriptor(mark.damageTypes, String(filterIndex));
                const damageTypeId = filterDescriptor && filterDescriptor.enumerable && "value" in filterDescriptor
                    ? filterDescriptor.value
                    : undefined;
                if (typeof damageTypeId !== "string" || damageTypeId.trim().length === 0) {
                    throw new Error(`Damage mark "${markId}" has an invalid damage type filter.`);
                }
                if (seenDamageTypes.has(damageTypeId)) {
                    throw new Error(`Damage mark "${markId}" has a duplicate damage type filter "${damageTypeId}".`);
                }
                seenDamageTypes.add(damageTypeId);
                filters.push(damageTypeId);
            }
            damageTypes = Object.freeze(filters);
        }
        normalized.push(Object.freeze({
            markId,
            stacks: stacks,
            multiplier,
            consumePolicy,
            ...(damageTypes === undefined ? {} : { damageTypes })
        }));
    }
    normalized.sort((left, right) => left.markId < right.markId ? -1 : left.markId > right.markId ? 1 : 0);
    return Object.freeze(normalized);
}
function ownDataRecord(value, label, maximumEntries) {
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
        || (prototype !== Object.prototype && prototype !== null)) {
        throw new Error(`${label} must be a plain object with own data fields.`);
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new Error(`${label} contains unsupported symbol fields.`);
    }
    const keys = Object.keys(descriptors);
    if (maximumEntries !== undefined && keys.length > maximumEntries) {
        throw new Error(`${label} exceeds the maximum limit of ${maximumEntries} entries.`);
    }
    const detached = {};
    for (const key of keys) {
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
function normalizeArmorMatrix(value) {
    const matrix = ownDataRecord(value, "Damage armor matrix");
    const allowed = new Set(["armorTypeId", "defaultMultiplier", "multipliers"]);
    if (Object.keys(matrix).some((key) => !allowed.has(key))) {
        throw new Error("Damage armor matrix contains an unsupported field.");
    }
    if (typeof matrix.armorTypeId !== "string" || matrix.armorTypeId.trim().length === 0) {
        throw new Error("Damage armor matrix armorTypeId must be a non-empty id.");
    }
    const multipliers = ownDataRecord(matrix.multipliers, "Damage armor matrix multipliers", ARMOR_MATRIX_LIMITS.damageTypes);
    const normalizedMultipliers = Object.create(null);
    for (const damageTypeId of Object.keys(multipliers).sort()) {
        const multiplier = multipliers[damageTypeId];
        if (damageTypeId.trim().length === 0
            || typeof multiplier !== "number"
            || !Number.isFinite(multiplier)
            || multiplier < 0
            || multiplier > ARMOR_MATRIX_LIMITS.multiplier) {
            throw new Error(`Damage armor multiplier "${damageTypeId}" must be finite and in range 0..${ARMOR_MATRIX_LIMITS.multiplier}.`);
        }
        Object.defineProperty(normalizedMultipliers, damageTypeId, {
            value: multiplier,
            enumerable: true
        });
    }
    const defaultMultiplier = matrix.defaultMultiplier;
    if (defaultMultiplier !== undefined
        && (typeof defaultMultiplier !== "number"
            || !Number.isFinite(defaultMultiplier)
            || defaultMultiplier < 0
            || defaultMultiplier > ARMOR_MATRIX_LIMITS.multiplier)) {
        throw new Error(`Damage armor default multiplier must be finite and in range 0..${ARMOR_MATRIX_LIMITS.multiplier}.`);
    }
    return Object.freeze({
        armorTypeId: matrix.armorTypeId,
        ...(defaultMultiplier === undefined ? {} : { defaultMultiplier }),
        multipliers: Object.freeze(normalizedMultipliers)
    });
}
function normalizeResistances(resistances) {
    if (resistances === undefined)
        return undefined;
    const inspected = ownDataRecord(resistances, "Damage resistances");
    const normalized = Object.create(null);
    for (const damageType of Object.keys(inspected).sort()) {
        const multiplier = inspected[damageType];
        if (damageType.trim().length === 0) {
            throw new Error("Damage resistance type ids must be non-empty.");
        }
        if (typeof multiplier !== "number" || !Number.isFinite(multiplier)) {
            throw new Error(`Resistance for damage type "${damageType}" must be finite.`);
        }
        Object.defineProperty(normalized, damageType, { value: multiplier, enumerable: true });
    }
    return Object.freeze(normalized);
}
function validateTags(tags) {
    if (tags === undefined)
        return;
    if (!Array.isArray(tags)) {
        throw new Error("Damage tags must be an array.");
    }
    for (const tag of tags) {
        if (!DAMAGE_TAGS.includes(tag)) {
            throw new Error(`Unsupported damage tag "${String(tag)}".`);
        }
    }
}
function validateId(value, label) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${label} must be a non-empty id.`);
    }
}
function validateSource(source) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
        throw new Error("Damage source must be an object with a supported kind.");
    }
    switch (source.kind) {
        case "tower":
            validateId(source.towerTypeId, "Tower source towerTypeId");
            if (source.towerId !== undefined)
                validateId(source.towerId, "Tower source towerId");
            return;
        case "ability":
            validateId(source.abilityId, "Ability source abilityId");
            return;
        case "tower_script":
            validateId(source.scriptId, "TowerScript source scriptId");
            return;
        case "status":
            validateId(source.statusId, "Status source statusId");
            return;
        case "reaction":
            validateId(source.reactionId, "Reaction source reactionId");
            return;
        case "enemy":
        case "leak":
            validateId(source.enemyId, `${source.kind} source enemyId`);
            validateId(source.enemyTypeId, `${source.kind} source enemyTypeId`);
            return;
        default:
            throw new Error(`Unsupported damage source kind "${String(source.kind)}".`);
    }
}
function validateTarget(target) {
    if (!target || typeof target !== "object" || Array.isArray(target)) {
        throw new Error("Damage target must be an object with a supported kind.");
    }
    switch (target.kind) {
        case "enemy":
            validateId(target.enemyId, "Enemy target enemyId");
            validateId(target.enemyTypeId, "Enemy target enemyTypeId");
            if (target.componentId !== undefined)
                validateId(target.componentId, "Enemy target componentId");
            return;
        case "tower":
            validateId(target.towerId, "Tower target towerId");
            validateId(target.towerTypeId, "Tower target towerTypeId");
            return;
        case "hero":
            validateId(target.heroId, "Hero target heroId");
            validateId(target.heroDefinitionId, "Hero target heroDefinitionId");
            return;
        case "core":
            return;
        default:
            throw new Error(`Unsupported damage target kind "${String(target.kind)}".`);
    }
}
/** Stateless shared damage pipeline. Entity mutation, shields, deaths and rewards stay outside it. */
export class DamageResolver {
    static resolve(packet, context = {}) {
        if (!packet || typeof packet !== "object") {
            throw new Error("Damage packet must be an object.");
        }
        if (!Number.isFinite(packet.amount)) {
            throw new Error("Damage amount must be finite.");
        }
        validateSource(packet.source);
        validateTarget(packet.target);
        if (packet.damageType !== undefined && (typeof packet.damageType !== "string" || packet.damageType.trim().length === 0)) {
            throw new Error("Damage type must be a non-empty string.");
        }
        validateTags(packet.tags);
        const resistances = normalizeResistances(context.resistances);
        const modifierResolution = resolveModifiers(packet.amount, "damage", packet.modifiers === undefined ? [] : packet.modifiers);
        const damageType = packet.damageType ?? "physical";
        const marks = normalizeMarks(context.marks);
        const markTrace = [];
        let afterMarks = modifierResolution.value;
        for (const mark of marks) {
            if (mark.damageTypes !== undefined && !mark.damageTypes.includes(damageType))
                continue;
            const effectiveMultiplier = 1 + (mark.multiplier - 1) * mark.stacks;
            const before = afterMarks;
            const product = before * effectiveMultiplier;
            if (!Number.isFinite(product)) {
                throw new Error(`Damage overflow after applying mark "${mark.markId}"; result must be finite.`);
            }
            afterMarks = Math.max(0, product);
            markTrace.push(Object.freeze({
                markId: mark.markId,
                stacks: mark.stacks,
                multiplier: mark.multiplier,
                effectiveMultiplier,
                before,
                after: afterMarks,
                consumePolicy: mark.consumePolicy
            }));
        }
        const armorMatrix = context.armorMatrix === undefined
            ? undefined
            : normalizeArmorMatrix(context.armorMatrix);
        const armorMultiplier = armorMatrix === undefined
            ? 1
            : Object.prototype.hasOwnProperty.call(armorMatrix.multipliers, damageType)
                ? armorMatrix.multipliers[damageType]
                : armorMatrix.defaultMultiplier ?? 1;
        const armorProduct = afterMarks * armorMultiplier;
        if (!Number.isFinite(armorProduct)) {
            throw new Error("Damage overflow after applying armor matrix; result must be finite.");
        }
        const afterArmor = Math.max(0, armorProduct);
        const configuredResistance = resistances !== undefined
            && Object.prototype.hasOwnProperty.call(resistances, damageType)
            ? resistances[damageType]
            : 1;
        const resistanceMultiplier = Math.max(0, configuredResistance);
        const resistanceProduct = afterArmor * resistanceMultiplier;
        if (!Number.isFinite(resistanceProduct)) {
            throw new Error("Damage overflow after applying resistance; result must be finite.");
        }
        const afterResistance = Math.max(0, resistanceProduct);
        let finalAmount = afterResistance;
        let blockedByArmor = false;
        const legacyArmor = context.legacyArmor;
        if (legacyArmor !== undefined) {
            if (legacyArmor.kind !== "pierce_only") {
                throw new Error(`Unsupported legacy armor kind "${String(legacyArmor.kind)}".`);
            }
            if (typeof legacyArmor.bypassed !== "boolean") {
                throw new Error("Legacy pierce-only armor bypassed must be boolean.");
            }
            if (!Number.isFinite(legacyArmor.chipDamage)) {
                throw new Error("Legacy pierce-only armor chip damage must be finite.");
            }
            if (!legacyArmor.bypassed) {
                finalAmount = Math.min(afterResistance, Math.max(0, legacyArmor.chipDamage));
                blockedByArmor = afterResistance > 0 && finalAmount === 0;
            }
        }
        return {
            requestedAmount: packet.amount,
            modifierTrace: modifierResolution.trace,
            afterModifiers: modifierResolution.value,
            ...(markTrace.length === 0 ? {} : {
                markTrace: Object.freeze(markTrace),
                afterMarks
            }),
            ...(armorMatrix === undefined ? {} : {
                armorTypeId: armorMatrix.armorTypeId,
                armorMultiplier,
                afterArmor
            }),
            resistanceMultiplier,
            afterResistance,
            finalAmount,
            blockedByArmor
        };
    }
}
