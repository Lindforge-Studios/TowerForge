import { resolveCapabilitySet } from "./mechanics.js";
export const DIRECTOR_LIMITS = Object.freeze({
    counterDefinitions: 256,
    conditionsPerCounter: 8,
    groupsPerCounter: 8,
    totalCounterGroups: 2_048,
    idUtf8Bytes: 128,
    labelUtf8Bytes: 256,
    addedGroupsPerDecision: 8,
    addedEnemiesPerDecision: 1_024,
    threatCost: 1_000_000_000,
    decisionHistory: 1_024
});
export const DIRECTOR_METRICS = [
    "damage_share",
    "coverage_ratio",
    "movement_layer_share",
    "logistics_brownout_ratio"
];
export class DirectorProfileValidationError extends Error {
}
function dataRecord(value, path) {
    if (value === null || typeof value !== "object" || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new DirectorProfileValidationError(`${path} must be a plain object.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new DirectorProfileValidationError(`${path} rejects symbol keys.`);
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!("value" in descriptor) || !descriptor.enumerable) {
            throw new DirectorProfileValidationError(`${path}.${key} must be an enumerable data property.`);
        }
    }
    return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function closed(record, allowed, path) {
    const allow = new Set(allowed);
    for (const key of Object.keys(record)) {
        if (!allow.has(key))
            throw new DirectorProfileValidationError(`${path} is closed; unknown field "${key}".`);
    }
    for (const key of allowed) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) {
            throw new DirectorProfileValidationError(`${path}.${key} is required.`);
        }
    }
}
function plainArray(value, path, max) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) {
        throw new DirectorProfileValidationError(`${path} must be a plain array with at most ${max} entries.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(descriptors).length !== value.length + 1) {
        throw new DirectorProfileValidationError(`${path} must be dense and contain no extra properties.`);
    }
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw new DirectorProfileValidationError(`${path}[${index}] must be an enumerable data property.`);
        }
    }
    return value;
}
function stringValue(value, path, maxBytes) {
    if (typeof value !== "string" || value.length === 0 || new TextEncoder().encode(value).length > maxBytes) {
        throw new DirectorProfileValidationError(`${path} must be a non-empty string of at most ${maxBytes} UTF-8 bytes.`);
    }
    return value;
}
function finite(value, path, min, max, integer = false) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max
        || (integer && !Number.isSafeInteger(value))) {
        throw new DirectorProfileValidationError(`${path} must be ${integer ? "an integer" : "a finite number"} in ${min}..${max}.`);
    }
    return value;
}
function normalizeCondition(value, path) {
    const record = dataRecord(value, path);
    const metric = record.metric;
    const required = metric === "logistics_brownout_ratio"
        ? ["metric", "operator", "threshold"]
        : ["metric", "key", "operator", "threshold"];
    closed(record, required, path);
    if (typeof metric !== "string" || !DIRECTOR_METRICS.includes(metric)) {
        throw new DirectorProfileValidationError(`${path}.metric is unsupported.`);
    }
    const operator = record.operator;
    if (operator !== "gte" && operator !== "lte") {
        throw new DirectorProfileValidationError(`${path}.operator must be gte or lte.`);
    }
    return Object.freeze({
        metric: metric,
        ...(metric === "logistics_brownout_ratio" ? {} : {
            key: stringValue(record.key, `${path}.key`, DIRECTOR_LIMITS.idUtf8Bytes)
        }),
        operator,
        threshold: finite(record.threshold, `${path}.threshold`, 0, 1)
    });
}
function normalizeGroup(value, path) {
    const record = dataRecord(value, path);
    const keys = Object.keys(record).sort();
    const expected = record.routeId === undefined
        ? ["count", "enemyId", "spawnInterval", "startDelay"]
        : ["count", "enemyId", "routeId", "spawnInterval", "startDelay"];
    if (keys.join("\0") !== expected.join("\0")) {
        throw new DirectorProfileValidationError(`${path} is a closed wave group.`);
    }
    return Object.freeze({
        enemyId: stringValue(record.enemyId, `${path}.enemyId`, DIRECTOR_LIMITS.idUtf8Bytes),
        count: finite(record.count, `${path}.count`, 1, DIRECTOR_LIMITS.addedEnemiesPerDecision, true),
        spawnInterval: finite(record.spawnInterval, `${path}.spawnInterval`, 0, DIRECTOR_LIMITS.threatCost),
        startDelay: finite(record.startDelay, `${path}.startDelay`, 0, DIRECTOR_LIMITS.threatCost),
        ...(record.routeId === undefined ? {} : {
            routeId: stringValue(record.routeId, `${path}.routeId`, DIRECTOR_LIMITS.idUtf8Bytes)
        })
    });
}
/** Parse the exact closed Director v1 profile into detached, deeply frozen own data. */
export function normalizeDirectorProfileV1(value) {
    const profile = dataRecord(value, "director profile");
    closed(profile, ["counterPool", "threatBudget", "fairness"], "director profile");
    const poolInput = dataRecord(profile.counterPool, "director profile.counterPool");
    const counterIds = Object.keys(poolInput).sort();
    if (counterIds.length > DIRECTOR_LIMITS.counterDefinitions) {
        throw new DirectorProfileValidationError(`Director counterPool exceeds ${DIRECTOR_LIMITS.counterDefinitions} definitions.`);
    }
    const counterPool = Object.create(null);
    let totalGroups = 0;
    for (const counterId of counterIds) {
        stringValue(counterId, `director counter id`, DIRECTOR_LIMITS.idUtf8Bytes);
        const raw = dataRecord(poolInput[counterId], `director profile.counterPool.${counterId}`);
        closed(raw, ["label", "priority", "conditions", "groups", "threatCost"], `director profile.counterPool.${counterId}`);
        const conditions = plainArray(raw.conditions, `director profile.counterPool.${counterId}.conditions`, DIRECTOR_LIMITS.conditionsPerCounter);
        if (conditions.length === 0)
            throw new DirectorProfileValidationError(`Director counter "${counterId}" requires a condition.`);
        const groups = plainArray(raw.groups, `director profile.counterPool.${counterId}.groups`, DIRECTOR_LIMITS.groupsPerCounter);
        if (groups.length === 0)
            throw new DirectorProfileValidationError(`Director counter "${counterId}" requires a group.`);
        totalGroups += groups.length;
        if (totalGroups > DIRECTOR_LIMITS.totalCounterGroups) {
            throw new DirectorProfileValidationError(`Director counter groups exceed ${DIRECTOR_LIMITS.totalCounterGroups}.`);
        }
        Object.defineProperty(counterPool, counterId, { value: Object.freeze({
                label: stringValue(raw.label, `director profile.counterPool.${counterId}.label`, DIRECTOR_LIMITS.labelUtf8Bytes),
                priority: finite(raw.priority, `director profile.counterPool.${counterId}.priority`, -DIRECTOR_LIMITS.threatCost, DIRECTOR_LIMITS.threatCost, true),
                conditions: Object.freeze(conditions.map((entry, index) => normalizeCondition(entry, `director profile.counterPool.${counterId}.conditions[${index}]`))),
                groups: Object.freeze(groups.map((entry, index) => normalizeGroup(entry, `director profile.counterPool.${counterId}.groups[${index}]`))),
                threatCost: finite(raw.threatCost, `director profile.counterPool.${counterId}.threatCost`, 0, DIRECTOR_LIMITS.threatCost)
            }), enumerable: true, configurable: false, writable: false });
    }
    const budget = dataRecord(profile.threatBudget, "director profile.threatBudget");
    closed(budget, ["base", "perWave"], "director profile.threatBudget");
    const fairness = dataRecord(profile.fairness, "director profile.fairness");
    closed(fairness, ["minimumWaveIndex", "maxConsecutiveUses", "maxAddedGroups", "maxAddedEnemies"], "director profile.fairness");
    return Object.freeze({
        counterPool: Object.freeze(counterPool),
        threatBudget: Object.freeze({
            base: finite(budget.base, "director profile.threatBudget.base", 0, DIRECTOR_LIMITS.threatCost),
            perWave: finite(budget.perWave, "director profile.threatBudget.perWave", 0, DIRECTOR_LIMITS.threatCost)
        }),
        fairness: Object.freeze({
            minimumWaveIndex: finite(fairness.minimumWaveIndex, "director profile.fairness.minimumWaveIndex", 0, DIRECTOR_LIMITS.decisionHistory, true),
            maxConsecutiveUses: finite(fairness.maxConsecutiveUses, "director profile.fairness.maxConsecutiveUses", 0, DIRECTOR_LIMITS.decisionHistory, true),
            maxAddedGroups: finite(fairness.maxAddedGroups, "director profile.fairness.maxAddedGroups", 0, DIRECTOR_LIMITS.addedGroupsPerDecision, true),
            maxAddedEnemies: finite(fairness.maxAddedEnemies, "director profile.fairness.maxAddedEnemies", 0, DIRECTOR_LIMITS.addedEnemiesPerDecision, true)
        })
    });
}
export function resolveActiveDirectorMechanics(content, missionId) {
    const mission = content.missions[missionId];
    const capability = mission
        ? resolveCapabilitySet(content.mechanics, mission.mechanics).director
        : undefined;
    if (!mission || !capability?.active || !capability.profileId)
        return undefined;
    const module = content.mechanics.modules.director;
    if (!module || module.schemaVersion !== 1 || module.enabled !== true)
        return undefined;
    const profile = module.profiles[capability.profileId];
    if (profile === undefined)
        return undefined;
    try {
        return Object.freeze({
            schemaVersion: 1,
            profileId: capability.profileId,
            ...normalizeDirectorProfileV1(profile)
        });
    }
    catch {
        return undefined;
    }
}
