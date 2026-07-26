/** Closed structural and runtime budgets for opt-in tile displacement physics v1. */
export const PHYSICS_LIMITS = Object.freeze({
    displacementDistance: 8,
    displacementEffectsPerSource: 8,
    displacementTargetsPerActivation: 64,
    immuneEnemyTypeIds: 4_096,
    fallHazardTerrainTags: 64,
    idOrTagUtf8Bytes: 128,
    stepsPerEffectApplication: 8,
    stepAttemptsPerActivation: 4_096,
    stepAttemptsPerTick: 32_768
});
const DISPLACEMENT_EFFECT_SCHEMA = Object.freeze({
    kind: "displacement",
    requiredFields: Object.freeze(["kind", "mode", "distance", "stopAtBlocker"]),
    optionalFields: Object.freeze([]),
    additionalProperties: false,
    kinds: Object.freeze(["displacement"]),
    modes: Object.freeze(["push", "pull"])
});
/** Capability-aware authoring descriptor shared by Studio and MCP surfaces. */
export const PHYSICS_MECHANICS_SCHEMA = Object.freeze({
    schemaVersion: 1,
    moduleId: "physics",
    supportedModuleSchemaVersions: Object.freeze([1]),
    profile: Object.freeze({
        requiredFields: Object.freeze([]),
        optionalFields: Object.freeze([
            "displacementImmuneEnemyTypeIds",
            "fallImmuneEnemyTypeIds",
            "fallHazardTerrainTags"
        ]),
        additionalProperties: false
    }),
    effect: DISPLACEMENT_EFFECT_SCHEMA,
    displacementEffect: DISPLACEMENT_EFFECT_SCHEMA,
    limits: PHYSICS_LIMITS,
    runtimeSnapshot: null
});
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
function plainRecord(value) {
    let prototype;
    let descriptors;
    try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
            ? Object.getOwnPropertyDescriptors(value)
            : {};
    }
    catch {
        return undefined;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value) || prototype !== Object.prototype) {
        return undefined;
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0)
        return undefined;
    const detached = {};
    for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
            return undefined;
        Object.defineProperty(detached, key, { value: descriptor.value, enumerable: true });
    }
    return detached;
}
/**
 * Inspect an authored effect without executing property accessors. Only a plain, symbol-free
 * object whose enumerable own properties are all data descriptors is admitted. The returned
 * record is a detached frozen copy, so validation and runtime dispatch share one fail-closed
 * trust boundary before inspecting `kind` or any effect field.
 */
export function inspectOwnDataEffect(value) {
    const record = plainRecord(value);
    if (!record)
        return Object.freeze({ ok: false });
    const frozen = Object.freeze(record);
    return Object.freeze({
        ok: true,
        kind: Object.prototype.hasOwnProperty.call(frozen, "kind") ? frozen.kind : undefined,
        record: frozen
    });
}
/** Parse the exact closed DisplacementEffectV1 shape into detached immutable data. */
export function parseDisplacementEffectV1(value) {
    const inspected = inspectOwnDataEffect(value);
    if (!inspected.ok || inspected.kind !== "displacement")
        return undefined;
    const keys = Object.keys(inspected.record);
    if (keys.length !== 4 || keys.some((key) => (key !== "kind" && key !== "mode" && key !== "distance" && key !== "stopAtBlocker")))
        return undefined;
    const mode = inspected.record.mode;
    const distance = inspected.record.distance;
    const stopAtBlocker = inspected.record.stopAtBlocker;
    if ((mode !== "push" && mode !== "pull")
        || !Number.isSafeInteger(distance)
        || distance < 1
        || distance > PHYSICS_LIMITS.displacementDistance
        || typeof stopAtBlocker !== "boolean")
        return undefined;
    return Object.freeze({
        kind: "displacement",
        mode,
        distance: distance,
        stopAtBlocker
    });
}
function utf8ByteLength(value) {
    let bytes = 0;
    for (const character of value) {
        const point = character.codePointAt(0);
        bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }
    return bytes;
}
function stringArray(value, maximum) {
    if (value === undefined)
        return Object.freeze([]);
    let prototype;
    let descriptors;
    try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
            ? Object.getOwnPropertyDescriptors(value)
            : {};
    }
    catch {
        return undefined;
    }
    if (!Array.isArray(value) || prototype !== Array.prototype)
        return undefined;
    const length = descriptors.length && "value" in descriptors.length ? descriptors.length.value : undefined;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum)
        return undefined;
    if (Reflect.ownKeys(descriptors).some((key) => {
        if (key === "length")
            return false;
        return typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length;
    }))
        return undefined;
    const result = [];
    const seen = new Set();
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
            return undefined;
        const item = descriptor.value;
        if (typeof item !== "string" || item.length === 0
            || utf8ByteLength(item) > PHYSICS_LIMITS.idOrTagUtf8Bytes || seen.has(item))
            return undefined;
        seen.add(item);
        result.push(item);
    }
    result.sort();
    return Object.freeze(result);
}
/** Resolve a detached, frozen profile only when the mission capability is genuinely active. */
export function resolveActivePhysicsMechanics(content, missionId) {
    const capability = content.missions[missionId]?.capabilities.physics;
    if (!capability?.active || capability.profileId === undefined)
        return undefined;
    const module = plainRecord(ownData(ownData(content.mechanics, "modules"), "physics"));
    if (!module || module.schemaVersion !== 1 || module.enabled !== true)
        return undefined;
    const profiles = plainRecord(module.profiles);
    const profile = profiles ? plainRecord(ownData(profiles, capability.profileId)) : undefined;
    if (!profile)
        return undefined;
    const allowed = new Set(PHYSICS_MECHANICS_SCHEMA.profile.optionalFields);
    if (Object.keys(profile).some((key) => !allowed.has(key))) {
        return undefined;
    }
    const displacementImmuneEnemyTypeIds = stringArray(profile.displacementImmuneEnemyTypeIds, PHYSICS_LIMITS.immuneEnemyTypeIds);
    const fallImmuneEnemyTypeIds = stringArray(profile.fallImmuneEnemyTypeIds, PHYSICS_LIMITS.immuneEnemyTypeIds);
    const fallHazardTerrainTags = stringArray(profile.fallHazardTerrainTags, PHYSICS_LIMITS.fallHazardTerrainTags);
    if (!displacementImmuneEnemyTypeIds || !fallImmuneEnemyTypeIds || !fallHazardTerrainTags)
        return undefined;
    return Object.freeze({
        schemaVersion: 1,
        profileId: capability.profileId,
        displacementImmuneEnemyTypeIds,
        fallImmuneEnemyTypeIds,
        fallHazardTerrainTags
    });
}
