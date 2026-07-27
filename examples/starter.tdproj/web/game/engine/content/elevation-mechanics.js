import { ELEVATION_LIMITS } from "../simulation/map.js";
export { ELEVATION_LIMITS } from "../simulation/map.js";
/** Closed R3.2 LoS budgets. They are engine contracts, not UI hints. */
export const LINE_OF_SIGHT_LIMITS = Object.freeze({
    activeMapCells: 65_536,
    terrainBlockerTags: 64,
    terrainTagUtf8Bytes: 128,
    terrainDefinitions: 256,
    terrainTagsPerDefinition: 64,
    terrainTagsAcrossDefinitions: 8_192,
    maximumRayDistance: 256,
    candidatesPerAcquisition: 4_096,
    analysisTargets: 4_096,
    cellInspectionsPerOperation: 1_048_576
});
export const ELEVATION_MECHANICS_SCHEMA = Object.freeze({
    schemaVersion: 2,
    moduleId: "elevation",
    supportedModuleSchemaVersions: Object.freeze([1, 2]),
    profile: Object.freeze({
        requiredFields: Object.freeze([]),
        optionalFields: Object.freeze(["lineOfSight"]),
        additionalProperties: false,
        versions: Object.freeze({
            1: Object.freeze({
                requiredFields: Object.freeze([]),
                optionalFields: Object.freeze([]),
                additionalProperties: false
            }),
            2: Object.freeze({
                requiredFields: Object.freeze([]),
                optionalFields: Object.freeze(["lineOfSight"]),
                additionalProperties: false
            })
        }),
        lineOfSight: Object.freeze({
            requiredFields: Object.freeze(["terrainBlockerTags"]),
            optionalFields: Object.freeze([]),
            additionalProperties: false
        })
    }),
    map: Object.freeze({
        field: "elevationOverrides",
        coordinateField: "elevation",
        implicitDefault: 0,
        canonicalOrder: Object.freeze(["r", "q"]),
        zeroOverridesOmitted: true
    }),
    limits: Object.freeze({
        ...ELEVATION_LIMITS,
        lineOfSight: LINE_OF_SIGHT_LIMITS
    }),
    runtimeSnapshot: Object.freeze({
        path: "snapshot.elevation",
        schemaVersion: 1,
        optionalUnlessActive: true,
        fields: Object.freeze(["schemaVersion", "defaultElevation", "overrides"])
    })
});
function ownDataValue(value, key) {
    if (value === null || typeof value !== "object")
        return undefined;
    try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && descriptor.enumerable && "value" in descriptor ? descriptor.value : undefined;
    }
    catch {
        return undefined;
    }
}
function utf8ByteLength(value) {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 0x7f)
            bytes += 1;
        else if (code <= 0x7ff)
            bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
            const next = value.charCodeAt(index + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                bytes += 4;
                index += 1;
            }
            else
                bytes += 3;
        }
        else
            bytes += 3;
    }
    return bytes;
}
function resolveTerrainBlockerTags(value) {
    let descriptors;
    let prototype;
    let array;
    try {
        array = Array.isArray(value);
        prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
        descriptors = Object.getOwnPropertyDescriptors(value);
    }
    catch {
        return undefined;
    }
    if (!array || prototype !== Array.prototype)
        return undefined;
    const lengthValue = descriptors.length?.value;
    if (!Number.isSafeInteger(lengthValue) || lengthValue < 0
        || lengthValue > LINE_OF_SIGHT_LIMITS.terrainBlockerTags) {
        return undefined;
    }
    const length = lengthValue;
    const result = [];
    const seen = new Set();
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
            return undefined;
        const tag = descriptor.value;
        if (typeof tag !== "string" || tag.length === 0
            || utf8ByteLength(tag) > LINE_OF_SIGHT_LIMITS.terrainTagUtf8Bytes || seen.has(tag)) {
            return undefined;
        }
        seen.add(tag);
        result.push(tag);
    }
    result.sort();
    return Object.freeze(result);
}
/** Resolve only the enabled, selected and supported mission-level opt-in switch. */
export function resolveActiveElevationMechanics(content, missionId) {
    const capability = content.missions[missionId]?.capabilities.elevation;
    if (!capability?.active || capability.profileId === undefined)
        return undefined;
    const authoredModule = ownDataValue(ownDataValue(content.mechanics, "modules"), "elevation");
    const schemaVersion = ownDataValue(authoredModule, "schemaVersion");
    if (schemaVersion === 1) {
        return Object.freeze({ schemaVersion: 1, profileId: capability.profileId });
    }
    if (schemaVersion !== 2)
        return undefined;
    const profile = ownDataValue(ownDataValue(authoredModule, "profiles"), capability.profileId);
    const lineOfSight = ownDataValue(profile, "lineOfSight");
    if (lineOfSight === undefined) {
        return Object.freeze({ schemaVersion: 2, profileId: capability.profileId });
    }
    const tags = resolveTerrainBlockerTags(ownDataValue(lineOfSight, "terrainBlockerTags"));
    if (!tags)
        return Object.freeze({ schemaVersion: 2, profileId: capability.profileId });
    return Object.freeze({
        schemaVersion: 2,
        profileId: capability.profileId,
        lineOfSight: Object.freeze({ terrainBlockerTags: tags })
    });
}
export function resolveActiveLineOfSightMechanics(content, missionId) {
    const elevation = resolveActiveElevationMechanics(content, missionId);
    if (elevation?.schemaVersion !== 2 || !elevation.lineOfSight)
        return undefined;
    return Object.freeze({
        profileId: elevation.profileId,
        terrainBlockerTags: elevation.lineOfSight.terrainBlockerTags
    });
}
