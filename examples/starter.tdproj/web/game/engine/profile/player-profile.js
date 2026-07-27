import { canonicalStringify } from "../simulation/stable-digest.js";
export const PLAYER_PROFILE_SCHEMA_VERSION = 2;
export const PLAYER_PROFILE_LIMITS = Object.freeze({
    jsonBytes: 1 * 1_024 * 1_024,
    collectionEntries: 10_000,
    warnings: 1_000
});
export class UnsupportedPlayerProfileVersionError extends Error {
    code = "UNSUPPORTED_PLAYER_PROFILE_VERSION";
    version;
    constructor(version) {
        super(`Unsupported player profile version "${version}".`);
        this.name = "UnsupportedPlayerProfileVersionError";
        this.version = version;
    }
}
const PROFILE_KEYS = Object.freeze([
    "version",
    "clearedMissionIds",
    "starsByMission",
    "metaResources",
    "upgradeLevels",
    "selectedDifficultyId"
]);
const PROFILE_KEY_SET = new Set(PROFILE_KEYS);
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_PROFILE_DEPTH = 64;
const MAX_PROFILE_NODES = PLAYER_PROFILE_LIMITS.collectionEntries * 8 + 1_024;
function utf8ByteLength(value) {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit <= 0x7f)
            bytes += 1;
        else if (codeUnit <= 0x7ff)
            bytes += 2;
        else if (codeUnit >= 0xd800
            && codeUnit <= 0xdbff
            && index + 1 < value.length
            && value.charCodeAt(index + 1) >= 0xdc00
            && value.charCodeAt(index + 1) <= 0xdfff) {
            bytes += 4;
            index += 1;
        }
        else
            bytes += 3;
    }
    return bytes;
}
/**
 * Validate and budget an untrusted profile without invoking accessors or coercion hooks.
 * Non-finite numbers are allowed here because the profile normalizer intentionally repairs them.
 */
function assertSafeBoundedInput(value) {
    const ancestors = new WeakSet();
    let bytes = 0;
    let nodes = 0;
    const emit = (valueToMeasure) => {
        bytes += utf8ByteLength(valueToMeasure);
        if (bytes > PLAYER_PROFILE_LIMITS.jsonBytes) {
            throw new Error(`Player profile exceeds the ${PLAYER_PROFILE_LIMITS.jsonBytes} byte budget.`);
        }
    };
    const visit = (current, depth) => {
        if (depth > MAX_PROFILE_DEPTH)
            throw new Error("Player profile exceeds the nesting depth limit.");
        nodes += 1;
        if (nodes > MAX_PROFILE_NODES)
            throw new Error("Player profile exceeds the node budget.");
        if (current === null) {
            emit("null");
            return;
        }
        if (typeof current === "string") {
            emit(JSON.stringify(current));
            return;
        }
        if (typeof current === "boolean") {
            emit(current ? "true" : "false");
            return;
        }
        if (typeof current === "number") {
            emit(Number.isFinite(current) ? (Object.is(current, -0) ? "0" : JSON.stringify(current)) : "null");
            return;
        }
        if (typeof current !== "object") {
            throw new Error(`Player profile rejects unsupported ${typeof current} values.`);
        }
        if (ancestors.has(current))
            throw new Error("Player profile rejects values containing a cycle.");
        ancestors.add(current);
        try {
            if (Array.isArray(current)) {
                if (Object.getPrototypeOf(current) !== Array.prototype) {
                    throw new Error("Player profile accepts plain arrays only.");
                }
                const descriptors = Object.getOwnPropertyDescriptors(current);
                if (Object.getOwnPropertySymbols(descriptors).length > 0) {
                    throw new Error("Player profile rejects symbol keys.");
                }
                const lengthDescriptor = descriptors.length;
                if (!lengthDescriptor || !("value" in lengthDescriptor)) {
                    throw new Error("Player profile array length must be a data property.");
                }
                const length = lengthDescriptor.value;
                if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
                    throw new Error("Player profile array length is invalid.");
                }
                if (length > PLAYER_PROFILE_LIMITS.collectionEntries) {
                    throw new Error(`Player profile collection exceeds the ${PLAYER_PROFILE_LIMITS.collectionEntries} entry limit.`);
                }
                const elementKeys = Object.keys(descriptors).filter((key) => key !== "length");
                if (elementKeys.length !== length) {
                    throw new Error("Player profile rejects sparse arrays or arrays with extra properties.");
                }
                emit("[");
                for (let index = 0; index < length; index += 1) {
                    if (index > 0)
                        emit(",");
                    const descriptor = descriptors[String(index)];
                    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
                        throw new Error("Player profile array entries must be enumerable data properties; accessors are rejected.");
                    }
                    visit(descriptor.value, depth + 1);
                }
                emit("]");
                return;
            }
            if (Object.getPrototypeOf(current) !== Object.prototype) {
                throw new Error("Player profile accepts plain objects with the standard prototype only.");
            }
            const descriptors = Object.getOwnPropertyDescriptors(current);
            if (Object.getOwnPropertySymbols(descriptors).length > 0) {
                throw new Error("Player profile rejects symbol keys.");
            }
            const keys = Object.keys(descriptors).sort();
            if (keys.length > PLAYER_PROFILE_LIMITS.collectionEntries) {
                throw new Error(`Player profile collection exceeds the ${PLAYER_PROFILE_LIMITS.collectionEntries} entry limit.`);
            }
            for (const key of keys) {
                // The envelope is closed and must never accept pollution-shaped fields. Nested
                // records, however, use authored domain IDs and are copied with defineProperty;
                // `__proto__` and `constructor` are therefore safe and valid there.
                if (depth === 0 && UNSAFE_KEYS.has(key)) {
                    throw new Error(`Player profile rejects unsafe prototype key "${key}".`);
                }
                const descriptor = descriptors[key];
                if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
                    throw new Error("Player profile object fields must be enumerable data properties; accessors are rejected.");
                }
            }
            emit("{");
            for (let index = 0; index < keys.length; index += 1) {
                if (index > 0)
                    emit(",");
                const key = keys[index];
                emit(JSON.stringify(key));
                emit(":");
                visit(descriptors[key].value, depth + 1);
            }
            emit("}");
        }
        finally {
            ancestors.delete(current);
        }
    };
    visit(value, 0);
}
function objectFields(value, context) {
    if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new Error(`${context} must be a plain object.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const fields = new Map();
    for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw new Error(`${context} fields must be enumerable data properties; accessors are rejected.`);
        }
        fields.set(key, descriptor.value);
    }
    return fields;
}
function arrayItems(value, context) {
    if (!Array.isArray(value))
        return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
        throw new Error(`${context} has an invalid array length.`);
    }
    const items = [];
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw new Error(`${context} rejects sparse arrays and accessors.`);
        }
        items.push(descriptor.value);
    }
    return items;
}
function setRecordValue(record, key, value) {
    Object.defineProperty(record, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
    });
}
class WarningCollector {
    collected = [];
    truncated = false;
    add(code, path, message) {
        if (this.truncated)
            return;
        if (this.collected.length >= PLAYER_PROFILE_LIMITS.warnings) {
            this.collected[PLAYER_PROFILE_LIMITS.warnings - 1] = Object.freeze({
                code: "warnings_truncated",
                path: "$",
                message: `Additional player profile warnings were omitted after reaching the ${PLAYER_PROFILE_LIMITS.warnings} warning limit.`
            });
            this.truncated = true;
            return;
        }
        this.collected.push(Object.freeze({ code, path, message }));
    }
    finish() {
        return Object.freeze(this.collected.slice());
    }
}
function normalizedNumber(value) {
    if (typeof value === "number")
        return value;
    if (typeof value === "string" && value.trim().length > 0)
        return Number(value);
    return undefined;
}
function diagnosticValueLabel(value) {
    if (value === null)
        return "null";
    if (typeof value === "string")
        return value;
    if (typeof value === "number") {
        if (Number.isNaN(value))
            return "NaN";
        if (value === Number.POSITIVE_INFINITY)
            return "Infinity";
        if (value === Number.NEGATIVE_INFINITY)
            return "-Infinity";
        return Object.is(value, -0) ? "0" : `${value}`;
    }
    if (typeof value === "boolean")
        return value ? "true" : "false";
    if (Array.isArray(value))
        return "[array]";
    if (typeof value === "object")
        return "[object]";
    return `[${typeof value}]`;
}
function normalizeNonnegativeNumber(value, path, warnings, options = {}) {
    const parsed = normalizedNumber(value);
    let normalized = parsed !== undefined && Number.isFinite(parsed) ? parsed : 0;
    if (normalized < 0)
        normalized = 0;
    if (options.integer)
        normalized = Math.floor(normalized);
    if (options.maximum !== undefined)
        normalized = Math.min(normalized, options.maximum);
    if (parsed === undefined || !Number.isFinite(parsed) || normalized !== parsed || typeof value !== "number") {
        warnings.add("number_normalized", path, `Player profile value at ${path} was normalized to ${normalized}.`);
    }
    return Object.is(normalized, -0) ? 0 : normalized;
}
function freezeProfile(profile) {
    Object.freeze(profile.clearedMissionIds);
    Object.freeze(profile.starsByMission);
    Object.freeze(profile.metaResources);
    Object.freeze(profile.upgradeLevels);
    return Object.freeze(profile);
}
export function createEmptyPlayerProfile(content) {
    const metaResources = {};
    for (const currency of content.metaProgression.currencies)
        setRecordValue(metaResources, currency.id, 0);
    const upgradeLevels = {};
    for (const upgradeId of Object.keys(content.metaProgression.upgrades))
        setRecordValue(upgradeLevels, upgradeId, 0);
    return freezeProfile({
        version: PLAYER_PROFILE_SCHEMA_VERSION,
        clearedMissionIds: [],
        starsByMission: {},
        metaResources,
        upgradeLevels,
        selectedDifficultyId: content.defaultDifficultyId
    });
}
function normalizeProfile(fields, content, warnings) {
    for (const key of fields.keys()) {
        if (!PROFILE_KEY_SET.has(key)) {
            warnings.add("extra_field_dropped", `$.${key}`, `Extra player profile field "${key}" was dropped.`);
        }
    }
    const clearedMissionIds = [];
    const seenMissions = new Set();
    const rawClears = arrayItems(fields.get("clearedMissionIds"), "Player profile clearedMissionIds");
    if (fields.has("clearedMissionIds") && !rawClears) {
        warnings.add("invalid_collection", "$.clearedMissionIds", "Player profile clearedMissionIds was not an array and was reset.");
    }
    for (let index = 0; index < (rawClears?.length ?? 0); index += 1) {
        const missionId = rawClears[index];
        const path = `$.clearedMissionIds[${index}]`;
        if (typeof missionId !== "string" || !Object.prototype.hasOwnProperty.call(content.missions, missionId)) {
            warnings.add("unknown_mission_dropped", path, `Unknown mission "${diagnosticValueLabel(missionId)}" was dropped.`);
            continue;
        }
        if (seenMissions.has(missionId)) {
            warnings.add("duplicate_mission_dropped", path, `Duplicate mission "${missionId}" was dropped.`);
            continue;
        }
        seenMissions.add(missionId);
        clearedMissionIds.push(missionId);
    }
    const starsByMission = {};
    let starFields;
    if (fields.has("starsByMission")) {
        const rawStars = fields.get("starsByMission");
        if (rawStars !== null && typeof rawStars === "object" && !Array.isArray(rawStars)) {
            starFields = objectFields(rawStars, "Player profile starsByMission");
        }
        else {
            warnings.add("invalid_collection", "$.starsByMission", "Player profile starsByMission was not an object and was reset.");
        }
    }
    if (starFields) {
        for (const missionId of starFields.keys()) {
            if (!Object.prototype.hasOwnProperty.call(content.missions, missionId)) {
                warnings.add("unknown_mission_dropped", `$.starsByMission.${missionId}`, `Unknown mission "${missionId}" was dropped from stars.`);
            }
        }
        for (const missionId of Object.keys(content.missions)) {
            if (!starFields.has(missionId))
                continue;
            const maximum = content.missions[missionId]?.objectives?.stars?.length ?? 0;
            setRecordValue(starsByMission, missionId, normalizeNonnegativeNumber(starFields.get(missionId), `$.starsByMission.${missionId}`, warnings, { integer: true, maximum }));
        }
    }
    const metaResources = {};
    let resourceFields;
    if (fields.has("metaResources")) {
        const rawResources = fields.get("metaResources");
        if (rawResources !== null && typeof rawResources === "object" && !Array.isArray(rawResources)) {
            resourceFields = objectFields(rawResources, "Player profile metaResources");
        }
        else {
            warnings.add("invalid_collection", "$.metaResources", "Player profile metaResources was not an object and was reset.");
        }
    }
    const currencyIds = new Set(content.metaProgression.currencies.map((currency) => currency.id));
    if (resourceFields) {
        for (const currencyId of resourceFields.keys()) {
            if (!currencyIds.has(currencyId)) {
                warnings.add("unknown_currency_dropped", `$.metaResources.${currencyId}`, `Unknown currency "${currencyId}" was dropped.`);
            }
        }
    }
    for (const currency of content.metaProgression.currencies) {
        setRecordValue(metaResources, currency.id, resourceFields?.has(currency.id)
            ? normalizeNonnegativeNumber(resourceFields.get(currency.id), `$.metaResources.${currency.id}`, warnings)
            : 0);
    }
    const upgradeLevels = {};
    let upgradeFields;
    if (fields.has("upgradeLevels")) {
        const rawUpgrades = fields.get("upgradeLevels");
        if (rawUpgrades !== null && typeof rawUpgrades === "object" && !Array.isArray(rawUpgrades)) {
            upgradeFields = objectFields(rawUpgrades, "Player profile upgradeLevels");
        }
        else {
            warnings.add("invalid_collection", "$.upgradeLevels", "Player profile upgradeLevels was not an object and was reset.");
        }
    }
    const authoredUpgrades = content.metaProgression.upgrades;
    if (upgradeFields) {
        for (const upgradeId of upgradeFields.keys()) {
            if (!Object.prototype.hasOwnProperty.call(authoredUpgrades, upgradeId)) {
                warnings.add("unknown_upgrade_dropped", `$.upgradeLevels.${upgradeId}`, `Unknown upgrade "${upgradeId}" was dropped.`);
            }
        }
    }
    for (const upgradeId of Object.keys(authoredUpgrades)) {
        setRecordValue(upgradeLevels, upgradeId, upgradeFields?.has(upgradeId)
            ? normalizeNonnegativeNumber(upgradeFields.get(upgradeId), `$.upgradeLevels.${upgradeId}`, warnings, {
                integer: true,
                maximum: Math.max(0, Math.floor(authoredUpgrades[upgradeId]?.maxLevel ?? 0))
            })
            : 0);
    }
    let selectedDifficultyId = content.defaultDifficultyId;
    if (fields.has("selectedDifficultyId")) {
        const candidate = fields.get("selectedDifficultyId");
        if (typeof candidate === "string" && content.difficulties.some((difficulty) => difficulty.id === candidate)) {
            selectedDifficultyId = candidate;
        }
        else {
            warnings.add("unknown_difficulty_defaulted", "$.selectedDifficultyId", `Player profile difficulty "${diagnosticValueLabel(candidate)}" is unknown; defaulted to "${content.defaultDifficultyId}".`);
        }
    }
    return freezeProfile({
        version: PLAYER_PROFILE_SCHEMA_VERSION,
        clearedMissionIds,
        starsByMission,
        metaResources,
        upgradeLevels,
        selectedDifficultyId
    });
}
function frozenMigrations(source) {
    if (source === "v2")
        return Object.freeze([]);
    const migration = source === "legacy-array"
        ? {
            id: "legacy-clears-array-to-profile-v2",
            description: "Migrated the legacy cleared-mission array to player profile v2."
        }
        : {
            id: "legacy-object-to-profile-v2",
            description: "Migrated the legacy unversioned/version-1 object to player profile v2."
        };
    return Object.freeze([Object.freeze(migration)]);
}
export function decodePlayerProfile(value, content) {
    assertSafeBoundedInput(value);
    const warnings = new WarningCollector();
    let source;
    let fields;
    if (Array.isArray(value)) {
        source = "legacy-array";
        fields = new Map([["clearedMissionIds", value]]);
    }
    else {
        fields = objectFields(value, "Player profile");
        if (!fields.has("version"))
            source = "legacy-object";
        else {
            const version = fields.get("version");
            if (version === PLAYER_PROFILE_SCHEMA_VERSION)
                source = "v2";
            else if (version === 1)
                source = "legacy-object";
            else if (typeof version === "number" && Number.isSafeInteger(version) && version > PLAYER_PROFILE_SCHEMA_VERSION) {
                throw new UnsupportedPlayerProfileVersionError(version);
            }
            else {
                throw new Error(`Invalid player profile version "${diagnosticValueLabel(version)}".`);
            }
        }
    }
    const result = {
        profile: normalizeProfile(fields, content, warnings),
        source,
        migrations: frozenMigrations(source),
        warnings: warnings.finish()
    };
    return Object.freeze(result);
}
export function parsePlayerProfileJson(source, content) {
    if (typeof source !== "string")
        throw new Error("Player profile JSON source must be a string.");
    if (utf8ByteLength(source) > PLAYER_PROFILE_LIMITS.jsonBytes) {
        throw new Error(`Player profile JSON exceeds the ${PLAYER_PROFILE_LIMITS.jsonBytes} byte budget.`);
    }
    let parsed;
    try {
        parsed = JSON.parse(source);
    }
    catch (cause) {
        throw new Error("Player profile JSON is malformed.", { cause });
    }
    return decodePlayerProfile(parsed, content);
}
function assertSerializableProfile(profile) {
    assertSafeBoundedInput(profile);
    const fields = objectFields(profile, "Player profile");
    if (fields.size !== PROFILE_KEYS.length || PROFILE_KEYS.some((key) => !fields.has(key))) {
        throw new Error("Player profile contains missing or unsupported fields.");
    }
    if (fields.get("version") !== PLAYER_PROFILE_SCHEMA_VERSION) {
        throw new Error("Player profile version must be 2 for serialization.");
    }
    const clears = arrayItems(fields.get("clearedMissionIds"), "Player profile clearedMissionIds");
    if (!clears || clears.some((missionId) => typeof missionId !== "string")) {
        throw new Error("Player profile clearedMissionIds must contain strings.");
    }
    for (const [fieldName, integer] of [
        ["starsByMission", true],
        ["metaResources", false],
        ["upgradeLevels", true]
    ]) {
        const values = objectFields(fields.get(fieldName), `Player profile ${fieldName}`);
        for (const value of values.values()) {
            if (typeof value !== "number"
                || !Number.isFinite(value)
                || value < 0
                || (integer && !Number.isInteger(value))) {
                throw new Error(`Player profile ${fieldName} contains an invalid value.`);
            }
        }
    }
    if (typeof fields.get("selectedDifficultyId") !== "string") {
        throw new Error("Player profile selectedDifficultyId must be a string.");
    }
}
export function serializePlayerProfile(profile) {
    assertSerializableProfile(profile);
    return canonicalStringify(profile, {
        maxDepth: MAX_PROFILE_DEPTH,
        maxNodes: MAX_PROFILE_NODES,
        maxBytes: PLAYER_PROFILE_LIMITS.jsonBytes
    });
}
export function getPlayerProfileLaunchOptions(profile) {
    assertSerializableProfile(profile);
    const fields = objectFields(profile, "Player profile");
    const selectedDifficultyId = fields.get("selectedDifficultyId");
    const upgradeFields = objectFields(fields.get("upgradeLevels"), "Player profile upgradeLevels");
    const metaUpgradeLevels = {};
    for (const [upgradeId, level] of upgradeFields) {
        setRecordValue(metaUpgradeLevels, upgradeId, level);
    }
    return {
        difficultyId: selectedDifficultyId,
        metaUpgradeLevels
    };
}
function frozenFailure(code, profile) {
    return Object.freeze({ ok: false, code, profile });
}
function ownDataValue(record, key) {
    if (record === null || typeof record !== "object")
        return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
function ownNumberOrZero(record, key) {
    const value = ownDataValue(record, key);
    return typeof value === "number" ? value : 0;
}
function copyNumberRecord(source) {
    const copy = {};
    for (const key of Object.keys(source))
        setRecordValue(copy, key, ownNumberOrZero(source, key));
    return copy;
}
function copyProfile(profile, changes = {}) {
    return freezeProfile({
        version: PLAYER_PROFILE_SCHEMA_VERSION,
        clearedMissionIds: changes.clearedMissionIds ?? [...profile.clearedMissionIds],
        starsByMission: changes.starsByMission ?? copyNumberRecord(profile.starsByMission),
        metaResources: changes.metaResources ?? copyNumberRecord(profile.metaResources),
        upgradeLevels: changes.upgradeLevels ?? copyNumberRecord(profile.upgradeLevels),
        selectedDifficultyId: changes.selectedDifficultyId ?? profile.selectedDifficultyId
    });
}
function metaCurrencyIds(content) {
    return content.metaProgression.currencies.map((currency) => currency.id);
}
function isValidMetaResourceBag(value, currencyIds) {
    if (value === null
        || typeof value !== "object"
        || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype)
        return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length > 0)
        return false;
    for (const currencyId of Object.keys(descriptors)) {
        const descriptor = descriptors[currencyId];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
            return false;
        const amount = descriptor.value;
        if (!currencyIds.has(currencyId) || typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
            return false;
        }
    }
    return true;
}
export function selectPlayerDifficulty(profile, content, difficultyId) {
    assertSerializableProfile(profile);
    if (!content.difficulties.some((difficulty) => difficulty.id === difficultyId)) {
        return frozenFailure("unknown_difficulty", profile);
    }
    if (profile.selectedDifficultyId === difficultyId) {
        return Object.freeze({ ok: true, code: "difficulty_unchanged", profile });
    }
    return Object.freeze({
        ok: true,
        code: "difficulty_selected",
        profile: copyProfile(profile, { selectedDifficultyId: difficultyId })
    });
}
export function purchasePlayerMetaUpgrade(profile, content, upgradeId) {
    assertSerializableProfile(profile);
    if (!Object.prototype.hasOwnProperty.call(content.metaProgression.upgrades, upgradeId)) {
        return frozenFailure("unknown_upgrade", profile);
    }
    const upgrade = ownDataValue(content.metaProgression.upgrades, upgradeId);
    const previousLevel = ownNumberOrZero(profile.upgradeLevels, upgradeId);
    if (previousLevel >= upgrade.maxLevel)
        return frozenFailure("upgrade_max_level", profile);
    const currencyIds = metaCurrencyIds(content);
    const currencyIdSet = new Set(currencyIds);
    const cost = upgrade.costs[previousLevel];
    if (!isValidMetaResourceBag(cost, currencyIdSet))
        return frozenFailure("invalid_upgrade_cost", profile);
    for (const currencyId of currencyIds) {
        if (ownNumberOrZero(profile.metaResources, currencyId) < ownNumberOrZero(cost, currencyId)) {
            return frozenFailure("insufficient_meta_resources", profile);
        }
    }
    const metaResources = copyNumberRecord(profile.metaResources);
    for (const currencyId of currencyIds) {
        setRecordValue(metaResources, currencyId, ownNumberOrZero(profile.metaResources, currencyId) - ownNumberOrZero(cost, currencyId));
    }
    const upgradeLevels = copyNumberRecord(profile.upgradeLevels);
    const newLevel = previousLevel + 1;
    setRecordValue(upgradeLevels, upgradeId, newLevel);
    return Object.freeze({
        ok: true,
        code: "upgrade_purchased",
        profile: copyProfile(profile, { metaResources, upgradeLevels }),
        upgradeId,
        previousLevel,
        newLevel
    });
}
export function isPlayerMissionUnlocked(profile, content, missionId) {
    assertSerializableProfile(profile);
    if (!Object.prototype.hasOwnProperty.call(content.missions, missionId))
        return false;
    const node = content.worldMap.missionNodes.find((candidate) => candidate.missionId === missionId);
    if (!node)
        return true;
    const clearedMissionIds = new Set(profile.clearedMissionIds);
    return node.unlockRequiresMissionIds.every((requiredId) => clearedMissionIds.has(requiredId));
}
export function newlyUnlockedPlayerMissionIds(profile, content, clearedMissionId) {
    assertSerializableProfile(profile);
    if (!profile.clearedMissionIds.includes(clearedMissionId))
        return Object.freeze([]);
    const clearedMissionIds = new Set(profile.clearedMissionIds);
    const newlyUnlocked = [];
    for (const missionId of Object.keys(content.missions)) {
        const node = content.worldMap.missionNodes.find((candidate) => candidate.missionId === missionId);
        if (!node
            || clearedMissionIds.has(missionId)
            || !node.unlockRequiresMissionIds.includes(clearedMissionId)
            || !node.unlockRequiresMissionIds.every((requiredId) => clearedMissionIds.has(requiredId))) {
            continue;
        }
        newlyUnlocked.push(missionId);
    }
    return Object.freeze(newlyUnlocked);
}
export function recordPlayerMissionClear(profile, content, missionId, earnedStars) {
    assertSerializableProfile(profile);
    if (!Object.prototype.hasOwnProperty.call(content.missions, missionId)) {
        return frozenFailure("unknown_mission", profile);
    }
    const maximumStars = content.missions[missionId].objectives?.stars?.length ?? 0;
    if (!Number.isFinite(earnedStars) || !Number.isInteger(earnedStars) || earnedStars < 0 || earnedStars > maximumStars) {
        return frozenFailure("invalid_earned_stars", profile);
    }
    const reward = Object.prototype.hasOwnProperty.call(content.metaProgression.rewardsByMission, missionId)
        ? ownDataValue(content.metaProgression.rewardsByMission, missionId)
        : undefined;
    const firstClearReward = reward && typeof reward === "object" ? ownDataValue(reward, "firstClear") : undefined;
    const repeatClearReward = reward && typeof reward === "object" ? ownDataValue(reward, "repeatClear") : undefined;
    const perStarReward = reward && typeof reward === "object" ? ownDataValue(reward, "perStar") : undefined;
    const currencyIds = metaCurrencyIds(content);
    const currencyIdSet = new Set(currencyIds);
    if (reward !== undefined
        && (reward === null
            || typeof reward !== "object"
            || !isValidMetaResourceBag(firstClearReward ?? {}, currencyIdSet)
            || !isValidMetaResourceBag(repeatClearReward ?? {}, currencyIdSet)
            || !isValidMetaResourceBag(perStarReward ?? {}, currencyIdSet))) {
        return frozenFailure("invalid_mission_reward", profile);
    }
    const firstClear = !profile.clearedMissionIds.includes(missionId);
    const previousStars = ownNumberOrZero(profile.starsByMission, missionId);
    const bestStars = Math.max(previousStars, earnedStars);
    const rewardedStarCount = Math.max(0, bestStars - previousStars);
    const baseReward = firstClear ? firstClearReward : repeatClearReward;
    const grantedResources = {};
    const metaResources = copyNumberRecord(profile.metaResources);
    for (const currencyId of currencyIds) {
        const amount = ownNumberOrZero(baseReward, currencyId)
            + ownNumberOrZero(perStarReward, currencyId) * rewardedStarCount;
        const newBalance = ownNumberOrZero(profile.metaResources, currencyId) + amount;
        if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(newBalance)) {
            return frozenFailure("invalid_mission_reward", profile);
        }
        if (amount > 0)
            setRecordValue(grantedResources, currencyId, amount);
        setRecordValue(metaResources, currencyId, newBalance);
    }
    const clearedMissionIds = [...profile.clearedMissionIds];
    if (firstClear)
        clearedMissionIds.push(missionId);
    const starsByMission = copyNumberRecord(profile.starsByMission);
    setRecordValue(starsByMission, missionId, bestStars);
    const nextProfile = copyProfile(profile, { clearedMissionIds, starsByMission, metaResources });
    const newlyUnlockedMissionIds = firstClear
        ? newlyUnlockedPlayerMissionIds(nextProfile, content, missionId)
        : Object.freeze([]);
    return Object.freeze({
        ok: true,
        code: "mission_clear_recorded",
        profile: nextProfile,
        missionId,
        firstClear,
        previousStars,
        earnedStars,
        grantedResources: Object.freeze(grantedResources),
        newlyUnlockedMissionIds
    });
}
