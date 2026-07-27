import type { GameContentRegistry } from "./registry.js";
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

/** Closed R3.3 high-ground authoring/runtime budgets. */
export const HIGH_GROUND_LIMITS = Object.freeze({
  maximumEffectiveElevationDelta: 64,
  rangeBonusPerElevation: 16,
  damageBonusBasisPointsPerElevation: 10_000,
  totalRangeBonus: 64,
  totalDamageBonusBasisPoints: 100_000,
  modifiersPerDamagePacket: 1
});

export const ELEVATION_MECHANICS_SCHEMA = Object.freeze({
  schemaVersion: 3,
  moduleId: "elevation",
  supportedModuleSchemaVersions: Object.freeze([1, 2, 3] as const),
  profile: Object.freeze({
    requiredFields: Object.freeze([] as const),
    optionalFields: Object.freeze(["lineOfSight", "highGround"] as const),
    additionalProperties: false,
    versions: Object.freeze({
      1: Object.freeze({
        requiredFields: Object.freeze([] as const),
        optionalFields: Object.freeze([] as const),
        additionalProperties: false
      }),
      2: Object.freeze({
        requiredFields: Object.freeze([] as const),
        optionalFields: Object.freeze(["lineOfSight"] as const),
        additionalProperties: false
      }),
      3: Object.freeze({
        requiredFields: Object.freeze([] as const),
        optionalFields: Object.freeze(["lineOfSight", "highGround"] as const),
        additionalProperties: false
      })
    }),
    lineOfSight: Object.freeze({
      requiredFields: Object.freeze(["terrainBlockerTags"] as const),
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    highGround: Object.freeze({
      requiredFields: Object.freeze([
        "maximumEffectiveElevationDelta",
        "rangeBonusPerElevation",
        "damageBonusBasisPointsPerElevation"
      ] as const),
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    })
  }),
  map: Object.freeze({
    field: "elevationOverrides",
    coordinateField: "elevation",
    implicitDefault: 0,
    canonicalOrder: Object.freeze(["r", "q"] as const),
    zeroOverridesOmitted: true
  }),
  limits: Object.freeze({
    ...ELEVATION_LIMITS,
    lineOfSight: LINE_OF_SIGHT_LIMITS,
    highGround: HIGH_GROUND_LIMITS
  }),
  runtimeSnapshot: Object.freeze({
    path: "snapshot.elevation",
    schemaVersion: 1,
    optionalUnlessActive: true,
    fields: Object.freeze(["schemaVersion", "defaultElevation", "overrides"] as const)
  })
});

export interface ElevationLineOfSightProfileV2 {
  readonly terrainBlockerTags: readonly string[];
}

export interface ElevationHighGroundProfileV3 {
  readonly maximumEffectiveElevationDelta: number;
  readonly rangeBonusPerElevation: number;
  readonly damageBonusBasisPointsPerElevation: number;
}

export interface ActiveElevationMechanicsV1 {
  readonly schemaVersion: 1;
  readonly profileId: string;
}

export interface ActiveElevationMechanicsV2 {
  readonly schemaVersion: 2;
  readonly profileId: string;
  readonly lineOfSight?: ElevationLineOfSightProfileV2;
}

export interface ActiveElevationMechanicsV3 {
  readonly schemaVersion: 3;
  readonly profileId: string;
  readonly lineOfSight?: ElevationLineOfSightProfileV2;
  readonly highGround?: ElevationHighGroundProfileV3;
}

export type ActiveElevationMechanics =
  | ActiveElevationMechanicsV1
  | ActiveElevationMechanicsV2
  | ActiveElevationMechanicsV3;

function ownDataValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function resolveTerrainBlockerTags(value: unknown): readonly string[] | undefined {
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  let prototype: object | null;
  let array: boolean;
  try {
    array = Array.isArray(value);
    prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
  } catch {
    return undefined;
  }
  if (!array || prototype !== Array.prototype) return undefined;
  const lengthValue = descriptors.length?.value;
  if (!Number.isSafeInteger(lengthValue) || (lengthValue as number) < 0
    || (lengthValue as number) > LINE_OF_SIGHT_LIMITS.terrainBlockerTags) {
    return undefined;
  }
  const length = lengthValue as number;
  if (Reflect.ownKeys(descriptors).some((key) => {
    if (key === "length") return false;
    if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)) return true;
    return Number(key) >= length;
  })) return undefined;
  const result: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
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

function resolveHighGroundProfile(value: unknown): ElevationHighGroundProfileV3 | undefined {
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  let prototype: object | null;
  let array: boolean;
  try {
    array = Array.isArray(value);
    prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    descriptors = value !== null && typeof value === "object"
      ? Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>
      : {};
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object" || array || prototype !== Object.prototype) return undefined;
  const expected = [
    "maximumEffectiveElevationDelta",
    "rangeBonusPerElevation",
    "damageBonusBasisPointsPerElevation"
  ] as const;
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== expected.length
    || keys.some((key) => typeof key !== "string" || !expected.includes(key as typeof expected[number]))) {
    return undefined;
  }
  const values: Record<typeof expected[number], number> = {
    maximumEffectiveElevationDelta: 0,
    rangeBonusPerElevation: 0,
    damageBonusBasisPointsPerElevation: 0
  };
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)
      || !Number.isSafeInteger(descriptor.value)) return undefined;
    values[key] = descriptor.value as number;
  }
  const maximumDelta = values.maximumEffectiveElevationDelta;
  const rangeBonus = values.rangeBonusPerElevation;
  const damageBonus = values.damageBonusBasisPointsPerElevation;
  if (maximumDelta < 1 || maximumDelta > HIGH_GROUND_LIMITS.maximumEffectiveElevationDelta
    || rangeBonus < 0 || rangeBonus > HIGH_GROUND_LIMITS.rangeBonusPerElevation
    || damageBonus < 0 || damageBonus > HIGH_GROUND_LIMITS.damageBonusBasisPointsPerElevation
    || (rangeBonus === 0 && damageBonus === 0)
    || maximumDelta * rangeBonus > HIGH_GROUND_LIMITS.totalRangeBonus
    || maximumDelta * damageBonus > HIGH_GROUND_LIMITS.totalDamageBonusBasisPoints) {
    return undefined;
  }
  return Object.freeze({
    maximumEffectiveElevationDelta: maximumDelta,
    rangeBonusPerElevation: rangeBonus,
    damageBonusBasisPointsPerElevation: damageBonus
  });
}

/** Resolve only the enabled, selected and supported mission-level opt-in switch. */
export function resolveActiveElevationMechanics(
  content: GameContentRegistry,
  missionId: string
): ActiveElevationMechanics | undefined {
  const capability = content.missions[missionId]?.capabilities.elevation;
  if (!capability?.active || capability.profileId === undefined) return undefined;
  const authoredModule = ownDataValue(ownDataValue(content.mechanics, "modules"), "elevation");
  const schemaVersion = ownDataValue(authoredModule, "schemaVersion");
  if (schemaVersion === 1) {
    return Object.freeze({ schemaVersion: 1, profileId: capability.profileId });
  }
  if (schemaVersion !== 2 && schemaVersion !== 3) return undefined;
  const profile = ownDataValue(ownDataValue(authoredModule, "profiles"), capability.profileId);
  const lineOfSight = ownDataValue(profile, "lineOfSight");
  const tags = lineOfSight === undefined
    ? undefined
    : resolveTerrainBlockerTags(ownDataValue(lineOfSight, "terrainBlockerTags"));
  if (schemaVersion === 2) return Object.freeze({
    schemaVersion,
    profileId: capability.profileId,
    ...(tags === undefined ? {} : { lineOfSight: Object.freeze({ terrainBlockerTags: tags }) })
  });
  const highGround = resolveHighGroundProfile(ownDataValue(profile, "highGround"));
  return Object.freeze({
    schemaVersion,
    profileId: capability.profileId,
    ...(tags === undefined ? {} : { lineOfSight: Object.freeze({ terrainBlockerTags: tags }) }),
    ...(highGround === undefined ? {} : { highGround })
  });
}

export function resolveActiveLineOfSightMechanics(
  content: GameContentRegistry,
  missionId: string
): (ElevationLineOfSightProfileV2 & { readonly profileId: string }) | undefined {
  const elevation = resolveActiveElevationMechanics(content, missionId);
  if ((elevation?.schemaVersion !== 2 && elevation?.schemaVersion !== 3) || !elevation.lineOfSight) return undefined;
  return Object.freeze({
    profileId: elevation.profileId,
    terrainBlockerTags: elevation.lineOfSight.terrainBlockerTags
  });
}

export function resolveActiveHighGroundMechanics(
  content: GameContentRegistry,
  missionId: string
): (ElevationHighGroundProfileV3 & { readonly profileId: string }) | undefined {
  const elevation = resolveActiveElevationMechanics(content, missionId);
  if (elevation?.schemaVersion !== 3 || !elevation.highGround) return undefined;
  return Object.freeze({ profileId: elevation.profileId, ...elevation.highGround });
}
