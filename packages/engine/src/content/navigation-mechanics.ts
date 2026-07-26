import type { GameContentRegistry } from "./registry.js";
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

export type NavigationModeV1 = "authored_routes" | "dynamic_flow";
export type NavigationTerrainModeV1 = "respect_walkable" | "ignore_walkable";
export type NavigationTowerOccupancyV1 = "blocked" | "ignored";

export interface MovementProfileV1 {
  readonly label: string;
  readonly terrainMode: NavigationTerrainModeV1;
  readonly towerOccupancy: NavigationTowerOccupancyV1;
  readonly defaultTerrainCost: number | null;
  readonly terrainCosts?: Readonly<Record<string, number | null>>;
}

export interface AuthoredRoutesNavigationProfileV1 {
  readonly mode: "authored_routes";
}

export interface DynamicFlowNavigationProfileV1 {
  readonly mode: "dynamic_flow";
  readonly defaultMovementProfileId: string;
  readonly movementProfiles: Readonly<Record<string, MovementProfileV1>>;
  readonly enemyMovementProfiles?: Readonly<Record<string, string>>;
}

export type NavigationProfileV1 =
  | AuthoredRoutesNavigationProfileV1
  | DynamicFlowNavigationProfileV1;

export type ActiveNavigationMechanicsV1 = NavigationProfileV1 & {
  readonly schemaVersion: 1;
  readonly profileId: string;
};

/** Closed descriptor for the shared deterministic movement-profile value shape. */
export const MOVEMENT_PROFILE_V1_SCHEMA = Object.freeze({
  requiredFields: Object.freeze(["label", "terrainMode", "towerOccupancy", "defaultTerrainCost"] as const),
  optionalFields: Object.freeze(["terrainCosts"] as const),
  additionalProperties: false,
  label: Object.freeze({ minLength: 1, maxLength: NAVIGATION_LIMITS.labelLength }),
  terrainModeValues: Object.freeze(["respect_walkable", "ignore_walkable"] as const),
  towerOccupancyValues: Object.freeze(["blocked", "ignored"] as const),
  defaultTerrainCost: Object.freeze({
    integer: true,
    minimum: 1,
    maximum: NAVIGATION_LIMITS.terrainCost,
    nullable: true
  }),
  terrainCosts: Object.freeze({
    maximumEntries: NAVIGATION_LIMITS.terrainOverridesPerProfile,
    values: Object.freeze({
      integer: true,
      minimum: 1,
      maximum: NAVIGATION_LIMITS.terrainCost,
      nullable: true
    })
  })
});

/** Machine-readable authoring descriptor shared with future Studio/MCP surfaces. */
export const NAVIGATION_MECHANICS_SCHEMA = Object.freeze({
  schemaVersion: 1,
  moduleId: "navigation",
  supportedModuleSchemaVersions: Object.freeze([1] as const),
  profile: Object.freeze({
    additionalProperties: false,
    discriminator: "mode",
    modes: Object.freeze({
      authored_routes: Object.freeze({
        requiredFields: Object.freeze(["mode"] as const),
        optionalFields: Object.freeze([] as const)
      }),
      dynamic_flow: Object.freeze({
        requiredFields: Object.freeze(["mode", "defaultMovementProfileId", "movementProfiles"] as const),
        optionalFields: Object.freeze(["enemyMovementProfiles"] as const)
      })
    })
  }),
  movementProfile: MOVEMENT_PROFILE_V1_SCHEMA,
  limits: NAVIGATION_LIMITS,
  runtimeSnapshot: Object.freeze({
    path: "snapshot.navigation",
    schemaVersion: 1,
    modes: Object.freeze(["dynamic_flow"] as const),
    optionalUnlessActiveDynamicFlow: true
  })
});

export class NavigationProfileValidationError extends Error {
  readonly fieldPath: string;

  constructor(fieldPath: string, message: string) {
    super(message);
    this.name = "NavigationProfileValidationError";
    this.fieldPath = fieldPath;
  }
}

type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;

function plainRecord(value: unknown, fieldPath: string, label: string): Record<string, unknown> {
  let prototype: object | null;
  let descriptors: DescriptorMap;
  try {
    prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    descriptors = value !== null && typeof value === "object"
      ? Object.getOwnPropertyDescriptors(value) as DescriptorMap
      : {};
  } catch {
    throw new NavigationProfileValidationError(fieldPath, `${label} could not be inspected safely.`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) || prototype !== Object.prototype) {
    throw new NavigationProfileValidationError(fieldPath, `${label} must be a plain object with own data fields.`);
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw new NavigationProfileValidationError(fieldPath, `${label} must not contain symbol fields.`);
  }
  const detached: Record<string, unknown> = {};
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new NavigationProfileValidationError(
        `${fieldPath}.${key}`,
        `${label}.${key} must be an enumerable own data field.`
      );
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

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  fieldPath: string,
  label: string
): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unexpected !== undefined) {
    throw new NavigationProfileValidationError(
      `${fieldPath}.${unexpected}`,
      `${label} contains unknown closed field "${unexpected}".`
    );
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function boundedId(value: unknown, fieldPath: string, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new NavigationProfileValidationError(fieldPath, `${label} must be a non-empty string id.`);
  }
  if (utf8ByteLength(value) > NAVIGATION_LIMITS.idUtf8Bytes) {
    throw new NavigationProfileValidationError(
      fieldPath,
      `${label} exceeds the ${NAVIGATION_LIMITS.idUtf8Bytes} UTF-8 byte limit.`
    );
  }
  return value;
}

function boundedLabel(value: unknown, fieldPath: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > NAVIGATION_LIMITS.labelLength) {
    throw new NavigationProfileValidationError(
      fieldPath,
      `Movement profile label must contain 1..${NAVIGATION_LIMITS.labelLength} characters.`
    );
  }
  return value;
}

function terrainCost(value: unknown, fieldPath: string): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || !Number.isSafeInteger(value)
    || value < 1
    || value > NAVIGATION_LIMITS.terrainCost
  ) {
    throw new NavigationProfileValidationError(
      fieldPath,
      `Terrain cost must be a safe integer from 1 to ${NAVIGATION_LIMITS.terrainCost}, or null.`
    );
  }
  return value;
}

function compareBinary(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function defineOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, { value, enumerable: true });
}

/** Normalize one closed movement profile for navigation-owned and other opt-in modules. */
export function normalizeMovementProfileV1(
  value: unknown,
  fieldPath = "movementProfile"
): MovementProfileV1 {
  const profile = plainRecord(value, fieldPath, "Movement profile");
  requireExactKeys(
    profile,
    ["label", "terrainMode", "towerOccupancy", "defaultTerrainCost", "terrainCosts"],
    fieldPath,
    "Movement profile"
  );
  for (const required of ["label", "terrainMode", "towerOccupancy", "defaultTerrainCost"] as const) {
    if (!Object.prototype.hasOwnProperty.call(profile, required)) {
      throw new NavigationProfileValidationError(`${fieldPath}.${required}`, `Movement profile ${required} is required.`);
    }
  }
  const label = boundedLabel(profile.label, `${fieldPath}.label`);
  if (profile.terrainMode !== "respect_walkable" && profile.terrainMode !== "ignore_walkable") {
    throw new NavigationProfileValidationError(
      `${fieldPath}.terrainMode`,
      "Movement profile terrainMode must be respect_walkable or ignore_walkable."
    );
  }
  if (profile.towerOccupancy !== "blocked" && profile.towerOccupancy !== "ignored") {
    throw new NavigationProfileValidationError(
      `${fieldPath}.towerOccupancy`,
      "Movement profile towerOccupancy must be blocked or ignored."
    );
  }
  const defaultTerrainCost = terrainCost(profile.defaultTerrainCost, `${fieldPath}.defaultTerrainCost`);
  let terrainCosts: Readonly<Record<string, number | null>> | undefined;
  if (profile.terrainCosts !== undefined) {
    const authored = plainRecord(profile.terrainCosts, `${fieldPath}.terrainCosts`, "Movement terrain costs");
    if (Object.keys(authored).length > NAVIGATION_LIMITS.terrainOverridesPerProfile) {
      throw new NavigationProfileValidationError(
        `${fieldPath}.terrainCosts`,
        `Movement terrain costs exceed the ${NAVIGATION_LIMITS.terrainOverridesPerProfile} override limit.`
      );
    }
    const normalized: Record<string, number | null> = {};
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
export function normalizeNavigationProfileV1(value: unknown): NavigationProfileV1 {
  const profile = plainRecord(value, "profile", "Navigation profile");
  if (profile.mode === "authored_routes") {
    requireExactKeys(profile, ["mode"], "profile", "authored_routes navigation profile");
    return Object.freeze({ mode: "authored_routes" });
  }
  if (profile.mode !== "dynamic_flow") {
    throw new NavigationProfileValidationError(
      "profile.mode",
      "Navigation profile mode must be authored_routes or dynamic_flow."
    );
  }
  requireExactKeys(
    profile,
    ["mode", "defaultMovementProfileId", "movementProfiles", "enemyMovementProfiles"],
    "profile",
    "dynamic_flow navigation profile"
  );
  for (const required of ["defaultMovementProfileId", "movementProfiles"] as const) {
    if (!Object.prototype.hasOwnProperty.call(profile, required)) {
      throw new NavigationProfileValidationError(`profile.${required}`, `Navigation ${required} is required.`);
    }
  }
  const defaultMovementProfileId = boundedId(
    profile.defaultMovementProfileId,
    "profile.defaultMovementProfileId",
    "Default movement profile id"
  );
  const rawMovementProfiles = plainRecord(
    profile.movementProfiles,
    "profile.movementProfiles",
    "Navigation movement profiles"
  );
  if (Object.keys(rawMovementProfiles).length > NAVIGATION_LIMITS.movementProfiles) {
    throw new NavigationProfileValidationError(
      "profile.movementProfiles",
      `Navigation movement profiles exceed the ${NAVIGATION_LIMITS.movementProfiles} profile limit.`
    );
  }
  const movementProfiles: Record<string, MovementProfileV1> = {};
  let terrainOverrideCount = 0;
  for (const movementProfileId of Object.keys(rawMovementProfiles).sort(compareBinary)) {
    boundedId(movementProfileId, `profile.movementProfiles.${movementProfileId}`, "Movement profile id");
    const normalized = normalizeMovementProfileV1(
      rawMovementProfiles[movementProfileId],
      `profile.movementProfiles.${movementProfileId}`
    );
    terrainOverrideCount += Object.keys(normalized.terrainCosts ?? {}).length;
    defineOwn(movementProfiles, movementProfileId, normalized);
  }
  if (terrainOverrideCount > NAVIGATION_LIMITS.terrainOverridesAcrossProfiles) {
    throw new NavigationProfileValidationError(
      "profile.movementProfiles",
      `Navigation terrain costs exceed the ${NAVIGATION_LIMITS.terrainOverridesAcrossProfiles} total override limit.`
    );
  }

  let enemyMovementProfiles: Readonly<Record<string, string>> | undefined;
  if (profile.enemyMovementProfiles !== undefined) {
    const authored = plainRecord(
      profile.enemyMovementProfiles,
      "profile.enemyMovementProfiles",
      "Navigation enemy movement assignments"
    );
    if (Object.keys(authored).length > NAVIGATION_LIMITS.enemyAssignments) {
      throw new NavigationProfileValidationError(
        "profile.enemyMovementProfiles",
        `Navigation enemy assignments exceed the ${NAVIGATION_LIMITS.enemyAssignments} assignment limit.`
      );
    }
    const normalized: Record<string, string> = {};
    for (const enemyId of Object.keys(authored).sort(compareBinary)) {
      boundedId(enemyId, `profile.enemyMovementProfiles.${enemyId}`, "Enemy id");
      defineOwn(
        normalized,
        enemyId,
        boundedId(
          authored[enemyId],
          `profile.enemyMovementProfiles.${enemyId}`,
          "Assigned movement profile id"
        )
      );
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
export function resolveActiveNavigationMechanics(
  content: GameContentRegistry,
  missionId: string
): ActiveNavigationMechanicsV1 | undefined {
  const mission = Object.prototype.hasOwnProperty.call(content.missions, missionId)
    ? content.missions[missionId]
    : undefined;
  if (!mission) return undefined;
  const capability = resolveCapabilitySet(content.mechanics, mission.mechanics).navigation;
  if (!capability.active || capability.profileId === undefined) return undefined;
  const catalog = plainRecord(content.mechanics, "mechanics", "Active mechanics catalog");
  requireExactKeys(catalog, ["schemaVersion", "modules"], "mechanics", "Active mechanics catalog");
  if (catalog.schemaVersion !== 1) throw new Error("Active mechanics catalog must use schema version 1.");
  const modules = plainRecord(catalog.modules, "mechanics.modules", "Active mechanics modules");
  const module = plainRecord(
    modules.navigation,
    "mechanics.modules.navigation",
    "Active navigation mechanics module"
  );
  requireExactKeys(
    module,
    ["schemaVersion", "enabled", "profiles"],
    "mechanics.modules.navigation",
    "Active navigation mechanics module"
  );
  if (module.schemaVersion !== 1 || module.enabled !== true) return undefined;
  const profiles = plainRecord(
    module.profiles,
    "mechanics.modules.navigation.profiles",
    "Active navigation mechanics profiles"
  );
  const authored = Object.prototype.hasOwnProperty.call(profiles, capability.profileId)
    ? profiles[capability.profileId]
    : undefined;
  if (authored === undefined) return undefined;
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
