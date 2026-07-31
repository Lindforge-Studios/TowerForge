const INACTIVE_BALLISTICS_PRESENTATION = Object.freeze({
  active: false,
  projectiles: Object.freeze([])
});

const MAX_PROJECTILES = 4_096;
const MAX_ID_UTF8_BYTES = 128;
const PROJECTILE_FIELDS = Object.freeze([
  "id",
  "sourceCoord",
  "targetCoord",
  "trajectory",
  "elapsedUnits",
  "travelTimeUnits",
  "altitude",
  "maxAltitude"
]);
const BLOCKED_EVENT_FIELDS = Object.freeze([
  "type",
  "projectileId",
  "targetCoord",
  "blockerCoord",
  "terrainId",
  "blockerTag",
  "projectileAltitude",
  "obstacleTop"
]);
const RICOCHET_EVENT_FIELDS = Object.freeze([
  "type",
  "projectileId",
  "bounceCount",
  "surfaceKind",
  "surfaceId",
  "collisionCoord",
  "nextSourceCoord",
  "nextTargetCoord"
]);

function ownDataValue(record, key) {
  if (record === null || typeof record !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function ownEnumerableKeys(record) {
  if (record === null || typeof record !== "object") return null;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(record);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") return null;
      const descriptor = descriptors[key];
      if (descriptor.enumerable && !("value" in descriptor)) return null;
    }
    return Object.keys(descriptors).filter((key) => descriptors[key].enumerable);
  } catch {
    return null;
  }
}

function isClosedRecord(record, allowedFields) {
  const keys = ownEnumerableKeys(record);
  return keys !== null && keys.every((key) => allowedFields.includes(key));
}

function finiteNumber(value, minimum = -Infinity, maximum = Infinity) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function normalizeCoord(value) {
  if (!isClosedRecord(value, ["q", "r"])) return null;
  const q = ownDataValue(value, "q");
  const r = ownDataValue(value, "r");
  if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) return null;
  return Object.freeze({ q, r });
}

function normalizeProjectile(value) {
  if (!isClosedRecord(value, PROJECTILE_FIELDS)) return null;
  const id = ownDataValue(value, "id");
  const sourceCoord = normalizeCoord(ownDataValue(value, "sourceCoord"));
  const targetCoord = normalizeCoord(ownDataValue(value, "targetCoord"));
  const trajectory = ownDataValue(value, "trajectory");
  const elapsedUnits = ownDataValue(value, "elapsedUnits");
  const travelTimeUnits = ownDataValue(value, "travelTimeUnits");
  const altitude = ownDataValue(value, "altitude");
  const maxAltitude = ownDataValue(value, "maxAltitude");
  if (
    typeof id !== "string"
    || id.length === 0
    || new TextEncoder().encode(id).length > MAX_ID_UTF8_BYTES
    || !sourceCoord
    || !targetCoord
    || !["direct", "arc"].includes(trajectory)
    || !finiteNumber(travelTimeUnits, Number.MIN_VALUE, 1_000_000)
    || !finiteNumber(elapsedUnits, 0, travelTimeUnits)
    || !finiteNumber(altitude, -1_000_000, 1_000_000)
  ) return null;
  if (trajectory === "arc" && !finiteNumber(maxAltitude, 0, 1_000_000)) return null;
  if (trajectory === "direct" && maxAltitude !== undefined) return null;
  const result = {
    id,
    sourceCoord,
    targetCoord,
    trajectory,
    elapsedUnits,
    travelTimeUnits,
    progress: Math.max(0, Math.min(1, elapsedUnits / travelTimeUnits)),
    altitude
  };
  if (maxAltitude !== undefined) result.maxAltitude = maxAltitude;
  return Object.freeze(result);
}

function binaryCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedText(value) {
  return typeof value === "string"
    && value.length > 0
    && new TextEncoder().encode(value).length <= MAX_ID_UTF8_BYTES;
}

function inspectDenseArray(value, maximumLength) {
  if (!Array.isArray(value)) return null;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return null; }
  const length = descriptors.length && "value" in descriptors.length ? descriptors.length.value : undefined;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximumLength) return null;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") return null;
    if (key === "length") continue;
    if (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length || !("value" in descriptors[key])) return null;
  }
  for (let index = 0; index < length; index += 1) {
    if (!descriptors[String(index)] || !("value" in descriptors[String(index)])) return null;
  }
  return { descriptors, length };
}

function normalizeBlockedEvent(value) {
  if (!isClosedRecord(value, BLOCKED_EVENT_FIELDS) || ownDataValue(value, "type") !== "projectileBlocked") return null;
  if (!boundedText(ownDataValue(value, "projectileId"))
    || !boundedText(ownDataValue(value, "terrainId"))
    || !boundedText(ownDataValue(value, "blockerTag"))
    || !finiteNumber(ownDataValue(value, "projectileAltitude"), -1_000_000, 1_000_000)
    || !finiteNumber(ownDataValue(value, "obstacleTop"), -1_000_000, 1_000_000)) return null;
  const targetCoord = normalizeCoord(ownDataValue(value, "targetCoord"));
  const blockerCoord = normalizeCoord(ownDataValue(value, "blockerCoord"));
  if (!targetCoord || !blockerCoord) return null;
  return Object.freeze({
    projectileId: ownDataValue(value, "projectileId"),
    targetCoord,
    blockerCoord,
    terrainId: ownDataValue(value, "terrainId"),
    blockerTag: ownDataValue(value, "blockerTag"),
    projectileAltitude: ownDataValue(value, "projectileAltitude"),
    obstacleTop: ownDataValue(value, "obstacleTop")
  });
}

function normalizeRicochetEvent(value) {
  if (!isClosedRecord(value, RICOCHET_EVENT_FIELDS) || ownDataValue(value, "type") !== "projectileRicocheted") return null;
  const projectileId = ownDataValue(value, "projectileId");
  const bounceCount = ownDataValue(value, "bounceCount");
  const surfaceKind = ownDataValue(value, "surfaceKind");
  const surfaceId = ownDataValue(value, "surfaceId");
  const collisionCoord = normalizeCoord(ownDataValue(value, "collisionCoord"));
  const nextSourceCoord = normalizeCoord(ownDataValue(value, "nextSourceCoord"));
  const nextTargetCoord = normalizeCoord(ownDataValue(value, "nextTargetCoord"));
  if (!boundedText(projectileId)
    || !Number.isSafeInteger(bounceCount)
    || bounceCount < 1
    || bounceCount > 4
    || !["terrain", "armor"].includes(surfaceKind)
    || !boundedText(surfaceId)
    || !collisionCoord
    || !nextSourceCoord
    || !nextTargetCoord) return null;
  return Object.freeze({
    projectileId,
    bounceCount,
    surfaceKind,
    surfaceId,
    collisionCoord,
    nextSourceCoord,
    nextTargetCoord
  });
}

export function projectBallisticsPresentation(snapshot) {
  const state = ownDataValue(snapshot, "ballistics");
  if (!isClosedRecord(state, ["schemaVersion", "projectiles"])) return INACTIVE_BALLISTICS_PRESENTATION;
  if (ownDataValue(state, "schemaVersion") !== 1) return INACTIVE_BALLISTICS_PRESENTATION;
  const source = ownDataValue(state, "projectiles");
  if (!Array.isArray(source)) return INACTIVE_BALLISTICS_PRESENTATION;
  const descriptors = (() => {
    try { return Object.getOwnPropertyDescriptors(source); } catch { return null; }
  })();
  const length = descriptors?.length && "value" in descriptors.length ? descriptors.length.value : undefined;
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_PROJECTILES
    || Reflect.ownKeys(descriptors).some((key) => {
      if (typeof key !== "string") return true;
      if (key === "length") return false;
      if (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length) return true;
      return !("value" in descriptors[key]);
    })) {
    return INACTIVE_BALLISTICS_PRESENTATION;
  }
  const projectiles = [];
  const projectileIds = new Set();
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor)) return INACTIVE_BALLISTICS_PRESENTATION;
    const projectile = normalizeProjectile(descriptor.value);
    if (!projectile || projectileIds.has(projectile.id)) return INACTIVE_BALLISTICS_PRESENTATION;
    projectileIds.add(projectile.id);
    projectiles.push(projectile);
  }
  projectiles.sort((left, right) => binaryCompare(left.id, right.id));
  return Object.freeze({ active: true, projectiles: Object.freeze(projectiles) });
}

export function projectBallisticsPresentationPoint(projectile, projectCoord, altitudeScale = 1) {
  if (!projectile || typeof projectCoord !== "function" || !finiteNumber(altitudeScale, 0)) return null;
  const source = projectCoord(projectile.sourceCoord);
  const target = projectCoord(projectile.targetCoord);
  if (!finiteNumber(source?.x) || !finiteNumber(source?.y) || !finiteNumber(target?.x) || !finiteNumber(target?.y)) return null;
  const progress = projectile.progress;
  return Object.freeze({
    x: source.x + (target.x - source.x) * progress,
    y: source.y + (target.y - source.y) * progress - projectile.altitude * altitudeScale,
    altitude: projectile.altitude
  });
}

export function projectBallisticsEventPresentation(snapshot) {
  if (!projectBallisticsPresentation(snapshot).active) return Object.freeze([]);
  const inspected = inspectDenseArray(ownDataValue(snapshot, "lastEvents"), MAX_PROJECTILES);
  if (!inspected) return Object.freeze([]);
  const result = [];
  const ids = new Set();
  for (let index = 0; index < inspected.length; index += 1) {
    const value = inspected.descriptors[String(index)].value;
    if (ownDataValue(value, "type") !== "projectileBlocked") continue;
    const row = normalizeBlockedEvent(value);
    if (!row || ids.has(row.projectileId)) return Object.freeze([]);
    ids.add(row.projectileId);
    result.push(row);
  }
  result.sort((left, right) => binaryCompare(left.projectileId, right.projectileId));
  return Object.freeze(result);
}

export function projectBallisticsRicochetEventPresentation(snapshot) {
  if (!projectBallisticsPresentation(snapshot).active) return Object.freeze([]);
  const inspected = inspectDenseArray(ownDataValue(snapshot, "lastEvents"), MAX_PROJECTILES);
  if (!inspected) return Object.freeze([]);
  const result = [];
  const keys = new Set();
  for (let index = 0; index < inspected.length; index += 1) {
    const value = inspected.descriptors[String(index)].value;
    if (ownDataValue(value, "type") !== "projectileRicocheted") continue;
    const row = normalizeRicochetEvent(value);
    const key = row ? `${row.projectileId}\u0000${row.bounceCount}` : "";
    if (!row || keys.has(key)) return Object.freeze([]);
    keys.add(key);
    result.push(row);
  }
  result.sort((left, right) => binaryCompare(left.projectileId, right.projectileId)
    || left.bounceCount - right.bounceCount);
  return Object.freeze(result);
}
