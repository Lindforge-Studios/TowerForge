import type { GameContentRegistry } from "./registry.js";
import type { DisplacementEffectV1 } from "../simulation/types.js";

/** Closed structural and runtime budgets for opt-in tile displacement physics v1. */
export const PHYSICS_LIMITS = Object.freeze({
  displacementDistance: 8,
  displacementEffectsPerSource: 8,
  displacementTargetsPerActivation: 64,
  immuneEnemyTypeIds: 4_096,
  fallHazardTerrainTags: 64,
  idOrTagUtf8Bytes: 128,
  stepsPerEffectApplication: 8,
  stepAttemptsPerActivation: 4_096,
  stepAttemptsPerTick: 32_768
});

const DISPLACEMENT_EFFECT_SCHEMA = Object.freeze({
  kind: "displacement" as const,
  requiredFields: Object.freeze(["kind", "mode", "distance", "stopAtBlocker"] as const),
  optionalFields: Object.freeze([] as const),
  additionalProperties: false,
  kinds: Object.freeze(["displacement"] as const),
  modes: Object.freeze(["push", "pull"] as const)
});

/** Capability-aware authoring descriptor shared by Studio and MCP surfaces. */
export const PHYSICS_MECHANICS_SCHEMA = Object.freeze({
  schemaVersion: 1,
  moduleId: "physics" as const,
  supportedModuleSchemaVersions: Object.freeze([1] as const),
  profile: Object.freeze({
    requiredFields: Object.freeze([] as const),
    optionalFields: Object.freeze([
      "displacementImmuneEnemyTypeIds",
      "fallImmuneEnemyTypeIds",
      "fallHazardTerrainTags"
    ] as const),
    additionalProperties: false
  }),
  effect: DISPLACEMENT_EFFECT_SCHEMA,
  displacementEffect: DISPLACEMENT_EFFECT_SCHEMA,
  limits: PHYSICS_LIMITS,
  runtimeSnapshot: null
});

export interface PhysicsProfileV1 {
  readonly displacementImmuneEnemyTypeIds?: readonly string[];
  readonly fallImmuneEnemyTypeIds?: readonly string[];
  readonly fallHazardTerrainTags?: readonly string[];
}

export interface ActivePhysicsMechanicsV1 extends PhysicsProfileV1 {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly displacementImmuneEnemyTypeIds: readonly string[];
  readonly fallImmuneEnemyTypeIds: readonly string[];
  readonly fallHazardTerrainTags: readonly string[];
}

type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;

export type OwnDataEffectInspection =
  | Readonly<{ ok: false }>
  | Readonly<{
      ok: true;
      kind: unknown;
      record: Readonly<Record<string, unknown>>;
    }>;

function ownData(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  let prototype: object | null;
  let descriptors: DescriptorMap;
  try {
    prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    descriptors = value !== null && typeof value === "object"
      ? Object.getOwnPropertyDescriptors(value) as DescriptorMap
      : {};
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) || prototype !== Object.prototype) {
    return undefined;
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) return undefined;
  const detached: Record<string, unknown> = {};
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    Object.defineProperty(detached, key, { value: descriptor.value, enumerable: true });
  }
  return detached;
}

/**
 * Inspect an authored effect without executing property accessors. Only a plain, symbol-free
 * object whose enumerable own properties are all data descriptors is admitted. The returned
 * record is a detached frozen copy, so validation and runtime dispatch share one fail-closed
 * trust boundary before inspecting `kind` or any effect field.
 */
export function inspectOwnDataEffect(value: unknown): OwnDataEffectInspection {
  const record = plainRecord(value);
  if (!record) return Object.freeze({ ok: false as const });
  const frozen = Object.freeze(record);
  return Object.freeze({
    ok: true as const,
    kind: Object.prototype.hasOwnProperty.call(frozen, "kind") ? frozen.kind : undefined,
    record: frozen
  });
}

/** Parse the exact closed DisplacementEffectV1 shape into detached immutable data. */
export function parseDisplacementEffectV1(value: unknown): Readonly<DisplacementEffectV1> | undefined {
  const inspected = inspectOwnDataEffect(value);
  if (!inspected.ok || inspected.kind !== "displacement") return undefined;
  const keys = Object.keys(inspected.record);
  if (keys.length !== 4 || keys.some((key) => (
    key !== "kind" && key !== "mode" && key !== "distance" && key !== "stopAtBlocker"
  ))) return undefined;
  const mode = inspected.record.mode;
  const distance = inspected.record.distance;
  const stopAtBlocker = inspected.record.stopAtBlocker;
  if ((mode !== "push" && mode !== "pull")
    || !Number.isSafeInteger(distance)
    || (distance as number) < 1
    || (distance as number) > PHYSICS_LIMITS.displacementDistance
    || typeof stopAtBlocker !== "boolean") return undefined;
  return Object.freeze({
    kind: "displacement" as const,
    mode,
    distance: distance as number,
    stopAtBlocker
  });
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function stringArray(value: unknown, maximum: number): readonly string[] | undefined {
  if (value === undefined) return Object.freeze([]);
  let prototype: object | null;
  let descriptors: DescriptorMap;
  try {
    prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    descriptors = value !== null && typeof value === "object"
      ? Object.getOwnPropertyDescriptors(value) as DescriptorMap
      : {};
  } catch {
    return undefined;
  }
  if (!Array.isArray(value) || prototype !== Array.prototype) return undefined;
  const length = descriptors.length && "value" in descriptors.length ? descriptors.length.value : undefined;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return undefined;
  if (Reflect.ownKeys(descriptors).some((key) => {
    if (key === "length") return false;
    return typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length;
  })) return undefined;
  const result: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    const item = descriptor.value;
    if (typeof item !== "string" || item.length === 0
      || utf8ByteLength(item) > PHYSICS_LIMITS.idOrTagUtf8Bytes || seen.has(item)) return undefined;
    seen.add(item);
    result.push(item);
  }
  result.sort();
  return Object.freeze(result);
}

/** Resolve a detached, frozen profile only when the mission capability is genuinely active. */
export function resolveActivePhysicsMechanics(
  content: GameContentRegistry,
  missionId: string
): ActivePhysicsMechanicsV1 | undefined {
  const capability = content.missions[missionId]?.capabilities.physics;
  if (!capability?.active || capability.profileId === undefined) return undefined;
  const module = plainRecord(ownData(ownData(content.mechanics, "modules"), "physics"));
  if (!module || module.schemaVersion !== 1 || module.enabled !== true) return undefined;
  const profiles = plainRecord(module.profiles);
  const profile = profiles ? plainRecord(ownData(profiles, capability.profileId)) : undefined;
  if (!profile) return undefined;
  const allowed = new Set(PHYSICS_MECHANICS_SCHEMA.profile.optionalFields);
  if (Object.keys(profile).some((key) => !allowed.has(key as typeof PHYSICS_MECHANICS_SCHEMA.profile.optionalFields[number]))) {
    return undefined;
  }
  const displacementImmuneEnemyTypeIds = stringArray(
    profile.displacementImmuneEnemyTypeIds,
    PHYSICS_LIMITS.immuneEnemyTypeIds
  );
  const fallImmuneEnemyTypeIds = stringArray(
    profile.fallImmuneEnemyTypeIds,
    PHYSICS_LIMITS.immuneEnemyTypeIds
  );
  const fallHazardTerrainTags = stringArray(
    profile.fallHazardTerrainTags,
    PHYSICS_LIMITS.fallHazardTerrainTags
  );
  if (!displacementImmuneEnemyTypeIds || !fallImmuneEnemyTypeIds || !fallHazardTerrainTags) return undefined;
  return Object.freeze({
    schemaVersion: 1 as const,
    profileId: capability.profileId,
    displacementImmuneEnemyTypeIds,
    fallImmuneEnemyTypeIds,
    fallHazardTerrainTags
  });
}
