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
] as const;

export type MechanicsModuleId = (typeof MECHANICS_MODULE_IDS)[number];

/** Modules with executable engine support. Authoring any other module remains capability-inactive. */
export const IMPLEMENTED_MECHANICS_MODULE_IDS = [
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
  "multiplayer"
] as const satisfies readonly MechanicsModuleId[];

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

export interface ShieldRegenerationDefinition {
  readonly ratePerUnit: number;
  readonly delayAfterDamage?: number;
}

export interface ShieldDefinition {
  readonly capacity: number;
  readonly regeneration?: ShieldRegenerationDefinition;
}

export interface CombatShieldDefinitions {
  readonly enemies?: Readonly<Record<string, ShieldDefinition>>;
  readonly towers?: Readonly<Record<string, ShieldDefinition>>;
}

export interface DamageTypeDefinition {
  readonly label: string;
}

export interface ArmorTypeDefinition {
  readonly label: string;
  readonly defaultMultiplier?: number;
  readonly multipliers: Readonly<Record<string, number>>;
}

export interface CombatArmorAssignments {
  readonly enemies?: Readonly<Record<string, string>>;
}

export type MarkConsumePolicy = "retain" | "consume_one" | "consume_all";

export interface MarkDefinition {
  readonly label: string;
  readonly duration: number;
  readonly maxStacks: number;
  readonly multiplier: number;
  readonly consumePolicy: MarkConsumePolicy;
  readonly damageTypes?: readonly string[];
}

export interface MarkApplication {
  readonly markId: string;
  readonly stacks?: number;
}

export interface CombatMarkBindings {
  readonly towers?: Readonly<Record<string, readonly MarkApplication[]>>;
  readonly abilities?: Readonly<Record<string, readonly MarkApplication[]>>;
  readonly towerScripts?: Readonly<Record<string, readonly MarkApplication[]>>;
}

export interface CombatMarksDefinition {
  readonly definitions: Readonly<Record<string, MarkDefinition>>;
  readonly bindings?: CombatMarkBindings;
}

/** Closed combat profile. Armor fields require schema v2; marks require schema v3. */
export interface CombatMechanicsProfile {
  readonly shields?: CombatShieldDefinitions;
  readonly damageTypes?: Readonly<Record<string, DamageTypeDefinition>>;
  readonly armorTypes?: Readonly<Record<string, ArmorTypeDefinition>>;
  readonly armorAssignments?: CombatArmorAssignments;
  readonly marks?: CombatMarksDefinition;
}

export type MechanicsProfileDefinition = Readonly<Record<string, unknown>>;

export interface MechanicsModuleDefinition {
  schemaVersion: 1 | 2 | 3 | 4;
  enabled: boolean;
  profiles: Readonly<Record<string, MechanicsProfileDefinition>>;
}

export interface MechanicsCatalog {
  schemaVersion: 1;
  modules: Readonly<Partial<Record<MechanicsModuleId, MechanicsModuleDefinition>>>;
}

export interface MissionMechanicsSelection {
  profiles?: Readonly<Partial<Record<MechanicsModuleId, string>>>;
}

export type CapabilityReason =
  | "active"
  | "module_unavailable"
  | "module_missing"
  | "module_disabled"
  | "module_version_unsupported"
  | "not_selected"
  | "profile_missing"
  | "dependency_missing";

export interface CapabilityState {
  readonly moduleId: MechanicsModuleId;
  readonly available: boolean;
  readonly moduleEnabled: boolean;
  readonly active: boolean;
  readonly profileId?: string;
  readonly reason: CapabilityReason;
}

export type CapabilitySet = Readonly<Record<MechanicsModuleId, CapabilityState>>;

function ownEnumerableDataValue(value: unknown, key: string): unknown {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a mission's read-only mechanics view without mutating the catalog or selection.
 * Availability is supplied by the engine runtime so authored data cannot claim implementation.
 */
export function resolveCapabilitySet(
  catalog: MechanicsCatalog,
  selection: MissionMechanicsSelection = {},
  availableModuleIds: readonly MechanicsModuleId[] = IMPLEMENTED_MECHANICS_MODULE_IDS
): CapabilitySet {
  const availableIds = new Set<MechanicsModuleId>(availableModuleIds);
  const modules = ownEnumerableDataValue(catalog, "modules");
  const selectedProfiles = ownEnumerableDataValue(selection, "profiles");
  const entries = MECHANICS_MODULE_IDS.map((moduleId): readonly [MechanicsModuleId, CapabilityState] => {
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
          : moduleId === "heroes"
            ? schemaVersion === 1 || schemaVersion === 2 || schemaVersion === 3 || schemaVersion === 4
              || schemaVersion === 5 || schemaVersion === 6 || schemaVersion === 7
          : moduleId === "logistics"
            ? schemaVersion === 1 || schemaVersion === 2 || schemaVersion === 3
          : moduleId === "multiplayer"
            ? schemaVersion === 1 || schemaVersion === 2
          : schemaVersion === 1;
    const profiles = ownEnumerableDataValue(module, "profiles");
    const profile = profileId === undefined ? undefined : ownEnumerableDataValue(profiles, profileId);

    let reason: CapabilityReason;
    if (!module) reason = "module_missing";
    else if (!available) reason = "module_unavailable";
    else if (!moduleEnabled) reason = "module_disabled";
    else if (!moduleVersionSupported) reason = "module_version_unsupported";
    else if (profileId === undefined) reason = "not_selected";
    else if (profile === undefined) reason = "profile_missing";
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
    } else if (moduleId === "heroes" && schemaVersion === 7) {
      const selectedHeroId = ownEnumerableDataValue(profile, "selectedHeroId");
      const heroDefinition = typeof selectedHeroId === "string"
        ? ownEnumerableDataValue(ownEnumerableDataValue(profile, "definitions"), selectedHeroId)
        : undefined;
      const blocking = ownEnumerableDataValue(heroDefinition, "blocking");
      if (blocking === null) {
        reason = "active";
      } else {
        const navigationModuleValue = ownEnumerableDataValue(modules, "navigation");
        const navigationModule = navigationModuleValue !== null && typeof navigationModuleValue === "object"
          && !Array.isArray(navigationModuleValue)
          ? navigationModuleValue
          : undefined;
        const navigationProfileId = ownEnumerableDataValue(selectedProfiles, "navigation");
        const navigationProfile = typeof navigationProfileId === "string"
          ? ownEnumerableDataValue(ownEnumerableDataValue(navigationModule, "profiles"), navigationProfileId)
          : undefined;
        const movementProfiles = ownEnumerableDataValue(navigationProfile, "movementProfiles");
        const movementProfileIds = ownEnumerableDataValue(blocking, "movementProfileIds");
        let referencesExist = false;
        try {
          referencesExist = Array.isArray(movementProfileIds)
            && movementProfileIds.length > 0
            && movementProfileIds.every((movementProfileId) => (
              typeof movementProfileId === "string"
              && ownEnumerableDataValue(movementProfiles, movementProfileId) !== undefined
            ));
        } catch {
          referencesExist = false;
        }
        reason = navigationModule
          && availableIds.has("navigation")
          && ownEnumerableDataValue(navigationModule, "enabled") === true
          && ownEnumerableDataValue(navigationModule, "schemaVersion") === 1
          && typeof navigationProfileId === "string"
          && ownEnumerableDataValue(navigationProfile, "mode") === "dynamic_flow"
          && referencesExist
          ? "active"
          : "dependency_missing";
      }
    } else reason = "active";

    const state: CapabilityState = {
      moduleId,
      available,
      moduleEnabled,
      active: reason === "active",
      ...(profileId === undefined ? {} : { profileId }),
      reason
    };
    return [moduleId, state];
  });

  return Object.fromEntries(entries) as CapabilitySet;
}
