import type { ModifierSpec } from "../simulation/modifiers.js";
import type { RogueliteSnapshotV1, TowerState } from "../simulation/types.js";
import type { GameContentRegistry } from "./registry.js";

/** Closed authoring and runtime budgets for opt-in tower-tag synergies. */
export const ROGUELITE_SYNERGY_LIMITS = Object.freeze({
  towerTypesWithTags: 4_096,
  tagsPerTower: 16,
  totalTowerTagRefs: 16_384,
  tagUtf8Bytes: 128,
  synergyDefinitions: 32,
  synergyIdUtf8Bytes: 128,
  labelUtf8Bytes: 256,
  tiersPerSynergy: 8,
  requiredCount: 65_536,
  modifiersPerTier: 4,
  totalProfileModifiers: 32,
  flatAbsoluteValue: 1_000_000_000_000,
  additiveRatioMinimum: -1,
  additiveRatioMaximum: 1_000,
  multiplierMinimum: 0,
  multiplierMaximum: 1_000
});

const REQUIRED_PROFILE_FIELDS = Object.freeze(["synergies"] as const);
const REQUIRED_SYNERGY_FIELDS = Object.freeze(["label", "tag", "tiers"] as const);
const OPTIONAL_SYNERGY_FIELDS = Object.freeze(["tierMode"] as const);
const REQUIRED_TIER_FIELDS = Object.freeze(["requiredCount", "modifiers"] as const);
const REQUIRED_MODIFIER_FIELDS = Object.freeze(["target", "operation", "value"] as const);

/** Capability-aware descriptor shared by validation, Studio, and MCP. */
export const ROGUELITE_MECHANICS_SCHEMA = Object.freeze({
  schemaVersion: 1,
  moduleId: "roguelite" as const,
  supportedModuleSchemaVersions: Object.freeze([1] as const),
  profile: Object.freeze({
    requiredFields: REQUIRED_PROFILE_FIELDS,
    optionalFields: Object.freeze([] as const),
    additionalProperties: false
  }),
  towerTags: Object.freeze({
    field: "tags" as const,
    optional: true,
    itemType: "string" as const,
    uniqueItems: true
  }),
  synergy: Object.freeze({
    requiredFields: REQUIRED_SYNERGY_FIELDS,
    optionalFields: OPTIONAL_SYNERGY_FIELDS,
    additionalProperties: false,
    tierModes: Object.freeze(["highest", "cumulative"] as const)
  }),
  tiers: Object.freeze({
    requiredFields: REQUIRED_TIER_FIELDS,
    optionalFields: Object.freeze([] as const),
    additionalProperties: false
  }),
  modifier: Object.freeze({
    requiredFields: REQUIRED_MODIFIER_FIELDS,
    optionalFields: Object.freeze([] as const),
    additionalProperties: false,
    targets: Object.freeze(["damage"] as const),
    operations: Object.freeze(["flat", "additive_ratio", "multiplier"] as const),
    stage: "run" as const
  }),
  limits: ROGUELITE_SYNERGY_LIMITS,
  runtimeSnapshot: Object.freeze({
    path: "snapshot.roguelite" as const,
    schemaVersion: 1,
    optionalUnlessActive: true,
    fields: Object.freeze(["schemaVersion", "synergies"] as const)
  })
});

export type SynergyTierMode = "highest" | "cumulative";
export type SynergyModifierOperationV1 = "flat" | "additive_ratio" | "multiplier";

export interface SynergyModifierV1 {
  readonly target: "damage";
  readonly operation: SynergyModifierOperationV1;
  readonly value: number;
}

export interface SynergyTierV1 {
  readonly requiredCount: number;
  readonly modifiers: readonly SynergyModifierV1[];
}

export interface SynergyDefinitionV1 {
  readonly label: string;
  readonly tag: string;
  readonly tierMode?: SynergyTierMode;
  readonly tiers: readonly SynergyTierV1[];
}

export interface RogueliteMechanicsProfileV1 {
  readonly synergies: Readonly<Record<string, SynergyDefinitionV1>>;
}

export interface ActiveRogueliteMechanicsV1 extends RogueliteMechanicsProfileV1 {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly towerTagsByTypeId: Readonly<Record<string, readonly string[]>>;
}

export class RogueliteProfileValidationError extends Error {
  readonly fieldPath: string;

  constructor(fieldPath: string, message: string) {
    super(message);
    this.name = "RogueliteProfileValidationError";
    this.fieldPath = fieldPath;
  }
}

type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function ownData(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function inspectRecord(value: unknown, path: string, label: string): Record<string, unknown> {
  let prototype: object | null;
  let descriptors: DescriptorMap;
  try {
    prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    descriptors = value !== null && typeof value === "object"
      ? Object.getOwnPropertyDescriptors(value) as DescriptorMap
      : {};
  } catch {
    throw new RogueliteProfileValidationError(path, `${label} must be inspectable own data.`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || (prototype !== Object.prototype && prototype !== null)) {
    throw new RogueliteProfileValidationError(path, `${label} must be a plain object.`);
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw new RogueliteProfileValidationError(path, `${label} must not contain symbol fields.`);
  }
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new RogueliteProfileValidationError(`${path}.${key}`, `${label} fields must be enumerable own data.`);
    }
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}

function inspectArray(value: unknown, path: string, maximum: number, label: string): readonly unknown[] {
  let prototype: object | null;
  let descriptors: DescriptorMap;
  try {
    prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    descriptors = value !== null && typeof value === "object"
      ? Object.getOwnPropertyDescriptors(value) as DescriptorMap
      : {};
  } catch {
    throw new RogueliteProfileValidationError(path, `${label} must be inspectable own data.`);
  }
  if (!Array.isArray(value) || prototype !== Array.prototype) {
    throw new RogueliteProfileValidationError(path, `${label} must be an array.`);
  }
  const length = descriptors.length && "value" in descriptors.length ? descriptors.length.value : undefined;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
    throw new RogueliteProfileValidationError(path, `${label} exceeds its ${maximum} item limit.`);
  }
  if (Reflect.ownKeys(descriptors).some((key) => (
    key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)
  ))) {
    throw new RogueliteProfileValidationError(path, `${label} must be dense own data without extra fields.`);
  }
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new RogueliteProfileValidationError(`${path}[${index}]`, `${label} must not contain sparse entries or accessors.`);
    }
    result.push(descriptor.value);
  }
  return result;
}

function boundedString(value: unknown, path: string, label: string, maximumBytes: number): string {
  if (typeof value !== "string" || value.length === 0 || utf8ByteLength(value) > maximumBytes) {
    throw new RogueliteProfileValidationError(
      path,
      `${label} must be a non-empty string no longer than ${maximumBytes} UTF-8 bytes.`
    );
  }
  return value;
}

function rejectUnknownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  label: string
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new RogueliteProfileValidationError(`${path}.${key}`, `${label} is closed; unknown field "${key}" is not allowed.`);
    }
  }
}

function requireFields(record: Record<string, unknown>, required: readonly string[], path: string, label: string): void {
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      throw new RogueliteProfileValidationError(`${path}.${field}`, `${label} ${field} is required.`);
    }
  }
}

/** Validate and normalize one optional tower tag list. */
export function normalizeTowerTagsV1(value: unknown, path = "tags"): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  const items = inspectArray(value, path, ROGUELITE_SYNERGY_LIMITS.tagsPerTower, "Tower tags");
  const seen = new Set<string>();
  const tags: string[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const tag = boundedString(
      items[index],
      `${path}[${index}]`,
      "Tower tag",
      ROGUELITE_SYNERGY_LIMITS.tagUtf8Bytes
    );
    if (seen.has(tag)) {
      throw new RogueliteProfileValidationError(`${path}[${index}]`, `Duplicate tower tag "${tag}".`);
    }
    seen.add(tag);
    tags.push(tag);
  }
  tags.sort();
  return Object.freeze(tags);
}

function normalizeModifier(value: unknown, path: string): SynergyModifierV1 {
  const modifier = inspectRecord(value, path, "Synergy modifier");
  rejectUnknownFields(modifier, REQUIRED_MODIFIER_FIELDS, path, "Synergy modifier");
  requireFields(modifier, REQUIRED_MODIFIER_FIELDS, path, "Synergy modifier");
  if (modifier.target !== "damage") {
    throw new RogueliteProfileValidationError(`${path}.target`, "Synergy modifier target must be damage.");
  }
  const operation = modifier.operation;
  if (operation !== "flat" && operation !== "additive_ratio" && operation !== "multiplier") {
    throw new RogueliteProfileValidationError(`${path}.operation`, "Synergy modifier operation is unsupported.");
  }
  const numericValue = modifier.value;
  if (typeof numericValue !== "number" || !Number.isFinite(numericValue)) {
    throw new RogueliteProfileValidationError(`${path}.value`, "Synergy modifier value must be finite.");
  }
  const valid = operation === "flat"
    ? Math.abs(numericValue) <= ROGUELITE_SYNERGY_LIMITS.flatAbsoluteValue
    : operation === "additive_ratio"
      ? numericValue >= ROGUELITE_SYNERGY_LIMITS.additiveRatioMinimum
        && numericValue <= ROGUELITE_SYNERGY_LIMITS.additiveRatioMaximum
      : numericValue >= ROGUELITE_SYNERGY_LIMITS.multiplierMinimum
        && numericValue <= ROGUELITE_SYNERGY_LIMITS.multiplierMaximum;
  if (!valid) {
    throw new RogueliteProfileValidationError(`${path}.value`, `Synergy ${operation} value is outside its allowed range.`);
  }
  return Object.freeze({ target: "damage" as const, operation, value: numericValue });
}

/** Validate and detach an exact closed roguelite v1 profile. */
export function normalizeRogueliteProfileV1(value: unknown): RogueliteMechanicsProfileV1 {
  const profile = inspectRecord(value, "profile", "Roguelite profile");
  rejectUnknownFields(profile, REQUIRED_PROFILE_FIELDS, "profile", "Roguelite profile");
  requireFields(profile, REQUIRED_PROFILE_FIELDS, "profile", "Roguelite profile");
  const authoredSynergies = inspectRecord(profile.synergies, "profile.synergies", "Roguelite synergies");
  const synergyIds = Object.keys(authoredSynergies).sort();
  if (synergyIds.length > ROGUELITE_SYNERGY_LIMITS.synergyDefinitions) {
    throw new RogueliteProfileValidationError(
      "profile.synergies",
      `Roguelite profile exceeds the ${ROGUELITE_SYNERGY_LIMITS.synergyDefinitions} synergy definition limit.`
    );
  }
  const synergies = Object.create(null) as Record<string, SynergyDefinitionV1>;
  let totalModifiers = 0;
  for (const synergyId of synergyIds) {
    boundedString(
      synergyId,
      `profile.synergies.${synergyId}`,
      "Synergy id",
      ROGUELITE_SYNERGY_LIMITS.synergyIdUtf8Bytes
    );
    const path = `profile.synergies.${synergyId}`;
    const synergy = inspectRecord(authoredSynergies[synergyId], path, `Synergy "${synergyId}"`);
    rejectUnknownFields(
      synergy,
      [...REQUIRED_SYNERGY_FIELDS, ...OPTIONAL_SYNERGY_FIELDS],
      path,
      `Synergy "${synergyId}"`
    );
    requireFields(synergy, REQUIRED_SYNERGY_FIELDS, path, `Synergy "${synergyId}"`);
    const label = boundedString(
      synergy.label,
      `${path}.label`,
      "Synergy label",
      ROGUELITE_SYNERGY_LIMITS.labelUtf8Bytes
    );
    const tag = boundedString(
      synergy.tag,
      `${path}.tag`,
      "Synergy tag",
      ROGUELITE_SYNERGY_LIMITS.tagUtf8Bytes
    );
    const tierMode = synergy.tierMode === undefined ? "highest" : synergy.tierMode;
    if (tierMode !== "highest" && tierMode !== "cumulative") {
      throw new RogueliteProfileValidationError(`${path}.tierMode`, "Synergy tierMode must be highest or cumulative.");
    }
    const authoredTiers = inspectArray(
      synergy.tiers,
      `${path}.tiers`,
      ROGUELITE_SYNERGY_LIMITS.tiersPerSynergy,
      "Synergy tiers"
    );
    if (authoredTiers.length === 0) {
      throw new RogueliteProfileValidationError(`${path}.tiers`, "Synergy must define at least one tier.");
    }
    const tiers: SynergyTierV1[] = [];
    let previousRequiredCount = 0;
    for (let tierIndex = 0; tierIndex < authoredTiers.length; tierIndex += 1) {
      const tierPath = `${path}.tiers[${tierIndex}]`;
      const tier = inspectRecord(authoredTiers[tierIndex], tierPath, "Synergy tier");
      rejectUnknownFields(tier, REQUIRED_TIER_FIELDS, tierPath, "Synergy tier");
      requireFields(tier, REQUIRED_TIER_FIELDS, tierPath, "Synergy tier");
      if (!Number.isSafeInteger(tier.requiredCount)
        || (tier.requiredCount as number) <= previousRequiredCount
        || (tier.requiredCount as number) > ROGUELITE_SYNERGY_LIMITS.requiredCount) {
        throw new RogueliteProfileValidationError(
          `${tierPath}.requiredCount`,
          `Synergy tier requiredCount must be a strictly ascending positive safe integer no greater than ${ROGUELITE_SYNERGY_LIMITS.requiredCount}.`
        );
      }
      previousRequiredCount = tier.requiredCount as number;
      const authoredModifiers = inspectArray(
        tier.modifiers,
        `${tierPath}.modifiers`,
        ROGUELITE_SYNERGY_LIMITS.modifiersPerTier,
        "Synergy tier modifiers"
      );
      if (authoredModifiers.length === 0) {
        throw new RogueliteProfileValidationError(`${tierPath}.modifiers`, "Synergy tier must define at least one modifier.");
      }
      totalModifiers += authoredModifiers.length;
      if (totalModifiers > ROGUELITE_SYNERGY_LIMITS.totalProfileModifiers) {
        throw new RogueliteProfileValidationError(
          `${tierPath}.modifiers`,
          `Roguelite profile exceeds the ${ROGUELITE_SYNERGY_LIMITS.totalProfileModifiers} total modifier limit.`
        );
      }
      tiers.push(Object.freeze({
        requiredCount: previousRequiredCount,
        modifiers: Object.freeze(authoredModifiers.map((modifier, modifierIndex) => (
          normalizeModifier(modifier, `${tierPath}.modifiers[${modifierIndex}]`)
        )))
      }));
    }
    Object.defineProperty(synergies, synergyId, {
      value: Object.freeze({
        label,
        tag,
        ...(tierMode === "highest" ? {} : { tierMode }),
        tiers: Object.freeze(tiers)
      }),
      enumerable: true
    });
  }
  return Object.freeze({ synergies: Object.freeze(synergies) });
}

function normalizeTowerTagsByTypeId(content: GameContentRegistry): Readonly<Record<string, readonly string[]>> {
  const result = Object.create(null) as Record<string, readonly string[]>;
  let taggedTowerTypes = 0;
  let totalTagRefs = 0;
  for (const towerTypeId of Object.keys(content.towers).sort()) {
    const tags = normalizeTowerTagsV1(ownData(content.towers[towerTypeId], "tags"), `towers.${towerTypeId}.tags`);
    if (tags.length === 0) continue;
    taggedTowerTypes += 1;
    totalTagRefs += tags.length;
    if (taggedTowerTypes > ROGUELITE_SYNERGY_LIMITS.towerTypesWithTags
      || totalTagRefs > ROGUELITE_SYNERGY_LIMITS.totalTowerTagRefs) {
      throw new RogueliteProfileValidationError(
        `towers.${towerTypeId}.tags`,
        "Tower tag catalog exceeds the roguelite aggregate budget."
      );
    }
    Object.defineProperty(result, towerTypeId, { value: tags, enumerable: true });
  }
  return Object.freeze(result);
}

/** Resolve a detached profile only when the mission genuinely activates roguelite v1. */
export function resolveActiveRogueliteMechanics(
  content: GameContentRegistry,
  missionId: string
): ActiveRogueliteMechanicsV1 | undefined {
  try {
    const capability = content.missions[missionId]?.capabilities.roguelite;
    if (!capability?.active || capability.profileId === undefined) return undefined;
    const module = inspectRecord(
      ownData(ownData(content.mechanics, "modules"), "roguelite"),
      "module",
      "Roguelite mechanics module"
    );
    if (module.schemaVersion !== 1 || module.enabled !== true) return undefined;
    rejectUnknownFields(module, ["schemaVersion", "enabled", "profiles"], "module", "Roguelite mechanics module");
    const profiles = inspectRecord(module.profiles, "module.profiles", "Roguelite mechanics profiles");
    const profile = normalizeRogueliteProfileV1(ownData(profiles, capability.profileId));
    return Object.freeze({
      schemaVersion: 1 as const,
      profileId: capability.profileId,
      synergies: profile.synergies,
      towerTagsByTypeId: normalizeTowerTagsByTypeId(content)
    });
  } catch {
    return undefined;
  }
}

export interface DerivedRogueliteSynergyStateV1 {
  readonly snapshot: RogueliteSnapshotV1;
  readonly damageModifiers: readonly ModifierSpec[];
}

function modifierSynergyId(synergyId: string): string {
  return `${synergyId.length}:${synergyId}`;
}

/** Derive runtime state from authoritative placed towers; nothing is checkpointed separately. */
export function deriveRogueliteSynergyStateV1(
  active: ActiveRogueliteMechanicsV1,
  towers: readonly TowerState[]
): DerivedRogueliteSynergyStateV1 {
  const counts = new Map<string, number>();
  for (const tower of towers) {
    if (typeof tower.hp === "number" && tower.hp <= 0) continue;
    for (const tag of active.towerTagsByTypeId[tower.typeId] ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const rows: RogueliteSnapshotV1["synergies"][number][] = [];
  const damageModifiers: ModifierSpec[] = [];
  for (const synergyId of Object.keys(active.synergies).sort()) {
    const synergy = active.synergies[synergyId]!;
    const towerCount = counts.get(synergy.tag) ?? 0;
    const achieved = synergy.tiers.filter((tier) => tier.requiredCount <= towerCount);
    const activeTiers = (synergy.tierMode ?? "highest") === "cumulative"
      ? achieved
      : achieved.length === 0 ? [] : [achieved[achieved.length - 1]!];
    for (const tier of activeTiers) {
      tier.modifiers.forEach((modifier, modifierIndex) => {
        damageModifiers.push(Object.freeze({
          id: `roguelite:synergy:${modifierSynergyId(synergyId)}:tier:${tier.requiredCount}:modifier:${String(modifierIndex).padStart(2, "0")}`,
          target: "damage",
          stage: "run",
          operation: modifier.operation,
          value: modifier.value
        }));
      });
    }
    rows.push(Object.freeze({
      synergyId,
      label: synergy.label,
      tag: synergy.tag,
      towerCount,
      tierMode: synergy.tierMode ?? "highest",
      activeTierRequiredCounts: Object.freeze(activeTiers.map((tier) => tier.requiredCount))
    }));
  }
  return Object.freeze({
    snapshot: Object.freeze({ schemaVersion: 1 as const, synergies: Object.freeze(rows) }),
    damageModifiers: Object.freeze(damageModifiers)
  });
}
