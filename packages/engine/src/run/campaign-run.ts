import type { GameSeed } from "../simulation/rng.js";
import { canonicalStringify } from "../simulation/stable-digest.js";

export const CAMPAIGN_RUN_SCHEMA_VERSION = 2 as const;

export const CAMPAIGN_RUN_LIMITS = Object.freeze({
  jsonBytes: 1_048_576,
  collectionEntries: 10_000,
  identifierCodeUnits: 256,
  seedCodeUnits: 4_096,
  maxDepth: 8,
  maxNodes: 50_000
});

export interface CampaignRunDeckEntryV1 {
  readonly instanceId: string;
  readonly cardId: string;
}

export interface CampaignRunArtifactEntryV1 {
  readonly instanceId: string;
  readonly artifactId: string;
}

export interface CampaignRunV1 {
  readonly version: 1;
  readonly seed: GameSeed;
  readonly nodeId: string | null;
  readonly deck: readonly CampaignRunDeckEntryV1[];
  readonly artifacts: readonly CampaignRunArtifactEntryV1[];
  readonly runResources: Readonly<Record<string, number>>;
}

export interface CampaignRunModuleInventoryEntryV2 {
  readonly instanceId: string;
  readonly moduleId: string;
}

export interface CampaignRunArsenalV2 {
  readonly moduleInventory: readonly CampaignRunModuleInventoryEntryV2[];
}

export interface CampaignRunV2 {
  readonly version: typeof CAMPAIGN_RUN_SCHEMA_VERSION;
  readonly seed: GameSeed;
  readonly nodeId: string | null;
  readonly deck: readonly CampaignRunDeckEntryV1[];
  readonly artifacts: readonly CampaignRunArtifactEntryV1[];
  readonly runResources: Readonly<Record<string, number>>;
  readonly arsenal: CampaignRunArsenalV2;
}

export type CampaignRun = CampaignRunV1 | CampaignRunV2;
export type CampaignRunSource = "v1" | "v2";

export interface CampaignRunMigration {
  readonly id: string;
  readonly description: string;
}

export interface DecodedCampaignRun {
  readonly run: CampaignRunV2;
  readonly source: CampaignRunSource;
  readonly migrations: readonly CampaignRunMigration[];
}

export class UnsupportedCampaignRunVersionError extends Error {
  readonly code = "UNSUPPORTED_CAMPAIGN_RUN_VERSION" as const;
  readonly version: number;

  constructor(version: number) {
    super(`Unsupported campaign run version "${version}".`);
    this.name = "UnsupportedCampaignRunVersionError";
    this.version = version;
  }
}

type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;
type Fields = ReadonlyMap<string, unknown>;

const ROOT_V1_KEYS = Object.freeze(["version", "seed", "nodeId", "deck", "artifacts", "runResources"] as const);
const ROOT_V2_KEYS = Object.freeze([...ROOT_V1_KEYS, "arsenal"] as const);
const DECK_ENTRY_KEYS = Object.freeze(["instanceId", "cardId"] as const);
const ARTIFACT_ENTRY_KEYS = Object.freeze(["instanceId", "artifactId"] as const);
const ARSENAL_KEYS = Object.freeze(["moduleInventory"] as const);
const MODULE_INVENTORY_ENTRY_KEYS = Object.freeze(["instanceId", "moduleId"] as const);
const EMPTY_MIGRATIONS: readonly CampaignRunMigration[] = Object.freeze([]);
const V1_TO_V2_MIGRATIONS: readonly CampaignRunMigration[] = Object.freeze([
  Object.freeze({
    id: "campaign-run-v1-to-v2",
    description: "Add an empty campaign-scoped arsenal module inventory."
  })
]);

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) bytes += 1;
    else if (codeUnit <= 0x7ff) bytes += 2;
    else if (
      codeUnit >= 0xd800
      && codeUnit <= 0xdbff
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function captureCampaignRunInput(value: unknown, detectFutureRootVersion: boolean): unknown {
  const ancestors = new WeakSet<object>();
  let bytes = 0;
  let nodes = 0;

  const emit = (fragment: string): void => {
    bytes += utf8ByteLength(fragment);
    if (bytes > CAMPAIGN_RUN_LIMITS.jsonBytes) {
      throw new Error(`Campaign run exceeds the ${CAMPAIGN_RUN_LIMITS.jsonBytes} byte budget.`);
    }
  };

  const visit = (current: unknown, depth: number): unknown => {
    if (depth > CAMPAIGN_RUN_LIMITS.maxDepth) throw new Error("Campaign run exceeds the nesting depth limit.");
    nodes += 1;
    if (nodes > CAMPAIGN_RUN_LIMITS.maxNodes) throw new Error("Campaign run exceeds the node budget.");

    if (current === null) {
      emit("null");
      return null;
    }
    if (typeof current === "string") {
      emit(JSON.stringify(current));
      return current;
    }
    if (typeof current === "boolean") {
      emit(current ? "true" : "false");
      return current;
    }
    if (typeof current === "number") {
      emit(Number.isFinite(current) ? (Object.is(current, -0) ? "0" : JSON.stringify(current)) : "null");
      return current;
    }
    if (typeof current !== "object") {
      throw new Error(`Campaign run rejects unsupported ${typeof current} values.`);
    }
    if (ancestors.has(current)) throw new Error("Campaign run rejects values containing a cycle.");

    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype) {
          throw new Error("Campaign run accepts plain arrays only.");
        }
        const descriptors = Object.getOwnPropertyDescriptors(current) as unknown as DescriptorMap;
        if (Object.getOwnPropertySymbols(descriptors).length > 0) {
          throw new Error("Campaign run rejects symbol keys.");
        }
        const lengthDescriptor = descriptors.length;
        const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
        if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
          throw new Error("Campaign run array length is invalid.");
        }
        if (length > CAMPAIGN_RUN_LIMITS.collectionEntries) {
          throw new Error(`Campaign run collection exceeds the ${CAMPAIGN_RUN_LIMITS.collectionEntries} entry limit.`);
        }
        const elementKeys = Object.keys(descriptors).filter((key) => key !== "length");
        if (elementKeys.length !== length) {
          throw new Error("Campaign run rejects sparse arrays or arrays with extra properties.");
        }
        const detached: unknown[] = [];
        emit("[");
        for (let index = 0; index < length; index += 1) {
          if (index > 0) emit(",");
          const descriptor = descriptors[String(index)];
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw new Error("Campaign run array entries must be enumerable data properties.");
          }
          detached.push(visit(descriptor.value, depth + 1));
        }
        emit("]");
        return detached;
      }

      if (Object.getPrototypeOf(current) !== Object.prototype) {
        throw new Error("Campaign run accepts plain objects with the standard prototype only.");
      }
      const descriptors = Object.getOwnPropertyDescriptors(current) as DescriptorMap;
      if (depth === 0 && detectFutureRootVersion) {
        const descriptor = descriptors.version;
        const version = descriptor && "value" in descriptor ? descriptor.value : undefined;
        if (typeof version === "number" && Number.isSafeInteger(version) && version > CAMPAIGN_RUN_SCHEMA_VERSION) {
          throw new UnsupportedCampaignRunVersionError(version);
        }
      }
      if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new Error("Campaign run rejects symbol keys.");
      }
      const keys = Object.keys(descriptors).sort();
      if (keys.length > CAMPAIGN_RUN_LIMITS.collectionEntries) {
        throw new Error(`Campaign run collection exceeds the ${CAMPAIGN_RUN_LIMITS.collectionEntries} entry limit.`);
      }
      for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new Error("Campaign run object fields must be enumerable data properties.");
        }
      }
      const detached: Record<string, unknown> = {};
      emit("{");
      for (let index = 0; index < keys.length; index += 1) {
        if (index > 0) emit(",");
        const key = keys[index]!;
        emit(JSON.stringify(key));
        emit(":");
        Object.defineProperty(detached, key, {
          value: visit(descriptors[key]!.value, depth + 1),
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
      emit("}");
      return detached;
    } finally {
      ancestors.delete(current);
    }
  };

  return visit(value, 0);
}

function objectFields(value: unknown, context: string): Fields {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${context} must be a plain object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as DescriptorMap;
  const fields = new Map<string, unknown>();
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error(`${context} fields must be enumerable data properties.`);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function exactFields(fields: Fields, keys: readonly string[], context: string): void {
  const keySet = new Set(keys);
  if (fields.size !== keys.length || keys.some((key) => !fields.has(key))) {
    throw new Error(`${context} contains missing or unsupported fields.`);
  }
  for (const key of fields.keys()) {
    if (!keySet.has(key)) throw new Error(`${context} contains unsupported field "${key}".`);
  }
}

function identifier(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > CAMPAIGN_RUN_LIMITS.identifierCodeUnits) {
    throw new Error(`${context} must be a non-empty identifier of at most ${CAMPAIGN_RUN_LIMITS.identifierCodeUnits} code units.`);
  }
  return value;
}

function normalizedSeed(value: unknown): GameSeed {
  if (typeof value === "string") {
    if (value.length > CAMPAIGN_RUN_LIMITS.seedCodeUnits) {
      throw new Error(`Campaign run seed exceeds ${CAMPAIGN_RUN_LIMITS.seedCodeUnits} code units.`);
    }
    return value;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value)) {
    throw new Error("Campaign run seed must be a string or a finite safe integer.");
  }
  return Object.is(value, -0) ? 0 : value;
}

function deckEntries(value: unknown): readonly CampaignRunDeckEntryV1[] {
  if (!Array.isArray(value)) throw new Error("Campaign run deck must be an array.");
  const seen = new Set<string>();
  const entries = value.map((entry, index) => {
    const fields = objectFields(entry, `Campaign run deck entry ${index}`);
    exactFields(fields, DECK_ENTRY_KEYS, `Campaign run deck entry ${index}`);
    const instanceId = identifier(fields.get("instanceId"), `Campaign run deck instanceId at ${index}`);
    if (seen.has(instanceId)) throw new Error(`Campaign run deck contains duplicate instanceId "${instanceId}".`);
    seen.add(instanceId);
    return Object.freeze({ instanceId, cardId: identifier(fields.get("cardId"), `Campaign run cardId at ${index}`) });
  });
  return Object.freeze(entries);
}

function artifactEntries(value: unknown): readonly CampaignRunArtifactEntryV1[] {
  if (!Array.isArray(value)) throw new Error("Campaign run artifacts must be an array.");
  const seen = new Set<string>();
  const entries = value.map((entry, index) => {
    const fields = objectFields(entry, `Campaign run artifact entry ${index}`);
    exactFields(fields, ARTIFACT_ENTRY_KEYS, `Campaign run artifact entry ${index}`);
    const instanceId = identifier(fields.get("instanceId"), `Campaign run artifact instanceId at ${index}`);
    if (seen.has(instanceId)) throw new Error(`Campaign run artifacts contain duplicate instanceId "${instanceId}".`);
    seen.add(instanceId);
    return Object.freeze({ instanceId, artifactId: identifier(fields.get("artifactId"), `Campaign run artifactId at ${index}`) });
  });
  return Object.freeze(entries);
}

function moduleInventoryEntries(value: unknown): readonly CampaignRunModuleInventoryEntryV2[] {
  if (!Array.isArray(value)) throw new Error("Campaign run arsenal moduleInventory must be an array.");
  const seen = new Set<string>();
  const entries = value.map((entry, index) => {
    const fields = objectFields(entry, `Campaign run module inventory entry ${index}`);
    exactFields(fields, MODULE_INVENTORY_ENTRY_KEYS, `Campaign run module inventory entry ${index}`);
    const instanceId = identifier(fields.get("instanceId"), `Campaign run module instanceId at ${index}`);
    if (seen.has(instanceId)) throw new Error(`Campaign run module inventory contains duplicate instanceId "${instanceId}".`);
    seen.add(instanceId);
    return Object.freeze({
      instanceId,
      moduleId: identifier(fields.get("moduleId"), `Campaign run moduleId at ${index}`)
    });
  });
  return Object.freeze(entries);
}

function arsenalState(value: unknown): CampaignRunArsenalV2 {
  const fields = objectFields(value, "Campaign run arsenal");
  exactFields(fields, ARSENAL_KEYS, "Campaign run arsenal");
  return Object.freeze({ moduleInventory: moduleInventoryEntries(fields.get("moduleInventory")) });
}

function resourceRecord(value: unknown): Readonly<Record<string, number>> {
  const fields = objectFields(value, "Campaign run runResources");
  const resources: Record<string, number> = {};
  for (const key of [...fields.keys()].sort()) {
    identifier(key, "Campaign run resource id");
    const amount = fields.get(key);
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      throw new Error(`Campaign run resource "${key}" must be a finite non-negative number.`);
    }
    Object.defineProperty(resources, key, {
      value: Object.is(amount, -0) ? 0 : amount,
      enumerable: true,
      configurable: false,
      writable: false
    });
  }
  return Object.freeze(resources);
}

function frozenRun(fields: {
  seed: GameSeed;
  nodeId: string | null;
  deck: readonly CampaignRunDeckEntryV1[];
  artifacts: readonly CampaignRunArtifactEntryV1[];
  runResources: Readonly<Record<string, number>>;
  arsenal: CampaignRunArsenalV2;
}): CampaignRunV2 {
  return Object.freeze({
    version: CAMPAIGN_RUN_SCHEMA_VERSION,
    seed: fields.seed,
    nodeId: fields.nodeId,
    deck: fields.deck,
    artifacts: fields.artifacts,
    runResources: fields.runResources,
    arsenal: fields.arsenal
  });
}

function validatedRun(value: unknown): DecodedCampaignRun {
  const captured = captureCampaignRunInput(value, true);
  const fields = objectFields(captured, "Campaign run");
  const version = fields.get("version");
  if (version !== 1 && version !== CAMPAIGN_RUN_SCHEMA_VERSION) {
    throw new Error(`Invalid campaign run version "${String(version)}".`);
  }
  exactFields(fields, version === 1 ? ROOT_V1_KEYS : ROOT_V2_KEYS, "Campaign run");
  const deck = deckEntries(fields.get("deck"));
  const artifacts = artifactEntries(fields.get("artifacts"));
  const runResources = resourceRecord(fields.get("runResources"));
  const arsenal = version === 1
    ? Object.freeze({ moduleInventory: Object.freeze([]) })
    : arsenalState(fields.get("arsenal"));
  const aggregateEntries = deck.length + artifacts.length + arsenal.moduleInventory.length
    + Object.keys(runResources).length;
  if (aggregateEntries > CAMPAIGN_RUN_LIMITS.collectionEntries) {
    throw new Error(`Campaign run collections exceed the aggregate ${CAMPAIGN_RUN_LIMITS.collectionEntries} entry limit.`);
  }
  const rawNodeId = fields.get("nodeId");
  const nodeId = rawNodeId === null ? null : identifier(rawNodeId, "Campaign run nodeId");
  const run = frozenRun({
    seed: normalizedSeed(fields.get("seed")),
    nodeId,
    deck,
    artifacts,
    runResources,
    arsenal
  });
  return Object.freeze({
    run,
    source: version === 1 ? "v1" as const : "v2" as const,
    migrations: version === 1 ? V1_TO_V2_MIGRATIONS : EMPTY_MIGRATIONS
  });
}

export function createCampaignRun(seed: GameSeed): CampaignRunV2 {
  return frozenRun({
    seed: normalizedSeed(seed),
    nodeId: null,
    deck: Object.freeze([]),
    artifacts: Object.freeze([]),
    runResources: Object.freeze({}),
    arsenal: Object.freeze({ moduleInventory: Object.freeze([]) })
  });
}

export function decodeCampaignRun(value: unknown): DecodedCampaignRun {
  return validatedRun(value);
}

export function importCampaignRun(source: string): DecodedCampaignRun {
  if (typeof source !== "string") throw new Error("Campaign run JSON source must be a string.");
  if (utf8ByteLength(source) > CAMPAIGN_RUN_LIMITS.jsonBytes) {
    throw new Error(`Campaign run JSON exceeds the ${CAMPAIGN_RUN_LIMITS.jsonBytes} byte budget.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (cause) {
    throw new Error("Campaign run JSON is malformed.", { cause });
  }
  return decodeCampaignRun(parsed);
}

export function exportCampaignRun(run: CampaignRunV1 | CampaignRunV2): string {
  const captured = validatedRun(run).run;
  return canonicalStringify(captured, {
    maxDepth: CAMPAIGN_RUN_LIMITS.maxDepth,
    maxNodes: CAMPAIGN_RUN_LIMITS.maxNodes,
    maxBytes: CAMPAIGN_RUN_LIMITS.jsonBytes
  });
}
