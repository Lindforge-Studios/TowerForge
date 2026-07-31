const MAX_NODES = 1_024;
const MAX_AVAILABLE_NODES = 1_024;
const MAX_ID_BYTES = 128;
const MAX_LABEL_BYTES = 256;
const MAX_RUN_RESOURCES = 256;
const MAX_CHOICES_PER_NODE = 16;
const MAX_RESOURCE_ENTRIES = 16;
const MAX_RESOURCE_AMOUNT = 1_000_000_000;
const MAX_CARRY_ENTRIES = 10_000;
const MAX_CARRY_IDENTIFIER_CODE_UNITS = 256;

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

function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length && expectedKeys.every((key) => keys.includes(key));
}

function ownDictionary(value, maximum) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  let descriptors;
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.getOwnPropertySymbols(descriptors).length > 0) return null;
  const keys = Object.keys(descriptors);
  if (keys.length > maximum) return null;
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!boundedText(key, MAX_ID_BYTES) || !descriptor?.enumerable || !("value" in descriptor)) return null;
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}

function projectResourceBag(value, resourceIds) {
  const bag = ownDictionary(value, MAX_RESOURCE_ENTRIES);
  if (!bag) return null;
  const projected = [];
  for (const resourceId of Object.keys(bag).sort()) {
    const amount = bag[resourceId];
    if (!resourceIds.has(resourceId) || !Number.isSafeInteger(amount)
      || amount < 0 || amount > MAX_RESOURCE_AMOUNT) return null;
    if (amount > 0) projected.push(Object.freeze({ resourceId, amount }));
  }
  return Object.freeze(projected);
}

function projectChoices(value, resourceIds) {
  const choices = denseArray(value, MAX_CHOICES_PER_NODE);
  if (!choices || choices.length === 0) return null;
  const seen = new Set();
  const projected = [];
  for (const value of choices) {
    const choice = ownRecord(value, ["id", "label", "costs", "grants"]);
    if (!choice || Object.keys(choice).length !== 4) return null;
    const id = boundedText(choice.id, MAX_ID_BYTES);
    const label = boundedText(choice.label, MAX_LABEL_BYTES);
    const costs = projectResourceBag(choice.costs, resourceIds);
    const grants = projectResourceBag(choice.grants, resourceIds);
    if (!id || !label || !costs || !grants || seen.has(id)
      || [...costs, ...grants].every((entry) => entry.amount === 0)) return null;
    seen.add(id);
    projected.push(Object.freeze({ id, label, costs, grants }));
  }
  projected.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return Object.freeze(projected);
}

function projectCarryEntries(value, idField) {
  const entries = denseArray(value, MAX_CARRY_ENTRIES);
  if (!entries) return null;
  const seen = new Set();
  const projected = [];
  for (const value of entries) {
    const entry = ownRecord(value, ["instanceId", idField]);
    if (!entry || !hasExactKeys(entry, ["instanceId", idField])) return null;
    const instanceId = typeof entry.instanceId === "string"
      && entry.instanceId.length > 0
      && entry.instanceId.length <= MAX_CARRY_IDENTIFIER_CODE_UNITS
      ? entry.instanceId
      : undefined;
    const definitionId = typeof entry[idField] === "string"
      && entry[idField].length > 0
      && entry[idField].length <= MAX_CARRY_IDENTIFIER_CODE_UNITS
      ? entry[idField]
      : undefined;
    if (!instanceId || !definitionId || seen.has(instanceId)) return null;
    seen.add(instanceId);
    projected.push(Object.freeze({ instanceId, [idField]: definitionId }));
  }
  return Object.freeze(projected);
}

function projectNode(value, schemaVersion, resourceIds) {
  const commonFields = ["id", "type", "regionId", "x", "y", "difficulty", "nextNodeIds"];
  const rawType = ownRecord(value, [...commonFields, "missionId", "label", "choices"]);
  if (!rawType) return null;
  const type = rawType.type;
  if (!NODE_TYPES.has(type)) return null;
  const expectedFields = BATTLE_TYPES.has(type)
    ? [...commonFields, "missionId"]
    : schemaVersion === 2 ? [...commonFields, "label", "choices"] : [...commonFields, "label"];
  if (!hasExactKeys(rawType, expectedFields)) return null;
  const node = rawType;
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
  if (schemaVersion === 2 && !BATTLE_TYPES.has(type)) {
    const choices = projectChoices(node.choices, resourceIds);
    if (!choices) return null;
    return { id, type, label, missionId, regionId, x, y, difficulty: node.difficulty, choices };
  }
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

  const campaignHeader = ownRecord(input.campaign, [
    "schemaVersion", "source", "rogueliteProfileId", "runResources", "entryNodeIds", "nodes"
  ]);
  const schemaVersion = campaignHeader?.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2) return undefined;
  const campaignFields = schemaVersion === 2
    ? ["schemaVersion", "source", "rogueliteProfileId", "runResources", "entryNodeIds", "nodes"]
    : ["schemaVersion", "source", "rogueliteProfileId", "entryNodeIds", "nodes"];
  const campaign = campaignHeader;
  const run = ownRecord(input.run, ["version", "seed", "nodeId", "deck", "artifacts", "runResources", "arsenal"]);
  const runFields = run?.version === 2
    ? ["version", "seed", "nodeId", "deck", "artifacts", "runResources", "arsenal"]
    : ["version", "seed", "nodeId", "deck", "artifacts", "runResources"];
  if (!hasExactKeys(campaign, campaignFields)
    || campaign.source !== "authored" || !run || !hasExactKeys(run, runFields)
    || (run.version !== 1 && run.version !== 2)) return undefined;
  const profileId = boundedText(campaign.rogueliteProfileId, MAX_ID_BYTES);
  if (!profileId) return undefined;
  const deck = projectCarryEntries(run.deck, "cardId");
  const artifacts = projectCarryEntries(run.artifacts, "artifactId");
  if (!deck || !artifacts || deck.length + artifacts.length > MAX_CARRY_ENTRIES) return undefined;
  let modules = Object.freeze([]);
  if (run.version === 2) {
    const arsenal = ownRecord(run.arsenal, ["moduleInventory"]);
    modules = arsenal && projectCarryEntries(arsenal.moduleInventory, "moduleId");
    if (!modules || deck.length + artifacts.length + modules.length > MAX_CARRY_ENTRIES) return undefined;
  }
  const loadout = Object.freeze({ deck, artifacts, ...(run.version === 2 ? { modules } : {}) });

  const resourceIds = new Set();
  const resourceLabels = new Map();
  const runResources = [];
  if (schemaVersion === 2) {
    const definitions = ownDictionary(campaign.runResources, MAX_RUN_RESOURCES);
    const balances = ownDictionary(run.runResources, MAX_RUN_RESOURCES);
    if (!definitions || !balances) return undefined;
    for (const resourceId of Object.keys(definitions).sort()) {
      const definition = ownRecord(definitions[resourceId], ["label"]);
      const label = definition && Object.keys(definition).length === 1
        ? boundedText(definition.label, MAX_LABEL_BYTES)
        : undefined;
      if (!label) return undefined;
      resourceIds.add(resourceId);
      resourceLabels.set(resourceId, label);
    }
    for (const resourceId of Object.keys(balances)) {
      const amount = balances[resourceId];
      if (!resourceIds.has(resourceId) || !Number.isSafeInteger(amount) || amount < 0) return undefined;
    }
    for (const resourceId of [...resourceIds].sort()) {
      runResources.push(Object.freeze({
        id: resourceId,
        label: resourceLabels.get(resourceId),
        amount: balances[resourceId] ?? 0
      }));
    }
  }

  const authoredNodes = denseArray(campaign.nodes, MAX_NODES);
  const authoredAvailability = denseArray(input.availableNodeIds, MAX_AVAILABLE_NODES);
  if (!authoredNodes || !authoredAvailability) return undefined;
  const nodes = [];
  const nodeIds = new Set();
  for (const value of authoredNodes) {
    const node = projectNode(value, schemaVersion, resourceIds);
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
    ...(deck.length > 0 || artifacts.length > 0 || modules.length > 0 || currentNodeId === null ? { loadout } : {}),
    ...(schemaVersion === 2 ? { runResources: Object.freeze(runResources) } : {}),
    nodes: Object.freeze(nodes.map((node) => Object.freeze({
      ...node,
      ...(schemaVersion === 2 && !("choices" in node) ? { choices: Object.freeze([]) } : {}),
      state: node.id === currentNodeId ? "current" : available.has(node.id) ? "available" : "locked"
    })))
  });
}
