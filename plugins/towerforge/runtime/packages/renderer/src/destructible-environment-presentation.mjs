const MAX_OBJECTS = 4_096;
const MAX_ID_UTF8_BYTES = 128;

export const INACTIVE_DESTRUCTIBLE_ENVIRONMENT_PRESENTATION = Object.freeze({
  active: false,
  rows: Object.freeze([])
});

function binaryCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ownField(record, key) {
  if (record === null || typeof record !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function closedRecord(value, fields) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) return null;
    for (const field of fields) {
      const descriptor = descriptors[field];
      if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    }
    return descriptors;
  } catch {
    return null;
  }
}

function denseArray(value, maximum) {
  if (!Array.isArray(value)) return null;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length && "value" in descriptors.length ? descriptors.length.value : -1;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
    const keys = Object.keys(descriptors);
    if (keys.some((key) => key !== "length" && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= length))) return null;
    const rows = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !("value" in descriptor)) return null;
      rows.push(descriptor.value);
    }
    return rows;
  } catch {
    return null;
  }
}

function boundedId(value) {
  return typeof value === "string" && value.length > 0
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value)
    && new TextEncoder().encode(value).length <= MAX_ID_UTF8_BYTES;
}

function projectCoord(value) {
  const descriptors = closedRecord(value, ["q", "r"]);
  if (!descriptors) return null;
  const q = descriptors.q.value;
  const r = descriptors.r.value;
  return Number.isSafeInteger(q) && Number.isSafeInteger(r) ? Object.freeze({ q, r }) : null;
}

function projectRow(value) {
  const descriptors = closedRecord(value, [
    "objectId", "definitionId", "coord", "hp", "maxHp", "destroyed"
  ]);
  if (!descriptors) return null;
  const objectId = descriptors.objectId.value;
  const definitionId = descriptors.definitionId.value;
  const coord = projectCoord(descriptors.coord.value);
  const hp = descriptors.hp.value;
  const maxHp = descriptors.maxHp.value;
  const destroyed = descriptors.destroyed.value;
  if (!boundedId(objectId) || !boundedId(definitionId) || !coord
    || typeof maxHp !== "number" || !Number.isFinite(maxHp) || maxHp <= 0
    || typeof hp !== "number" || !Number.isFinite(hp) || hp < 0 || hp > maxHp
    || typeof destroyed !== "boolean" || destroyed !== (hp === 0)) return null;
  return Object.freeze({
    objectId,
    definitionId,
    coord,
    hp,
    maxHp,
    hpRatio: hp / maxHp,
    destroyed
  });
}

/** Pure fail-closed projection over the authoritative optional Ballistics v2 snapshot section. */
export function projectDestructibleEnvironmentPresentation(snapshot) {
  const ballistics = ownField(snapshot, "ballistics");
  const ballisticsDescriptors = closedRecord(ballistics, ["schemaVersion", "projectiles", "destructibles"]);
  if (!ballisticsDescriptors || ballisticsDescriptors.schemaVersion.value !== 2
    || !Array.isArray(ballisticsDescriptors.projectiles.value)) {
    return INACTIVE_DESTRUCTIBLE_ENVIRONMENT_PRESENTATION;
  }
  const destructibles = closedRecord(ballisticsDescriptors.destructibles.value, ["schemaVersion", "objects"]);
  if (!destructibles || destructibles.schemaVersion.value !== 1) {
    return INACTIVE_DESTRUCTIBLE_ENVIRONMENT_PRESENTATION;
  }
  const objects = denseArray(destructibles.objects.value, MAX_OBJECTS);
  if (!objects) return INACTIVE_DESTRUCTIBLE_ENVIRONMENT_PRESENTATION;
  const rows = [];
  const ids = new Set();
  for (const object of objects) {
    const row = projectRow(object);
    if (!row || ids.has(row.objectId)) return INACTIVE_DESTRUCTIBLE_ENVIRONMENT_PRESENTATION;
    ids.add(row.objectId);
    rows.push(row);
  }
  rows.sort((left, right) => binaryCompare(left.objectId, right.objectId));
  return Object.freeze({ active: true, rows: Object.freeze(rows) });
}
