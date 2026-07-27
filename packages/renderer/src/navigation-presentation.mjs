const MAX_NAVIGATION_CUES = 4_096;
const MAX_PRESENTATION_COORDINATE = 1_000_000;

function dataRecord(value, allowedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  if (prototype !== Object.prototype || Object.getOwnPropertySymbols(descriptors).length > 0) return null;
  const allowed = new Set(allowedKeys);
  const detached = {};
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!allowed.has(key) || !descriptor?.enumerable || !("value" in descriptor)) return null;
    Object.defineProperty(detached, key, { value: descriptor.value, enumerable: true });
  }
  return detached;
}

function ownDataValue(value, key) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return null;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return null;
  }
  return descriptor && descriptor.enumerable && "value" in descriptor
    ? { present: true, value: descriptor.value }
    : descriptor === undefined ? { present: false } : null;
}

function denseArray(value, maximumLength) {
  if (!Array.isArray(value)) return null;
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  if (prototype !== Array.prototype || Object.getOwnPropertySymbols(descriptors).length > 0) return null;
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximumLength) return null;
  const detached = [];
  for (const key of Object.keys(descriptors)) {
    if (key === "length") continue;
    const descriptor = descriptors[key];
    if (
      !/^(0|[1-9]\d*)$/.test(key)
      || Number(key) >= length
      || !descriptor?.enumerable
      || !("value" in descriptor)
    ) return null;
    detached[Number(key)] = descriptor.value;
  }
  return Object.keys(descriptors).length === length + 1 && detached.length === length ? detached : null;
}

function coord(value) {
  const record = dataRecord(value, ["q", "r"]);
  if (!record || !Object.hasOwn(record, "q") || !Object.hasOwn(record, "r")) return null;
  if (
    !Number.isSafeInteger(record.q)
    || !Number.isSafeInteger(record.r)
    || Math.abs(record.q) > MAX_PRESENTATION_COORDINATE
    || Math.abs(record.r) > MAX_PRESENTATION_COORDINATE
  ) return null;
  return { q: record.q, r: record.r };
}

function point(value) {
  const record = dataRecord(value, ["x", "y"]);
  if (!record || !Number.isFinite(record.x) || !Number.isFinite(record.y)) return undefined;
  return { x: record.x, y: record.y };
}

function blockingPair(value) {
  const record = dataRecord(value, ["movementProfileId", "routeId"]);
  if (
    !record
    || typeof record.movementProfileId !== "string"
    || record.movementProfileId.length === 0
    || typeof record.routeId !== "string"
    || record.routeId.length === 0
  ) return null;
  return { movementProfileId: record.movementProfileId, routeId: record.routeId };
}

/** Convert engine-owned placement analysis into detached renderer-only cues. */
export function projectNavigationPlacementCues(value) {
  const empty = { active: false, cues: [] };
  if (value === undefined || value === null) return empty;
  const analysis = dataRecord(value, ["schemaVersion", "mode", "profileId", "fields", "placementRows"]);
  if (
    !analysis
    || analysis.schemaVersion !== 1
    || analysis.mode !== "dynamic_flow"
    || typeof analysis.profileId !== "string"
    || analysis.profileId.length === 0
    || denseArray(analysis.fields, 256) === null
  ) return empty;
  const rows = denseArray(analysis.placementRows, MAX_NAVIGATION_CUES);
  if (rows === null) return empty;
  const seen = new Set();
  const cues = [];
  for (const authored of rows) {
    const row = dataRecord(authored, ["coord", "ok", "reasonKey", "blockingPair"]);
    if (!row || typeof row.ok !== "boolean") return empty;
    const detachedCoord = coord(row.coord);
    if (!detachedCoord) return empty;
    const key = detachedCoord.q + "," + detachedCoord.r;
    if (seen.has(key)) return empty;
    seen.add(key);
    if (Object.hasOwn(row, "reasonKey") && typeof row.reasonKey !== "string") return empty;
    let detachedPair;
    if (Object.hasOwn(row, "blockingPair")) {
      detachedPair = blockingPair(row.blockingPair);
      if (!detachedPair) return empty;
    }
    cues.push({
      coord: detachedCoord,
      state: row.ok ? "allowed" : "blocked",
      ...(row.reasonKey === undefined ? {} : { reasonKey: row.reasonKey }),
      ...(detachedPair === undefined ? {} : { blockingPair: detachedPair })
    });
  }
  cues.sort((left, right) => left.coord.r - right.coord.r || left.coord.q - right.coord.q);
  return { active: true, cues };
}

/**
 * Interpolate an engine-authored dynamic-navigation state, or detach the
 * caller's already-computed legacy route point when the optional state is absent.
 */
export function projectEnemyNavigationPoint(enemy, legacyPoint, coordToPoint) {
  const navigationDescriptor = ownDataValue(enemy, "navigation");
  if (navigationDescriptor === null) return undefined;
  if (!navigationDescriptor.present) return point(legacyPoint);
  const navigation = dataRecord(
    navigationDescriptor.value,
    ["schemaVersion", "movementProfileId", "currentCoord", "nextCoord", "edgeProgress", "stepsEntered"]
  );
  if (
    !navigation
    || navigation.schemaVersion !== 1
    || typeof navigation.movementProfileId !== "string"
    || navigation.movementProfileId.length === 0
    || !Number.isFinite(navigation.edgeProgress)
    || navigation.edgeProgress < 0
    || navigation.edgeProgress >= 1
    || !Number.isSafeInteger(navigation.stepsEntered)
    || navigation.stepsEntered < 0
    || typeof coordToPoint !== "function"
  ) return undefined;
  const currentCoord = coord(navigation.currentCoord);
  const hasNextCoord = Object.hasOwn(navigation, "nextCoord");
  const nextCoord = hasNextCoord ? coord(navigation.nextCoord) : undefined;
  if (!currentCoord || (hasNextCoord && !nextCoord)) return undefined;
  if (!hasNextCoord && navigation.edgeProgress !== 0) return undefined;
  if (nextCoord && nextCoord.q === currentCoord.q && nextCoord.r === currentCoord.r) return undefined;
  let currentPoint;
  let nextPoint;
  try {
    currentPoint = point(coordToPoint({ ...currentCoord }));
    nextPoint = nextCoord ? point(coordToPoint({ ...nextCoord })) : currentPoint;
  } catch {
    return undefined;
  }
  if (!currentPoint || !nextPoint) return undefined;
  const progress = navigation.edgeProgress;
  return {
    x: currentPoint.x + (nextPoint.x - currentPoint.x) * progress,
    y: currentPoint.y + (nextPoint.y - currentPoint.y) * progress
  };
}
