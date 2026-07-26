const MAX_SYNERGIES = 32;
const MAX_TIERS = 8;
const MAX_REQUIRED_COUNT = 65_536;
const MAX_ID_OR_TAG_BYTES = 128;
const MAX_LABEL_BYTES = 256;
const MAX_ARTIFACT_INVENTORY = 10_000;
const MAX_DROP_EVENTS = 10_000;
const MAX_TOWER_SLOT_ROWS = 65_536;
const MAX_SLOTS_PER_TOWER = 8;

const INACTIVE = Object.freeze({ active: false, synergies: Object.freeze([]) });

function ownData(value, key) {
  if (value === null || typeof value !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function record(value, allowedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(descriptors).length > 0) {
    return null;
  }
  const allowed = new Set(allowedKeys);
  const detached = Object.create(null);
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!allowed.has(key) || !descriptor?.enumerable || !("value" in descriptor)) return null;
    Object.defineProperty(detached, key, { value: descriptor.value, enumerable: true });
  }
  return detached;
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

function boundedText(value, maximumBytes) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return new TextEncoder().encode(value).length <= maximumBytes ? value : null;
  } catch {
    return null;
  }
}

function projectRow(value) {
  const row = record(value, [
    "synergyId", "label", "tag", "towerCount", "tierMode", "activeTierRequiredCounts"
  ]);
  if (!row || Object.keys(row).length !== 6) return null;
  const synergyId = boundedText(row.synergyId, MAX_ID_OR_TAG_BYTES);
  const label = boundedText(row.label, MAX_LABEL_BYTES);
  const tag = boundedText(row.tag, MAX_ID_OR_TAG_BYTES);
  if (!synergyId || !label || !tag
    || !Number.isSafeInteger(row.towerCount)
    || row.towerCount < 0
    || (row.tierMode !== "highest" && row.tierMode !== "cumulative")) return null;
  const rawCounts = denseArray(row.activeTierRequiredCounts, MAX_TIERS);
  if (!rawCounts || (row.tierMode === "highest" && rawCounts.length > 1)) return null;
  const counts = [];
  let previous = 0;
  for (const count of rawCounts) {
    if (!Number.isSafeInteger(count) || count <= previous || count > MAX_REQUIRED_COUNT || count > row.towerCount) {
      return null;
    }
    previous = count;
    counts.push(count);
  }
  return Object.freeze({
    synergyId,
    label,
    tag,
    towerCount: row.towerCount,
    tierMode: row.tierMode,
    activeTierRequiredCounts: Object.freeze(counts)
  });
}

/** Project only the authoritative optional engine snapshot; renderers never count towers. */
export function projectRoguelitePresentation(snapshot) {
  const sectionValue = ownData(snapshot, "roguelite");
  if (sectionValue === undefined || sectionValue === null) return INACTIVE;
  const schemaVersion = ownData(sectionValue, "schemaVersion");
  const section = schemaVersion === 1
    ? record(sectionValue, ["schemaVersion", "synergies"])
    : schemaVersion === 2 || schemaVersion === 3
      ? record(sectionValue, ["schemaVersion", "synergies", "artifacts"])
      : null;
  if (!section || Object.keys(section).length !== (schemaVersion === 1 ? 2 : 3)) return undefined;
  const authoredRows = denseArray(section.synergies, MAX_SYNERGIES);
  if (!authoredRows) return undefined;
  const rows = [];
  const seen = new Set();
  for (const value of authoredRows) {
    const row = projectRow(value);
    if (!row || seen.has(row.synergyId)) return undefined;
    seen.add(row.synergyId);
    rows.push(row);
  }
  rows.sort((left, right) => left.synergyId < right.synergyId ? -1 : left.synergyId > right.synergyId ? 1 : 0);
  if (schemaVersion === 1) return Object.freeze({ active: true, synergies: Object.freeze(rows) });

  const artifacts = schemaVersion === 2
    ? record(section.artifacts, ["inventory"])
    : record(section.artifacts, ["inventory", "towerSlots", "management"]);
  if (!artifacts || Object.keys(artifacts).length !== (schemaVersion === 2 ? 1 : 3)) return undefined;
  const authoredInventory = denseArray(artifacts.inventory, MAX_ARTIFACT_INVENTORY);
  if (!authoredInventory) return undefined;
  const inventory = [];
  const instances = new Set();
  for (const value of authoredInventory) {
    const entry = record(value, ["instanceId", "artifactId", "label", "slotType", "socket"]);
    if (!entry || Object.keys(entry).length !== 5 || (schemaVersion === 2 && entry.socket !== null)) return undefined;
    const instanceId = boundedText(entry.instanceId, MAX_ID_OR_TAG_BYTES);
    const artifactId = boundedText(entry.artifactId, MAX_ID_OR_TAG_BYTES);
    const label = boundedText(entry.label, MAX_LABEL_BYTES);
    const slotType = boundedText(entry.slotType, MAX_ID_OR_TAG_BYTES);
    if (!instanceId || !artifactId || !label || !slotType || instances.has(instanceId)) return undefined;
    let socket = null;
    if (entry.socket !== null) {
      const projectedSocket = record(entry.socket, ["towerId", "towerTypeId", "slotId"]);
      if (!projectedSocket || Object.keys(projectedSocket).length !== 3) return undefined;
      const towerId = boundedText(projectedSocket.towerId, MAX_ID_OR_TAG_BYTES);
      const towerTypeId = boundedText(projectedSocket.towerTypeId, MAX_ID_OR_TAG_BYTES);
      const slotId = boundedText(projectedSocket.slotId, MAX_ID_OR_TAG_BYTES);
      if (!towerId || !towerTypeId || !slotId) return undefined;
      socket = Object.freeze({ towerId, towerTypeId, slotId });
    }
    instances.add(instanceId);
    inventory.push(Object.freeze({ instanceId, artifactId, label, slotType, socket }));
  }
  inventory.sort((left, right) => left.instanceId < right.instanceId ? -1 : left.instanceId > right.instanceId ? 1 : 0);

  let towerSlots;
  let management;
  if (schemaVersion === 3) {
    const authoredTowerRows = denseArray(artifacts.towerSlots, MAX_TOWER_SLOT_ROWS);
    if (!authoredTowerRows) return undefined;
    const towerIds = new Set();
    towerSlots = [];
    for (const value of authoredTowerRows) {
      const towerRow = record(value, ["towerId", "towerTypeId", "slots"]);
      if (!towerRow || Object.keys(towerRow).length !== 3) return undefined;
      const towerId = boundedText(towerRow.towerId, MAX_ID_OR_TAG_BYTES);
      const towerTypeId = boundedText(towerRow.towerTypeId, MAX_ID_OR_TAG_BYTES);
      if (!towerId || !towerTypeId || towerIds.has(towerId)) return undefined;
      const authoredSlots = denseArray(towerRow.slots, MAX_SLOTS_PER_TOWER);
      if (!authoredSlots || authoredSlots.length === 0) return undefined;
      const slotIds = new Set();
      const slots = [];
      for (const slotValue of authoredSlots) {
        const slot = record(slotValue, ["slotId", "slotType", "artifactInstanceId"]);
        if (!slot || Object.keys(slot).length !== 3) return undefined;
        const slotId = boundedText(slot.slotId, MAX_ID_OR_TAG_BYTES);
        const slotType = boundedText(slot.slotType, MAX_ID_OR_TAG_BYTES);
        const artifactInstanceId = slot.artifactInstanceId === null
          ? null
          : boundedText(slot.artifactInstanceId, MAX_ID_OR_TAG_BYTES);
        if (!slotId || !slotType || slotIds.has(slotId) || artifactInstanceId === null && slot.artifactInstanceId !== null) {
          return undefined;
        }
        slotIds.add(slotId);
        slots.push(Object.freeze({ slotId, slotType, artifactInstanceId }));
      }
      slots.sort((left, right) => left.slotId < right.slotId ? -1 : left.slotId > right.slotId ? 1 : 0);
      towerIds.add(towerId);
      towerSlots.push(Object.freeze({ towerId, towerTypeId, slots: Object.freeze(slots) }));
    }
    towerSlots.sort((left, right) => left.towerId < right.towerId ? -1 : left.towerId > right.towerId ? 1 : 0);

    const managementValue = record(artifacts.management, ["allowed", "reasonKey"]);
    if (!managementValue || typeof managementValue.allowed !== "boolean") return undefined;
    const managementKeys = Object.keys(managementValue);
    if (managementValue.allowed) {
      if (managementKeys.length !== 1) return undefined;
      management = Object.freeze({ allowed: true });
    } else {
      const reasonKey = boundedText(managementValue.reasonKey, MAX_LABEL_BYTES);
      if (managementKeys.length !== 2 || !reasonKey) return undefined;
      management = Object.freeze({ allowed: false, reasonKey });
    }

    const inventoryById = new Map(inventory.map((entry) => [entry.instanceId, entry]));
    const towerById = new Map(towerSlots.map((tower) => [tower.towerId, tower]));
    const assignments = new Set();
    for (const tower of towerSlots) {
      for (const slot of tower.slots) {
        const key = `${tower.towerId.length}:${tower.towerId}|${slot.slotId.length}:${slot.slotId}`;
        if (slot.artifactInstanceId === null) continue;
        const item = inventoryById.get(slot.artifactInstanceId);
        if (!item || item.socket?.towerId !== tower.towerId || item.socket.towerTypeId !== tower.towerTypeId
          || item.socket.slotId !== slot.slotId || item.slotType !== slot.slotType || assignments.has(key)) return undefined;
        assignments.add(key);
      }
    }
    for (const item of inventory) {
      if (!item.socket) continue;
      const tower = towerById.get(item.socket.towerId);
      const slot = tower?.slots.find((candidate) => candidate.slotId === item.socket.slotId);
      if (!tower || tower.towerTypeId !== item.socket.towerTypeId
        || !slot || slot.artifactInstanceId !== item.instanceId || slot.slotType !== item.slotType) return undefined;
    }
  }

  const eventsValue = ownData(snapshot, "lastEvents");
  const events = eventsValue === undefined ? [] : denseArray(eventsValue, MAX_DROP_EVENTS);
  if (!events) return undefined;
  const drops = [];
  for (const value of events) {
    if (ownData(value, "type") !== "artifactDropped") continue;
    const event = record(value, [
      "type", "enemyId", "enemyTypeId", "artifactInstanceId", "artifactId", "rollIndex"
    ]);
    if (!event || Object.keys(event).length !== 6) return undefined;
    const enemyId = boundedText(event.enemyId, MAX_ID_OR_TAG_BYTES);
    const enemyTypeId = boundedText(event.enemyTypeId, MAX_ID_OR_TAG_BYTES);
    const artifactInstanceId = boundedText(event.artifactInstanceId, MAX_ID_OR_TAG_BYTES);
    const artifactId = boundedText(event.artifactId, MAX_ID_OR_TAG_BYTES);
    if (!enemyId || !enemyTypeId || !artifactInstanceId || !artifactId
      || !Number.isSafeInteger(event.rollIndex) || event.rollIndex < 0 || event.rollIndex > 7) return undefined;
    drops.push(Object.freeze({
      enemyId,
      enemyTypeId,
      artifactInstanceId,
      artifactId,
      rollIndex: event.rollIndex
    }));
  }
  return Object.freeze({
    active: true,
    synergies: Object.freeze(rows),
    artifacts: Object.freeze({
      inventory: Object.freeze(inventory),
      drops: Object.freeze(drops),
      ...(schemaVersion === 3 ? {
        towerSlots: Object.freeze(towerSlots),
        management
      } : {})
    })
  });
}
