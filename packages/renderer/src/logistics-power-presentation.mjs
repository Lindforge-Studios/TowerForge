const MAX_PARTICIPANTS = 4_096;
const MAX_NODES = 1_024;
const MAX_UNDIRECTED_EDGES = 65_536;
const MAX_DIRECTED_LINK_IDS = MAX_UNDIRECTED_EDGES * 2;
const MAX_ID_BYTES = 128;
const MAX_ENTRY_AMOUNT = 1_000_000_000_000;
const MAX_COMPONENT_OUTPUT = MAX_NODES * MAX_ENTRY_AMOUNT;
const MAX_COMPONENT_DEMAND = MAX_PARTICIPANTS * MAX_ENTRY_AMOUNT;
const MAX_PRIORITY = 1_000_000;
const MAX_AMMUNITION_INVENTORIES = 4_096;
const MAX_AMMUNITION_AMOUNT = 1_000_000_000;
const MAX_SUPPLY_SOURCES = 1_024;
const MAX_SUPPLY_EDGES = 65_536;
const MAX_SUPPLY_DISTANCE = 64;

const INACTIVE = Object.freeze({ active: false, power: null });

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
    if (!allowed.has(key) || descriptor?.enumerable !== true || !("value" in descriptor)) return null;
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}

function ownValue(value, key) {
  if (value === null || typeof value !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function denseArray(value, maximum = MAX_PARTICIPANTS) {
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
    key !== "length"
    && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)
  ))) return null;
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor?.enumerable !== true || !("value" in descriptor)) return null;
    result.push(descriptor.value);
  }
  return result;
}

function id(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return new TextEncoder().encode(value).length <= MAX_ID_BYTES ? value : null;
  } catch {
    return null;
  }
}

function amount(value, { positive = false, maximum = MAX_ENTRY_AMOUNT } = {}) {
  return Number.isFinite(value)
    && value >= (positive ? Number.MIN_VALUE : 0)
    && value <= maximum
    ? value
    : null;
}

function compareBinary(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUniqueIds(value) {
  const source = denseArray(value);
  if (!source) return null;
  const result = [];
  let previous;
  for (const candidate of source) {
    const normalized = id(candidate);
    if (!normalized || (previous !== undefined && compareBinary(previous, normalized) >= 0)) return null;
    previous = normalized;
    result.push(normalized);
  }
  return Object.freeze(result);
}

function projectComponent(value) {
  const row = ownRecord(value, ["id", "output", "demand", "allocated", "nodeIds", "consumerIds"]);
  if (!row || Object.keys(row).length !== 6) return null;
  const componentId = id(row.id);
  const output = amount(row.output, { maximum: MAX_COMPONENT_OUTPUT });
  const demand = amount(row.demand, { maximum: MAX_COMPONENT_DEMAND });
  const allocated = amount(row.allocated, { maximum: MAX_COMPONENT_OUTPUT });
  const nodeIds = sortedUniqueIds(row.nodeIds);
  const consumerIds = sortedUniqueIds(row.consumerIds);
  if (!componentId || output === null || demand === null || allocated === null
    || allocated > output || !nodeIds || nodeIds.length === 0 || !consumerIds) return null;
  return Object.freeze({ id: componentId, output, demand, allocated, nodeIds, consumerIds });
}

function projectNode(value) {
  const row = ownRecord(value, [
    "towerId", "towerTypeId", "role", "componentId", "output", "linkTowerIds", "coveredConsumerIds"
  ]);
  if (!row || Object.keys(row).length !== 7) return null;
  const towerId = id(row.towerId);
  const towerTypeId = id(row.towerTypeId);
  const componentId = id(row.componentId);
  const output = amount(row.output);
  const linkTowerIds = sortedUniqueIds(row.linkTowerIds);
  const coveredConsumerIds = sortedUniqueIds(row.coveredConsumerIds);
  if (!towerId || !towerTypeId || !componentId || output === null || !linkTowerIds || !coveredConsumerIds
    || (row.role !== "generator" && row.role !== "relay")
    || (row.role === "generator" && output === 0)
    || (row.role === "relay" && output !== 0)) return null;
  return Object.freeze({
    towerId, towerTypeId, role: row.role, componentId, output, linkTowerIds, coveredConsumerIds
  });
}

function projectConsumer(value) {
  const row = ownRecord(value, [
    "towerId", "towerTypeId", "demand", "priority", "nodeId", "componentId", "powered"
  ]);
  if (!row || Object.keys(row).length !== 7) return null;
  const towerId = id(row.towerId);
  const towerTypeId = id(row.towerTypeId);
  const demand = amount(row.demand, { positive: true });
  const priority = row.priority;
  const nodeId = row.nodeId === null ? null : id(row.nodeId);
  const componentId = row.componentId === null ? null : id(row.componentId);
  if (!towerId || !towerTypeId || demand === null
    || !Number.isSafeInteger(priority) || priority < 0 || priority > MAX_PRIORITY
    || (row.nodeId !== null && !nodeId) || (row.componentId !== null && !componentId)
    || (nodeId === null) !== (componentId === null) || typeof row.powered !== "boolean"
    || (row.powered && nodeId === null)) return null;
  return Object.freeze({ towerId, towerTypeId, demand, priority, nodeId, componentId, powered: row.powered });
}

function projectSortedRows(value, project, key, maximum) {
  const source = denseArray(value, maximum);
  if (!source) return null;
  const rows = [];
  let previous;
  for (const candidate of source) {
    const row = project(candidate);
    if (!row || (previous !== undefined && compareBinary(previous, row[key]) >= 0)) return null;
    previous = row[key];
    rows.push(row);
  }
  return Object.freeze(rows);
}

function projectPower(value) {
  const power = ownRecord(value, ["components", "nodes", "consumers"]);
  if (!power || Object.keys(power).length !== 3) return null;
  const components = projectSortedRows(power.components, projectComponent, "id", MAX_NODES);
  const nodes = projectSortedRows(power.nodes, projectNode, "towerId", MAX_NODES);
  const consumers = projectSortedRows(power.consumers, projectConsumer, "towerId", MAX_PARTICIPANTS);
  if (!components || !nodes || !consumers
    || nodes.length + consumers.length > MAX_PARTICIPANTS
    || components.length > nodes.length) return null;

  const componentById = new Map(components.map((row) => [row.id, row]));
  const nodeById = new Map(nodes.map((row) => [row.towerId, row]));
  const consumerById = new Map(consumers.map((row) => [row.towerId, row]));
  if (nodes.some((node) => consumerById.has(node.towerId))) return null;
  let directedLinkIds = 0;
  for (const component of components) {
    if (component.id !== component.nodeIds[0]
      || component.nodeIds.some((towerId) => nodeById.get(towerId)?.componentId !== component.id)
      || component.consumerIds.some((towerId) => consumerById.get(towerId)?.componentId !== component.id)) return null;
    const output = component.nodeIds.reduce((sum, towerId) => sum + nodeById.get(towerId).output, 0);
    const demand = component.consumerIds.reduce((sum, towerId) => sum + consumerById.get(towerId).demand, 0);
    if (!Number.isFinite(output) || !Number.isFinite(demand)
      || output !== component.output || demand !== component.demand) return null;

    const allocationOrder = component.consumerIds
      .map((towerId) => consumerById.get(towerId))
      .sort((left, right) => left.priority - right.priority || compareBinary(left.towerId, right.towerId));
    let remaining = output;
    let allocated = 0;
    let brownout = false;
    for (const consumer of allocationOrder) {
      const expectedPowered = !brownout && consumer.demand <= remaining;
      if (!expectedPowered) brownout = true;
      else {
        remaining -= consumer.demand;
        allocated += consumer.demand;
      }
      if (consumer.powered !== expectedPowered) return null;
    }
    if (!Number.isFinite(allocated) || allocated !== component.allocated) return null;

    const reachable = new Set([component.nodeIds[0]]);
    const queue = [component.nodeIds[0]];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const node = nodeById.get(queue[cursor]);
      for (const linkedId of node.linkTowerIds) {
        if (reachable.has(linkedId)) continue;
        reachable.add(linkedId);
        queue.push(linkedId);
      }
    }
    if (reachable.size !== component.nodeIds.length) return null;
  }
  for (const node of nodes) {
    const component = componentById.get(node.componentId);
    if (!component || !component.nodeIds.includes(node.towerId)
      || node.linkTowerIds.some((towerId) => towerId === node.towerId
        || nodeById.get(towerId)?.componentId !== node.componentId
        || !nodeById.get(towerId).linkTowerIds.includes(node.towerId))
      || node.coveredConsumerIds.some((towerId) => consumerById.get(towerId)?.nodeId !== node.towerId)) return null;
    directedLinkIds += node.linkTowerIds.length;
    if (directedLinkIds > MAX_DIRECTED_LINK_IDS) return null;
  }
  for (const consumer of consumers) {
    if (consumer.nodeId === null) {
      if (consumer.powered || consumer.componentId !== null) return null;
      continue;
    }
    const node = nodeById.get(consumer.nodeId);
    const component = componentById.get(consumer.componentId);
    if (!node || !component || node.componentId !== consumer.componentId
      || !component.consumerIds.includes(consumer.towerId)
      || !node.coveredConsumerIds.includes(consumer.towerId)) return null;
  }
  if (directedLinkIds % 2 !== 0 || directedLinkIds / 2 > MAX_UNDIRECTED_EDGES) return null;
  return Object.freeze({ components, nodes, consumers });
}

function projectAmmunitionInventory(value) {
  const row = ownRecord(value, [
    "towerId", "towerTypeId", "ammoTypeId", "amount", "capacity",
    "consumptionPerActivation", "hasRequiredAmmo"
  ]);
  if (!row || Object.keys(row).length !== 7) return null;
  const towerId = id(row.towerId);
  const towerTypeId = id(row.towerTypeId);
  const ammoTypeId = id(row.ammoTypeId);
  const validAmount = Number.isSafeInteger(row.amount)
    && row.amount >= 0 && row.amount <= MAX_AMMUNITION_AMOUNT;
  const validCapacity = Number.isSafeInteger(row.capacity)
    && row.capacity >= 1 && row.capacity <= MAX_AMMUNITION_AMOUNT;
  const validConsumption = Number.isSafeInteger(row.consumptionPerActivation)
    && row.consumptionPerActivation >= 1
    && row.consumptionPerActivation <= row.capacity;
  if (!towerId || !towerTypeId || !ammoTypeId || !validAmount || !validCapacity
    || !validConsumption || row.amount > row.capacity || typeof row.hasRequiredAmmo !== "boolean"
    || row.hasRequiredAmmo !== (row.amount >= row.consumptionPerActivation)) return null;
  return Object.freeze({
    towerId,
    towerTypeId,
    ammoTypeId,
    amount: row.amount,
    capacity: row.capacity,
    consumptionPerActivation: row.consumptionPerActivation,
    hasRequiredAmmo: row.hasRequiredAmmo
  });
}

function projectAmmunition(value) {
  const ammunition = ownRecord(value, ["inventories"]);
  if (!ammunition || Object.keys(ammunition).length !== 1) return null;
  const inventories = projectSortedRows(
    ammunition.inventories,
    projectAmmunitionInventory,
    "towerId",
    MAX_AMMUNITION_INVENTORIES
  );
  return inventories ? Object.freeze({ inventories }) : null;
}

function projectSupplyProducer(value) {
  const row = ownRecord(value, [
    "towerId", "towerTypeId", "recipeId", "ammoTypeId", "amount", "capacity",
    "productionProgress", "productionInterval", "transferProgress", "transferInterval",
    "transferAmount", "transferRadius", "powered", "operational"
  ]);
  if (!row || ![12, 14].includes(Object.keys(row).length)
    || (Object.hasOwn(row, "transferAmount") !== Object.hasOwn(row, "transferRadius"))) return null;
  const towerId = id(row.towerId);
  const towerTypeId = id(row.towerTypeId);
  const recipeId = id(row.recipeId);
  const ammoTypeId = id(row.ammoTypeId);
  const validAmount = Number.isSafeInteger(row.amount) && row.amount >= 0
    && row.amount <= MAX_AMMUNITION_AMOUNT;
  const validCapacity = Number.isSafeInteger(row.capacity) && row.capacity >= 1
    && row.capacity <= MAX_AMMUNITION_AMOUNT && row.amount <= row.capacity;
  const validProduction = Number.isFinite(row.productionInterval) && row.productionInterval >= 0.2
    && row.productionInterval <= 1_000_000 && Number.isFinite(row.productionProgress)
    && row.productionProgress >= 0 && row.productionProgress <= row.productionInterval;
  const validTransfer = Number.isFinite(row.transferInterval) && row.transferInterval >= 0.2
    && row.transferInterval <= 1_000_000 && Number.isFinite(row.transferProgress)
    && row.transferProgress >= 0 && row.transferProgress <= row.transferInterval;
  const validAuthoredTransfer = !Object.hasOwn(row, "transferAmount") || (
    Number.isSafeInteger(row.transferAmount) && row.transferAmount >= 1 && row.transferAmount <= row.capacity
    && Number.isSafeInteger(row.transferRadius) && row.transferRadius >= 0
    && row.transferRadius <= MAX_SUPPLY_DISTANCE
  );
  if (!towerId || !towerTypeId || !recipeId || !ammoTypeId || !validAmount || !validCapacity
    || !validProduction || !validTransfer || !validAuthoredTransfer || typeof row.powered !== "boolean"
    || typeof row.operational !== "boolean" || (row.operational && !row.powered)) return null;
  return Object.freeze({
    towerId, towerTypeId, recipeId, ammoTypeId, amount: row.amount, capacity: row.capacity,
    productionProgress: row.productionProgress, productionInterval: row.productionInterval,
    transferProgress: row.transferProgress, transferInterval: row.transferInterval,
    powered: row.powered, operational: row.operational
  });
}

function projectSupplyStorage(value) {
  const row = ownRecord(value, [
    "towerId", "towerTypeId", "ammoTypeId", "amount", "capacity",
    "transferProgress", "transferInterval", "transferAmount", "transferRadius", "powered", "operational"
  ]);
  if (!row || ![9, 11].includes(Object.keys(row).length)
    || (Object.hasOwn(row, "transferAmount") !== Object.hasOwn(row, "transferRadius"))) return null;
  const towerId = id(row.towerId);
  const towerTypeId = id(row.towerTypeId);
  const ammoTypeId = id(row.ammoTypeId);
  const validAmount = Number.isSafeInteger(row.amount) && row.amount >= 0
    && row.amount <= MAX_AMMUNITION_AMOUNT;
  const validCapacity = Number.isSafeInteger(row.capacity) && row.capacity >= 1
    && row.capacity <= MAX_AMMUNITION_AMOUNT && row.amount <= row.capacity;
  const validTransfer = Number.isFinite(row.transferInterval) && row.transferInterval >= 0.2
    && row.transferInterval <= 1_000_000 && Number.isFinite(row.transferProgress)
    && row.transferProgress >= 0 && row.transferProgress <= row.transferInterval;
  const validAuthoredTransfer = !Object.hasOwn(row, "transferAmount") || (
    Number.isSafeInteger(row.transferAmount) && row.transferAmount >= 1 && row.transferAmount <= row.capacity
    && Number.isSafeInteger(row.transferRadius) && row.transferRadius >= 0
    && row.transferRadius <= MAX_SUPPLY_DISTANCE
  );
  if (!towerId || !towerTypeId || !ammoTypeId || !validAmount || !validCapacity || !validTransfer
    || !validAuthoredTransfer
    || typeof row.powered !== "boolean" || typeof row.operational !== "boolean"
    || (row.operational && !row.powered)) return null;
  return Object.freeze({
    towerId, towerTypeId, ammoTypeId, amount: row.amount, capacity: row.capacity,
    transferProgress: row.transferProgress, transferInterval: row.transferInterval,
    powered: row.powered, operational: row.operational
  });
}

function projectSupplyEdge(value) {
  const row = ownRecord(value, [
    "sourceTowerId", "sourceTowerTypeId", "sourceKind", "destinationTowerId",
    "destinationTowerTypeId", "destinationKind", "ammoTypeId", "distance"
  ]);
  if (!row || ![6, 8].includes(Object.keys(row).length)
    || (Object.hasOwn(row, "sourceTowerTypeId") !== Object.hasOwn(row, "destinationTowerTypeId"))) return null;
  const sourceTowerId = id(row.sourceTowerId);
  const destinationTowerId = id(row.destinationTowerId);
  const ammoTypeId = id(row.ammoTypeId);
  const sourceTowerTypeId = row.sourceTowerTypeId === undefined ? undefined : id(row.sourceTowerTypeId);
  const destinationTowerTypeId = row.destinationTowerTypeId === undefined
    ? undefined
    : id(row.destinationTowerTypeId);
  if (!sourceTowerId || !destinationTowerId || !ammoTypeId
    || (row.sourceTowerTypeId !== undefined && (!sourceTowerTypeId || !destinationTowerTypeId))
    || (row.sourceKind !== "producer" && row.sourceKind !== "storage")
    || (row.destinationKind !== "consumer" && row.destinationKind !== "storage")
    || (row.sourceKind === "storage" && row.destinationKind === "storage")
    || !Number.isSafeInteger(row.distance) || row.distance < 0 || row.distance > MAX_SUPPLY_DISTANCE) return null;
  return Object.freeze({
    sourceTowerId, sourceKind: row.sourceKind, destinationTowerId,
    destinationKind: row.destinationKind, ammoTypeId, distance: row.distance
  });
}

function compareSupplyEdges(left, right) {
  return compareBinary(left.sourceTowerId, right.sourceTowerId)
    || (left.sourceKind === right.sourceKind ? 0 : left.sourceKind === "producer" ? -1 : 1)
    || (left.destinationKind === right.destinationKind ? 0 : left.destinationKind === "consumer" ? -1 : 1)
    || left.distance - right.distance
    || compareBinary(left.destinationTowerId, right.destinationTowerId);
}

function projectSupply(value, ammunition) {
  const supply = ownRecord(value, ["producers", "storages", "edges"]);
  if (!supply || Object.keys(supply).length !== 3 || !ammunition) return null;
  const producers = projectSortedRows(
    supply.producers, projectSupplyProducer, "towerId", MAX_SUPPLY_SOURCES
  );
  const storages = projectSortedRows(
    supply.storages, projectSupplyStorage, "towerId", MAX_SUPPLY_SOURCES
  );
  const edgeValues = denseArray(supply.edges, MAX_SUPPLY_EDGES);
  if (!producers || !storages || !edgeValues || producers.length + storages.length > MAX_SUPPLY_SOURCES) return null;
  const producerById = new Map(producers.map((row) => [row.towerId, row]));
  const storageById = new Map(storages.map((row) => [row.towerId, row]));
  const inventoryById = new Map(ammunition.inventories.map((row) => [row.towerId, row]));
  const edges = [];
  let previous;
  for (const candidate of edgeValues) {
    const edge = projectSupplyEdge(candidate);
    if (!edge || (previous && compareSupplyEdges(previous, edge) >= 0)) return null;
    const source = edge.sourceKind === "producer"
      ? producerById.get(edge.sourceTowerId)
      : storageById.get(edge.sourceTowerId);
    const destination = edge.destinationKind === "consumer"
      ? inventoryById.get(edge.destinationTowerId)
      : storageById.get(edge.destinationTowerId);
    const candidateSourceTowerTypeId = ownValue(candidate, "sourceTowerTypeId");
    const candidateDestinationTowerTypeId = ownValue(candidate, "destinationTowerTypeId");
    if (!source || !destination || source.ammoTypeId !== edge.ammoTypeId
      || destination.ammoTypeId !== edge.ammoTypeId
      || (candidateSourceTowerTypeId !== undefined && candidateSourceTowerTypeId !== source.towerTypeId)
      || (candidateDestinationTowerTypeId !== undefined && candidateDestinationTowerTypeId !== destination.towerTypeId)
      || edge.destinationKind === "storage" && edge.sourceTowerId === edge.destinationTowerId) return null;
    previous = edge;
    edges.push(edge);
  }
  return Object.freeze({ producers, storages, edges: Object.freeze(edges) });
}

/**
 * Detach the authoritative engine snapshot for presentation. Invalid, absent, and future
 * projections fail closed to one immutable inactive value; this module never derives topology.
 */
export function projectLogisticsPresentation(snapshot) {
  const source = ownValue(snapshot, "logistics");
  if (source === undefined) return INACTIVE;
  try {
    const schemaVersion = ownValue(source, "schemaVersion");
    if (schemaVersion === 1) {
      const logistics = ownRecord(source, ["schemaVersion", "power"]);
      if (!logistics || Object.keys(logistics).length !== 2) return INACTIVE;
      const power = projectPower(logistics.power);
      return power ? Object.freeze({ active: true, power }) : INACTIVE;
    }
    if (schemaVersion === 2) {
      const logistics = ownRecord(source, ["schemaVersion", "power", "ammunition"]);
      if (!logistics || Object.keys(logistics).length !== 3) return INACTIVE;
      const power = logistics.power === null ? null : projectPower(logistics.power);
      const ammunition = logistics.ammunition === null ? null : projectAmmunition(logistics.ammunition);
      if ((logistics.power !== null && power === null)
        || (logistics.ammunition !== null && ammunition === null)
        || (power === null && ammunition === null)) return INACTIVE;
      return Object.freeze({ active: true, power, ammunition });
    }
    if (schemaVersion === 3) {
      const logistics = ownRecord(source, ["schemaVersion", "power", "ammunition", "supply"]);
      if (!logistics || Object.keys(logistics).length !== 4) return INACTIVE;
      const power = logistics.power === null ? null : projectPower(logistics.power);
      const ammunition = logistics.ammunition === null ? null : projectAmmunition(logistics.ammunition);
      const supply = logistics.supply === null ? null : projectSupply(logistics.supply, ammunition);
      if ((logistics.power !== null && power === null)
        || (logistics.ammunition !== null && ammunition === null)
        || (logistics.supply !== null && supply === null)
        || (power === null && ammunition === null && supply === null)) return INACTIVE;
      return Object.freeze({ active: true, power, ammunition, supply });
    }
    return INACTIVE;
  } catch {
    return INACTIVE;
  }
}
