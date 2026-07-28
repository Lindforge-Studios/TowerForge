const INVALID = Symbol("invalid");
const DIRECTOR_EVENT_LIMIT = 64;
const DIRECTOR_GROUP_LIMIT = 8;
const DIRECTOR_ADDED_ENEMY_LIMIT = 1_024;
const DIRECTOR_METRICS = new Set([
  "damage_share",
  "coverage_ratio",
  "movement_layer_share",
  "logistics_brownout_ratio"
]);

function ownData(record, key) {
  if (record === null || typeof record !== "object") return INVALID;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : INVALID;
  } catch {
    return INVALID;
  }
}

function denseArray(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return undefined;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return undefined; }
  if (Object.keys(descriptors).length !== value.length + 1) return undefined;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
  }
  return value;
}

function boundedId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : undefined;
}

function projectEvent(event) {
  if (ownData(event, "type") !== "directorDecision") return undefined;
  const waveIndex = ownData(event, "waveIndex");
  const counterId = boundedId(ownData(event, "counterId"));
  const threatCost = ownData(event, "threatCost");
  const reason = ownData(event, "reason");
  const groups = denseArray(ownData(event, "addedGroups"), DIRECTOR_GROUP_LIMIT);
  if (!Number.isSafeInteger(waveIndex) || waveIndex < 0 || counterId === undefined
    || typeof threatCost !== "number" || !Number.isFinite(threatCost) || threatCost < 0
    || reason === INVALID || groups === undefined) return undefined;
  const metric = ownData(reason, "metric");
  const keyValue = ownData(reason, "key");
  const operator = ownData(reason, "operator");
  const observed = ownData(reason, "observed");
  const threshold = ownData(reason, "threshold");
  const key = keyValue === INVALID ? undefined : boundedId(keyValue);
  if (!DIRECTOR_METRICS.has(metric) || (operator !== "gte" && operator !== "lte")
    || typeof observed !== "number" || !Number.isFinite(observed) || observed < 0 || observed > 1
    || typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1
    || (metric === "logistics_brownout_ratio" ? keyValue !== INVALID : key === undefined)) return undefined;
  let addedEnemyCount = 0;
  for (const group of groups) {
    const count = ownData(group, "count");
    if (!Number.isSafeInteger(count) || count < 1) return undefined;
    addedEnemyCount += count;
    if (addedEnemyCount > DIRECTOR_ADDED_ENEMY_LIMIT) return undefined;
  }
  return Object.freeze({
    waveIndex,
    counterId,
    threatCost,
    metric,
    ...(key === undefined ? {} : { key }),
    observed,
    threshold,
    addedEnemyCount,
    label: `Director: ${counterId} (+${addedEnemyCount})`
  });
}

/** Browser-only projection shared by Canvas and Phaser. It never decides or mutates gameplay. */
export function projectDirectorDecisionCues(snapshot) {
  const director = ownData(snapshot, "director");
  if (director === INVALID || ownData(director, "schemaVersion") !== 1
    || boundedId(ownData(director, "profileId")) === undefined
    || denseArray(ownData(director, "decisions"), 1_024) === undefined) return Object.freeze([]);
  const events = denseArray(ownData(snapshot, "lastEvents"), DIRECTOR_EVENT_LIMIT);
  if (events === undefined) return Object.freeze([]);
  const cues = [];
  for (const event of events) {
    const cue = projectEvent(event);
    if (cue) cues.push(cue);
  }
  return Object.freeze(cues);
}
