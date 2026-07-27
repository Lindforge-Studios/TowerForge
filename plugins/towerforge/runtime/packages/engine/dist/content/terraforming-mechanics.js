/** Closed structural and runtime budgets for opt-in transactional terraforming v1. */
export const TERRAFORMING_LIMITS = Object.freeze({
    transitionDefinitions: 64,
    sourceTagsPerTransition: 8,
    sourceTagsAcrossProfile: 512,
    idOrTagUtf8Bytes: 128,
    operationsPerBatch: 64,
    operationsPerScriptTransaction: 64,
    distinctCellsPerBatch: 64,
    activeTerrainOverrides: 512,
    activeElevationOverrides: 512,
    activeOverridesCombined: 1_024,
    elevationMinimum: -1_000_000,
    elevationMaximum: 1_000_000,
    maximumElevationDeltaPerOperation: 64,
    duration: 1_000_000_000,
    safetySourcesPerTransaction: 16_384,
    profileGoalFieldsPerTransaction: 256,
    fieldCellsBaselineAndCandidate: 8_388_608,
    pendingExpiryGroups: 512
});
/** Capability-aware authoring descriptor shared by Studio and MCP surfaces. */
export const TERRAFORMING_MECHANICS_SCHEMA = Object.freeze({
    schemaVersion: 1,
    moduleId: "terraforming",
    supportedModuleSchemaVersions: Object.freeze([1]),
    profile: Object.freeze({
        requiredFields: Object.freeze([]),
        optionalFields: Object.freeze(["terrainTransitions", "elevation"]),
        additionalProperties: false,
        terrainTransition: Object.freeze({
            requiredFields: Object.freeze(["fromTerrainTags", "toTerrainId"]),
            optionalFields: Object.freeze([]),
            additionalProperties: false,
            sourceTagSemantics: "any"
        }),
        elevation: Object.freeze({
            requiredFields: Object.freeze(["minimum", "maximum", "maximumDeltaPerOperation"]),
            optionalFields: Object.freeze([]),
            additionalProperties: false
        })
    }),
    limits: TERRAFORMING_LIMITS,
    dependencies: Object.freeze({
        terrain: "independent",
        elevation: Object.freeze({
            moduleId: "elevation",
            supportedModuleSchemaVersions: Object.freeze([1, 2, 3]),
            requiresProfilePolicy: "elevation"
        })
    }),
    towerScript: Object.freeze({
        minimumSchemaVersion: 6,
        action: "terraformTiles",
        event: "elevationChanged"
    }),
    failureReasons: Object.freeze([
        "terraform.invalid_operation",
        "terraform.operation_budget_exceeded",
        "terraform.duplicate_target",
        "terraform.target_outside_map",
        "terraform.transition_missing",
        "terraform.transition_source_tag_mismatch",
        "terraform.elevation_dependency_missing",
        "terraform.elevation_policy_missing",
        "terraform.elevation_out_of_range",
        "terraform.elevation_delta_exceeded",
        "terraform.override_budget_exceeded",
        "terraform.duration_out_of_range",
        "terraform.expiry_group_budget_exceeded",
        "terraform.target_owned",
        "terraform.authored_route_unavailable",
        "terraform.last_authored_route_blocked",
        "terraform.navigation_unavailable",
        "terraform.last_path_blocked",
        "terraform.solver_budget_exceeded"
    ]),
    runtimeSnapshot: Object.freeze({
        path: "snapshot.terraforming",
        schemaVersion: 1,
        optionalUnlessActive: true
    })
});
export class TerraformingProfileValidationError extends Error {
    fieldPath;
    constructor(fieldPath, message) {
        super(message);
        this.name = "TerraformingProfileValidationError";
        this.fieldPath = fieldPath;
    }
}
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
function inspectRecord(value, path, label) {
    let prototype;
    let descriptors;
    try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
            ? Object.getOwnPropertyDescriptors(value)
            : {};
    }
    catch {
        throw new TerraformingProfileValidationError(path, `${label} could not be inspected safely.`);
    }
    if (value === null || typeof value !== "object" || Array.isArray(value) || prototype !== Object.prototype) {
        throw new TerraformingProfileValidationError(path, `${label} must be a plain object with enumerable own data fields.`);
    }
    if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new TerraformingProfileValidationError(path, `${label} must not contain symbol fields.`);
    }
    const detached = Object.create(null);
    for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            throw new TerraformingProfileValidationError(`${path}.${key}`, `${label}.${key} must be an enumerable own data field; accessors are not allowed.`);
        }
        Object.defineProperty(detached, key, { value: descriptor.value, enumerable: true });
    }
    return Object.freeze(detached);
}
function rejectUnknownFields(record, allowed, path, label) {
    const unknown = Object.keys(record).find((key) => !allowed.includes(key));
    if (unknown !== undefined) {
        throw new TerraformingProfileValidationError(`${path}.${unknown}`, `${label} is closed; unknown field "${unknown}" is not allowed.`);
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
function boundedString(value, path, label) {
    if (typeof value !== "string" || value.length === 0
        || utf8ByteLength(value) > TERRAFORMING_LIMITS.idOrTagUtf8Bytes) {
        throw new TerraformingProfileValidationError(path, `${label} must contain 1..${TERRAFORMING_LIMITS.idOrTagUtf8Bytes} UTF-8 bytes.`);
    }
    return value;
}
function inspectSourceTags(value, path) {
    let prototype;
    let descriptors;
    try {
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = value !== null && typeof value === "object"
            ? Object.getOwnPropertyDescriptors(value)
            : {};
    }
    catch {
        throw new TerraformingProfileValidationError(path, "fromTerrainTags could not be inspected safely.");
    }
    if (!Array.isArray(value) || prototype !== Array.prototype) {
        throw new TerraformingProfileValidationError(path, "fromTerrainTags must be an ordinary dense own-data array.");
    }
    const length = descriptors.length && "value" in descriptors.length ? descriptors.length.value : undefined;
    if (!Number.isSafeInteger(length) || length < 1 || length > TERRAFORMING_LIMITS.sourceTagsPerTransition) {
        throw new TerraformingProfileValidationError(path, `fromTerrainTags must contain 1..${TERRAFORMING_LIMITS.sourceTagsPerTransition} tags.`);
    }
    if (Reflect.ownKeys(descriptors).some((key) => {
        if (key === "length")
            return false;
        return typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length;
    })) {
        throw new TerraformingProfileValidationError(path, "fromTerrainTags must be dense own data without extra fields.");
    }
    const result = [];
    const seen = new Set();
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
            throw new TerraformingProfileValidationError(`${path}[${index}]`, "fromTerrainTags must be dense own data; sparse entries and accessors are not allowed.");
        }
        const tag = boundedString(descriptor.value, `${path}[${index}]`, "Terrain tag");
        if (seen.has(tag)) {
            throw new TerraformingProfileValidationError(`${path}[${index}]`, `Duplicate terrain tag "${tag}".`);
        }
        seen.add(tag);
        result.push(tag);
    }
    result.sort();
    return Object.freeze(result);
}
function inspectElevationPolicy(value, path) {
    const record = inspectRecord(value, path, "Terraforming elevation policy");
    const fields = ["minimum", "maximum", "maximumDeltaPerOperation"];
    rejectUnknownFields(record, fields, path, "Terraforming elevation policy");
    for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(record, field)) {
            throw new TerraformingProfileValidationError(`${path}.${field}`, `Terraforming elevation ${field} is required.`);
        }
    }
    const minimum = record.minimum;
    const maximum = record.maximum;
    const maximumDeltaPerOperation = record.maximumDeltaPerOperation;
    if (!Number.isSafeInteger(minimum) || minimum < TERRAFORMING_LIMITS.elevationMinimum
        || minimum > TERRAFORMING_LIMITS.elevationMaximum) {
        throw new TerraformingProfileValidationError(`${path}.minimum`, `minimum must be a safe integer from ${TERRAFORMING_LIMITS.elevationMinimum} through ${TERRAFORMING_LIMITS.elevationMaximum}.`);
    }
    if (!Number.isSafeInteger(maximum) || maximum < TERRAFORMING_LIMITS.elevationMinimum
        || maximum > TERRAFORMING_LIMITS.elevationMaximum) {
        throw new TerraformingProfileValidationError(`${path}.maximum`, `maximum must be a safe integer from ${TERRAFORMING_LIMITS.elevationMinimum} through ${TERRAFORMING_LIMITS.elevationMaximum}.`);
    }
    if (minimum > maximum) {
        throw new TerraformingProfileValidationError(path, "Terraforming elevation minimum must not exceed maximum.");
    }
    if (!Number.isSafeInteger(maximumDeltaPerOperation) || maximumDeltaPerOperation < 1
        || maximumDeltaPerOperation > TERRAFORMING_LIMITS.maximumElevationDeltaPerOperation) {
        throw new TerraformingProfileValidationError(`${path}.maximumDeltaPerOperation`, `maximumDeltaPerOperation must be a safe integer from 1 through ${TERRAFORMING_LIMITS.maximumElevationDeltaPerOperation}.`);
    }
    return Object.freeze({
        minimum: minimum,
        maximum: maximum,
        maximumDeltaPerOperation: maximumDeltaPerOperation
    });
}
/** Validate and detach the exact closed v1 profile without invoking authored accessors. */
export function normalizeTerraformingProfileV1(value) {
    const profile = inspectRecord(value, "profile", "Terraforming profile");
    rejectUnknownFields(profile, TERRAFORMING_MECHANICS_SCHEMA.profile.optionalFields, "profile", "Terraforming profile");
    const transitions = Object.create(null);
    let totalSourceTags = 0;
    if (Object.prototype.hasOwnProperty.call(profile, "terrainTransitions")) {
        const authored = inspectRecord(profile.terrainTransitions, "profile.terrainTransitions", "Terraforming terrainTransitions");
        const ids = Object.keys(authored).sort();
        if (ids.length > TERRAFORMING_LIMITS.transitionDefinitions) {
            throw new TerraformingProfileValidationError("profile.terrainTransitions", `Terraforming profile exceeds the ${TERRAFORMING_LIMITS.transitionDefinitions} transition definition limit.`);
        }
        for (const transitionId of ids) {
            boundedString(transitionId, `profile.terrainTransitions.${transitionId}`, "Transition id");
            const path = `profile.terrainTransitions.${transitionId}`;
            const transition = inspectRecord(authored[transitionId], path, `Terraforming transition "${transitionId}"`);
            rejectUnknownFields(transition, TERRAFORMING_MECHANICS_SCHEMA.profile.terrainTransition.requiredFields, path, `Terraforming transition "${transitionId}"`);
            for (const field of TERRAFORMING_MECHANICS_SCHEMA.profile.terrainTransition.requiredFields) {
                if (!Object.prototype.hasOwnProperty.call(transition, field)) {
                    throw new TerraformingProfileValidationError(`${path}.${field}`, `Terraforming transition ${field} is required.`);
                }
            }
            const fromTerrainTags = inspectSourceTags(transition.fromTerrainTags, `${path}.fromTerrainTags`);
            totalSourceTags += fromTerrainTags.length;
            if (totalSourceTags > TERRAFORMING_LIMITS.sourceTagsAcrossProfile) {
                throw new TerraformingProfileValidationError(`${path}.fromTerrainTags`, `Terraforming profile exceeds the ${TERRAFORMING_LIMITS.sourceTagsAcrossProfile} total source-tag limit.`);
            }
            const toTerrainId = boundedString(transition.toTerrainId, `${path}.toTerrainId`, "Destination terrain id");
            Object.defineProperty(transitions, transitionId, {
                value: Object.freeze({ fromTerrainTags, toTerrainId }),
                enumerable: true
            });
        }
    }
    const elevation = Object.prototype.hasOwnProperty.call(profile, "elevation")
        ? inspectElevationPolicy(profile.elevation, "profile.elevation")
        : undefined;
    return Object.freeze({
        terrainTransitions: Object.freeze(transitions),
        ...(elevation ? { elevation } : {})
    });
}
/** Resolve a detached profile only when the mission genuinely activates terraforming v1. */
export function resolveActiveTerraformingMechanics(content, missionId) {
    try {
        const capability = content.missions[missionId]?.capabilities.terraforming;
        if (!capability?.active || capability.profileId === undefined)
            return undefined;
        const moduleValue = ownData(ownData(content.mechanics, "modules"), "terraforming");
        const module = inspectRecord(moduleValue, "module", "Terraforming mechanics module");
        if (module.schemaVersion !== 1 || module.enabled !== true)
            return undefined;
        const profiles = inspectRecord(module.profiles, "module.profiles", "Terraforming mechanics profiles");
        const profileValue = ownData(profiles, capability.profileId);
        const profile = normalizeTerraformingProfileV1(profileValue);
        return Object.freeze({
            schemaVersion: 1,
            profileId: capability.profileId,
            terrainTransitions: profile.terrainTransitions ?? Object.freeze({}),
            ...(profile.elevation ? { elevation: profile.elevation } : {})
        });
    }
    catch {
        return undefined;
    }
}
