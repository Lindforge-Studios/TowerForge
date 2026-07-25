export const MODIFIER_TARGETS = Object.freeze(["damage"]);
export const MODIFIER_STAGE_ORDER = Object.freeze([
    "tower_upgrade",
    "meta",
    "run",
    "spatial",
    "temporary"
]);
export const MODIFIER_OPERATION_ORDER = Object.freeze(["flat", "additive_ratio", "multiplier"]);
export const MAX_MODIFIERS_PER_RESOLUTION = 64;
function binaryCompare(left, right) {
    if (left < right)
        return -1;
    if (left > right)
        return 1;
    return 0;
}
function isAllowed(allowed, value) {
    return typeof value === "string" && allowed.includes(value);
}
function validateModifier(spec, index, seenIds) {
    if (!spec || typeof spec !== "object") {
        throw new Error(`Modifier at index ${index} must be an object.`);
    }
    if (typeof spec.id !== "string" || spec.id.trim().length === 0) {
        throw new Error(`Modifier at index ${index} must have a non-empty id.`);
    }
    if (seenIds.has(spec.id)) {
        throw new Error(`Duplicate modifier id "${spec.id}".`);
    }
    seenIds.add(spec.id);
    if (!isAllowed(MODIFIER_TARGETS, spec.target)) {
        throw new Error(`Modifier "${spec.id}" has unsupported target "${String(spec.target)}".`);
    }
    if (!isAllowed(MODIFIER_STAGE_ORDER, spec.stage)) {
        throw new Error(`Modifier "${spec.id}" has unsupported stage "${String(spec.stage)}".`);
    }
    if (!isAllowed(MODIFIER_OPERATION_ORDER, spec.operation)) {
        throw new Error(`Modifier "${spec.id}" has unsupported operation "${String(spec.operation)}".`);
    }
    if (!Number.isFinite(spec.value)) {
        throw new Error(`Modifier "${spec.id}" value must be finite.`);
    }
}
/**
 * Resolves modifiers using the stable contract
 * stage -> operation -> binary id. Additive ratios in one stage are all
 * anchored to the value immediately after that stage's flat modifiers.
 */
export function resolveModifiers(baseValue, target, modifiers) {
    if (!Number.isFinite(baseValue)) {
        throw new Error("Modifier base value must be finite.");
    }
    if (!isAllowed(MODIFIER_TARGETS, target)) {
        throw new Error(`Unsupported modifier target "${String(target)}".`);
    }
    if (!Array.isArray(modifiers)) {
        throw new Error("Modifiers must be an array.");
    }
    if (modifiers.length > MAX_MODIFIERS_PER_RESOLUTION) {
        throw new Error(`Modifier budget exceeded: at most ${MAX_MODIFIERS_PER_RESOLUTION} modifiers are allowed.`);
    }
    const seenIds = new Set();
    modifiers.forEach((spec, index) => validateModifier(spec, index, seenIds));
    const targetModifiers = modifiers
        .filter((spec) => spec.target === target)
        .slice()
        .sort((left, right) => {
        const stageOrder = MODIFIER_STAGE_ORDER.indexOf(left.stage) - MODIFIER_STAGE_ORDER.indexOf(right.stage);
        if (stageOrder !== 0)
            return stageOrder;
        const operationOrder = MODIFIER_OPERATION_ORDER.indexOf(left.operation) - MODIFIER_OPERATION_ORDER.indexOf(right.operation);
        return operationOrder !== 0 ? operationOrder : binaryCompare(left.id, right.id);
    });
    const trace = [];
    let value = baseValue;
    let currentStage;
    let additiveRatioAnchor = value;
    for (const spec of targetModifiers) {
        if (spec.stage !== currentStage) {
            currentStage = spec.stage;
            additiveRatioAnchor = value;
        }
        const before = value;
        if (spec.operation === "flat") {
            value += spec.value;
            additiveRatioAnchor = value;
        }
        else if (spec.operation === "additive_ratio") {
            value += additiveRatioAnchor * spec.value;
        }
        else {
            value *= spec.value;
        }
        if (!Number.isFinite(value)) {
            throw new Error(`Modifier "${spec.id}" produced a non-finite value.`);
        }
        trace.push({
            id: spec.id,
            stage: spec.stage,
            operation: spec.operation,
            operand: spec.value,
            before,
            after: value
        });
    }
    return { baseValue, target, value, trace };
}
