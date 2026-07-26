const MAX_UNITS = 1;
const MAX_ID_BYTES = 128;
const MAX_LABEL_BYTES = 128;
const MAX_COORDINATE = 1_000_000;

const INACTIVE = Object.freeze({ active: false, units: Object.freeze([]) });

function ownData(value, key) {
  if (value === null || typeof value !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function exactRecord(value, allowedKeys) {
  if (value === null || typeof value !== "object") return null;
  let prototype;
  let descriptors;
  try {
    if (Array.isArray(value)) return null;
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.getOwnPropertySymbols(descriptors).length > 0) return null;
  const keys = Object.keys(descriptors);
  if (keys.length !== allowedKeys.length || keys.some((key) => !allowedKeys.includes(key))) return null;
  const detached = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    Object.defineProperty(detached, key, { value: descriptor.value, enumerable: true });
  }
  return detached;
}

function denseArray(value, maximum) {
  let descriptors;
  try {
    if (!Array.isArray(value)) return null;
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
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) return null;
  try {
    return new TextEncoder().encode(value).length <= maximumBytes ? value : null;
  } catch {
    return null;
  }
}

function coordinate(value) {
  const coord = exactRecord(value, ["q", "r"]);
  if (!coord || !Number.isSafeInteger(coord.q) || !Number.isSafeInteger(coord.r)
    || coord.q < 0 || coord.r < 0 || coord.q > MAX_COORDINATE || coord.r > MAX_COORDINATE) return null;
  return Object.freeze({ q: coord.q, r: coord.r });
}

function nullableCoordinate(value) {
  return value === null ? null : coordinate(value);
}

function movement(value) {
  const record = exactRecord(value, ["targetCoord", "nextCoord", "edgeProgress"]);
  if (!record) return null;
  const targetCoord = nullableCoordinate(record.targetCoord);
  const nextCoord = nullableCoordinate(record.nextCoord);
  const edgeProgress = record.edgeProgress;
  if ((record.targetCoord !== null && !targetCoord)
    || (record.nextCoord !== null && !nextCoord)
    || typeof edgeProgress !== "number" || !Number.isFinite(edgeProgress)
    || edgeProgress < 0 || edgeProgress >= 1
    || (nextCoord === null && edgeProgress !== 0)
    || (targetCoord === null && nextCoord !== null)) return null;
  return Object.freeze({ targetCoord, nextCoord, edgeProgress });
}

/**
 * Project only the authoritative optional engine snapshot. Invalid/future/untrusted shapes fail
 * closed to the same inactive sentinel; renderers never reconstruct a hero from mechanics data.
 */
export function projectHeroesPresentation(snapshot) {
  const value = ownData(snapshot, "heroes");
  if (value === undefined || value === null) return INACTIVE;
  const section = exactRecord(value, ["schemaVersion", "units"]);
  if (!section || (section.schemaVersion !== 1 && section.schemaVersion !== 2)) return INACTIVE;
  const authoredUnits = denseArray(section.units, MAX_UNITS);
  if (!authoredUnits || authoredUnits.length !== 1) return INACTIVE;
  const units = [];
  const ids = new Set();
  const definitionIds = new Set();
  for (const value of authoredUnits) {
    const unit = exactRecord(value, section.schemaVersion === 1
      ? ["id", "definitionId", "label", "coord"]
      : ["id", "definitionId", "label", "coord", "movement"]);
    if (!unit) return INACTIVE;
    const id = boundedText(unit.id, MAX_ID_BYTES);
    const definitionId = boundedText(unit.definitionId, MAX_ID_BYTES);
    const label = boundedText(unit.label, MAX_LABEL_BYTES);
    const coord = coordinate(unit.coord);
    if (!id || !definitionId || id !== definitionId || !label || !coord
      || ids.has(id) || definitionIds.has(definitionId)) return INACTIVE;
    ids.add(id);
    definitionIds.add(definitionId);
    if (section.schemaVersion === 1) {
      units.push(Object.freeze({ id, definitionId, label, coord }));
      continue;
    }
    const projectedMovement = movement(unit.movement);
    if (!projectedMovement) return INACTIVE;
    units.push(Object.freeze({ id, definitionId, label, coord, movement: projectedMovement }));
  }
  return Object.freeze({ active: true, units: Object.freeze(units) });
}

/** Convert one detached presentation unit into a renderer point without pathfinding. */
export function projectHeroPresentationPoint(hero, coordToPoint) {
  if (typeof coordToPoint !== "function") return undefined;
  try {
    const current = coordinate(ownData(hero, "coord"));
    if (!current) return undefined;
    const currentPoint = coordToPoint(current);
    if (!currentPoint || !Number.isFinite(currentPoint.x) || !Number.isFinite(currentPoint.y)) return undefined;
    const authoredMovement = ownData(hero, "movement");
    if (authoredMovement === undefined) return { x: currentPoint.x, y: currentPoint.y };
    const projectedMovement = movement(authoredMovement);
    if (!projectedMovement) return undefined;
    if (projectedMovement.nextCoord === null) return { x: currentPoint.x, y: currentPoint.y };
    const nextPoint = coordToPoint(projectedMovement.nextCoord);
    if (!nextPoint || !Number.isFinite(nextPoint.x) || !Number.isFinite(nextPoint.y)) return undefined;
    const progress = projectedMovement.edgeProgress;
    return {
      x: currentPoint.x + (nextPoint.x - currentPoint.x) * progress,
      y: currentPoint.y + (nextPoint.y - currentPoint.y) * progress
    };
  } catch {
    return undefined;
  }
}

/** Presentation-only hit test; returns an authoritative snapshot unit id or null. */
export function hitTestHeroesPresentation(presentation, point, coordToPoint, radius = 0) {
  if (!presentation?.active || !Array.isArray(presentation.units)
    || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
    || !Number.isFinite(radius) || radius < 0) return null;
  for (const hero of presentation.units) {
    const projected = projectHeroPresentationPoint(hero, coordToPoint);
    if (!projected) continue;
    const dx = projected.x - point.x;
    const dy = projected.y - point.y;
    if (dx * dx + dy * dy <= radius * radius) return hero.id;
  }
  return null;
}
