const MAX_PRESENTATION_EVENTS = 256;
const MAX_EVENT_INPUT = 4_096;
const MAX_COORDINATE = 1_000_000;
const MAX_ID_BYTES = 128;

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
    detached[key] = descriptor.value;
  }
  return detached;
}

function ownDataValue(value, key) {
  if (value === null || typeof value !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function densePrefix(value) {
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
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_EVENT_INPUT) return null;
  const prefix = [];
  for (let index = 0; index < Math.min(length, MAX_PRESENTATION_EVENTS); index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    prefix.push(descriptor.value);
  }
  return prefix;
}

function text(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return new TextEncoder().encode(value).length <= MAX_ID_BYTES ? value : null;
  } catch {
    return null;
  }
}

function coord(value) {
  const record = dataRecord(value, ["q", "r"]);
  if (!record || !Object.hasOwn(record, "q") || !Object.hasOwn(record, "r")) return null;
  if (
    !Number.isSafeInteger(record.q)
    || !Number.isSafeInteger(record.r)
    || record.q < 0
    || record.r < 0
    || record.q > MAX_COORDINATE
    || record.r > MAX_COORDINATE
  ) return null;
  return { q: record.q, r: record.r };
}

function source(record) {
  const sourceKind = record.sourceKind === "tower" || record.sourceKind === "ability"
    ? record.sourceKind
    : null;
  const sourceId = text(record.sourceId);
  const sourceCoord = coord(record.sourceCoord);
  return sourceKind && sourceId && sourceCoord ? { sourceKind, sourceId, sourceCoord } : null;
}

function displacementCue(value) {
  const record = dataRecord(value, [
    "type", "sourceKind", "sourceId", "sourceCoord", "enemyId", "enemyTypeId", "mode",
    "requestedDistance", "movedDistance", "from", "to", "stopReason"
  ]);
  if (!record || record.type !== "enemyDisplacementResolved") return null;
  const origin = source(record);
  const enemyId = text(record.enemyId);
  const from = coord(record.from);
  const to = coord(record.to);
  const stopReason = text(record.stopReason);
  if (
    !origin
    || !enemyId
    || (Object.hasOwn(record, "enemyTypeId") && !text(record.enemyTypeId))
    || (record.mode !== "push" && record.mode !== "pull")
    || !Number.isSafeInteger(record.requestedDistance)
    || record.requestedDistance < 1
    || record.requestedDistance > 8
    || !Number.isSafeInteger(record.movedDistance)
    || record.movedDistance < 0
    || record.movedDistance > record.requestedDistance
    || !from
    || !to
    || !stopReason
  ) return null;
  return {
    kind: "displacement",
    ...origin,
    enemyId,
    mode: record.mode,
    requestedDistance: record.requestedDistance,
    movedDistance: record.movedDistance,
    from,
    to,
    stopReason
  };
}

function fallCue(value) {
  const record = dataRecord(value, [
    "type", "sourceKind", "sourceId", "sourceCoord", "enemyId", "enemyTypeId", "from", "to", "terrainTag"
  ]);
  if (!record || record.type !== "enemyFell") return null;
  const origin = source(record);
  const enemyId = text(record.enemyId);
  const from = coord(record.from);
  const to = coord(record.to);
  const terrainTag = text(record.terrainTag);
  if (
    !origin
    || !enemyId
    || (Object.hasOwn(record, "enemyTypeId") && !text(record.enemyTypeId))
    || !from
    || !to
    || !terrainTag
  ) return null;
  return { kind: "fall", ...origin, enemyId, from, to, terrainTag };
}

/** Detach bounded, engine-authored optional physics events for renderer cues. */
export function projectPhysicsPresentationCues(snapshot) {
  const events = densePrefix(ownDataValue(snapshot, "lastEvents"));
  if (events === null) return [];
  const cues = [];
  for (const event of events) {
    const type = ownDataValue(event, "type");
    const cue = type === "enemyDisplacementResolved"
      ? displacementCue(event)
      : type === "enemyFell"
        ? fallCue(event)
        : null;
    if (cue) cues.push(cue);
  }
  return cues;
}
