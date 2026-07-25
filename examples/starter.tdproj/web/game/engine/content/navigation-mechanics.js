import { resolveCapabilitySet } from "./mechanics.js";
/** Closed R2 navigation budgets. These are content/runtime contracts, not UI hints. */
export const NAVIGATION_LIMITS = Object.freeze({
    movementProfiles: 32,
    enemyAssignments: 4_096,
    routeEndpointPairs: 64,
    uniqueGoals: 64,
    cachedProfileGoalPairs: 256,
    activeMapCells: 65_536,
    materializedFieldCells: 4_194_304,
    terrainOverridesPerProfile: 256,
    terrainOverridesAcrossProfiles: 8_192,
    terrainDefinitions: 256,
    terrainTagsPerDefinition: 64,
    terrainTagsAcrossDefinitions: 8_192,
    terrainTagUtf8Bytes: 128,
    terrainCost: 1_000_000,
    idUtf8Bytes: 128,
    labelLength: 128,
    liveEnemyStates: 16_384,
    placementAnalysisCoordinates: 4_096,
    placementAnalysisRelaxations: 8_388_608
});
/** Machine-readable authoring descriptor shared with future Studio/MCP surfaces. */
export const NAVIGATION_MECHANICS_SCHEMA = Object.freeze({
    schemaVersion: 1,
    moduleId: "navigation",
    supportedModuleSchemaVersions: Object.freeze([1]),
    profile: Object.freeze({
        additionalProperties: false,
        discriminator: "mode",
        modes: Object.freeze({
            authored_routes: Object.freeze({
                requiredFields: Object.freeze(["mode"]),
                optionalFields: Object.freeze([])
            }),
            dynamic_flow: Object.freeze({
                requiredFields: Object.freeze(["mode", "defaultMovementProfileId", "movementProfiles"]),
                optionalFields: Object.freeze(["enemyMovementProfiles"])
            })
        })
    }),
    limits: NAVIGATION_LIMITS,
    runtimeSnapshot: Object.freeze({
        path: "snapshot.navigation",
        schemaVersion: 1,
        modes: Object.freeze(["dynamic_flow"]),
        optionalUnlessActiveDynamicFlow: true
    })
});
export class NavigationProfileValidationError extends Error {
    fieldPath;
    constructor(fieldPath, message) {
        super(message);
        this.name = "NavigationProfileValidationError";
        this.fieldPath = fieldPath;
    }
}
function plainRecord(value, fieldPath, label) {
    let prototype;
    let descriptors;
    try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
            ? Object.getOwnPropertyDescriptors(value)
            : {};
    }
    catch {
        throw new NavigationProfileValidationError(fieldPath, `${label} could not be inspected safely.`);
    }
    if (value === null || typeof value !== "object" || Array.isArray(value) || prototype !== Object.prototype) {
        throw new NavigationProfileValidationError(fieldPath, `${label} must be a plain object with own data fields.`);
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new NavigationProfileValidationError(fieldPath, `${label} must not contain symbol fields.`);
    }
    const detached = {};
    for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
            throw new NavigationProfileValidationError(`${fieldPath}.${key}`, `${label}.${key} must be an enumerable own data field.`);
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
function requireExactKeys(value, allowed, fieldPath, label) {
    const allowedKeys = new Set(allowed);
    const unexpected = Object.keys(value).find((key) => !allowedKeys.has(key));
    if (unexpected !== undefined) {
        throw new NavigationProfileValidationError(`${fieldPath}.${unexpected}`, `${label} contains unknown closed field "${unexpected}".`);
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
function boundedId(value, fieldPath, label) {
    if (typeof value !== "string" || value.length === 0) {
        throw new NavigationProfileValidationError(fieldPath, `${label} must be a non-empty string id.`);
    }
    if (utf8ByteLength(value) > NAVIGATION_LIMITS.idUtf8Bytes) {
        throw new NavigationProfileValidationError(fieldPath, `${label} exceeds the ${NAVIGATION_LIMITS.idUtf8Bytes} UTF-8 byte limit.`);
    }
    return value;
}
function boundedLabel(value, fieldPath) {
    if (typeof value !== "string" || value.length === 0 || value.length > NAVIGATION_LIMITS.labelLength) {
        throw new NavigationProfileValidationError(fieldPath, `Movement profile label must contain 1..${NAVIGATION_LIMITS.labelLength} characters.`);
    }
    return value;
}
function terrainCost(value, fieldPath) {
    if (value === null)
        return null;
    if (typeof value !== "number"
        || !Number.isFinite(value)
        || !Number.isSafeInteger(value)
        || value < 1
        || value > NAVIGATION_LIMITS.terrainCost) {
        throw new NavigationProfileValidationError(fieldPath, `Terrain cost must be a safe integer from 1 to ${NAVIGATION_LIMITS.terrainCost}, or null.`);
    }
    return value;
}
function compareBinary(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function defineOwn(target, key, value) {
    Object.defineProperty(target, key, { value, enumerable: true });
}
function normalizeMovementProfile(value, fieldPath) {
    const profile = plainRecord(value, fieldPath, "Movement profile");
    requireExactKeys(profile, ["label", "terrainMode", "towerOccupancy", "defaultTerrainCost", "terrainCosts"], fieldPath, "Movement profile");
    for (const required of ["label", "terrainMode", "towerOccupancy", "defaultTerrainCost"]) {
        if (!Object.prototype.hasOwnProperty.call(profile, required)) {
            throw new NavigationProfileValidationError(`${fieldPath}.${required}`, `Movement profile ${required} is required.`);
        }
    }
    const label = boundedLabel(profile.label, `${fieldPath}.label`);
    if (profile.terrainMode !== "respect_walkable" && profile.terrainMode !== "ignore_walkable") {
        throw new NavigationProfileValidationError(`${fieldPath}.terrainMode`, "Movement profile terrainMode must be respect_walkable or ignore_walkable.");
    }
    if (profile.towerOccupancy !== "blocked" && profile.towerOccupancy !== "ignored") {
        throw new NavigationProfileValidationError(`${fieldPath}.towerOccupancy`, "Movement profile towerOccupancy must be blocked or ignored.");
    }
    const defaultTerrainCost = terrainCost(profile.defaultTerrainCost, `${fieldPath}.defaultTerrainCost`);
    let terrainCosts;
    if (profile.terrainCosts !== undefined) {
        const authored = plainRecord(profile.terrainCosts, `${fieldPath}.terrainCosts`, "Movement terrain costs");
        if (Object.keys(authored).length > NAVIGATION_LIMITS.terrainOverridesPerProfile) {
            throw new NavigationProfileValidationError(`${fieldPath}.terrainCosts`, `Movement terrain costs exceed the ${NAVIGATION_LIMITS.terrainOverridesPerProfile} override limit.`);
        }
        const normalized = {};
        for (const terrainId of Object.keys(authored).sort(compareBinary)) {
            boundedId(terrainId, `${fieldPath}.terrainCosts.${terrainId}`, "Terrain id");
            defineOwn(normalized, terrainId, terrainCost(authored[terrainId], `${fieldPath}.terrainCosts.${terrainId}`));
        }
        terrainCosts = Object.freeze(normalized);
    }
    return Object.freeze({
        label,
        terrainMode: profile.terrainMode,
        towerOccupancy: profile.towerOccupancy,
        defaultTerrainCost,
        ...(terrainCosts === undefined ? {} : { terrainCosts })
    });
}
/**
 * Safely detaches one navigation v1 profile into canonical binary-key order.
 * Cross-project references are intentionally resolved by content validation/resolution.
 */
export function normalizeNavigationProfileV1(value) {
    const profile = plainRecord(value, "profile", "Navigation profile");
    if (profile.mode === "authored_routes") {
        requireExactKeys(profile, ["mode"], "profile", "authored_routes navigation profile");
        return Object.freeze({ mode: "authored_routes" });
    }
    if (profile.mode !== "dynamic_flow") {
        throw new NavigationProfileValidationError("profile.mode", "Navigation profile mode must be authored_routes or dynamic_flow.");
    }
    requireExactKeys(profile, ["mode", "defaultMovementProfileId", "movementProfiles", "enemyMovementProfiles"], "profile", "dynamic_flow navigation profile");
    for (const required of ["defaultMovementProfileId", "movementProfiles"]) {
        if (!Object.prototype.hasOwnProperty.call(profile, required)) {
            throw new NavigationProfileValidationError(`profile.${required}`, `Navigation ${required} is required.`);
        }
    }
    const defaultMovementProfileId = boundedId(profile.defaultMovementProfileId, "profile.defaultMovementProfileId", "Default movement profile id");
    const rawMovementProfiles = plainRecord(profile.movementProfiles, "profile.movementProfiles", "Navigation movement profiles");
    if (Object.keys(rawMovementProfiles).length > NAVIGATION_LIMITS.movementProfiles) {
        throw new NavigationProfileValidationError("profile.movementProfiles", `Navigation movement profiles exceed the ${NAVIGATION_LIMITS.movementProfiles} profile limit.`);
    }
    const movementProfiles = {};
    let terrainOverrideCount = 0;
    for (const movementProfileId of Object.keys(rawMovementProfiles).sort(compareBinary)) {
        boundedId(movementProfileId, `profile.movementProfiles.${movementProfileId}`, "Movement profile id");
        const normalized = normalizeMovementProfile(rawMovementProfiles[movementProfileId], `profile.movementProfiles.${movementProfileId}`);
        terrainOverrideCount += Object.keys(normalized.terrainCosts ?? {}).length;
        defineOwn(movementProfiles, movementProfileId, normalized);
    }
    if (terrainOverrideCount > NAVIGATION_LIMITS.terrainOverridesAcrossProfiles) {
        throw new NavigationProfileValidationError("profile.movementProfiles", `Navigation terrain costs exceed the ${NAVIGATION_LIMITS.terrainOverridesAcrossProfiles} total override limit.`);
    }
    let enemyMovementProfiles;
    if (profile.enemyMovementProfiles !== undefined) {
        const authored = plainRecord(profile.enemyMovementProfiles, "profile.enemyMovementProfiles", "Navigation enemy movement assignments");
        if (Object.keys(authored).length > NAVIGATION_LIMITS.enemyAssignments) {
            throw new NavigationProfileValidationError("profile.enemyMovementProfiles", `Navigation enemy assignments exceed the ${NAVIGATION_LIMITS.enemyAssignments} assignment limit.`);
        }
        const normalized = {};
        for (const enemyId of Object.keys(authored).sort(compareBinary)) {
            boundedId(enemyId, `profile.enemyMovementProfiles.${enemyId}`, "Enemy id");
            defineOwn(normalized, enemyId, boundedId(authored[enemyId], `profile.enemyMovementProfiles.${enemyId}`, "Assigned movement profile id"));
        }
        enemyMovementProfiles = Object.freeze(normalized);
    }
    return Object.freeze({
        mode: "dynamic_flow",
        defaultMovementProfileId,
        movementProfiles: Object.freeze(movementProfiles),
        ...(enemyMovementProfiles === undefined ? {} : { enemyMovementProfiles })
    });
}
/** Resolves and safely detaches the mission-selected navigation profile. */
export function resolveActiveNavigationMechanics(content, missionId) {
    const mission = Object.prototype.hasOwnProperty.call(content.missions, missionId)
        ? content.missions[missionId]
        : undefined;
    if (!mission)
        return undefined;
    const capability = resolveCapabilitySet(content.mechanics, mission.mechanics).navigation;
    if (!capability.active || capability.profileId === undefined)
        return undefined;
    const catalog = plainRecord(content.mechanics, "mechanics", "Active mechanics catalog");
    requireExactKeys(catalog, ["schemaVersion", "modules"], "mechanics", "Active mechanics catalog");
    if (catalog.schemaVersion !== 1)
        throw new Error("Active mechanics catalog must use schema version 1.");
    const modules = plainRecord(catalog.modules, "mechanics.modules", "Active mechanics modules");
    const module = plainRecord(modules.navigation, "mechanics.modules.navigation", "Active navigation mechanics module");
    requireExactKeys(module, ["schemaVersion", "enabled", "profiles"], "mechanics.modules.navigation", "Active navigation mechanics module");
    if (module.schemaVersion !== 1 || module.enabled !== true)
        return undefined;
    const profiles = plainRecord(module.profiles, "mechanics.modules.navigation.profiles", "Active navigation mechanics profiles");
    const authored = Object.prototype.hasOwnProperty.call(profiles, capability.profileId)
        ? profiles[capability.profileId]
        : undefined;
    if (authored === undefined)
        return undefined;
    const profile = normalizeNavigationProfileV1(authored);
    if (profile.mode === "dynamic_flow") {
        if (!Object.prototype.hasOwnProperty.call(profile.movementProfiles, profile.defaultMovementProfileId)) {
            throw new Error(`Active navigation default movement profile "${profile.defaultMovementProfileId}" is unknown.`);
        }
        for (const [enemyId, movementProfileId] of Object.entries(profile.enemyMovementProfiles ?? {})) {
            if (!Object.prototype.hasOwnProperty.call(content.enemies, enemyId)) {
                throw new Error(`Active navigation assignment references unknown enemy "${enemyId}".`);
            }
            if (!Object.prototype.hasOwnProperty.call(profile.movementProfiles, movementProfileId)) {
                throw new Error(`Active navigation assignment references unknown movement profile "${movementProfileId}".`);
            }
        }
        for (const movementProfile of Object.values(profile.movementProfiles)) {
            for (const terrainId of Object.keys(movementProfile.terrainCosts ?? {})) {
                if (!Object.prototype.hasOwnProperty.call(content.terrainTypes, terrainId)) {
                    throw new Error(`Active navigation terrain cost references unknown terrain "${terrainId}".`);
                }
            }
        }
    }
    return Object.freeze({ schemaVersion: 1, profileId: capability.profileId, ...profile });
}
