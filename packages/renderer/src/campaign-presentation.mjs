const MAX_NODES = 1_024;
const MAX_AVAILABLE_NODES = 1_024;
const MAX_ID_BYTES = 128;
const MAX_LABEL_BYTES = 256;

const NODE_TYPES = new Set(["battle", "elite", "merchant", "event", "boss"]);
const BATTLE_TYPES = new Set(["battle", "elite", "boss"]);
const INACTIVE = Object.freeze({
  active: false,
  profileId: null,
  currentNodeId: null,
  nodes: Object.freeze([])
});

function ownRecord(value, allowedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.getOwnPropertySymbols(descriptors).length > 0) return null;
  const allowed = new Set(allowedKeys);
  const result = Object.create(null);
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!allowed.has(key) || !descriptor?.enumerable || !("value" in descriptor)) return null;
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}

function denseArray(value, maximum) {
  if (!Array.isArray(value)) return null;
  let descriptors;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) return null;
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
  if (Reflect.ownKeys(descriptors).some((key) => (
    key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)
  ))) return null;
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    result.push(descriptor.value);
  }
  return result;
}

function boundedText(value, maximumBytes, optional = false) {
  if (optional && value === null) return null;
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    return new TextEncoder().encode(value).length <= maximumBytes ? value : undefined;
  } catch {
    return undefined;
  }
}

function finiteCoordinate(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function projectNode(value) {
  const commonFields = ["id", "type", "regionId", "x", "y", "difficulty", "nextNodeIds"];
  const rawType = ownRecord(value, [...commonFields, "missionId", "label"]);
  if (!rawType) return null;
  const type = rawType.type;
  if (!NODE_TYPES.has(type)) return null;
  const expectedFields = BATTLE_TYPES.has(type)
    ? [...commonFields, "missionId"]
    : [...commonFields, "label"];
  const node = ownRecord(value, expectedFields);
  if (!node || Object.keys(node).length !== expectedFields.length) return null;
  const id = boundedText(node.id, MAX_ID_BYTES);
  const regionId = boundedText(node.regionId, MAX_ID_BYTES);
  const x = finiteCoordinate(node.x);
  const y = finiteCoordinate(node.y);
  if (!id || !regionId || x === undefined || y === undefined
    || !Number.isSafeInteger(node.difficulty) || node.difficulty < 1 || node.difficulty > 5) return null;
  const nextNodeIds = denseArray(node.nextNodeIds, MAX_NODES);
  if (!nextNodeIds) return null;
  const nextIds = new Set();
  for (const nextNodeId of nextNodeIds) {
    const normalized = boundedText(nextNodeId, MAX_ID_BYTES);
    if (!normalized || nextIds.has(normalized)) return null;
    nextIds.add(normalized);
  }
  const label = BATTLE_TYPES.has(type) ? null : boundedText(node.label, MAX_LABEL_BYTES);
  const missionId = BATTLE_TYPES.has(type) ? boundedText(node.missionId, MAX_ID_BYTES) : null;
  if ((BATTLE_TYPES.has(type) && !missionId) || (!BATTLE_TYPES.has(type) && !label)) return null;
  return { id, type, label, missionId, regionId, x, y, difficulty: node.difficulty };
}

/**
 * Project normalized, authoritative campaign state into renderer-safe view data.
 * Availability is supplied by the engine; this adapter deliberately owns no graph rules.
 */
export function projectCampaignPresentation(value) {
  if (value === undefined || value === null) return INACTIVE;
  const input = ownRecord(value, ["campaign", "run", "availableNodeIds"]);
  if (!input || Object.keys(input).length !== 3) return undefined;
  if (input.campaign === null && input.run === null) return INACTIVE;

  const campaign = ownRecord(input.campaign, [
    "schemaVersion", "source", "rogueliteProfileId", "entryNodeIds", "nodes"
  ]);
  const run = ownRecord(input.run, ["version", "seed", "nodeId", "deck", "artifacts", "runResources"]);
  if (!campaign || Object.keys(campaign).length !== 5 || campaign.schemaVersion !== 1
    || campaign.source !== "authored" || !run || Object.keys(run).length !== 6 || run.version !== 1) return undefined;
  const profileId = boundedText(campaign.rogueliteProfileId, MAX_ID_BYTES);
  if (!profileId) return undefined;

  const authoredNodes = denseArray(campaign.nodes, MAX_NODES);
  const authoredAvailability = denseArray(input.availableNodeIds, MAX_AVAILABLE_NODES);
  if (!authoredNodes || !authoredAvailability) return undefined;
  const nodes = [];
  const nodeIds = new Set();
  for (const value of authoredNodes) {
    const node = projectNode(value);
    if (!node || nodeIds.has(node.id)) return undefined;
    nodeIds.add(node.id);
    nodes.push(node);
  }

  const currentNodeId = run.nodeId === null ? null : boundedText(run.nodeId, MAX_ID_BYTES);
  if (run.nodeId !== null && (!currentNodeId || !nodeIds.has(currentNodeId))) return undefined;
  const available = new Set();
  for (const value of authoredAvailability) {
    const nodeId = boundedText(value, MAX_ID_BYTES);
    if (!nodeId || !nodeIds.has(nodeId) || available.has(nodeId)) return undefined;
    available.add(nodeId);
  }

  nodes.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return Object.freeze({
    active: true,
    profileId,
    currentNodeId,
    nodes: Object.freeze(nodes.map((node) => Object.freeze({
      ...node,
      state: node.id === currentNodeId ? "current" : available.has(node.id) ? "available" : "locked"
    })))
  });
}
