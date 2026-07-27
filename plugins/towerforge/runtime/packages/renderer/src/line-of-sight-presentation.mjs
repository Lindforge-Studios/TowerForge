const REASONS = new Set([
  "clear",
  "terrain_tag",
  "elevation",
  "ray_budget_exceeded",
  "operation_budget_exceeded"
]);

function record(value, requiredKeys, optionalKeys = []) {
  let prototype;
  let descriptors;
  let array;
  try {
    prototype = value && typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
    descriptors = value && typeof value === "object" ? Object.getOwnPropertyDescriptors(value) : undefined;
    array = Array.isArray(value);
  } catch {
    return undefined;
  }
  if (!descriptors || array || prototype !== Object.prototype
    || Reflect.ownKeys(descriptors).some((key) => typeof key === "symbol")) return undefined;
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const keys = Object.keys(descriptors);
  if (requiredKeys.some((key) => !Object.hasOwn(descriptors, key))
    || keys.some((key) => !allowed.has(key))) return undefined;
  const result = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !("value" in descriptor)) return undefined;
    result[key] = descriptor.value;
  }
  return result;
}

function denseArray(value) {
  let array;
  let prototype;
  let descriptors;
  try {
    array = Array.isArray(value);
    prototype = value && typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
    descriptors = value && typeof value === "object" ? Object.getOwnPropertyDescriptors(value) : undefined;
  } catch { return undefined; }
  if (!array || prototype !== Array.prototype || !descriptors) return undefined;
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0) return undefined;
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) return undefined;
    result.push(descriptor.value);
  }
  const extra = Reflect.ownKeys(descriptors).some((key) => key !== "length"
    && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length));
  return extra ? undefined : result;
}

function coord(value) {
  const source = record(value, ["q", "r"]);
  if (!source || !Number.isSafeInteger(source.q) || !Number.isSafeInteger(source.r)) return undefined;
  return { q: source.q, r: source.r };
}

function coverage(value, rowCount) {
  const source = record(value, [
    "requestedTargets",
    "analyzedTargets",
    "cellInspections",
    "budgetExceeded"
  ]);
  if (!source || !Number.isSafeInteger(source.requestedTargets) || source.requestedTargets < 0
    || !Number.isSafeInteger(source.analyzedTargets) || source.analyzedTargets !== rowCount
    || source.requestedTargets !== rowCount
    || !Number.isSafeInteger(source.cellInspections) || source.cellInspections < 0
    || typeof source.budgetExceeded !== "boolean") return undefined;
  return {
    requestedTargets: source.requestedTargets,
    analyzedTargets: source.analyzedTargets,
    cellInspections: source.cellInspections,
    budgetExceeded: source.budgetExceeded
  };
}

function blocker(value) {
  const source = record(value, ["coord", "terrainId", "elevation"], ["tag"]);
  if (!source) return undefined;
  const position = coord(source.coord);
  if (!position || typeof source.terrainId !== "string" || !Number.isSafeInteger(source.elevation)
    || (source.tag !== undefined && typeof source.tag !== "string")) return undefined;
  return {
    coord: position,
    terrainId: source.terrainId,
    elevation: source.elevation,
    ...(source.tag === undefined ? {} : { tag: source.tag })
  };
}

function analysisRow(value) {
  const source = record(value, ["target", "visible", "reason"], ["blocker"]);
  if (!source || typeof source.visible !== "boolean" || !REASONS.has(source.reason)) return undefined;
  const target = coord(source.target);
  const projectedBlocker = source.blocker === undefined ? undefined : blocker(source.blocker);
  const requiresBlocker = source.reason === "terrain_tag" || source.reason === "elevation";
  if (!target || (source.blocker !== undefined && projectedBlocker === undefined)
    || requiresBlocker !== Boolean(projectedBlocker)
    || (source.reason === "terrain_tag" && typeof projectedBlocker?.tag !== "string")
    || (source.reason === "elevation" && projectedBlocker?.tag !== undefined)
    || source.visible !== (source.reason === "clear")) return undefined;
  return {
    target,
    visible: source.visible,
    reason: source.reason,
    ...(projectedBlocker === undefined ? {} : { blocker: projectedBlocker })
  };
}

/**
 * Copy the engine's detached diagnostic into renderer-owned presentation data. This adapter is
 * intentionally fail-closed and never derives a visibility verdict from project or map content.
 */
export function projectLineOfSightAnalysis(value) {
  const source = record(value, ["schemaVersion", "profileId", "source", "rows", "coverage"]);
  if (!source || source.schemaVersion !== 1 || typeof source.profileId !== "string" || !source.profileId) {
    return undefined;
  }
  const authoredRows = denseArray(source.rows);
  const projectedSource = coord(source.source);
  if (!authoredRows || !projectedSource) return undefined;
  const rows = [];
  for (const item of authoredRows) {
    const projected = analysisRow(item);
    if (!projected) return undefined;
    rows.push(projected);
  }
  const projectedCoverage = coverage(source.coverage, rows.length);
  if (!projectedCoverage) return undefined;
  return {
    active: true,
    profileId: source.profileId,
    source: projectedSource,
    rows,
    coverage: projectedCoverage
  };
}
