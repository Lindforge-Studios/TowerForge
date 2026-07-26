/** Stable mechanics module identifiers shared by project catalogs and mission selections. */
export const MECHANICS_MODULE_IDS = [
    "combat",
    "reactions",
    "navigation",
    "elevation",
    "physics",
    "terraforming",
    "roguelite",
    "heroes",
    "logistics",
    "director",
    "scriptingDx",
    "multiplayer"
];
/** Modules with executable engine support. Authoring any other module remains capability-inactive. */
export const IMPLEMENTED_MECHANICS_MODULE_IDS = [
    "combat",
    "reactions",
    "navigation",
    "elevation",
    "physics",
    "terraforming",
    "roguelite",
    "heroes"
];
export const SHIELD_LIMITS = Object.freeze({
    capacity: 1_000_000_000_000,
    ratePerUnit: 1_000_000_000,
    delayAfterDamage: 1_000_000_000
});
export const ARMOR_MATRIX_LIMITS = Object.freeze({
    damageTypes: 256,
    armorTypes: 256,
    assignments: 4096,
    matrixEntries: 16384,
    multiplier: 1_000_000,
    labelLength: 128
});
export const MARK_LIMITS = Object.freeze({
    definitions: 256,
    sourceBindings: 4096,
    runtimeApplications: 16384,
    applicationsPerSource: 16,
    filterDamageTypes: 256,
    labelLength: 128,
    duration: 1_000_000_000,
    maxStacks: 256,
    multiplier: 1_000_000
});
/** Structural and runtime budgets for the opt-in reactions v1 capability. */
export const REACTION_LIMITS = Object.freeze({
    exposureDefinitions: 256,
    damageTypeApplicationBindings: 256,
    applicationsPerDamageType: 16,
    totalExposureApplications: 4096,
    reactionDefinitions: 256,
    requirementsPerReaction: 8,
    effectsPerReaction: 8,
    totalReactionEffects: 2048,
    runtimeExposureApplications: 16_384,
    labelLength: 128,
    idTagUtf8Bytes: 128,
    duration: 1_000_000_000,
    maxStacks: 256,
    flatDamage: 1_000_000_000_000,
    sourceMultiplier: 1_000_000,
    radius: 64,
    targetsPerEffect: 64,
    maxDepth: 4,
    secondaryPacketsPerRoot: 256
});
function ownEnumerableDataValue(value, key) {
    if (value === null || (typeof value !== "object" && typeof value !== "function"))
        return undefined;
    try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && descriptor.enumerable && "value" in descriptor ? descriptor.value : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Resolve a mission's read-only mechanics view without mutating the catalog or selection.
 * Availability is supplied by the engine runtime so authored data cannot claim implementation.
 */
export function resolveCapabilitySet(catalog, selection = {}, availableModuleIds = IMPLEMENTED_MECHANICS_MODULE_IDS) {
    const availableIds = new Set(availableModuleIds);
    const modules = ownEnumerableDataValue(catalog, "modules");
    const selectedProfiles = ownEnumerableDataValue(selection, "profiles");
    const entries = MECHANICS_MODULE_IDS.map((moduleId) => {
        const authoredModule = ownEnumerableDataValue(modules, moduleId);
        const module = authoredModule !== null && typeof authoredModule === "object" && !Array.isArray(authoredModule)
            ? authoredModule
            : undefined;
        const selectedProfile = ownEnumerableDataValue(selectedProfiles, moduleId);
        const profileId = typeof selectedProfile === "string" ? selectedProfile : undefined;
        const available = availableIds.has(moduleId);
        const moduleEnabled = ownEnumerableDataValue(module, "enabled") === true;
        const schemaVersion = ownEnumerableDataValue(module, "schemaVersion");
        const moduleVersionSupported = moduleId === "combat"
            ? schemaVersion === 1 || schemaVersion === 2 || schemaVersion === 3
            : moduleId === "elevation"
                ? schemaVersion === 1 || schemaVersion === 2 || schemaVersion === 3
                : moduleId === "roguelite"
                    ? schemaVersion === 1 || schemaVersion === 2 || schemaVersion === 3 || schemaVersion === 4
                    : schemaVersion === 1;
        const profiles = ownEnumerableDataValue(module, "profiles");
        const profile = profileId === undefined ? undefined : ownEnumerableDataValue(profiles, profileId);
        let reason;
        if (!module)
            reason = "module_missing";
        else if (!available)
            reason = "module_unavailable";
        else if (!moduleEnabled)
            reason = "module_disabled";
        else if (!moduleVersionSupported)
            reason = "module_version_unsupported";
        else if (profileId === undefined)
            reason = "not_selected";
        else if (profile === undefined)
            reason = "profile_missing";
        else if (moduleId === "reactions") {
            const combatModuleValue = ownEnumerableDataValue(modules, "combat");
            const combatModule = combatModuleValue !== null && typeof combatModuleValue === "object" && !Array.isArray(combatModuleValue)
                ? combatModuleValue
                : undefined;
            const combatProfileId = ownEnumerableDataValue(selectedProfiles, "combat");
            const combatProfiles = ownEnumerableDataValue(combatModule, "profiles");
            const combatProfile = typeof combatProfileId === "string"
                ? ownEnumerableDataValue(combatProfiles, combatProfileId)
                : undefined;
            const combatSchemaVersion = ownEnumerableDataValue(combatModule, "schemaVersion");
            reason = combatModule
                && availableIds.has("combat")
                && ownEnumerableDataValue(combatModule, "enabled") === true
                && (combatSchemaVersion === 2 || combatSchemaVersion === 3)
                && typeof combatProfileId === "string"
                && combatProfile !== undefined
                ? "active"
                : "dependency_missing";
        }
        else
            reason = "active";
        const state = {
            moduleId,
            available,
            moduleEnabled,
            active: reason === "active",
            ...(profileId === undefined ? {} : { profileId }),
            reason
        };
        return [moduleId, state];
    });
    return Object.fromEntries(entries);
}
