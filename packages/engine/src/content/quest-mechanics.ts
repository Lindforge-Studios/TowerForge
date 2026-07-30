import type { GameContentRegistry } from "./registry.js";
import type { GameSeed } from "../simulation/rng.js";
import { SeededRng } from "../simulation/rng.js";
import { resolveCapabilitySet } from "./mechanics.js";

export const QUEST_LIMITS = Object.freeze({
  selectionCount: 3,
  definitions: 256,
  weight: 1_000_000,
  count: 1_000_000,
  waves: 10_000,
  idUtf8Bytes: 128,
  labelUtf8Bytes: 256
});

export const QUEST_SOURCE_KINDS = Object.freeze([
  "tower", "ability", "tower_script", "status", "reaction"
] as const);
export const QUEST_SHIELD_SCOPES = Object.freeze(["tower", "hero", "any"] as const);

export type QuestSourceKindV1 = (typeof QUEST_SOURCE_KINDS)[number];
export type QuestShieldScopeV1 = (typeof QUEST_SHIELD_SCOPES)[number];

export interface QuestKillWithSourceObjectiveV1 {
  readonly kind: "kill_with_source";
  readonly count: number;
  readonly source: { readonly kind: QuestSourceKindV1; readonly id: string };
}

export interface QuestPreserveShieldObjectiveV1 {
  readonly kind: "preserve_shield";
  readonly waves: number;
  readonly scope: QuestShieldScopeV1;
}

export type QuestObjectiveV1 = QuestKillWithSourceObjectiveV1 | QuestPreserveShieldObjectiveV1;

export interface QuestDefinitionV1 {
  readonly label: string;
  readonly weight: number;
  readonly objective: QuestObjectiveV1;
}

export interface QuestProfileV1 {
  readonly selectionCount: number;
  readonly definitions: Readonly<Record<string, QuestDefinitionV1>>;
}

export interface ActiveQuestMechanicsV1 extends QuestProfileV1 {
  readonly schemaVersion: 1;
  readonly profileId: string;
}

export interface QuestSelectionV1 {
  readonly questId: string;
  readonly definition: QuestDefinitionV1;
}

export class QuestProfileValidationError extends Error {}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function dataRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new QuestProfileValidationError(`${path} must be a plain object.`);
  }
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>;
  } catch {
    throw new QuestProfileValidationError(`${path} could not be inspected safely.`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new QuestProfileValidationError(`${path} must be a plain object with no custom prototype.`);
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw new QuestProfileValidationError(`${path} rejects symbol fields.`);
  }
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new QuestProfileValidationError(`${path}.${key} must be an enumerable own data property; accessors are forbidden.`);
    }
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}

function closed(record: Record<string, unknown>, fields: readonly string[], path: string): void {
  const expected = new Set(fields);
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) throw new QuestProfileValidationError(`${path} is closed; unknown field "${key}".`);
  }
  for (const key of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new QuestProfileValidationError(`${path}.${key} is required.`);
    }
  }
}

function boundedString(value: unknown, path: string, maxBytes: number): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()
    || /[\u0000-\u001f\u007f]/.test(value) || utf8Bytes(value) > maxBytes) {
    throw new QuestProfileValidationError(`${path} must be a bounded non-empty UTF-8 string of at most ${maxBytes} bytes.`);
  }
  return value;
}

function boundedInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new QuestProfileValidationError(`${path} must be an integer in ${minimum}..${maximum}.`);
  }
  return value as number;
}

function normalizeObjective(value: unknown, path: string): QuestObjectiveV1 {
  const objective = dataRecord(value, path);
  if (objective.kind === "kill_with_source") {
    closed(objective, ["kind", "count", "source"], path);
    const source = dataRecord(objective.source, `${path}.source`);
    closed(source, ["kind", "id"], `${path}.source`);
    if (typeof source.kind !== "string" || !QUEST_SOURCE_KINDS.includes(source.kind as QuestSourceKindV1)) {
      throw new QuestProfileValidationError(`${path}.source.kind is unsupported.`);
    }
    return Object.freeze({
      kind: "kill_with_source",
      count: boundedInteger(objective.count, `${path}.count`, 1, QUEST_LIMITS.count),
      source: Object.freeze({
        kind: source.kind as QuestSourceKindV1,
        id: boundedString(source.id, `${path}.source.id`, QUEST_LIMITS.idUtf8Bytes)
      })
    });
  }
  if (objective.kind === "preserve_shield") {
    closed(objective, ["kind", "waves", "scope"], path);
    if (typeof objective.scope !== "string" || !QUEST_SHIELD_SCOPES.includes(objective.scope as QuestShieldScopeV1)) {
      throw new QuestProfileValidationError(`${path}.scope is unsupported.`);
    }
    return Object.freeze({
      kind: "preserve_shield",
      waves: boundedInteger(objective.waves, `${path}.waves`, 1, QUEST_LIMITS.waves),
      scope: objective.scope as QuestShieldScopeV1
    });
  }
  throw new QuestProfileValidationError(`${path}.kind is unsupported.`);
}

/** Parse a closed quest profile into detached, binary-ordered, deeply frozen own data. */
export function normalizeQuestProfileV1(value: unknown): QuestProfileV1 {
  const profile = dataRecord(value, "quest profile");
  closed(profile, ["selectionCount", "definitions"], "quest profile");
  const definitionsInput = dataRecord(profile.definitions, "quest profile.definitions");
  const definitionIds = Object.keys(definitionsInput).sort();
  if (definitionIds.length === 0 || definitionIds.length > QUEST_LIMITS.definitions) {
    throw new QuestProfileValidationError(`quest profile.definitions must contain 1..${QUEST_LIMITS.definitions} definitions.`);
  }
  const selectionCount = boundedInteger(
    profile.selectionCount,
    "quest profile.selectionCount",
    1,
    QUEST_LIMITS.selectionCount
  );
  const definitions = Object.create(null) as Record<string, QuestDefinitionV1>;
  for (const questId of definitionIds) {
    boundedString(questId, "quest definition id", QUEST_LIMITS.idUtf8Bytes);
    const path = `quest profile.definitions.${questId}`;
    const definition = dataRecord(definitionsInput[questId], path);
    closed(definition, ["label", "weight", "objective"], path);
    Object.defineProperty(definitions, questId, {
      value: Object.freeze({
        label: boundedString(definition.label, `${path}.label`, QUEST_LIMITS.labelUtf8Bytes),
        weight: boundedInteger(definition.weight, `${path}.weight`, 1, QUEST_LIMITS.weight),
        objective: normalizeObjective(definition.objective, `${path}.objective`)
      }),
      enumerable: true
    });
  }
  return Object.freeze({ selectionCount, definitions: Object.freeze(definitions) });
}

function questSelectionSeed(seed: GameSeed): GameSeed {
  if (typeof seed === "number" && (!Number.isSafeInteger(seed) || !Number.isFinite(seed))) {
    throw new QuestProfileValidationError("Quest selection seed must be a string or finite safe integer.");
  }
  if (typeof seed !== "number" && typeof seed !== "string") {
    throw new QuestProfileValidationError("Quest selection seed must be a string or finite safe integer.");
  }
  return `towerforge:quests:v1:${typeof seed === "number" ? `n:${seed}` : `s:${seed}`}`;
}

function normalizeSelectionOptions(value: unknown): Readonly<{
  seed: GameSeed;
  eligibleDefinitionIds?: readonly string[];
}> {
  const options = dataRecord(value, "quest selection options");
  for (const key of Object.keys(options)) {
    if (key !== "seed" && key !== "eligibleDefinitionIds") {
      throw new QuestProfileValidationError(`quest selection options is closed; unknown field "${key}".`);
    }
  }
  if (!Object.prototype.hasOwnProperty.call(options, "seed")) {
    throw new QuestProfileValidationError("quest selection options.seed is required.");
  }
  const seed = options.seed;
  questSelectionSeed(seed as GameSeed);
  if (!Object.prototype.hasOwnProperty.call(options, "eligibleDefinitionIds")) {
    return Object.freeze({ seed: seed as GameSeed });
  }
  const valueIds = options.eligibleDefinitionIds;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    if (!Array.isArray(valueIds) || Object.getPrototypeOf(valueIds) !== Array.prototype) {
      throw new Error();
    }
    descriptors = Object.getOwnPropertyDescriptors(valueIds) as unknown as Record<PropertyKey, PropertyDescriptor>;
  } catch {
    throw new QuestProfileValidationError("quest selection options.eligibleDefinitionIds must be a dense plain array.");
  }
  const arrayLength = descriptors.length?.value;
  if (!Number.isSafeInteger(arrayLength) || arrayLength < 0
    || Object.getOwnPropertySymbols(descriptors).length > 0
    || arrayLength > QUEST_LIMITS.definitions
    || Object.keys(descriptors).some((key) => key !== "length" && !/^(0|[1-9]\d*)$/.test(key))
    || Object.keys(descriptors).filter((key) => key !== "length").length !== arrayLength) {
    throw new QuestProfileValidationError("quest selection options.eligibleDefinitionIds must be a bounded dense plain array.");
  }
  const ids: string[] = [];
  for (let index = 0; index < arrayLength; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new QuestProfileValidationError("quest selection options.eligibleDefinitionIds entries must be own data.");
    }
    ids.push(boundedString(
      descriptor.value,
      `quest selection options.eligibleDefinitionIds[${index}]`,
      QUEST_LIMITS.idUtf8Bytes
    ));
  }
  if (new Set(ids).size !== ids.length) {
    throw new QuestProfileValidationError("eligibleDefinitionIds must be unique.");
  }
  return Object.freeze({ seed: seed as GameSeed, eligibleDefinitionIds: Object.freeze(ids) });
}

/** Deterministic weighted sampling without replacement over a canonical eligible set. */
export function selectProceduralQuestsV1(
  profileInput: QuestProfileV1,
  options: { readonly seed: GameSeed; readonly eligibleDefinitionIds?: readonly string[] }
): readonly QuestSelectionV1[] {
  const profile = normalizeQuestProfileV1(profileInput);
  const normalizedOptions = normalizeSelectionOptions(options);
  const allowed = normalizedOptions.eligibleDefinitionIds === undefined
    ? undefined
    : new Set(normalizedOptions.eligibleDefinitionIds);
  const candidates = Object.keys(profile.definitions)
    .filter((questId) => allowed === undefined || allowed.has(questId))
    .map((questId) => ({ questId, definition: profile.definitions[questId]! }));
  if (allowed) {
    const unknown = [...allowed].filter((questId) => !Object.prototype.hasOwnProperty.call(profile.definitions, questId)).sort();
    if (unknown.length > 0) throw new QuestProfileValidationError(`Unknown eligible quest id "${unknown[0]}".`);
  }
  const rng = new SeededRng(questSelectionSeed(normalizedOptions.seed));
  const selected: QuestSelectionV1[] = [];
  while (candidates.length > 0 && selected.length < profile.selectionCount) {
    const totalWeight = candidates.reduce((total, candidate) => total + candidate.definition.weight, 0);
    let cursor = rng.nextInt(totalWeight);
    let selectedIndex = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      if (cursor < candidates[index]!.definition.weight) {
        selectedIndex = index;
        break;
      }
      cursor -= candidates[index]!.definition.weight;
    }
    const [entry] = candidates.splice(selectedIndex, 1);
    selected.push(Object.freeze({ questId: entry!.questId, definition: entry!.definition }));
  }
  selected.sort((left, right) => left.questId < right.questId ? -1 : left.questId > right.questId ? 1 : 0);
  return Object.freeze(selected);
}

export function resolveActiveQuestMechanics(
  content: GameContentRegistry,
  missionId: string
): ActiveQuestMechanicsV1 | undefined {
  const mission = content.missions[missionId];
  const capability = mission ? resolveCapabilitySet(content.mechanics, mission.mechanics).quests : undefined;
  if (!mission || !capability?.active || !capability.profileId) return undefined;
  const module = content.mechanics.modules.quests;
  if (!module || module.schemaVersion !== 1 || module.enabled !== true) return undefined;
  const profile = module.profiles[capability.profileId];
  if (profile === undefined) return undefined;
  try {
    return Object.freeze({
      schemaVersion: 1,
      profileId: capability.profileId,
      ...normalizeQuestProfileV1(profile)
    });
  } catch {
    return undefined;
  }
}
