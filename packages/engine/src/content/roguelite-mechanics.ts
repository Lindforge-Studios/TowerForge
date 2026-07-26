import { MAX_MODIFIERS_PER_RESOLUTION, type ModifierSpec } from "../simulation/modifiers.js";
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

/** Closed authoring/runtime budgets for roguelite v2 artifacts and boss loot. */
export const ROGUELITE_ARTIFACT_LIMITS = Object.freeze({
  definitions: 256,
  slotsPerTower: 8,
  totalSlots: 4_096,
  modifiersPerArtifact: 8,
  totalArtifactModifiers: 1_024,
  lootTables: 64,
  rollsPerTable: 8,
  entriesPerTable: 128,
  weight: 1_000_000,
  totalTableWeight: 0xffff_ffff,
  idUtf8Bytes: 128,
  labelUtf8Bytes: 256
});

export const ROGUELITE_ARTIFACT_INVENTORY_LIMIT = 10_000;

/** Closed authoring/runtime budgets for opt-in roguelite v3 wave draft. */
export const ROGUELITE_DRAFT_LIMITS = Object.freeze({
  definitions: 256,
  pools: 32,
  entriesPerPool: 128,
  effectsPerCard: 4,
  totalEffects: 1_024,
  offerSize: 3,
  selections: 10_000,
  weight: 1_000_000,
  totalPoolWeight: 0xffff_ffff,
  idUtf8Bytes: 128,
  tagUtf8Bytes: 128,
  labelUtf8Bytes: 256
});

export const ROGUELITE_DAMAGE_MODIFIER_RESERVE = Object.freeze({
  towerUpgrade: 0,
  meta: 1,
  spatial: 2,
  temporary: 0,
  total: 3
});

const REQUIRED_PROFILE_V1_FIELDS = Object.freeze(["synergies"] as const);
const REQUIRED_PROFILE_V2_FIELDS = Object.freeze(["synergies", "artifacts"] as const);
const REQUIRED_PROFILE_V3_FIELDS = Object.freeze(["synergies"] as const);
const OPTIONAL_PROFILE_V3_FIELDS = Object.freeze(["artifacts", "draft"] as const);
const REQUIRED_SYNERGY_FIELDS = Object.freeze(["label", "tag", "tiers"] as const);
const OPTIONAL_SYNERGY_FIELDS = Object.freeze(["tierMode"] as const);
const REQUIRED_TIER_FIELDS = Object.freeze(["requiredCount", "modifiers"] as const);
const REQUIRED_MODIFIER_FIELDS = Object.freeze(["target", "operation", "value"] as const);
const REQUIRED_ARTIFACTS_FIELDS = Object.freeze(["definitions", "towerSlots", "bossLootTables"] as const);
const REQUIRED_ARTIFACT_DEFINITION_FIELDS = Object.freeze(["label", "slotType", "modifiers"] as const);
const REQUIRED_TOWER_SLOT_FIELDS = Object.freeze(["slotId", "slotType"] as const);
const REQUIRED_LOOT_TABLE_FIELDS = Object.freeze(["rolls", "entries"] as const);
const OPTIONAL_LOOT_TABLE_FIELDS = Object.freeze(["noDropWeight"] as const);
const REQUIRED_LOOT_ENTRY_FIELDS = Object.freeze(["artifactId", "weight"] as const);
const REQUIRED_DRAFT_FIELDS = Object.freeze(["definitions", "pools", "defaultPoolId"] as const);
const REQUIRED_DRAFT_DEFINITION_FIELDS = Object.freeze(["label", "effects"] as const);
const REQUIRED_DRAFT_EFFECT_FIELDS = Object.freeze(["kind", "scope", "modifier"] as const);
const REQUIRED_DRAFT_POOL_FIELDS = Object.freeze(["entries"] as const);
const REQUIRED_DRAFT_POOL_ENTRY_FIELDS = Object.freeze(["cardId", "weight"] as const);

/** Capability-aware descriptor shared by validation, Studio, and MCP. */
export const ROGUELITE_MECHANICS_SCHEMA = Object.freeze({
  schemaVersion: 3,
  moduleId: "roguelite" as const,
  supportedModuleSchemaVersions: Object.freeze([1, 2, 3] as const),
  profile: Object.freeze({
    requiredFields: REQUIRED_PROFILE_V3_FIELDS,
    optionalFields: OPTIONAL_PROFILE_V3_FIELDS,
    additionalProperties: false
  }),
  profileVersions: Object.freeze({
    1: Object.freeze({
      requiredFields: REQUIRED_PROFILE_V1_FIELDS,
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    2: Object.freeze({
      requiredFields: REQUIRED_PROFILE_V2_FIELDS,
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    3: Object.freeze({
      requiredFields: REQUIRED_PROFILE_V3_FIELDS,
      optionalFields: OPTIONAL_PROFILE_V3_FIELDS,
      additionalProperties: false
    })
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
  artifacts: Object.freeze({
    requiredFields: REQUIRED_ARTIFACTS_FIELDS,
    optionalFields: Object.freeze([] as const),
    additionalProperties: false,
    definition: Object.freeze({
      requiredFields: REQUIRED_ARTIFACT_DEFINITION_FIELDS,
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    towerSlot: Object.freeze({
      requiredFields: REQUIRED_TOWER_SLOT_FIELDS,
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    lootTable: Object.freeze({
      requiredFields: REQUIRED_LOOT_TABLE_FIELDS,
      optionalFields: OPTIONAL_LOOT_TABLE_FIELDS,
      additionalProperties: false
    }),
    lootEntry: Object.freeze({
      requiredFields: REQUIRED_LOOT_ENTRY_FIELDS,
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    })
  }),
  draft: Object.freeze({
    requiredFields: REQUIRED_DRAFT_FIELDS,
    optionalFields: Object.freeze([] as const),
    additionalProperties: false,
    definition: Object.freeze({
      requiredFields: REQUIRED_DRAFT_DEFINITION_FIELDS,
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    effect: Object.freeze({
      requiredFields: REQUIRED_DRAFT_EFFECT_FIELDS,
      optionalFields: Object.freeze([] as const),
      additionalProperties: false,
      kinds: Object.freeze(["modifier"] as const)
    }),
    scope: Object.freeze({
      kinds: Object.freeze(["all_towers", "tower_type", "tower_tag"] as const)
    }),
    pool: Object.freeze({
      requiredFields: REQUIRED_DRAFT_POOL_FIELDS,
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    poolEntry: Object.freeze({
      requiredFields: REQUIRED_DRAFT_POOL_ENTRY_FIELDS,
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    offerSize: ROGUELITE_DRAFT_LIMITS.offerSize,
    sampling: "weighted_without_replacement" as const
  }),
  limits: Object.freeze({
    synergies: ROGUELITE_SYNERGY_LIMITS,
    artifacts: ROGUELITE_ARTIFACT_LIMITS,
    draft: ROGUELITE_DRAFT_LIMITS,
    damageResolution: Object.freeze({
      maximum: MAX_MODIFIERS_PER_RESOLUTION,
      reserved: ROGUELITE_DAMAGE_MODIFIER_RESERVE
    })
  }),
  runtimeSnapshot: Object.freeze({
    path: "snapshot.roguelite" as const,
    supportedSchemaVersions: Object.freeze([1, 2, 3, 4] as const),
    optionalUnlessActive: true,
    fieldsByVersion: Object.freeze({
      1: Object.freeze(["schemaVersion", "synergies"] as const),
      2: Object.freeze(["schemaVersion", "synergies", "artifacts"] as const),
      3: Object.freeze(["schemaVersion", "synergies", "artifacts"] as const),
      4: Object.freeze(["schemaVersion", "synergies", "draft"] as const)
    }),
    optionalFieldsByVersion: Object.freeze({
      4: Object.freeze(["artifacts"] as const)
    })
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

export interface ArtifactDefinitionV2 {
  readonly label: string;
  readonly slotType: string;
  readonly modifiers: readonly SynergyModifierV1[];
}

export interface ArtifactTowerSlotV2 {
  readonly slotId: string;
  readonly slotType: string;
}

export interface ArtifactLootEntryV2 {
  readonly artifactId: string;
  readonly weight: number;
}

export interface ArtifactBossLootTableV2 {
  readonly rolls: number;
  readonly noDropWeight?: number;
  readonly entries: readonly ArtifactLootEntryV2[];
}

export interface RogueliteArtifactsDefinitionV2 {
  readonly definitions: Readonly<Record<string, ArtifactDefinitionV2>>;
  readonly towerSlots: Readonly<Record<string, readonly ArtifactTowerSlotV2[]>>;
  readonly bossLootTables: Readonly<Record<string, ArtifactBossLootTableV2>>;
}

export interface RogueliteMechanicsProfileV2 extends RogueliteMechanicsProfileV1 {
  readonly artifacts: RogueliteArtifactsDefinitionV2;
}

export type DraftScopeV3 =
  | { readonly kind: "all_towers" }
  | { readonly kind: "tower_type"; readonly towerTypeId: string }
  | { readonly kind: "tower_tag"; readonly tag: string };

export interface DraftModifierEffectV3 {
  readonly kind: "modifier";
  readonly scope: DraftScopeV3;
  readonly modifier: SynergyModifierV1;
}

export interface DraftCardDefinitionV3 {
  readonly label: string;
  readonly effects: readonly DraftModifierEffectV3[];
}

export interface DraftPoolEntryV3 {
  readonly cardId: string;
  readonly weight: number;
}

export interface DraftPoolV3 {
  readonly entries: readonly DraftPoolEntryV3[];
}

export interface RogueliteDraftDefinitionV3 {
  readonly definitions: Readonly<Record<string, DraftCardDefinitionV3>>;
  readonly pools: Readonly<Record<string, DraftPoolV3>>;
  readonly defaultPoolId: string;
}

export interface RogueliteMechanicsProfileV3 extends RogueliteMechanicsProfileV1 {
  readonly artifacts?: RogueliteArtifactsDefinitionV2;
  readonly draft?: RogueliteDraftDefinitionV3;
}

export interface ActiveRogueliteMechanicsV1 extends RogueliteMechanicsProfileV1 {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly towerTagsByTypeId: Readonly<Record<string, readonly string[]>>;
  readonly artifacts?: undefined;
  readonly draft?: undefined;
}

export interface ActiveRogueliteMechanicsV2 extends RogueliteMechanicsProfileV2 {
  readonly schemaVersion: 2;
  readonly profileId: string;
  readonly towerTagsByTypeId: Readonly<Record<string, readonly string[]>>;
  readonly draft?: undefined;
}

export interface ActiveRogueliteMechanicsV3 extends RogueliteMechanicsProfileV3 {
  readonly schemaVersion: 3;
  readonly profileId: string;
  readonly towerTagsByTypeId: Readonly<Record<string, readonly string[]>>;
}

export type ActiveRogueliteMechanics =
  | ActiveRogueliteMechanicsV1
  | ActiveRogueliteMechanicsV2
  | ActiveRogueliteMechanicsV3;

export function rogueliteSynergyWorstCaseModifierCount(
  synergies: Readonly<Record<string, SynergyDefinitionV1>>
): number {
  let total = 0;
  for (const synergy of Object.values(synergies)) {
    total += (synergy.tierMode ?? "highest") === "cumulative"
      ? synergy.tiers.reduce((sum, tier) => sum + tier.modifiers.length, 0)
      : synergy.tiers.reduce((maximum, tier) => Math.max(maximum, tier.modifiers.length), 0);
  }
  return total;
}

export function assertRogueliteV2ModifierBudget(profile: RogueliteMechanicsProfileV2): void {
  const synergyWorstCase = rogueliteSynergyWorstCaseModifierCount(profile.synergies);
  if (synergyWorstCase + ROGUELITE_DAMAGE_MODIFIER_RESERVE.total > MAX_MODIFIERS_PER_RESOLUTION) {
    throw new RogueliteProfileValidationError(
      "profile.synergies",
      "Roguelite v2 worst-case synergy modifiers exceed the shared damage resolution budget."
    );
  }
}

/** Guard the shared resolver against the worst authored v3 run stack for one mission. */
export function assertRogueliteV3ModifierBudget(
  profile: RogueliteMechanicsProfileV3,
  content: GameContentRegistry,
  missionId: string
): void {
  const mission = content.missions[missionId];
  if (!mission) return;
  if (profile.draft && Math.max(0, mission.waves.length - 1) > ROGUELITE_DRAFT_LIMITS.selections) {
    throw new RogueliteProfileValidationError(
      "profile.draft",
      `Draft mission "${missionId}" can require more than ${ROGUELITE_DRAFT_LIMITS.selections} interwave selections.`
    );
  }
  const synergyWorstCase = rogueliteSynergyWorstCaseModifierCount(profile.synergies);
  for (const towerTypeId of mission.buildTowerIds) {
    const tags = new Set(normalizeTowerTagsV1(ownData(content.towers[towerTypeId], "tags")));
    const artifactWorstCase = (profile.artifacts?.towerSlots[towerTypeId] ?? []).reduce((total, slot) => {
      const maximum = Object.values(profile.artifacts?.definitions ?? {}).reduce((best, definition) => (
        definition.slotType === slot.slotType ? Math.max(best, definition.modifiers.length) : best
      ), 0);
      return total + maximum;
    }, 0);
    const draftWorstPerChoice = Object.values(profile.draft?.definitions ?? {}).reduce((maximum, definition) => {
      const matching = definition.effects.filter((effect) => (
        effect.scope.kind === "all_towers"
        || (effect.scope.kind === "tower_type" && effect.scope.towerTypeId === towerTypeId)
        || (effect.scope.kind === "tower_tag" && tags.has(effect.scope.tag))
      )).length;
      return Math.max(maximum, matching);
    }, 0);
    const total = synergyWorstCase
      + artifactWorstCase
      + Math.max(0, mission.waves.length - 1) * draftWorstPerChoice
      + ROGUELITE_DAMAGE_MODIFIER_RESERVE.total;
    if (total > MAX_MODIFIERS_PER_RESOLUTION) {
      throw new RogueliteProfileValidationError(
        "profile",
        `Roguelite v3 worst-case modifiers exceed the shared damage resolution budget for tower "${towerTypeId}".`
      );
    }
  }
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
  rejectUnknownFields(profile, REQUIRED_PROFILE_V1_FIELDS, "profile", "Roguelite profile");
  requireFields(profile, REQUIRED_PROFILE_V1_FIELDS, "profile", "Roguelite profile");
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

function boundedInteger(
  value: unknown,
  path: string,
  label: string,
  minimum: number,
  maximum: number
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RogueliteProfileValidationError(
      path,
      `${label} must be a safe integer in the range ${minimum}..${maximum}; ${maximum} is the maximum.`
    );
  }
  return value as number;
}

/** Validate and detach the exact closed artifact domain nested in a roguelite v2 profile. */
export function normalizeRogueliteArtifactsV2(value: unknown): RogueliteArtifactsDefinitionV2 {
  const artifacts = inspectRecord(value, "profile.artifacts", "Roguelite artifacts");
  rejectUnknownFields(artifacts, REQUIRED_ARTIFACTS_FIELDS, "profile.artifacts", "Roguelite artifacts");
  requireFields(artifacts, REQUIRED_ARTIFACTS_FIELDS, "profile.artifacts", "Roguelite artifacts");

  const authoredDefinitions = inspectRecord(
    artifacts.definitions,
    "profile.artifacts.definitions",
    "Artifact definitions"
  );
  const definitionIds = Object.keys(authoredDefinitions).sort();
  if (definitionIds.length > ROGUELITE_ARTIFACT_LIMITS.definitions) {
    throw new RogueliteProfileValidationError(
      "profile.artifacts.definitions",
      `Artifact definition count exceeds the ${ROGUELITE_ARTIFACT_LIMITS.definitions} item limit.`
    );
  }
  const definitions = Object.create(null) as Record<string, ArtifactDefinitionV2>;
  let totalModifiers = 0;
  for (const artifactId of definitionIds) {
    boundedString(
      artifactId,
      `profile.artifacts.definitions.${artifactId}`,
      "Artifact id",
      ROGUELITE_ARTIFACT_LIMITS.idUtf8Bytes
    );
    const path = `profile.artifacts.definitions.${artifactId}`;
    const definition = inspectRecord(authoredDefinitions[artifactId], path, `Artifact definition "${artifactId}"`);
    rejectUnknownFields(definition, REQUIRED_ARTIFACT_DEFINITION_FIELDS, path, `Artifact definition "${artifactId}"`);
    requireFields(definition, REQUIRED_ARTIFACT_DEFINITION_FIELDS, path, `Artifact definition "${artifactId}"`);
    const label = boundedString(
      definition.label,
      `${path}.label`,
      "Artifact label",
      ROGUELITE_ARTIFACT_LIMITS.labelUtf8Bytes
    );
    const slotType = boundedString(
      definition.slotType,
      `${path}.slotType`,
      "Artifact slot type",
      ROGUELITE_ARTIFACT_LIMITS.idUtf8Bytes
    );
    const authoredModifiers = inspectArray(
      definition.modifiers,
      `${path}.modifiers`,
      ROGUELITE_ARTIFACT_LIMITS.modifiersPerArtifact,
      "Artifact modifiers"
    );
    totalModifiers += authoredModifiers.length;
    if (totalModifiers > ROGUELITE_ARTIFACT_LIMITS.totalArtifactModifiers) {
      throw new RogueliteProfileValidationError(
        `${path}.modifiers`,
        `Artifact modifier count exceeds the ${ROGUELITE_ARTIFACT_LIMITS.totalArtifactModifiers} item budget.`
      );
    }
    Object.defineProperty(definitions, artifactId, {
      value: Object.freeze({
        label,
        slotType,
        modifiers: Object.freeze(authoredModifiers.map((modifier, index) => (
          normalizeModifier(modifier, `${path}.modifiers[${index}]`)
        )))
      }),
      enumerable: true
    });
  }

  const authoredTowerSlots = inspectRecord(
    artifacts.towerSlots,
    "profile.artifacts.towerSlots",
    "Artifact tower slots"
  );
  const towerSlots = Object.create(null) as Record<string, readonly ArtifactTowerSlotV2[]>;
  let totalSlots = 0;
  for (const towerTypeId of Object.keys(authoredTowerSlots).sort()) {
    boundedString(
      towerTypeId,
      `profile.artifacts.towerSlots.${towerTypeId}`,
      "Tower type id",
      ROGUELITE_ARTIFACT_LIMITS.idUtf8Bytes
    );
    const path = `profile.artifacts.towerSlots.${towerTypeId}`;
    const authoredSlots = inspectArray(
      authoredTowerSlots[towerTypeId],
      path,
      ROGUELITE_ARTIFACT_LIMITS.slotsPerTower,
      "Tower artifact slots"
    );
    totalSlots += authoredSlots.length;
    if (totalSlots > ROGUELITE_ARTIFACT_LIMITS.totalSlots) {
      throw new RogueliteProfileValidationError(
        path,
        `Artifact tower slot count exceeds the ${ROGUELITE_ARTIFACT_LIMITS.totalSlots} item budget.`
      );
    }
    const seenSlotIds = new Set<string>();
    const slots = authoredSlots.map((slotValue, index): ArtifactTowerSlotV2 => {
      const slotPath = `${path}[${index}]`;
      const slot = inspectRecord(slotValue, slotPath, "Tower artifact slot");
      rejectUnknownFields(slot, REQUIRED_TOWER_SLOT_FIELDS, slotPath, "Tower artifact slot");
      requireFields(slot, REQUIRED_TOWER_SLOT_FIELDS, slotPath, "Tower artifact slot");
      const slotId = boundedString(
        slot.slotId,
        `${slotPath}.slotId`,
        "Artifact slot id",
        ROGUELITE_ARTIFACT_LIMITS.idUtf8Bytes
      );
      if (seenSlotIds.has(slotId)) {
        throw new RogueliteProfileValidationError(`${slotPath}.slotId`, `Duplicate artifact slot id "${slotId}".`);
      }
      seenSlotIds.add(slotId);
      return Object.freeze({
        slotId,
        slotType: boundedString(
          slot.slotType,
          `${slotPath}.slotType`,
          "Artifact slot type",
          ROGUELITE_ARTIFACT_LIMITS.idUtf8Bytes
        )
      });
    });
    Object.defineProperty(towerSlots, towerTypeId, { value: Object.freeze(slots), enumerable: true });
  }

  const authoredLootTables = inspectRecord(
    artifacts.bossLootTables,
    "profile.artifacts.bossLootTables",
    "Artifact boss loot tables"
  );
  const lootTableEnemyIds = Object.keys(authoredLootTables).sort();
  if (lootTableEnemyIds.length > ROGUELITE_ARTIFACT_LIMITS.lootTables) {
    throw new RogueliteProfileValidationError(
      "profile.artifacts.bossLootTables",
      `Artifact loot table count exceeds the ${ROGUELITE_ARTIFACT_LIMITS.lootTables} item limit.`
    );
  }
  const bossLootTables = Object.create(null) as Record<string, ArtifactBossLootTableV2>;
  for (const enemyTypeId of lootTableEnemyIds) {
    boundedString(
      enemyTypeId,
      `profile.artifacts.bossLootTables.${enemyTypeId}`,
      "Loot-bearing enemy type id",
      ROGUELITE_ARTIFACT_LIMITS.idUtf8Bytes
    );
    const path = `profile.artifacts.bossLootTables.${enemyTypeId}`;
    const table = inspectRecord(authoredLootTables[enemyTypeId], path, `Artifact loot table "${enemyTypeId}"`);
    rejectUnknownFields(
      table,
      [...REQUIRED_LOOT_TABLE_FIELDS, ...OPTIONAL_LOOT_TABLE_FIELDS],
      path,
      `Artifact loot table "${enemyTypeId}"`
    );
    requireFields(table, REQUIRED_LOOT_TABLE_FIELDS, path, `Artifact loot table "${enemyTypeId}"`);
    const rolls = boundedInteger(
      table.rolls,
      `${path}.rolls`,
      "Artifact loot table rolls",
      1,
      ROGUELITE_ARTIFACT_LIMITS.rollsPerTable
    );
    const noDropWeight = table.noDropWeight === undefined
      ? 0
      : boundedInteger(
          table.noDropWeight,
          `${path}.noDropWeight`,
          "Artifact no-drop weight",
          0,
          ROGUELITE_ARTIFACT_LIMITS.weight
        );
    const authoredEntries = inspectArray(
      table.entries,
      `${path}.entries`,
      ROGUELITE_ARTIFACT_LIMITS.entriesPerTable,
      "Artifact loot entries"
    );
    if (authoredEntries.length === 0) {
      throw new RogueliteProfileValidationError(`${path}.entries`, "Artifact loot table must contain at least one entry.");
    }
    const seenArtifactIds = new Set<string>();
    let totalWeight = noDropWeight;
    const entries = authoredEntries.map((entryValue, index): ArtifactLootEntryV2 => {
      const entryPath = `${path}.entries[${index}]`;
      const entry = inspectRecord(entryValue, entryPath, "Artifact loot entry");
      rejectUnknownFields(entry, REQUIRED_LOOT_ENTRY_FIELDS, entryPath, "Artifact loot entry");
      requireFields(entry, REQUIRED_LOOT_ENTRY_FIELDS, entryPath, "Artifact loot entry");
      const artifactId = boundedString(
        entry.artifactId,
        `${entryPath}.artifactId`,
        "Artifact id",
        ROGUELITE_ARTIFACT_LIMITS.idUtf8Bytes
      );
      if (seenArtifactIds.has(artifactId)) {
        throw new RogueliteProfileValidationError(`${entryPath}.artifactId`, `Duplicate artifact loot entry "${artifactId}".`);
      }
      seenArtifactIds.add(artifactId);
      const weight = boundedInteger(
        entry.weight,
        `${entryPath}.weight`,
        "Artifact loot weight",
        1,
        ROGUELITE_ARTIFACT_LIMITS.weight
      );
      totalWeight += weight;
      return Object.freeze({ artifactId, weight });
    }).sort((left, right) => left.artifactId < right.artifactId ? -1 : left.artifactId > right.artifactId ? 1 : 0);
    if (totalWeight < 1 || totalWeight > ROGUELITE_ARTIFACT_LIMITS.totalTableWeight) {
      throw new RogueliteProfileValidationError(
        path,
        `Artifact loot table total weight exceeds the ${ROGUELITE_ARTIFACT_LIMITS.totalTableWeight} budget.`
      );
    }
    Object.defineProperty(bossLootTables, enemyTypeId, {
      value: Object.freeze({
        rolls,
        ...(noDropWeight === 0 ? {} : { noDropWeight }),
        entries: Object.freeze(entries)
      }),
      enumerable: true
    });
  }

  return Object.freeze({
    definitions: Object.freeze(definitions),
    towerSlots: Object.freeze(towerSlots),
    bossLootTables: Object.freeze(bossLootTables)
  });
}

/** Validate and detach an exact closed roguelite v2 profile. */
export function normalizeRogueliteProfileV2(value: unknown): RogueliteMechanicsProfileV2 {
  const profile = inspectRecord(value, "profile", "Roguelite profile");
  rejectUnknownFields(profile, REQUIRED_PROFILE_V2_FIELDS, "profile", "Roguelite profile");
  requireFields(profile, REQUIRED_PROFILE_V2_FIELDS, "profile", "Roguelite profile");
  const synergies = normalizeRogueliteProfileV1({ synergies: profile.synergies }).synergies;
  return Object.freeze({
    synergies,
    artifacts: normalizeRogueliteArtifactsV2(profile.artifacts)
  });
}

/** Validate and detach the exact closed wave-draft domain nested in roguelite v3. */
export function normalizeRogueliteDraftV3(value: unknown): RogueliteDraftDefinitionV3 {
  const draft = inspectRecord(value, "profile.draft", "Roguelite wave draft");
  rejectUnknownFields(draft, REQUIRED_DRAFT_FIELDS, "profile.draft", "Roguelite wave draft");
  requireFields(draft, REQUIRED_DRAFT_FIELDS, "profile.draft", "Roguelite wave draft");

  const authoredDefinitions = inspectRecord(
    draft.definitions,
    "profile.draft.definitions",
    "Draft card definitions"
  );
  const definitionIds = Object.keys(authoredDefinitions).sort();
  if (definitionIds.length > ROGUELITE_DRAFT_LIMITS.definitions) {
    throw new RogueliteProfileValidationError(
      "profile.draft.definitions",
      `Draft card definition count exceeds the ${ROGUELITE_DRAFT_LIMITS.definitions} item limit.`
    );
  }
  const definitions = Object.create(null) as Record<string, DraftCardDefinitionV3>;
  let totalEffects = 0;
  for (const cardId of definitionIds) {
    boundedString(cardId, `profile.draft.definitions.${cardId}`, "Draft card id", ROGUELITE_DRAFT_LIMITS.idUtf8Bytes);
    const path = `profile.draft.definitions.${cardId}`;
    const definition = inspectRecord(authoredDefinitions[cardId], path, `Draft card "${cardId}"`);
    rejectUnknownFields(definition, REQUIRED_DRAFT_DEFINITION_FIELDS, path, `Draft card "${cardId}"`);
    requireFields(definition, REQUIRED_DRAFT_DEFINITION_FIELDS, path, `Draft card "${cardId}"`);
    const authoredEffects = inspectArray(
      definition.effects,
      `${path}.effects`,
      ROGUELITE_DRAFT_LIMITS.effectsPerCard,
      "Draft card effects"
    );
    if (authoredEffects.length === 0) {
      throw new RogueliteProfileValidationError(`${path}.effects`, "Draft card must define at least one effect.");
    }
    totalEffects += authoredEffects.length;
    if (totalEffects > ROGUELITE_DRAFT_LIMITS.totalEffects) {
      throw new RogueliteProfileValidationError(
        `${path}.effects`,
        `Draft effect count exceeds the ${ROGUELITE_DRAFT_LIMITS.totalEffects} item budget.`
      );
    }
    const effects = authoredEffects.map((effectValue, effectIndex): DraftModifierEffectV3 => {
      const effectPath = `${path}.effects[${effectIndex}]`;
      const effect = inspectRecord(effectValue, effectPath, "Draft card effect");
      rejectUnknownFields(effect, REQUIRED_DRAFT_EFFECT_FIELDS, effectPath, "Draft card effect");
      requireFields(effect, REQUIRED_DRAFT_EFFECT_FIELDS, effectPath, "Draft card effect");
      if (effect.kind !== "modifier") {
        throw new RogueliteProfileValidationError(`${effectPath}.kind`, "Draft card effect kind must be modifier.");
      }
      const scopePath = `${effectPath}.scope`;
      const authoredScope = inspectRecord(effect.scope, scopePath, "Draft modifier scope");
      let scope: DraftScopeV3;
      if (authoredScope.kind === "all_towers") {
        rejectUnknownFields(authoredScope, ["kind"], scopePath, "All-towers draft modifier scope");
        requireFields(authoredScope, ["kind"], scopePath, "All-towers draft modifier scope");
        scope = Object.freeze({ kind: "all_towers" as const });
      } else if (authoredScope.kind === "tower_type") {
        rejectUnknownFields(authoredScope, ["kind", "towerTypeId"], scopePath, "Tower-type draft modifier scope");
        requireFields(authoredScope, ["kind", "towerTypeId"], scopePath, "Tower-type draft modifier scope");
        scope = Object.freeze({
          kind: "tower_type" as const,
          towerTypeId: boundedString(
            authoredScope.towerTypeId,
            `${scopePath}.towerTypeId`,
            "Draft tower type id",
            ROGUELITE_DRAFT_LIMITS.idUtf8Bytes
          )
        });
      } else if (authoredScope.kind === "tower_tag") {
        rejectUnknownFields(authoredScope, ["kind", "tag"], scopePath, "Tower-tag draft modifier scope");
        requireFields(authoredScope, ["kind", "tag"], scopePath, "Tower-tag draft modifier scope");
        scope = Object.freeze({
          kind: "tower_tag" as const,
          tag: boundedString(
            authoredScope.tag,
            `${scopePath}.tag`,
            "Draft tower tag",
            ROGUELITE_DRAFT_LIMITS.tagUtf8Bytes
          )
        });
      } else {
        throw new RogueliteProfileValidationError(`${scopePath}.kind`, "Draft modifier scope kind is unsupported.");
      }
      return Object.freeze({
        kind: "modifier" as const,
        scope,
        modifier: normalizeModifier(effect.modifier, `${effectPath}.modifier`)
      });
    });
    Object.defineProperty(definitions, cardId, {
      value: Object.freeze({
        label: boundedString(
          definition.label,
          `${path}.label`,
          "Draft card label",
          ROGUELITE_DRAFT_LIMITS.labelUtf8Bytes
        ),
        effects: Object.freeze(effects)
      }),
      enumerable: true
    });
  }

  const authoredPools = inspectRecord(draft.pools, "profile.draft.pools", "Draft pools");
  const poolIds = Object.keys(authoredPools).sort();
  if (poolIds.length > ROGUELITE_DRAFT_LIMITS.pools) {
    throw new RogueliteProfileValidationError(
      "profile.draft.pools",
      `Draft pool count exceeds the ${ROGUELITE_DRAFT_LIMITS.pools} item limit.`
    );
  }
  const pools = Object.create(null) as Record<string, DraftPoolV3>;
  for (const poolId of poolIds) {
    boundedString(poolId, `profile.draft.pools.${poolId}`, "Draft pool id", ROGUELITE_DRAFT_LIMITS.idUtf8Bytes);
    const path = `profile.draft.pools.${poolId}`;
    const pool = inspectRecord(authoredPools[poolId], path, `Draft pool "${poolId}"`);
    rejectUnknownFields(pool, REQUIRED_DRAFT_POOL_FIELDS, path, `Draft pool "${poolId}"`);
    requireFields(pool, REQUIRED_DRAFT_POOL_FIELDS, path, `Draft pool "${poolId}"`);
    const authoredEntries = inspectArray(
      pool.entries,
      `${path}.entries`,
      ROGUELITE_DRAFT_LIMITS.entriesPerPool,
      "Draft pool entries"
    );
    const seenCardIds = new Set<string>();
    let totalWeight = 0;
    const entries = authoredEntries.map((entryValue, entryIndex): DraftPoolEntryV3 => {
      const entryPath = `${path}.entries[${entryIndex}]`;
      const entry = inspectRecord(entryValue, entryPath, "Draft pool entry");
      rejectUnknownFields(entry, REQUIRED_DRAFT_POOL_ENTRY_FIELDS, entryPath, "Draft pool entry");
      requireFields(entry, REQUIRED_DRAFT_POOL_ENTRY_FIELDS, entryPath, "Draft pool entry");
      const cardId = boundedString(
        entry.cardId,
        `${entryPath}.cardId`,
        "Draft card id",
        ROGUELITE_DRAFT_LIMITS.idUtf8Bytes
      );
      if (seenCardIds.has(cardId)) {
        throw new RogueliteProfileValidationError(`${entryPath}.cardId`, `Duplicate draft pool card "${cardId}".`);
      }
      seenCardIds.add(cardId);
      const weight = boundedInteger(
        entry.weight,
        `${entryPath}.weight`,
        "Draft pool weight",
        1,
        ROGUELITE_DRAFT_LIMITS.weight
      );
      totalWeight += weight;
      return Object.freeze({ cardId, weight });
    }).sort((left, right) => left.cardId < right.cardId ? -1 : left.cardId > right.cardId ? 1 : 0);
    if (entries.length < ROGUELITE_DRAFT_LIMITS.offerSize) {
      throw new RogueliteProfileValidationError(
        `${path}.entries`,
        `Draft pool must contain at least ${ROGUELITE_DRAFT_LIMITS.offerSize} unique cards.`
      );
    }
    if (totalWeight > ROGUELITE_DRAFT_LIMITS.totalPoolWeight) {
      throw new RogueliteProfileValidationError(
        `${path}.entries`,
        `Draft pool total weight exceeds the ${ROGUELITE_DRAFT_LIMITS.totalPoolWeight} budget.`
      );
    }
    Object.defineProperty(pools, poolId, {
      value: Object.freeze({ entries: Object.freeze(entries) }),
      enumerable: true
    });
  }
  return Object.freeze({
    definitions: Object.freeze(definitions),
    pools: Object.freeze(pools),
    defaultPoolId: boundedString(
      draft.defaultPoolId,
      "profile.draft.defaultPoolId",
      "Default draft pool id",
      ROGUELITE_DRAFT_LIMITS.idUtf8Bytes
    )
  });
}

/** Validate and detach an exact closed roguelite v3 profile. */
export function normalizeRogueliteProfileV3(value: unknown): RogueliteMechanicsProfileV3 {
  const profile = inspectRecord(value, "profile", "Roguelite profile");
  rejectUnknownFields(
    profile,
    [...REQUIRED_PROFILE_V3_FIELDS, ...OPTIONAL_PROFILE_V3_FIELDS],
    "profile",
    "Roguelite profile"
  );
  requireFields(profile, REQUIRED_PROFILE_V3_FIELDS, "profile", "Roguelite profile");
  const synergies = normalizeRogueliteProfileV1({ synergies: profile.synergies }).synergies;
  return Object.freeze({
    synergies,
    ...(Object.prototype.hasOwnProperty.call(profile, "artifacts")
      ? { artifacts: normalizeRogueliteArtifactsV2(profile.artifacts) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(profile, "draft")
      ? { draft: normalizeRogueliteDraftV3(profile.draft) }
      : {})
  });
}

function hasValidDraftReferences(
  draft: RogueliteDraftDefinitionV3,
  content: GameContentRegistry,
  towerTagsByTypeId: Readonly<Record<string, readonly string[]>>
): boolean {
  if (!draft.pools[draft.defaultPoolId]) return false;
  const knownTags = new Set(Object.values(towerTagsByTypeId).flat());
  for (const definition of Object.values(draft.definitions)) {
    for (const effect of definition.effects) {
      if (effect.scope.kind === "tower_type" && !content.towers[effect.scope.towerTypeId]) return false;
      if (effect.scope.kind === "tower_tag" && !knownTags.has(effect.scope.tag)) return false;
    }
  }
  return Object.values(draft.pools).every((pool) => (
    pool.entries.every((entry) => draft.definitions[entry.cardId] !== undefined)
  ));
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

/** Resolve a detached profile only when the mission genuinely activates a supported roguelite version. */
export function resolveActiveRogueliteMechanics(
  content: GameContentRegistry,
  missionId: string
): ActiveRogueliteMechanics | undefined {
  try {
    const capability = content.missions[missionId]?.capabilities.roguelite;
    if (!capability?.active || capability.profileId === undefined) return undefined;
    const module = inspectRecord(
      ownData(ownData(content.mechanics, "modules"), "roguelite"),
      "module",
      "Roguelite mechanics module"
    );
    if ((module.schemaVersion !== 1 && module.schemaVersion !== 2 && module.schemaVersion !== 3)
      || module.enabled !== true) return undefined;
    rejectUnknownFields(module, ["schemaVersion", "enabled", "profiles"], "module", "Roguelite mechanics module");
    const profiles = inspectRecord(module.profiles, "module.profiles", "Roguelite mechanics profiles");
    const towerTagsByTypeId = normalizeTowerTagsByTypeId(content);
    if (module.schemaVersion === 1) {
      const profile = normalizeRogueliteProfileV1(ownData(profiles, capability.profileId));
      return Object.freeze({
        schemaVersion: 1 as const,
        profileId: capability.profileId,
        synergies: profile.synergies,
        towerTagsByTypeId
      });
    }
    if (module.schemaVersion === 2) {
      const profile = normalizeRogueliteProfileV2(ownData(profiles, capability.profileId));
      assertRogueliteV2ModifierBudget(profile);
      return Object.freeze({
        schemaVersion: 2 as const,
        profileId: capability.profileId,
        synergies: profile.synergies,
        artifacts: profile.artifacts,
        towerTagsByTypeId
      });
    }
    const profile = normalizeRogueliteProfileV3(ownData(profiles, capability.profileId));
    if (profile.artifacts) assertRogueliteV2ModifierBudget({ synergies: profile.synergies, artifacts: profile.artifacts });
    if (profile.draft && !hasValidDraftReferences(profile.draft, content, towerTagsByTypeId)) return undefined;
    assertRogueliteV3ModifierBudget(profile, content, missionId);
    return Object.freeze({
      schemaVersion: 3 as const,
      profileId: capability.profileId,
      synergies: profile.synergies,
      ...(profile.artifacts === undefined ? {} : { artifacts: profile.artifacts }),
      ...(profile.draft === undefined ? {} : { draft: profile.draft }),
      towerTagsByTypeId
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
  active: ActiveRogueliteMechanics,
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
