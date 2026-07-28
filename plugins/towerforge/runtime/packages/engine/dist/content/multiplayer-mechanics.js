import { resolveCapabilitySet } from "./mechanics.js";
export const MULTIPLAYER_LIMITS = Object.freeze({
    players: 64,
    idUtf8Bytes: 128,
    minimumFixedTickUnits: 0.000_001,
    maximumFixedTickUnits: 1_000_000,
    journalEntries: 100_000,
    sendDefinitions: 1_024,
    resourcesPerSend: 64,
    maximumResourceAmount: 1_000_000_000_000
});
export const MULTIPLAYER_MECHANICS_SCHEMA = Object.freeze({
    schemaVersion: 1,
    moduleId: "multiplayer",
    supportedModuleSchemaVersions: Object.freeze([1, 2]),
    profilesByModuleVersion: Object.freeze({
        1: Object.freeze({
            modes: Object.freeze(["local_coop"]),
            requiredFields: Object.freeze(["mode", "fixedTickUnits", "maxPlayers", "ownership"])
        }),
        2: Object.freeze({
            modes: Object.freeze(["local_coop", "asymmetric_send_vs_build"]),
            requiredFieldsByMode: Object.freeze({
                local_coop: Object.freeze(["mode", "fixedTickUnits", "maxPlayers", "ownership"]),
                asymmetric_send_vs_build: Object.freeze(["mode", "fixedTickUnits", "maxPlayers", "ownership", "sendPool"])
            }),
            sendDefinition: Object.freeze({
                requiredFields: Object.freeze(["enemyTypeId", "cost", "income", "spawnDelayUnits"]),
                optionalFields: Object.freeze(["routeId"]),
                additionalProperties: false
            })
        })
    }),
    profile: Object.freeze({
        requiredFields: Object.freeze(["mode", "fixedTickUnits", "maxPlayers", "ownership"]),
        optionalFields: Object.freeze([]),
        additionalProperties: false,
        modes: Object.freeze(["local_coop"])
    }),
    ownership: Object.freeze({
        requiredFields: Object.freeze(["towerControl", "resources", "routes"]),
        optionalFields: Object.freeze([]),
        additionalProperties: false,
        towerControl: Object.freeze(["owner_only", "shared"]),
        resources: Object.freeze(["shared", "partitioned"]),
        routes: Object.freeze(["shared", "partitioned"])
    }),
    limits: MULTIPLAYER_LIMITS
});
export class MultiplayerProfileValidationError extends Error {
    fieldPath;
    structural;
    constructor(fieldPath, message, structural = true) {
        super(message);
        this.name = "MultiplayerProfileValidationError";
        this.fieldPath = fieldPath;
        this.structural = structural;
    }
}
function inspectOwnRecord(value, fieldPath, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new MultiplayerProfileValidationError(fieldPath, `${label} must be a plain object.`);
    }
    let prototype;
    let descriptors;
    try {
        prototype = Object.getPrototypeOf(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    }
    catch {
        throw new MultiplayerProfileValidationError(fieldPath, `${label} could not be inspected safely.`);
    }
    if (prototype !== Object.prototype && prototype !== null) {
        throw new MultiplayerProfileValidationError(fieldPath, `${label} must be a plain object.`);
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new MultiplayerProfileValidationError(fieldPath, `${label} must not contain symbol fields.`);
    }
    const result = {};
    for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
            throw new MultiplayerProfileValidationError(`${fieldPath}.${key}`, `${label} fields must be enumerable own data properties.`);
        }
        Object.defineProperty(result, key, {
            value: descriptor.value,
            enumerable: true,
            configurable: true,
            writable: true
        });
    }
    return result;
}
function exactFields(record, fields, fieldPath, label, optionalFields = []) {
    const expected = new Set([...fields, ...optionalFields]);
    for (const key of fields) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) {
            throw new MultiplayerProfileValidationError(`${fieldPath}.${key}`, `${label} field "${key}" is required.`);
        }
    }
    for (const key of Object.keys(record)) {
        if (!expected.has(key)) {
            throw new MultiplayerProfileValidationError(`${fieldPath}.${key}`, `${label} is closed; unsupported field "${key}".`);
        }
    }
}
/** Descriptor-safe normalization of the complete local co-op v1 profile. */
export function normalizeMultiplayerProfileV1(value) {
    const profile = inspectOwnRecord(value, "profile", "Multiplayer profile");
    exactFields(profile, ["mode", "fixedTickUnits", "maxPlayers", "ownership"], "profile", "Multiplayer profile");
    if (profile.mode !== "local_coop") {
        throw new MultiplayerProfileValidationError("profile.mode", "Multiplayer mode must be local_coop in schema v1.", false);
    }
    if (typeof profile.fixedTickUnits !== "number"
        || !Number.isFinite(profile.fixedTickUnits)
        || profile.fixedTickUnits < MULTIPLAYER_LIMITS.minimumFixedTickUnits
        || profile.fixedTickUnits > MULTIPLAYER_LIMITS.maximumFixedTickUnits) {
        throw new MultiplayerProfileValidationError("profile.fixedTickUnits", `Multiplayer fixedTickUnits must be within ${MULTIPLAYER_LIMITS.minimumFixedTickUnits}..${MULTIPLAYER_LIMITS.maximumFixedTickUnits}.`, false);
    }
    if (typeof profile.maxPlayers !== "number"
        || !Number.isSafeInteger(profile.maxPlayers)
        || profile.maxPlayers < 2
        || profile.maxPlayers > MULTIPLAYER_LIMITS.players) {
        throw new MultiplayerProfileValidationError("profile.maxPlayers", `Multiplayer maxPlayers must be an integer within 2..${MULTIPLAYER_LIMITS.players}.`, false);
    }
    const ownership = inspectOwnRecord(profile.ownership, "profile.ownership", "Multiplayer ownership");
    exactFields(ownership, ["towerControl", "resources", "routes"], "profile.ownership", "Multiplayer ownership");
    if (ownership.towerControl !== "owner_only" && ownership.towerControl !== "shared") {
        throw new MultiplayerProfileValidationError("profile.ownership.towerControl", "Multiplayer towerControl must be owner_only or shared.", false);
    }
    if (ownership.resources !== "shared" && ownership.resources !== "partitioned") {
        throw new MultiplayerProfileValidationError("profile.ownership.resources", "Multiplayer v1 resources must be shared or partitioned.", false);
    }
    if (ownership.routes !== "shared" && ownership.routes !== "partitioned") {
        throw new MultiplayerProfileValidationError("profile.ownership.routes", "Multiplayer v1 routes must be shared or partitioned.", false);
    }
    return Object.freeze({
        mode: "local_coop",
        fixedTickUnits: Object.is(profile.fixedTickUnits, -0) ? 0 : profile.fixedTickUnits,
        maxPlayers: profile.maxPlayers,
        ownership: Object.freeze({
            towerControl: ownership.towerControl,
            resources: ownership.resources,
            routes: ownership.routes
        })
    });
}
function utf8ByteLength(value) {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit <= 0x7f)
            bytes += 1;
        else if (codeUnit <= 0x7ff)
            bytes += 2;
        else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < value.length
            && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
            bytes += 4;
            index += 1;
        }
        else
            bytes += 3;
    }
    return bytes;
}
function boundedId(value, fieldPath, label) {
    if (typeof value !== "string" || value.length === 0 || value !== value.trim()
        || utf8ByteLength(value) > MULTIPLAYER_LIMITS.idUtf8Bytes) {
        throw new MultiplayerProfileValidationError(fieldPath, `${label} must be a non-empty bounded id.`, false);
    }
    return value;
}
function normalizeResourceBag(value, fieldPath) {
    const bag = inspectOwnRecord(value, fieldPath, "Multiplayer resource bag");
    const keys = Object.keys(bag).sort();
    if (keys.length > MULTIPLAYER_LIMITS.resourcesPerSend) {
        throw new MultiplayerProfileValidationError(fieldPath, "Multiplayer resource bag exceeds its entry limit.", false);
    }
    const normalized = {};
    for (const resourceId of keys) {
        boundedId(resourceId, `${fieldPath}.${resourceId}`, "Multiplayer resource id");
        const amount = bag[resourceId];
        if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0
            || amount > MULTIPLAYER_LIMITS.maximumResourceAmount) {
            throw new MultiplayerProfileValidationError(`${fieldPath}.${resourceId}`, "Multiplayer resource amount must be finite, non-negative and within budget.", false);
        }
        Object.defineProperty(normalized, resourceId, {
            value: Object.is(amount, -0) ? 0 : amount,
            enumerable: true,
            configurable: false,
            writable: false
        });
    }
    return Object.freeze(normalized);
}
/** Descriptor-safe normalization of the complete asymmetric send-vs-build v2 profile. */
export function normalizeMultiplayerProfileV2(value) {
    const candidate = inspectOwnRecord(value, "profile", "Multiplayer profile");
    if (candidate.mode === "local_coop")
        return normalizeMultiplayerProfileV1(value);
    const profile = inspectOwnRecord(value, "profile", "Multiplayer profile");
    exactFields(profile, ["mode", "fixedTickUnits", "maxPlayers", "ownership", "sendPool"], "profile", "Multiplayer profile");
    if (profile.mode !== "asymmetric_send_vs_build") {
        throw new MultiplayerProfileValidationError("profile.mode", "Multiplayer mode must be asymmetric_send_vs_build in schema v2.", false);
    }
    if (typeof profile.fixedTickUnits !== "number" || !Number.isFinite(profile.fixedTickUnits)
        || profile.fixedTickUnits < MULTIPLAYER_LIMITS.minimumFixedTickUnits
        || profile.fixedTickUnits > MULTIPLAYER_LIMITS.maximumFixedTickUnits) {
        throw new MultiplayerProfileValidationError("profile.fixedTickUnits", "Multiplayer fixedTickUnits is out of bounds.", false);
    }
    if (profile.maxPlayers !== 2) {
        throw new MultiplayerProfileValidationError("profile.maxPlayers", "Asymmetric matches require exactly two players.", false);
    }
    const ownership = inspectOwnRecord(profile.ownership, "profile.ownership", "Multiplayer ownership");
    exactFields(ownership, ["towerControl", "resources", "routes"], "profile.ownership", "Multiplayer ownership");
    if (ownership.towerControl !== "owner_only" && ownership.towerControl !== "shared") {
        throw new MultiplayerProfileValidationError("profile.ownership.towerControl", "Multiplayer towerControl is invalid.", false);
    }
    if (ownership.resources !== "partitioned" || ownership.routes !== "partitioned") {
        throw new MultiplayerProfileValidationError("profile.ownership", "Asymmetric matches require partitioned resources and routes.", false);
    }
    const sendPool = inspectOwnRecord(profile.sendPool, "profile.sendPool", "Multiplayer send pool");
    const sendIds = Object.keys(sendPool).sort();
    if (sendIds.length === 0 || sendIds.length > MULTIPLAYER_LIMITS.sendDefinitions) {
        throw new MultiplayerProfileValidationError("profile.sendPool", "Multiplayer send pool must be non-empty and within budget.", false);
    }
    const normalizedPool = {};
    for (const sendId of sendIds) {
        boundedId(sendId, `profile.sendPool.${sendId}`, "Multiplayer send id");
        const root = `profile.sendPool.${sendId}`;
        const send = inspectOwnRecord(sendPool[sendId], root, "Multiplayer send definition");
        exactFields(send, ["enemyTypeId", "cost", "income", "spawnDelayUnits"], root, "Multiplayer send definition", ["routeId"]);
        const enemyTypeId = boundedId(send.enemyTypeId, `${root}.enemyTypeId`, "Enemy type id");
        if (typeof send.spawnDelayUnits !== "number" || !Number.isFinite(send.spawnDelayUnits)
            || send.spawnDelayUnits < 0 || send.spawnDelayUnits > MULTIPLAYER_LIMITS.maximumFixedTickUnits) {
            throw new MultiplayerProfileValidationError(`${root}.spawnDelayUnits`, "Spawn delay is out of bounds.", false);
        }
        Object.defineProperty(normalizedPool, sendId, {
            value: Object.freeze({
                enemyTypeId,
                cost: normalizeResourceBag(send.cost, `${root}.cost`),
                income: normalizeResourceBag(send.income, `${root}.income`),
                spawnDelayUnits: Object.is(send.spawnDelayUnits, -0) ? 0 : send.spawnDelayUnits,
                ...(send.routeId === undefined ? {} : {
                    routeId: boundedId(send.routeId, `${root}.routeId`, "Route id")
                })
            }),
            enumerable: true,
            configurable: false,
            writable: false
        });
    }
    return Object.freeze({
        mode: "asymmetric_send_vs_build",
        fixedTickUnits: Object.is(profile.fixedTickUnits, -0) ? 0 : profile.fixedTickUnits,
        maxPlayers: 2,
        ownership: Object.freeze({
            towerControl: ownership.towerControl,
            resources: "partitioned",
            routes: "partitioned"
        }),
        sendPool: Object.freeze(normalizedPool)
    });
}
/** Resolve only a selected, enabled, supported multiplayer profile. */
export function resolveActiveMultiplayerMechanics(content, missionId) {
    const mission = content.missions[missionId];
    const capability = mission
        ? resolveCapabilitySet(content.mechanics, mission.mechanics).multiplayer
        : undefined;
    if (!mission || !capability?.active || capability.profileId === undefined)
        return undefined;
    const module = content.mechanics.modules.multiplayer;
    if (!module || module.enabled !== true || (module.schemaVersion !== 1 && module.schemaVersion !== 2))
        return undefined;
    try {
        if (module.schemaVersion === 1) {
            const profile = normalizeMultiplayerProfileV1(module.profiles[capability.profileId]);
            return Object.freeze({ schemaVersion: 1, profileId: capability.profileId, ...profile });
        }
        const profile = normalizeMultiplayerProfileV2(module.profiles[capability.profileId]);
        return Object.freeze({ schemaVersion: 2, profileId: capability.profileId, ...profile });
    }
    catch {
        return undefined;
    }
}
