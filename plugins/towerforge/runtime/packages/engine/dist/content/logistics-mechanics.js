/** Closed structural and runtime budgets for the opt-in Logistics v1 power grid. */
export const LOGISTICS_POWER_LIMITS = Object.freeze({
    entriesPerRole: 4_096,
    entriesTotal: 4_096,
    idUtf8Bytes: 128,
    output: 1_000_000_000_000,
    demand: 1_000_000_000_000,
    radius: 64,
    priority: 1_000_000,
    liveParticipants: 4_096,
    liveNodes: 1_024,
    undirectedEdges: 65_536
});
/** Closed structural and runtime budgets for opt-in Logistics v2 local ammunition. */
export const LOGISTICS_AMMUNITION_LIMITS = Object.freeze({
    types: 256,
    towerInventories: 4_096,
    liveInventories: 4_096,
    idUtf8Bytes: 128,
    labelUtf8Bytes: 128,
    capacity: 1_000_000_000
});
export const LOGISTICS_MECHANICS_SCHEMA = Object.freeze({
    schemaVersion: 2,
    moduleId: "logistics",
    supportedModuleSchemaVersions: Object.freeze([1, 2]),
    profile: Object.freeze({
        requiredFields: Object.freeze(["power", "ammunition"]),
        optionalFields: Object.freeze([]),
        additionalProperties: false
    }),
    profileVersions: Object.freeze({
        1: Object.freeze({
            requiredFields: Object.freeze(["power"]),
            optionalFields: Object.freeze([]),
            additionalProperties: false
        }),
        2: Object.freeze({
            requiredFields: Object.freeze(["power", "ammunition"]),
            optionalFields: Object.freeze([]),
            additionalProperties: false
        })
    }),
    power: Object.freeze({
        nullable: true,
        requiredFields: Object.freeze(["generators", "relays", "consumers"]),
        optionalFields: Object.freeze([]),
        additionalProperties: false,
        generator: Object.freeze({
            requiredFields: Object.freeze(["output", "linkRadius", "coverageRadius"]),
            optionalFields: Object.freeze([]),
            additionalProperties: false
        }),
        relay: Object.freeze({
            requiredFields: Object.freeze(["linkRadius", "coverageRadius"]),
            optionalFields: Object.freeze([]),
            additionalProperties: false
        }),
        consumer: Object.freeze({
            requiredFields: Object.freeze(["demand", "priority"]),
            optionalFields: Object.freeze([]),
            additionalProperties: false
        })
    }),
    ammunition: Object.freeze({
        nullable: true,
        requiredFields: Object.freeze(["types", "towerInventories"]),
        optionalFields: Object.freeze([]),
        additionalProperties: false,
        type: Object.freeze({
            requiredFields: Object.freeze(["label"]),
            optionalFields: Object.freeze([]),
            additionalProperties: false
        }),
        towerInventory: Object.freeze({
            requiredFields: Object.freeze([
                "ammoTypeId", "capacity", "startingAmount", "consumptionPerActivation"
            ]),
            optionalFields: Object.freeze([]),
            additionalProperties: false
        }),
        fireCapableAttackKinds: Object.freeze([
            "single", "pulse", "sniper", "antiair", "splash", "pipeline"
        ]),
        limits: LOGISTICS_AMMUNITION_LIMITS
    }),
    limits: Object.freeze({
        power: LOGISTICS_POWER_LIMITS,
        ammunition: LOGISTICS_AMMUNITION_LIMITS
    }),
    runtimeSnapshot: Object.freeze({
        schemaVersion: 2,
        fields: Object.freeze(["schemaVersion", "power", "ammunition"]),
        powerFields: Object.freeze(["components", "nodes", "consumers"]),
        ammunitionFields: Object.freeze(["inventories"])
    })
});
export class LogisticsProfileValidationError extends Error {
    fieldPath;
    constructor(fieldPath, message) {
        super(message);
        this.fieldPath = fieldPath;
        this.name = "LogisticsProfileValidationError";
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
function inspectOwnDataRecord(value, fieldPath, label) {
    let prototype;
    let descriptors;
    try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
            ? Object.getOwnPropertyDescriptors(value)
            : {};
    }
    catch {
        throw new LogisticsProfileValidationError(fieldPath, `${label} could not be inspected safely.`);
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)
        || (prototype !== Object.prototype && prototype !== null)) {
        throw new LogisticsProfileValidationError(fieldPath, `${label} must be a plain object with own data fields.`);
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new LogisticsProfileValidationError(fieldPath, `${label} must not contain symbol fields.`);
    }
    const result = Object.create(null);
    for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
            throw new LogisticsProfileValidationError(`${fieldPath}.${key}`, `${label} field "${key}" must be an enumerable own data field; accessors are not allowed.`);
        }
        result[key] = descriptor.value;
    }
    return result;
}
function exactFields(record, fields, fieldPath, label) {
    const allowed = new Set(fields);
    for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(record, field)) {
            throw new LogisticsProfileValidationError(`${fieldPath}.${field}`, `${label} is missing required field "${field}".`);
        }
    }
    for (const key of Object.keys(record)) {
        if (!allowed.has(key)) {
            throw new LogisticsProfileValidationError(`${fieldPath}.${key}`, `${label} is closed; unknown field "${key}".`);
        }
    }
}
function boundedPositive(value, maximum, fieldPath) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > maximum) {
        throw new LogisticsProfileValidationError(fieldPath, `${fieldPath} must be a finite positive number with maximum ${maximum}.`);
    }
    return value;
}
function boundedRadius(value, fieldPath) {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)
        || value < 0 || value > LOGISTICS_POWER_LIMITS.radius) {
        throw new LogisticsProfileValidationError(fieldPath, `${fieldPath} must be a finite integer in 0..${LOGISTICS_POWER_LIMITS.radius}.`);
    }
    return value;
}
function boundedPriority(value, fieldPath) {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value)
        || value < 0 || value > LOGISTICS_POWER_LIMITS.priority) {
        throw new LogisticsProfileValidationError(fieldPath, `${fieldPath} priority must be a finite safe integer in 0..${LOGISTICS_POWER_LIMITS.priority}.`);
    }
    return value;
}
function boundedUtf8String(value, maximum, fieldPath, label) {
    if (typeof value !== "string" || value.length === 0 || utf8ByteLength(value) > maximum) {
        throw new LogisticsProfileValidationError(fieldPath, `${label} must contain 1..${maximum} UTF-8 bytes.`);
    }
    return value;
}
function boundedSafeInteger(value, minimum, maximum, fieldPath) {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value)
        || value < minimum || value > maximum) {
        throw new LogisticsProfileValidationError(fieldPath, `${fieldPath} must be a finite safe integer in ${minimum}..${maximum}.`);
    }
    return value;
}
function inspectRoleRecord(value, fieldPath, role) {
    const record = inspectOwnDataRecord(value, fieldPath, `Logistics ${role} record`);
    const ids = Object.keys(record);
    if (ids.length > LOGISTICS_POWER_LIMITS.entriesPerRole) {
        throw new LogisticsProfileValidationError(fieldPath, `Logistics ${role} record exceeds the ${LOGISTICS_POWER_LIMITS.entriesPerRole} entry budget.`);
    }
    for (const id of ids) {
        if (id.length === 0 || utf8ByteLength(id) > LOGISTICS_POWER_LIMITS.idUtf8Bytes) {
            throw new LogisticsProfileValidationError(`${fieldPath}.${id}`, `Logistics tower type id must contain 1..${LOGISTICS_POWER_LIMITS.idUtf8Bytes} UTF-8 bytes.`);
        }
    }
    return record;
}
function normalizeGenerators(value) {
    const root = "profile.power.generators";
    const record = inspectRoleRecord(value, root, "generator");
    const entries = Object.keys(record).sort().map((id) => {
        const path = `${root}.${id}`;
        const definition = inspectOwnDataRecord(record[id], path, "Logistics generator definition");
        exactFields(definition, ["output", "linkRadius", "coverageRadius"], path, "Logistics generator definition");
        return [id, Object.freeze({
                output: boundedPositive(definition.output, LOGISTICS_POWER_LIMITS.output, `${path}.output`),
                linkRadius: boundedRadius(definition.linkRadius, `${path}.linkRadius`),
                coverageRadius: boundedRadius(definition.coverageRadius, `${path}.coverageRadius`)
            })];
    });
    return Object.freeze(Object.fromEntries(entries));
}
function normalizeRelays(value) {
    const root = "profile.power.relays";
    const record = inspectRoleRecord(value, root, "relay");
    const entries = Object.keys(record).sort().map((id) => {
        const path = `${root}.${id}`;
        const definition = inspectOwnDataRecord(record[id], path, "Logistics relay definition");
        exactFields(definition, ["linkRadius", "coverageRadius"], path, "Logistics relay definition");
        return [id, Object.freeze({
                linkRadius: boundedRadius(definition.linkRadius, `${path}.linkRadius`),
                coverageRadius: boundedRadius(definition.coverageRadius, `${path}.coverageRadius`)
            })];
    });
    return Object.freeze(Object.fromEntries(entries));
}
function normalizeConsumers(value) {
    const root = "profile.power.consumers";
    const record = inspectRoleRecord(value, root, "consumer");
    const entries = Object.keys(record).sort().map((id) => {
        const path = `${root}.${id}`;
        const definition = inspectOwnDataRecord(record[id], path, "Logistics consumer definition");
        exactFields(definition, ["demand", "priority"], path, "Logistics consumer definition");
        return [id, Object.freeze({
                demand: boundedPositive(definition.demand, LOGISTICS_POWER_LIMITS.demand, `${path}.demand`),
                priority: boundedPriority(definition.priority, `${path}.priority`)
            })];
    });
    return Object.freeze(Object.fromEntries(entries));
}
/** Normalize one supported v1 profile without executing accessors or retaining authored references. */
export function normalizeLogisticsProfileV1(value) {
    const profile = inspectOwnDataRecord(value, "profile", "Logistics profile");
    exactFields(profile, ["power"], "profile", "Logistics profile");
    if (profile.power === null)
        return Object.freeze({ power: null });
    const power = inspectOwnDataRecord(profile.power, "profile.power", "Logistics power definition");
    exactFields(power, ["generators", "relays", "consumers"], "profile.power", "Logistics power definition");
    // Inspect record shapes and cardinality before traversing any nested definition.
    const generatorsRecord = inspectRoleRecord(power.generators, "profile.power.generators", "generator");
    const relaysRecord = inspectRoleRecord(power.relays, "profile.power.relays", "relay");
    const consumersRecord = inspectRoleRecord(power.consumers, "profile.power.consumers", "consumer");
    const total = Object.keys(generatorsRecord).length + Object.keys(relaysRecord).length
        + Object.keys(consumersRecord).length;
    if (total > LOGISTICS_POWER_LIMITS.entriesTotal) {
        throw new LogisticsProfileValidationError("profile.power", `Logistics power records exceed the ${LOGISTICS_POWER_LIMITS.entriesTotal} total entry budget.`);
    }
    const roles = new Set();
    for (const [role, record] of [
        ["generators", generatorsRecord], ["relays", relaysRecord], ["consumers", consumersRecord]
    ]) {
        for (const id of Object.keys(record)) {
            if (roles.has(id)) {
                throw new LogisticsProfileValidationError(`profile.power.${role}.${id}`, `Tower type "${id}" occurs in more than one Logistics power role.`);
            }
            roles.add(id);
        }
    }
    return Object.freeze({
        power: Object.freeze({
            generators: normalizeGenerators(generatorsRecord),
            relays: normalizeRelays(relaysRecord),
            consumers: normalizeConsumers(consumersRecord)
        })
    });
}
function inspectAmmunitionRecord(value, fieldPath, label, limit) {
    let prototype;
    let descriptors;
    try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
            ? Object.getOwnPropertyDescriptors(value)
            : {};
    }
    catch {
        throw new LogisticsProfileValidationError(fieldPath, `${label} could not be inspected safely.`);
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)
        || (prototype !== Object.prototype && prototype !== null)) {
        throw new LogisticsProfileValidationError(fieldPath, `${label} must be a plain object with own data fields.`);
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new LogisticsProfileValidationError(fieldPath, `${label} must not contain symbol fields.`);
    }
    const ids = Object.keys(descriptors);
    if (ids.length > limit) {
        throw new LogisticsProfileValidationError(fieldPath, `${label} exceeds the ${limit} entry budget.`);
    }
    const record = Object.create(null);
    for (const id of ids) {
        boundedUtf8String(id, LOGISTICS_AMMUNITION_LIMITS.idUtf8Bytes, `${fieldPath}.${id}`, `${label} id`);
        const descriptor = descriptors[id];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
            throw new LogisticsProfileValidationError(`${fieldPath}.${id}`, `${label} field "${id}" must be an enumerable own data field; accessors are not allowed.`);
        }
        record[id] = descriptor.value;
    }
    return record;
}
function normalizeAmmunition(value) {
    const root = "profile.ammunition";
    const ammunition = inspectOwnDataRecord(value, root, "Logistics ammunition definition");
    exactFields(ammunition, ["types", "towerInventories"], root, "Logistics ammunition definition");
    const typeRecord = inspectAmmunitionRecord(ammunition.types, `${root}.types`, "Logistics ammunition types", LOGISTICS_AMMUNITION_LIMITS.types);
    const inventoryRecord = inspectAmmunitionRecord(ammunition.towerInventories, `${root}.towerInventories`, "Logistics ammunition tower inventories", LOGISTICS_AMMUNITION_LIMITS.towerInventories);
    const types = Object.freeze(Object.fromEntries(Object.keys(typeRecord).sort().map((id) => {
        const path = `${root}.types.${id}`;
        const definition = inspectOwnDataRecord(typeRecord[id], path, "Logistics ammunition type");
        exactFields(definition, ["label"], path, "Logistics ammunition type");
        return [id, Object.freeze({
                label: boundedUtf8String(definition.label, LOGISTICS_AMMUNITION_LIMITS.labelUtf8Bytes, `${path}.label`, "Logistics ammunition type label")
            })];
    })));
    const towerInventories = Object.freeze(Object.fromEntries(Object.keys(inventoryRecord).sort().map((towerTypeId) => {
        const path = `${root}.towerInventories.${towerTypeId}`;
        const definition = inspectOwnDataRecord(inventoryRecord[towerTypeId], path, "Logistics tower inventory");
        exactFields(definition, ["ammoTypeId", "capacity", "startingAmount", "consumptionPerActivation"], path, "Logistics tower inventory");
        const capacity = boundedSafeInteger(definition.capacity, 1, LOGISTICS_AMMUNITION_LIMITS.capacity, `${path}.capacity`);
        return [towerTypeId, Object.freeze({
                ammoTypeId: boundedUtf8String(definition.ammoTypeId, LOGISTICS_AMMUNITION_LIMITS.idUtf8Bytes, `${path}.ammoTypeId`, "Logistics ammunition type reference"),
                capacity,
                startingAmount: boundedSafeInteger(definition.startingAmount, 0, capacity, `${path}.startingAmount`),
                consumptionPerActivation: boundedSafeInteger(definition.consumptionPerActivation, 1, capacity, `${path}.consumptionPerActivation`)
            })];
    })));
    return Object.freeze({ types, towerInventories });
}
/** Normalize one supported v2 profile without executing accessors or retaining authored references. */
export function normalizeLogisticsProfileV2(value) {
    const profile = inspectOwnDataRecord(value, "profile", "Logistics profile");
    exactFields(profile, ["power", "ammunition"], "profile", "Logistics profile");
    const power = normalizeLogisticsProfileV1({ power: profile.power }).power;
    const ammunition = profile.ammunition === null ? null : normalizeAmmunition(profile.ammunition);
    return Object.freeze({ power, ammunition });
}
/** Resolve only a selected, enabled, supported Logistics v1 profile. */
export function resolveActiveLogisticsMechanics(content, missionId) {
    const mission = content.missions[missionId];
    const capability = mission?.capabilities.logistics;
    if (!mission || !capability?.active || capability.profileId === undefined)
        return undefined;
    const module = content.mechanics.modules.logistics;
    if (!module || (module.schemaVersion !== 1 && module.schemaVersion !== 2))
        return undefined;
    const authored = module.profiles[capability.profileId];
    try {
        if (module.schemaVersion === 1) {
            const normalized = normalizeLogisticsProfileV1(authored);
            return Object.freeze({
                schemaVersion: 1,
                profileId: capability.profileId,
                power: normalized.power
            });
        }
        const normalized = normalizeLogisticsProfileV2(authored);
        return Object.freeze({
            schemaVersion: 2,
            profileId: capability.profileId,
            power: normalized.power,
            ammunition: normalized.ammunition
        });
    }
    catch {
        return undefined;
    }
}
