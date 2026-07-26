import {
  resolveActiveRogueliteMechanics,
  type ActiveRogueliteMechanicsV4
} from "../content/roguelite-mechanics.js";
import type {
  GameContentRegistry,
  WorldCampaignBattleNodeV1,
  WorldCampaignDefinitionV1,
  WorldCampaignNodeV1,
  WorldCampaignStructuralNodeV1,
  WorldMapCatalog
} from "../content/registry.js";
import {
  recordPlayerMissionClear,
  type PlayerProfileFailureCode,
  type PlayerProfileV3
} from "../profile/player-profile.js";
import { decodeCampaignRun, type CampaignRunV1 } from "./campaign-run.js";

export const WORLD_CAMPAIGN_SCHEMA = Object.freeze({
  supportedSchemaVersions: Object.freeze([1] as const),
  nodeTypes: Object.freeze(["battle", "elite", "merchant", "event", "boss"] as const),
  limits: Object.freeze({
    jsonBytes: 1_048_576,
    nodes: 1_024,
    edges: 8_192,
    entryNodes: 64,
    idUtf8Bytes: 128,
    labelUtf8Bytes: 256
  })
});

const WORLD_CAMPAIGN_LIMITS = WORLD_CAMPAIGN_SCHEMA.limits;
const ROOT_FIELDS = Object.freeze(["schemaVersion", "rogueliteProfileId", "entryNodeIds", "nodes"] as const);
const BATTLE_NODE_FIELDS = Object.freeze([
  "id", "type", "missionId", "regionId", "x", "y", "difficulty", "nextNodeIds"
] as const);
const STRUCTURAL_NODE_FIELDS = Object.freeze([
  "id", "type", "label", "regionId", "x", "y", "difficulty", "nextNodeIds"
] as const);
const BATTLE_NODE_TYPES = new Set<string>(["battle", "elite", "boss"]);
const STRUCTURAL_NODE_TYPES = new Set<string>(["merchant", "event"]);

export class WorldCampaignValidationError extends Error {
  readonly fieldPath: string;

  constructor(fieldPath: string, message: string) {
    super(message);
    this.name = "WorldCampaignValidationError";
    this.fieldPath = fieldPath;
  }
}

export type ResolvedWorldCampaignNodeV1 = WorldCampaignNodeV1;

export interface ResolvedWorldCampaignV1 {
  readonly schemaVersion: 1;
  readonly source: "authored" | "legacy";
  readonly rogueliteProfileId: string | null;
  readonly entryNodeIds: readonly string[];
  readonly nodes: readonly ResolvedWorldCampaignNodeV1[];
}

type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;
type Fields = ReadonlyMap<string, unknown>;

function binaryCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isBattleNode(node: WorldCampaignNodeV1): node is WorldCampaignBattleNodeV1 {
  return node.type === "battle" || node.type === "elite" || node.type === "boss";
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function jsonStringByteLength(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0x22 || codeUnit === 0x5c || codeUnit === 0x08 || codeUnit === 0x09
      || codeUnit === 0x0a || codeUnit === 0x0c || codeUnit === 0x0d) {
      bytes += 2;
    } else if (codeUnit < 0x20 || (codeUnit >= 0xd800 && codeUnit <= 0xdfff)) {
      const next = value.charCodeAt(index + 1);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (codeUnit <= 0x7f) bytes += 1;
    else if (codeUnit <= 0x7ff) bytes += 2;
    else bytes += 3;
  }
  return bytes;
}

/** Detach hostile authored data without invoking accessors, iterators, or serialization hooks. */
function captureCampaignInput(value: unknown): unknown {
  const ancestors = new WeakSet<object>();
  let bytes = 0;
  let visited = 0;
  const maximumVisited = WORLD_CAMPAIGN_LIMITS.edges * 4 + WORLD_CAMPAIGN_LIMITS.nodes * 16 + 1_024;

  const addBytes = (amount: number): void => {
    bytes += amount;
    if (bytes > WORLD_CAMPAIGN_LIMITS.jsonBytes) {
      throw new WorldCampaignValidationError(
        "worldMap.campaign",
        `World campaign exceeds the ${WORLD_CAMPAIGN_LIMITS.jsonBytes} byte limit.`
      );
    }
  };

  const visit = (current: unknown, path: string, depth: number): unknown => {
    visited += 1;
    if (visited > maximumVisited || depth > 12) {
      throw new WorldCampaignValidationError(path, "World campaign exceeds its structural budget.");
    }
    if (current === null) {
      addBytes(4);
      return null;
    }
    if (typeof current === "string") {
      addBytes(jsonStringByteLength(current));
      return current;
    }
    if (typeof current === "number" || typeof current === "boolean") {
      addBytes(String(current).length);
      return current;
    }
    if (typeof current !== "object") {
      throw new WorldCampaignValidationError(path, `World campaign rejects ${typeof current} values.`);
    }
    if (ancestors.has(current)) throw new WorldCampaignValidationError(path, "World campaign rejects cyclic data.");

    let prototype: object | null;
    let descriptors: DescriptorMap;
    try {
      prototype = Object.getPrototypeOf(current);
      descriptors = Object.getOwnPropertyDescriptors(current) as DescriptorMap;
    } catch {
      throw new WorldCampaignValidationError(path, "World campaign data could not be inspected safely.");
    }
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        if (prototype !== Array.prototype || Object.getOwnPropertySymbols(descriptors).length > 0) {
          throw new WorldCampaignValidationError(path, "World campaign arrays must be plain own-data arrays.");
        }
        const lengthDescriptor = descriptors.length;
        const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
        if (!Number.isSafeInteger(length) || (length as number) < 0 || (length as number) > WORLD_CAMPAIGN_LIMITS.edges + 1) {
          throw new WorldCampaignValidationError(path, "World campaign array exceeds its item limit.");
        }
        const keys = Reflect.ownKeys(descriptors).filter((key) => key !== "length");
        if (keys.length !== length) {
          throw new WorldCampaignValidationError(path, "World campaign arrays must be dense and contain no extra fields.");
        }
        const result: unknown[] = [];
        addBytes(2);
        for (let index = 0; index < (length as number); index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor?.enumerable || !("value" in descriptor)) {
            throw new WorldCampaignValidationError(`${path}[${index}]`, "World campaign arrays reject sparse entries and accessors.");
          }
          addBytes(index === 0 ? 0 : 1);
          result.push(visit(descriptor.value, `${path}[${index}]`, depth + 1));
        }
        return result;
      }
      if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new WorldCampaignValidationError(path, "World campaign objects must be plain own-data objects.");
      }
      const result = Object.create(null) as Record<string, unknown>;
      addBytes(2);
      let index = 0;
      for (const key of Object.keys(descriptors).sort(binaryCompare)) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new WorldCampaignValidationError(`${path}.${key}`, "World campaign fields must be enumerable own data.");
        }
        addBytes((index === 0 ? 0 : 1) + jsonStringByteLength(key) + 1);
        Object.defineProperty(result, key, {
          value: visit(descriptor.value, `${path}.${key}`, depth + 1),
          enumerable: true
        });
        index += 1;
      }
      return result;
    } finally {
      ancestors.delete(current);
    }
  };

  return visit(value, "worldMap.campaign", 0);
}

function fields(value: unknown, path: string, label: string): Fields {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new WorldCampaignValidationError(path, `${label} must be a plain object.`);
  }
  const result = new Map<string, unknown>();
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !("value" in descriptor)) {
      throw new WorldCampaignValidationError(`${path}.${key}`, `${label} fields must be enumerable own data.`);
    }
    result.set(key, descriptor.value);
  }
  return result;
}

function exactFields(actual: Fields, expected: readonly string[], path: string, label: string): void {
  for (const key of actual.keys()) {
    if (!expected.includes(key)) {
      throw new WorldCampaignValidationError(`${path}.${key}`, `${label} contains unknown field "${key}".`);
    }
  }
  for (const key of expected) {
    if (!actual.has(key)) throw new WorldCampaignValidationError(`${path}.${key}`, `${label} field "${key}" is required.`);
  }
}

function denseArray(value: unknown, path: string, maximum: number, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new WorldCampaignValidationError(path, `${label} must be an array.`);
  if (value.length > maximum) {
    throw new WorldCampaignValidationError(path, `${label} exceeds the ${maximum} item limit.`);
  }
  return value;
}

function boundedId(value: unknown, path: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || utf8ByteLength(value) > WORLD_CAMPAIGN_LIMITS.idUtf8Bytes) {
    throw new WorldCampaignValidationError(
      path,
      `${label} must be non-empty and no longer than ${WORLD_CAMPAIGN_LIMITS.idUtf8Bytes} UTF-8 bytes.`
    );
  }
  return value;
}

function boundedLabel(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || utf8ByteLength(value) > WORLD_CAMPAIGN_LIMITS.labelUtf8Bytes) {
    throw new WorldCampaignValidationError(
      path,
      `Campaign node label must be non-empty and no longer than ${WORLD_CAMPAIGN_LIMITS.labelUtf8Bytes} UTF-8 bytes.`
    );
  }
  return value;
}

function finiteCoordinate(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WorldCampaignValidationError(path, "Campaign node coordinate must be finite.");
  }
  return Object.is(value, -0) ? 0 : value;
}

function difficulty(value: unknown, path: string): 1 | 2 | 3 | 4 | 5 {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 5) {
    throw new WorldCampaignValidationError(path, "Campaign node difficulty must be an integer from 1 to 5.");
  }
  return value as 1 | 2 | 3 | 4 | 5;
}

function idArray(value: unknown, path: string, maximum: number, label: string): readonly string[] {
  const source = denseArray(value, path, maximum, label);
  const seen = new Set<string>();
  const result: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const id = boundedId(source[index], `${path}[${index}]`, `${label} id`);
    if (seen.has(id)) throw new WorldCampaignValidationError(`${path}[${index}]`, `${label} contains duplicate id "${id}".`);
    seen.add(id);
    result.push(id);
  }
  result.sort(binaryCompare);
  return Object.freeze(result);
}

function freezeCampaign(fieldsToFreeze: {
  source: "authored" | "legacy";
  rogueliteProfileId: string | null;
  entryNodeIds: readonly string[];
  nodes: readonly WorldCampaignNodeV1[];
}): ResolvedWorldCampaignV1 {
  return Object.freeze({
    schemaVersion: 1 as const,
    source: fieldsToFreeze.source,
    rogueliteProfileId: fieldsToFreeze.rogueliteProfileId,
    entryNodeIds: fieldsToFreeze.entryNodeIds,
    nodes: fieldsToFreeze.nodes
  });
}

function validateGraphTopology(entryNodeIds: readonly string[], nodes: readonly WorldCampaignNodeV1[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  for (const entryNodeId of entryNodeIds) {
    if (!byId.has(entryNodeId)) {
      throw new WorldCampaignValidationError(
        "worldMap.campaign.entryNodeIds",
        `Campaign entry references unknown node "${entryNodeId}".`
      );
    }
  }
  for (const node of nodes) {
    for (const nextNodeId of node.nextNodeIds) {
      if (!byId.has(nextNodeId)) {
        throw new WorldCampaignValidationError(
          `worldMap.campaign.nodes.${node.id}.nextNodeIds`,
          `Campaign nextNodeIds references unknown node "${nextNodeId}".`
        );
      }
      if (nextNodeId === node.id) {
        throw new WorldCampaignValidationError(
          `worldMap.campaign.nodes.${node.id}.nextNodeIds`,
          `Campaign node "${node.id}" cannot have a self edge.`
        );
      }
    }
  }

  const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  for (const node of nodes) {
    for (const nextNodeId of node.nextNodeIds) indegree.set(nextNodeId, (indegree.get(nextNodeId) ?? 0) + 1);
  }
  const ready = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id).sort(binaryCompare);
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.shift()!;
    visited += 1;
    for (const nextNodeId of byId.get(id)!.nextNodeIds) {
      const next = (indegree.get(nextNodeId) ?? 0) - 1;
      indegree.set(nextNodeId, next);
      if (next === 0) {
        ready.push(nextNodeId);
        ready.sort(binaryCompare);
      }
    }
  }
  if (visited !== nodes.length) {
    throw new WorldCampaignValidationError("worldMap.campaign.nodes", "World campaign graph contains a cycle.");
  }

  const reachable = new Set<string>();
  const pending = [...entryNodeIds];
  while (pending.length > 0) {
    const id = pending.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    pending.push(...byId.get(id)!.nextNodeIds);
  }
  const unreachable = nodes.map((node) => node.id).filter((id) => !reachable.has(id)).sort(binaryCompare);
  if (unreachable.length > 0) {
    throw new WorldCampaignValidationError(
      `worldMap.campaign.nodes.${unreachable[0]}`,
      `Campaign node "${unreachable[0]}" is not reachable from an entry node.`
    );
  }
}

/** Validate, normalize, sort, and deeply freeze an authored campaign graph. */
export function normalizeAuthoredWorldCampaignV1(
  value: unknown,
  content?: GameContentRegistry
): ResolvedWorldCampaignV1 {
  const captured = captureCampaignInput(value);
  const root = fields(captured, "worldMap.campaign", "World campaign");
  exactFields(root, ROOT_FIELDS, "worldMap.campaign", "World campaign");
  if (root.get("schemaVersion") !== 1) {
    throw new WorldCampaignValidationError(
      "worldMap.campaign.schemaVersion",
      "World campaign schema version is unsupported; only version 1 is supported."
    );
  }
  const rogueliteProfileId = boundedId(
    root.get("rogueliteProfileId"),
    "worldMap.campaign.rogueliteProfileId",
    "Roguelite profile id"
  );
  const entryNodeIds = idArray(
    root.get("entryNodeIds"),
    "worldMap.campaign.entryNodeIds",
    WORLD_CAMPAIGN_LIMITS.entryNodes,
    "Campaign entry nodes"
  );
  if (entryNodeIds.length === 0) {
    throw new WorldCampaignValidationError("worldMap.campaign.entryNodeIds", "World campaign needs at least one entry node.");
  }
  const authoredNodes = denseArray(
    root.get("nodes"),
    "worldMap.campaign.nodes",
    WORLD_CAMPAIGN_LIMITS.nodes,
    "Campaign nodes"
  );
  if (authoredNodes.length === 0) {
    throw new WorldCampaignValidationError("worldMap.campaign.nodes", "World campaign needs at least one node.");
  }
  const seenNodeIds = new Set<string>();
  let edgeCount = 0;
  const nodes = authoredNodes.map((valueAtNode, index): WorldCampaignNodeV1 => {
    const path = `worldMap.campaign.nodes[${index}]`;
    const node = fields(valueAtNode, path, "Campaign node");
    const nodeType = node.get("type");
    const isBattle = typeof nodeType === "string" && BATTLE_NODE_TYPES.has(nodeType);
    const isStructural = typeof nodeType === "string" && STRUCTURAL_NODE_TYPES.has(nodeType);
    if (!isBattle && !isStructural) {
      throw new WorldCampaignValidationError(`${path}.type`, `Campaign node type "${String(nodeType)}" is unsupported.`);
    }
    exactFields(node, isBattle ? BATTLE_NODE_FIELDS : STRUCTURAL_NODE_FIELDS, path, "Campaign node");
    const id = boundedId(node.get("id"), `${path}.id`, "Campaign node id");
    if (seenNodeIds.has(id)) {
      throw new WorldCampaignValidationError(`${path}.id`, `Campaign contains duplicate node id "${id}".`);
    }
    seenNodeIds.add(id);
    const nextNodeIds = idArray(
      node.get("nextNodeIds"),
      `${path}.nextNodeIds`,
      WORLD_CAMPAIGN_LIMITS.edges,
      "Campaign nextNodeIds"
    );
    edgeCount += nextNodeIds.length;
    if (edgeCount > WORLD_CAMPAIGN_LIMITS.edges) {
      throw new WorldCampaignValidationError(
        `${path}.nextNodeIds`,
        `World campaign edge count exceeds the ${WORLD_CAMPAIGN_LIMITS.edges} edge limit.`
      );
    }
    const common = {
      id,
      regionId: boundedId(node.get("regionId"), `${path}.regionId`, "Campaign region id"),
      x: finiteCoordinate(node.get("x"), `${path}.x`),
      y: finiteCoordinate(node.get("y"), `${path}.y`),
      difficulty: difficulty(node.get("difficulty"), `${path}.difficulty`),
      nextNodeIds
    };
    if (isBattle) {
      return Object.freeze({
        ...common,
        type: nodeType as WorldCampaignBattleNodeV1["type"],
        missionId: boundedId(node.get("missionId"), `${path}.missionId`, "Campaign mission id")
      });
    }
    return Object.freeze({
      ...common,
      type: nodeType as WorldCampaignStructuralNodeV1["type"],
      label: boundedLabel(node.get("label"), `${path}.label`)
    });
  }).sort((left, right) => binaryCompare(left.id, right.id));

  validateGraphTopology(entryNodeIds, nodes);
  if (content) {
    const regionIds = new Set(content.worldMap.regions.map((region) => region.id));
    for (const node of nodes) {
      if (!regionIds.has(node.regionId)) {
        throw new WorldCampaignValidationError(
          `worldMap.campaign.nodes.${node.id}.regionId`,
          `Campaign node "${node.id}" references unknown region "${node.regionId}".`
        );
      }
      if (!isBattleNode(node)) continue;
      const mission = content.missions[node.missionId];
      if (!mission) {
        throw new WorldCampaignValidationError(
          `worldMap.campaign.nodes.${node.id}.missionId`,
          `Campaign node "${node.id}" references unknown mission "${node.missionId}".`
        );
      }
      if (mission.mechanics?.profiles?.roguelite !== rogueliteProfileId) {
        throw new WorldCampaignValidationError(
          `worldMap.campaign.nodes.${node.id}.missionId`,
          `Campaign mission "${node.missionId}" does not select roguelite profile "${rogueliteProfileId}".`
        );
      }
    }
  }
  return freezeCampaign({
    source: "authored",
    rogueliteProfileId,
    entryNodeIds,
    nodes: Object.freeze(nodes)
  });
}

/** Read-only compatibility projection of legacy mission unlock requirements into forward edges. */
export function normalizeLegacyWorldCampaignV1(worldMap: WorldMapCatalog): ResolvedWorldCampaignV1 {
  let descriptors: DescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(worldMap) as DescriptorMap;
  } catch {
    throw new WorldCampaignValidationError("worldMap", "Legacy world map could not be inspected safely.");
  }
  const missionNodesDescriptor = descriptors.missionNodes;
  if (!missionNodesDescriptor?.enumerable || !("value" in missionNodesDescriptor)) {
    throw new WorldCampaignValidationError("worldMap.missionNodes", "Legacy missionNodes must be enumerable own data.");
  }
  const detached = captureCampaignInput(missionNodesDescriptor.value);
  const authoredNodes = denseArray(detached, "worldMap.missionNodes", WORLD_CAMPAIGN_LIMITS.nodes, "Legacy mission nodes");
  const legacy = authoredNodes.map((value, index) => {
    const path = `worldMap.missionNodes[${index}]`;
    const node = fields(value, path, "Legacy mission node");
    return {
      id: boundedId(node.get("missionId"), `${path}.missionId`, "Legacy mission id"),
      regionId: boundedId(node.get("regionId"), `${path}.regionId`, "Legacy region id"),
      x: finiteCoordinate(node.get("x"), `${path}.x`),
      y: finiteCoordinate(node.get("y"), `${path}.y`),
      difficulty: difficulty(node.get("difficulty"), `${path}.difficulty`),
      requirements: idArray(
        node.get("unlockRequiresMissionIds"),
        `${path}.unlockRequiresMissionIds`,
        WORLD_CAMPAIGN_LIMITS.edges,
        "Legacy unlock requirements"
      )
    };
  });
  const byId = new Map<string, typeof legacy[number]>();
  for (const node of legacy) {
    if (byId.has(node.id)) {
      throw new WorldCampaignValidationError("worldMap.missionNodes", `Legacy world map contains duplicate mission node "${node.id}".`);
    }
    byId.set(node.id, node);
  }
  const nextById = new Map([...byId.keys()].map((id) => [id, [] as string[]]));
  let edgeCount = 0;
  for (const node of legacy) {
    for (const requiredId of node.requirements) {
      if (!byId.has(requiredId)) {
        throw new WorldCampaignValidationError(
          `worldMap.missionNodes.${node.id}.unlockRequiresMissionIds`,
          `Legacy mission node "${node.id}" references unknown requirement "${requiredId}".`
        );
      }
      nextById.get(requiredId)!.push(node.id);
      edgeCount += 1;
      if (edgeCount > WORLD_CAMPAIGN_LIMITS.edges) {
        throw new WorldCampaignValidationError("worldMap.missionNodes", "Legacy mission graph exceeds the edge limit.");
      }
    }
  }
  const nodes: WorldCampaignBattleNodeV1[] = legacy.map((node) => Object.freeze({
    id: node.id,
    type: "battle" as const,
    missionId: node.id,
    regionId: node.regionId,
    x: node.x,
    y: node.y,
    difficulty: node.difficulty,
    nextNodeIds: Object.freeze(nextById.get(node.id)!.sort(binaryCompare))
  })).sort((left, right) => binaryCompare(left.id, right.id));
  const entryNodeIds = Object.freeze(legacy
    .filter((node) => node.requirements.length === 0)
    .map((node) => node.id)
    .sort(binaryCompare));
  if (nodes.length > 0) validateGraphTopology(entryNodeIds, nodes);
  return freezeCampaign({
    source: "legacy",
    rogueliteProfileId: null,
    entryNodeIds,
    nodes: Object.freeze(nodes)
  });
}

function activeCampaignProfile(
  content: GameContentRegistry,
  profileId: string
): ActiveRogueliteMechanicsV4 | undefined {
  for (const missionId of Object.keys(content.missions).sort(binaryCompare)) {
    const active = resolveActiveRogueliteMechanics(content, missionId);
    if (active?.schemaVersion === 4 && active.profileId === profileId && active.campaign?.schemaVersion === 1) return active;
  }
  return undefined;
}

/** Resolve only a genuinely active authored v4 campaign; legacy content remains capability-inert. */
export function resolveWorldCampaign(content: GameContentRegistry): ResolvedWorldCampaignV1 | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(content.worldMap, "campaign");
    if (!descriptor?.enumerable || !("value" in descriptor) || descriptor.value === undefined) return undefined;
    const normalized = normalizeAuthoredWorldCampaignV1(descriptor.value, content);
    return normalized.rogueliteProfileId !== null && activeCampaignProfile(content, normalized.rogueliteProfileId)
      ? normalized
      : undefined;
  } catch {
    return undefined;
  }
}

export type CampaignRunContentValidationResult = Readonly<
  | { ok: true; code: "valid"; run: CampaignRunV1; campaign: ResolvedWorldCampaignV1 }
  | { ok: false; code: "campaign_inactive" | "invalid_run" | "unknown_node" | "unknown_card" | "unknown_artifact"; run: CampaignRunV1 }
>;

function validateCapturedCampaignRunAgainstContent(
  run: CampaignRunV1,
  content: GameContentRegistry
): CampaignRunContentValidationResult {
  const campaign = resolveWorldCampaign(content);
  if (!campaign) return Object.freeze({ ok: false, code: "campaign_inactive" as const, run });
  if (run.nodeId !== null && !campaign.nodes.some((node) => node.id === run.nodeId)) {
    return Object.freeze({ ok: false, code: "unknown_node" as const, run });
  }
  const profile = activeCampaignProfile(content, campaign.rogueliteProfileId!);
  if (!profile) return Object.freeze({ ok: false, code: "campaign_inactive" as const, run });
  if (run.deck.some((entry) => !profile.draft?.definitions[entry.cardId])) {
    return Object.freeze({ ok: false, code: "unknown_card" as const, run });
  }
  if (run.artifacts.some((entry) => !profile.artifacts?.definitions[entry.artifactId])) {
    return Object.freeze({ ok: false, code: "unknown_artifact" as const, run });
  }
  return Object.freeze({ ok: true, code: "valid" as const, run, campaign });
}

function availableCampaignNodeIds(
  run: CampaignRunV1,
  campaign: ResolvedWorldCampaignV1
): readonly string[] {
  if (run.nodeId === null) return Object.freeze([...campaign.entryNodeIds]);
  const current = campaign.nodes.find((node) => node.id === run.nodeId);
  return Object.freeze([...(current?.nextNodeIds ?? [])].sort(binaryCompare));
}

function advanceCapturedCampaignRun(run: CampaignRunV1, nodeId: string): CampaignRunV1 {
  return Object.freeze({
    version: run.version,
    seed: run.seed,
    nodeId,
    deck: run.deck,
    artifacts: run.artifacts,
    runResources: run.runResources
  });
}

/** Validate the unchanged CampaignRunV1 codec document against currently active authored content. */
export function validateCampaignRunAgainstContent(
  run: CampaignRunV1,
  content: GameContentRegistry
): CampaignRunContentValidationResult {
  let captured: CampaignRunV1;
  try {
    captured = decodeCampaignRun(run).run;
  } catch {
    return Object.freeze({ ok: false, code: "invalid_run" as const, run });
  }
  return validateCapturedCampaignRunAgainstContent(captured, content);
}

/** Return binary-sorted entries or direct successors; it never evaluates merchant/event gameplay. */
export function getAvailableCampaignNodeIds(
  run: CampaignRunV1,
  content: GameContentRegistry
): readonly string[] {
  let captured: CampaignRunV1;
  try {
    captured = decodeCampaignRun(run).run;
  } catch {
    return Object.freeze([]);
  }
  const validation = validateCapturedCampaignRunAgainstContent(captured, content);
  if (!validation.ok) return Object.freeze([]);
  return availableCampaignNodeIds(captured, validation.campaign);
}

export type CampaignBattleVictoryFailureCode =
  | "campaign_inactive"
  | "invalid_run"
  | "unknown_node"
  | "unknown_card"
  | "unknown_artifact"
  | "node_not_available"
  | "node_type_not_implemented"
  | "invalid_profile"
  | PlayerProfileFailureCode;

export type CampaignBattleVictoryResult = Readonly<
  | {
      ok: false;
      code: CampaignBattleVictoryFailureCode;
      run: CampaignRunV1;
      profile: PlayerProfileV3;
    }
  | {
      ok: true;
      code: "campaign_battle_recorded";
      nodeId: string;
      run: CampaignRunV1;
      profile: PlayerProfileV3;
      newlyAvailableNodeIds: readonly string[];
    }
>;

/** Atomically apply a graph-available battle result to separate immutable run and profile documents. */
export function recordCampaignBattleVictory(
  run: CampaignRunV1,
  profile: PlayerProfileV3,
  content: GameContentRegistry,
  nodeId: string,
  earnedStars: number
): CampaignBattleVictoryResult {
  let captured: CampaignRunV1;
  try {
    captured = decodeCampaignRun(run).run;
  } catch {
    return Object.freeze({
      ok: false as const,
      code: "invalid_run" as const,
      run,
      profile
    });
  }
  const fail = (code: CampaignBattleVictoryFailureCode): CampaignBattleVictoryResult => Object.freeze({
    ok: false as const,
    code,
    run: captured,
    profile
  });
  const validation = validateCapturedCampaignRunAgainstContent(captured, content);
  if (!validation.ok) return fail(validation.code);
  if (!availableCampaignNodeIds(captured, validation.campaign).includes(nodeId)) return fail("node_not_available");
  const node = validation.campaign.nodes.find((candidate) => candidate.id === nodeId)!;
  if (!isBattleNode(node)) return fail("node_type_not_implemented");

  let profileResult: ReturnType<typeof recordPlayerMissionClear>;
  try {
    profileResult = recordPlayerMissionClear(profile, content, node.missionId, earnedStars);
  } catch {
    return fail("invalid_profile");
  }
  if (!profileResult.ok) return fail(profileResult.code);
  const nextRun = advanceCapturedCampaignRun(captured, nodeId);
  const newlyAvailableNodeIds = availableCampaignNodeIds(nextRun, validation.campaign);
  return Object.freeze({
    ok: true as const,
    code: "campaign_battle_recorded" as const,
    nodeId,
    run: nextRun,
    profile: profileResult.profile,
    newlyAvailableNodeIds
  });
}

/** Author-facing input alias retained separately from the normalized runtime shape. */
export type AuthoredWorldCampaignV1 = WorldCampaignDefinitionV1;
