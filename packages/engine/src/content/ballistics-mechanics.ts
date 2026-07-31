import type { GameContentRegistry } from "./registry.js";

/** Closed authoring and runtime budgets for opt-in deterministic projectile ballistics v1. */
export const BALLISTICS_LIMITS = Object.freeze({
  towerBindingsPerProfile: 256,
  activeProjectiles: 4_096,
  impactsPerTick: 4_096,
  travelTimeUnits: 1_000_000,
  maxAltitude: 1_000_000,
  idUtf8Bytes: 128
});

/** Independent authoring and runtime budgets for deterministic arc-clearance v1. */
export const ARC_CLEARANCE_LIMITS = Object.freeze({
  terrainBlockerTags: 64,
  terrainTagUtf8Bytes: 128,
  maximumBlockerHeight: 1_000_000,
  terrainDefinitions: 256,
  terrainTagsPerDefinition: 64,
  terrainTagsAcrossDefinitions: 8_192,
  maximumRayDistance: 256,
  cellInspectionsPerTick: 1_048_576
});

/** Independent content and runtime budgets for bounded topology ricochet v1. */
export const RICOCHET_LIMITS = Object.freeze({
  terrainSurfaceTags: 64,
  armorTypeSurfaces: 64,
  maxBouncesPerProjectile: 4,
  maximumReflectedRayDistance: 256,
  enemyCandidatesPerCell: 16,
  ricochetsPerTick: 4_096,
  cellInspectionsPerTick: 1_048_576,
  surfaceIdUtf8Bytes: 128
});

/** Independent content and runtime budgets for opt-in destructible environment objects v1. */
export const DESTRUCTIBLE_ENVIRONMENT_LIMITS = Object.freeze({
  definitionsPerProfile: 256,
  placementsPerMap: 4_096,
  idUtf8Bytes: 128,
  maxHp: 1_000_000_000,
  maximumBlockerHeight: 1_000_000,
  objectsPerCell: 1
});

export const BALLISTICS_TRAJECTORIES = Object.freeze(["direct", "arc"] as const);

/** Capability-aware descriptor shared by engine, Studio and MCP authoring surfaces. */
export const BALLISTICS_MECHANICS_SCHEMA = Object.freeze({
  schemaVersion: 1,
  moduleId: "ballistics" as const,
  supportedModuleSchemaVersions: Object.freeze([1] as const),
  profile: Object.freeze({
    requiredFields: Object.freeze(["projectiles"] as const),
    optionalFields: Object.freeze([] as const),
    additionalProperties: false
  }),
  projectiles: Object.freeze({
    requiredFields: Object.freeze(["towers"] as const),
    optionalFields: Object.freeze(["clearance", "ricochet", "destructibles"] as const),
    additionalProperties: false
  }),
  clearance: Object.freeze({
    requiredFields: Object.freeze(["terrainBlockerHeights"] as const),
    optionalFields: Object.freeze([] as const),
    additionalProperties: false,
    terrainBlockerHeights: Object.freeze({
      kind: "record" as const,
      key: "terrainTag" as const,
      value: Object.freeze({
        type: "number" as const,
        minimum: 0,
        maximum: ARC_CLEARANCE_LIMITS.maximumBlockerHeight
      })
    }),
    limits: ARC_CLEARANCE_LIMITS
  }),
  ricochet: Object.freeze({
    requiredFields: Object.freeze([] as const),
    optionalFields: Object.freeze(["terrainTags", "armorTypes"] as const),
    additionalProperties: false,
    surfaceRecord: Object.freeze({
      kind: "record" as const,
      value: Object.freeze({ const: true as const })
    }),
    limits: RICOCHET_LIMITS
  }),
  destructibles: Object.freeze({
    requiredFields: Object.freeze(["definitions"] as const),
    optionalFields: Object.freeze([] as const),
    additionalProperties: false,
    definition: Object.freeze({
      requiredFields: Object.freeze(["maxHp", "hitRegion"] as const),
      optionalFields: Object.freeze(["armorTypeId", "onDestroyed"] as const),
      additionalProperties: false
    }),
    hitRegion: Object.freeze({
      requiredFields: Object.freeze(["kind", "blockerHeight", "blocksLineOfSight"] as const),
      optionalFields: Object.freeze([] as const),
      additionalProperties: false,
      kinds: Object.freeze(["tile"] as const)
    }),
    onDestroyed: Object.freeze({
      requiredFields: Object.freeze(["terrainTransitionId"] as const),
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    limits: DESTRUCTIBLE_ENVIRONMENT_LIMITS
  }),
  towerBinding: Object.freeze({
    requiredFields: Object.freeze(["trajectory", "travelTimeUnits"] as const),
    optionalFields: Object.freeze(["maxAltitude", "ricochet"] as const),
    additionalProperties: false
  }),
  towerRicochet: Object.freeze({
    requiredFields: Object.freeze(["maxBounces", "rangeCells"] as const),
    optionalFields: Object.freeze([] as const),
    additionalProperties: false
  }),
  trajectories: BALLISTICS_TRAJECTORIES,
  limits: BALLISTICS_LIMITS
});

export type BallisticsTrajectoryV1 = (typeof BALLISTICS_TRAJECTORIES)[number];

export interface BallisticsTowerBindingV1 {
  readonly trajectory: BallisticsTrajectoryV1;
  readonly travelTimeUnits: number;
  readonly maxAltitude?: number;
  readonly ricochet?: BallisticsTowerRicochetV1;
}

export interface BallisticsTowerRicochetV1 {
  readonly maxBounces: number;
  readonly rangeCells: number;
}

export interface BallisticsProfileV1 {
  readonly projectiles: {
    readonly towers: Readonly<Record<string, BallisticsTowerBindingV1>>;
    readonly clearance?: BallisticsArcClearanceV1;
    readonly ricochet?: BallisticsRicochetSurfacesV1;
    readonly destructibles?: BallisticsDestructibleCatalogV1;
  };
}

export interface BallisticsArcClearanceV1 {
  readonly terrainBlockerHeights: Readonly<Record<string, number>>;
}

export interface BallisticsRicochetSurfacesV1 {
  readonly terrainTags?: Readonly<Record<string, true>>;
  readonly armorTypes?: Readonly<Record<string, true>>;
}

export interface BallisticsDestructibleHitRegionV1 {
  readonly kind: "tile";
  readonly blockerHeight: number;
  readonly blocksLineOfSight: boolean;
}

export interface BallisticsDestructibleOnDestroyedV1 {
  readonly terrainTransitionId: string;
}

export interface BallisticsDestructibleDefinitionV1 {
  readonly maxHp: number;
  readonly hitRegion: BallisticsDestructibleHitRegionV1;
  readonly armorTypeId?: string;
  readonly onDestroyed?: BallisticsDestructibleOnDestroyedV1;
}

export interface BallisticsDestructibleCatalogV1 {
  readonly definitions: Readonly<Record<string, BallisticsDestructibleDefinitionV1>>;
}

export interface ActiveBallisticsMechanicsV1 extends BallisticsProfileV1 {
  readonly schemaVersion: 1;
  readonly profileId: string;
}

export class BallisticsProfileValidationError extends Error {}

type DescriptorMap = Readonly<Record<PropertyKey, PropertyDescriptor>>;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function inspectRecord(
  value: unknown,
  path: string,
  maximumEntries?: number
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BallisticsProfileValidationError(`${path} must be a plain object.`);
  }
  let prototype: object | null;
  let descriptors: DescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as DescriptorMap;
  } catch {
    throw new BallisticsProfileValidationError(`${path} could not be inspected safely.`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new BallisticsProfileValidationError(`${path} must be a plain object with no custom prototype.`);
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw new BallisticsProfileValidationError(`${path} rejects symbol fields.`);
  }
  const keys = Object.keys(descriptors);
  if (maximumEntries !== undefined && keys.length > maximumEntries) {
    throw new BallisticsProfileValidationError(`${path} exceeds the maximum limit of ${maximumEntries} entries.`);
  }
  const detached = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new BallisticsProfileValidationError(
        `${path}.${key} must be an enumerable own data property; accessors are forbidden.`
      );
    }
    Object.defineProperty(detached, key, { value: descriptor.value, enumerable: true });
  }
  return detached;
}

function enforceClosedShape(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[],
  path: string
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new BallisticsProfileValidationError(`${path} is closed; unknown field "${key}".`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new BallisticsProfileValidationError(`${path}.${key} is required.`);
    }
  }
}

function boundedIdentifier(value: string, path: string): string {
  if (value.length === 0 || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)
    || utf8ByteLength(value) > BALLISTICS_LIMITS.idUtf8Bytes) {
    throw new BallisticsProfileValidationError(
      `${path} must be a bounded non-empty UTF-8 identifier of at most ${BALLISTICS_LIMITS.idUtf8Bytes} bytes.`
    );
  }
  return value;
}

function boundedPositiveNumber(value: unknown, path: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new BallisticsProfileValidationError(`${path} must be finite and in (0, ${maximum}].`);
  }
  return value as number;
}

function boundedNonNegativeNumber(value: unknown, path: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new BallisticsProfileValidationError(`${path} must be finite and in [0, ${maximum}].`);
  }
  return value;
}

function boundedSafeInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new BallisticsProfileValidationError(
      `${path} must be a safe integer in [${minimum}, ${maximum}].`
    );
  }
  return value as number;
}

function normalizeTowerRicochet(value: unknown, path: string): BallisticsTowerRicochetV1 {
  const ricochet = inspectRecord(value, path);
  enforceClosedShape(ricochet, ["maxBounces", "rangeCells"], [], path);
  return Object.freeze({
    maxBounces: boundedSafeInteger(
      ricochet.maxBounces,
      `${path}.maxBounces`,
      1,
      RICOCHET_LIMITS.maxBouncesPerProjectile
    ),
    rangeCells: boundedSafeInteger(
      ricochet.rangeCells,
      `${path}.rangeCells`,
      1,
      RICOCHET_LIMITS.maximumReflectedRayDistance
    )
  });
}

function normalizeRicochetSurfaceRecord(
  value: unknown,
  path: string,
  maximumEntries: number
): Readonly<Record<string, true>> {
  const surfaces = inspectRecord(value, path, maximumEntries);
  const ids = Object.keys(surfaces).sort();
  if (ids.length === 0) {
    throw new BallisticsProfileValidationError(`${path} must not be empty.`);
  }
  const normalized = Object.create(null) as Record<string, true>;
  for (const id of ids) {
    if (id.length === 0 || id !== id.trim() || /[\u0000-\u001f\u007f]/.test(id)
      || utf8ByteLength(id) > RICOCHET_LIMITS.surfaceIdUtf8Bytes) {
      throw new BallisticsProfileValidationError(
        `${path} surface id must be bounded non-empty UTF-8 of at most `
        + `${RICOCHET_LIMITS.surfaceIdUtf8Bytes} bytes.`
      );
    }
    if (surfaces[id] !== true) {
      throw new BallisticsProfileValidationError(`${path}.${id} ricochet surface value must be true.`);
    }
    Object.defineProperty(normalized, id, { value: true as const, enumerable: true });
  }
  return Object.freeze(normalized);
}

function normalizeRicochetSurfaces(value: unknown, path: string): BallisticsRicochetSurfacesV1 {
  const ricochet = inspectRecord(value, path);
  enforceClosedShape(ricochet, [], ["terrainTags", "armorTypes"], path);
  if (ricochet.terrainTags === undefined && ricochet.armorTypes === undefined) {
    throw new BallisticsProfileValidationError(`${path} requires at least one non-empty surface record.`);
  }
  const terrainTags = ricochet.terrainTags === undefined
    ? undefined
    : normalizeRicochetSurfaceRecord(
        ricochet.terrainTags,
        `${path}.terrainTags`,
        RICOCHET_LIMITS.terrainSurfaceTags
      );
  const armorTypes = ricochet.armorTypes === undefined
    ? undefined
    : normalizeRicochetSurfaceRecord(
        ricochet.armorTypes,
        `${path}.armorTypes`,
        RICOCHET_LIMITS.armorTypeSurfaces
      );
  return Object.freeze({
    ...(terrainTags === undefined ? {} : { terrainTags }),
    ...(armorTypes === undefined ? {} : { armorTypes })
  });
}

function normalizeArcClearance(value: unknown, path: string): BallisticsArcClearanceV1 {
  const clearance = inspectRecord(value, path);
  enforceClosedShape(clearance, ["terrainBlockerHeights"], [], path);
  const heights = inspectRecord(
    clearance.terrainBlockerHeights,
    `${path}.terrainBlockerHeights`,
    ARC_CLEARANCE_LIMITS.terrainBlockerTags
  );
  const tags = Object.keys(heights).sort();
  if (tags.length === 0) {
    throw new BallisticsProfileValidationError(`${path}.terrainBlockerHeights must not be empty.`);
  }
  const normalizedHeights = Object.create(null) as Record<string, number>;
  for (const tag of tags) {
    if (tag.length === 0 || tag !== tag.trim() || /[\u0000-\u001f\u007f]/.test(tag)
      || utf8ByteLength(tag) > ARC_CLEARANCE_LIMITS.terrainTagUtf8Bytes) {
      throw new BallisticsProfileValidationError(
        `${path}.terrainBlockerHeights terrain tag must be a bounded non-empty UTF-8 identifier of at most `
        + `${ARC_CLEARANCE_LIMITS.terrainTagUtf8Bytes} bytes.`
      );
    }
    Object.defineProperty(normalizedHeights, tag, {
      value: boundedNonNegativeNumber(
        heights[tag],
        `${path}.terrainBlockerHeights.${tag}`,
        ARC_CLEARANCE_LIMITS.maximumBlockerHeight
      ),
      enumerable: true
    });
  }
  return Object.freeze({ terrainBlockerHeights: Object.freeze(normalizedHeights) });
}

function normalizeDestructibleHitRegion(
  value: unknown,
  path: string
): BallisticsDestructibleHitRegionV1 {
  const hitRegion = inspectRecord(value, path);
  enforceClosedShape(hitRegion, ["kind", "blockerHeight", "blocksLineOfSight"], [], path);
  if (hitRegion.kind !== "tile") {
    throw new BallisticsProfileValidationError(`${path}.kind must be "tile".`);
  }
  if (typeof hitRegion.blocksLineOfSight !== "boolean") {
    throw new BallisticsProfileValidationError(`${path}.blocksLineOfSight must be boolean.`);
  }
  return Object.freeze({
    kind: "tile" as const,
    blockerHeight: boundedNonNegativeNumber(
      hitRegion.blockerHeight,
      `${path}.blockerHeight`,
      DESTRUCTIBLE_ENVIRONMENT_LIMITS.maximumBlockerHeight
    ),
    blocksLineOfSight: hitRegion.blocksLineOfSight
  });
}

function normalizeDestructibleOnDestroyed(
  value: unknown,
  path: string
): BallisticsDestructibleOnDestroyedV1 {
  const onDestroyed = inspectRecord(value, path);
  enforceClosedShape(onDestroyed, ["terrainTransitionId"], [], path);
  if (typeof onDestroyed.terrainTransitionId !== "string") {
    throw new BallisticsProfileValidationError(`${path}.terrainTransitionId must be an identifier.`);
  }
  return Object.freeze({
    terrainTransitionId: boundedIdentifier(
      onDestroyed.terrainTransitionId,
      `${path}.terrainTransitionId`
    )
  });
}

function normalizeDestructibleDefinition(
  value: unknown,
  path: string
): BallisticsDestructibleDefinitionV1 {
  const definition = inspectRecord(value, path);
  enforceClosedShape(definition, ["maxHp", "hitRegion"], ["armorTypeId", "onDestroyed"], path);
  if (definition.armorTypeId !== undefined && typeof definition.armorTypeId !== "string") {
    throw new BallisticsProfileValidationError(`${path}.armorTypeId must be an identifier when present.`);
  }
  const armorTypeId = definition.armorTypeId === undefined
    ? undefined
    : boundedIdentifier(definition.armorTypeId, `${path}.armorTypeId`);
  const onDestroyed = definition.onDestroyed === undefined
    ? undefined
    : normalizeDestructibleOnDestroyed(definition.onDestroyed, `${path}.onDestroyed`);
  return Object.freeze({
    maxHp: boundedPositiveNumber(
      definition.maxHp,
      `${path}.maxHp`,
      DESTRUCTIBLE_ENVIRONMENT_LIMITS.maxHp
    ),
    hitRegion: normalizeDestructibleHitRegion(definition.hitRegion, `${path}.hitRegion`),
    ...(armorTypeId === undefined ? {} : { armorTypeId }),
    ...(onDestroyed === undefined ? {} : { onDestroyed })
  });
}

function normalizeDestructibleCatalog(value: unknown, path: string): BallisticsDestructibleCatalogV1 {
  const catalog = inspectRecord(value, path);
  enforceClosedShape(catalog, ["definitions"], [], path);
  const definitions = inspectRecord(
    catalog.definitions,
    `${path}.definitions`,
    DESTRUCTIBLE_ENVIRONMENT_LIMITS.definitionsPerProfile
  );
  const definitionIds = Object.keys(definitions).sort();
  if (definitionIds.length === 0) {
    throw new BallisticsProfileValidationError(`${path}.definitions must not be empty.`);
  }
  const normalized = Object.create(null) as Record<string, BallisticsDestructibleDefinitionV1>;
  for (const definitionId of definitionIds) {
    boundedIdentifier(definitionId, `${path}.definitions id`);
    Object.defineProperty(normalized, definitionId, {
      value: normalizeDestructibleDefinition(
        definitions[definitionId],
        `${path}.definitions.${definitionId}`
      ),
      enumerable: true
    });
  }
  return Object.freeze({ definitions: Object.freeze(normalized) });
}

function normalizeTowerBinding(value: unknown, path: string): BallisticsTowerBindingV1 {
  const binding = inspectRecord(value, path);
  enforceClosedShape(binding, ["trajectory", "travelTimeUnits"], ["maxAltitude", "ricochet"], path);
  if (binding.trajectory !== "direct" && binding.trajectory !== "arc") {
    throw new BallisticsProfileValidationError(`${path}.trajectory must be "direct" or "arc".`);
  }
  const travelTimeUnits = boundedPositiveNumber(
    binding.travelTimeUnits,
    `${path}.travelTimeUnits`,
    BALLISTICS_LIMITS.travelTimeUnits
  );
  const ricochet = binding.ricochet === undefined
    ? undefined
    : normalizeTowerRicochet(binding.ricochet, `${path}.ricochet`);
  if (binding.trajectory === "direct") {
    if (binding.maxAltitude !== undefined) {
      throw new BallisticsProfileValidationError(`${path}.maxAltitude is forbidden for a direct trajectory.`);
    }
    return Object.freeze({
      trajectory: "direct" as const,
      travelTimeUnits,
      ...(ricochet === undefined ? {} : { ricochet })
    });
  }
  if (binding.maxAltitude === undefined) {
    throw new BallisticsProfileValidationError(`${path}.maxAltitude is required for an arc trajectory.`);
  }
  return Object.freeze({
    trajectory: "arc" as const,
    travelTimeUnits,
    maxAltitude: boundedPositiveNumber(
      binding.maxAltitude,
      `${path}.maxAltitude`,
      BALLISTICS_LIMITS.maxAltitude
    ),
    ...(ricochet === undefined ? {} : { ricochet })
  });
}

/** Parse detached, binary-ordered and deeply frozen ballistics v1 own data. */
export function normalizeBallisticsProfileV1(value: unknown): BallisticsProfileV1 {
  const profile = inspectRecord(value, "ballistics profile");
  enforceClosedShape(profile, ["projectiles"], [], "ballistics profile");
  const projectiles = inspectRecord(profile.projectiles, "ballistics profile.projectiles");
  enforceClosedShape(
    projectiles,
    ["towers"],
    ["clearance", "ricochet", "destructibles"],
    "ballistics profile.projectiles"
  );
  const towers = inspectRecord(
    projectiles.towers,
    "ballistics profile.projectiles.towers",
    BALLISTICS_LIMITS.towerBindingsPerProfile
  );
  const towerIds = Object.keys(towers).sort();
  const destructibles = projectiles.destructibles === undefined
    ? undefined
    : normalizeDestructibleCatalog(
        projectiles.destructibles,
        "ballistics profile.projectiles.destructibles"
      );
  if (towerIds.length === 0 && destructibles === undefined) {
    throw new BallisticsProfileValidationError("ballistics profile.projectiles.towers must not be empty.");
  }
  const normalizedTowers = Object.create(null) as Record<string, BallisticsTowerBindingV1>;
  for (const towerId of towerIds) {
    boundedIdentifier(towerId, "ballistics tower id");
    Object.defineProperty(normalizedTowers, towerId, {
      value: normalizeTowerBinding(towers[towerId], `ballistics profile.projectiles.towers.${towerId}`),
      enumerable: true
    });
  }
  const normalizedProjectiles: {
    towers: Readonly<Record<string, BallisticsTowerBindingV1>>;
    clearance?: BallisticsArcClearanceV1;
    ricochet?: BallisticsRicochetSurfacesV1;
    destructibles?: BallisticsDestructibleCatalogV1;
  } = { towers: Object.freeze(normalizedTowers) };
  if (projectiles.clearance !== undefined) {
    normalizedProjectiles.clearance = normalizeArcClearance(
      projectiles.clearance,
      "ballistics profile.projectiles.clearance"
    );
  }
  if (projectiles.ricochet !== undefined) {
    normalizedProjectiles.ricochet = normalizeRicochetSurfaces(
      projectiles.ricochet,
      "ballistics profile.projectiles.ricochet"
    );
  }
  if (destructibles !== undefined) normalizedProjectiles.destructibles = destructibles;
  const boundRicochetTowerIds = towerIds.filter((towerId) => normalizedTowers[towerId]?.ricochet !== undefined);
  if (normalizedProjectiles.ricochet === undefined && boundRicochetTowerIds.length > 0) {
    throw new BallisticsProfileValidationError(
      "ballistics profile.projectiles.ricochet is required when a tower has a ricochet binding."
    );
  }
  if (normalizedProjectiles.ricochet !== undefined && boundRicochetTowerIds.length === 0) {
    throw new BallisticsProfileValidationError(
      "ballistics profile.projectiles.ricochet requires at least one bound tower ricochet configuration."
    );
  }
  if (normalizedProjectiles.ricochet?.terrainTags !== undefined) {
    const blockerHeights = normalizedProjectiles.clearance?.terrainBlockerHeights;
    if (blockerHeights === undefined) {
      throw new BallisticsProfileValidationError(
        "ballistics profile.projectiles.ricochet terrain surfaces require arc clearance."
      );
    }
    for (const tag of Object.keys(normalizedProjectiles.ricochet.terrainTags)) {
      if (Object.prototype.hasOwnProperty.call(blockerHeights, tag)) continue;
      throw new BallisticsProfileValidationError(
        `ballistics profile.projectiles.ricochet terrain surface "${tag}" requires a matching clearance blocker tag.`
      );
    }
  }
  return Object.freeze({ projectiles: Object.freeze(normalizedProjectiles) });
}

/** Resolve a ballistics profile only when the mission-selected v1 capability is active. */
export function resolveActiveBallisticsMechanics(
  content: GameContentRegistry,
  missionId: string
): ActiveBallisticsMechanicsV1 | undefined {
  const capability = content.missions[missionId]?.capabilities.ballistics;
  if (!capability?.active || capability.profileId === undefined) return undefined;
  const module = content.mechanics.modules.ballistics;
  if (!module || module.schemaVersion !== 1 || module.enabled !== true) return undefined;
  const profile = module.profiles[capability.profileId];
  if (profile === undefined) return undefined;
  try {
    return Object.freeze({
      schemaVersion: 1 as const,
      profileId: capability.profileId,
      ...normalizeBallisticsProfileV1(profile)
    });
  } catch {
    return undefined;
  }
}
