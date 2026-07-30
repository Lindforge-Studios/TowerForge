const SOURCE_KINDS = Object.freeze(["tower", "ability", "tower_script", "status", "reaction", "enemy"]);
const SOURCE_KIND_SET = new Set(SOURCE_KINDS);
const INACTIVE = Object.freeze({
  active: false,
  cohorts: Object.freeze([]),
  cues: Object.freeze([])
});

function ownRecord(value, required, optional = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) return null;
    const allowed = new Set([...required, ...optional]);
    if (Object.keys(descriptors).some((key) => !allowed.has(key))) return null;
    for (const key of required) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    }
    for (const key of optional) {
      const descriptor = descriptors[key];
      if (descriptor && (!descriptor.enumerable || !("value" in descriptor))) return null;
    }
    return descriptors;
  } catch {
    return null;
  }
}

function field(descriptors, key) {
  return descriptors?.[key]?.value;
}

function ownField(value, key) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function dictionary(value, maximum) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) return null;
    const keys = Object.keys(descriptors);
    if (keys.length > maximum || keys.some((key) => {
      const descriptor = descriptors[key];
      return key.length === 0 || !descriptor?.enumerable || !("value" in descriptor);
    })) return null;
    return { descriptors, keys: keys.sort((left, right) => left < right ? -1 : left > right ? 1 : 0) };
  } catch {
    return null;
  }
}

function sourceKinds(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length === 0 || length > SOURCE_KINDS.length) return null;
    const allowed = new Set(["length", ...Array.from({ length }, (_, index) => String(index))]);
    if (
      Object.getOwnPropertySymbols(descriptors).length > 0
      || Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !allowed.has(key))
    ) return null;
    const selected = new Set();
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !("value" in descriptor)) return null;
      const kind = descriptor.value;
      if (!SOURCE_KIND_SET.has(kind) || selected.has(kind)) return null;
      selected.add(kind);
    }
    return Object.freeze(SOURCE_KINDS.filter((kind) => selected.has(kind)));
  } catch {
    return null;
  }
}

function eventArray(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 4_096) return null;
    const allowed = new Set(["length", ...Array.from({ length }, (_, index) => String(index))]);
    if (
      Object.getOwnPropertySymbols(descriptors).length > 0
      || Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !allowed.has(key))
    ) return null;
    const events = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !("value" in descriptor)) return null;
      events.push(descriptor.value);
    }
    return events;
  } catch {
    return null;
  }
}

function eventType(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, "type");
    return descriptor?.enumerable && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

/** Fail-closed projection of authoritative vanguard-protection metadata and presentation cues. */
export function projectVanguardProtectionPresentation(snapshot) {
  const enemyBehaviorsValue = ownField(snapshot, "enemyBehaviors");
  if (enemyBehaviorsValue === undefined) return INACTIVE;
  const enemyBehaviors = ownRecord(enemyBehaviorsValue, ["schemaVersion", "components"], ["formations"]);
  if (!enemyBehaviors || field(enemyBehaviors, "schemaVersion") !== 1) return INACTIVE;
  const formations = ownRecord(field(enemyBehaviors, "formations"), ["schemaVersion", "enemies"], ["protection"]);
  if (!formations || field(formations, "schemaVersion") !== 1) return INACTIVE;
  const protection = ownRecord(field(formations, "protection"), ["schemaVersion", "cohorts"]);
  if (!protection || field(protection, "schemaVersion") !== 1) return INACTIVE;
  const cohorts = dictionary(field(protection, "cohorts"), 64);
  if (!cohorts) return INACTIVE;

  const projectedCohorts = [];
  const cohortIds = new Set(cohorts.keys);
  for (const cohortId of cohorts.keys) {
    const cohort = ownRecord(field(cohorts.descriptors, cohortId), ["radius", "sourceKinds"]);
    if (!cohort) return INACTIVE;
    const radius = field(cohort, "radius");
    const kinds = sourceKinds(field(cohort, "sourceKinds"));
    if (!Number.isSafeInteger(radius) || radius < 1 || radius > 4 || !kinds) return INACTIVE;
    projectedCohorts.push(Object.freeze({ cohortId, radius, sourceKinds: kinds }));
  }

  const lastEventsValue = ownField(snapshot, "lastEvents");
  const lastEvents = lastEventsValue === undefined ? [] : eventArray(lastEventsValue);
  if (!lastEvents) return INACTIVE;
  const cues = [];
  for (const value of lastEvents) {
    const type = eventType(value);
    if (type === null) return INACTIVE;
    if (type !== "vanguardDamageIntercepted") continue;
    const event = ownRecord(value, [
      "type", "cohortId", "protectedEnemyId", "protectedEnemyTypeId", "vanguardEnemyId",
      "vanguardEnemyTypeId", "sourceKind", "requestedAmount", "originalComponentId"
    ]);
    if (!event) return INACTIVE;
    const cohortId = field(event, "cohortId");
    const sourceKind = field(event, "sourceKind");
    const requestedAmount = field(event, "requestedAmount");
    const originalComponentId = field(event, "originalComponentId");
    const strings = [
      field(event, "protectedEnemyId"), field(event, "protectedEnemyTypeId"),
      field(event, "vanguardEnemyId"), field(event, "vanguardEnemyTypeId")
    ];
    if (
      typeof cohortId !== "string" || !cohortIds.has(cohortId)
      || !SOURCE_KIND_SET.has(sourceKind)
      || !Number.isFinite(requestedAmount) || requestedAmount <= 0
      || strings.some((item) => typeof item !== "string" || item.length === 0)
      || (originalComponentId !== null && (typeof originalComponentId !== "string" || originalComponentId.length === 0))
    ) return INACTIVE;
    cues.push(Object.freeze({
      cohortId,
      protectedEnemyId: strings[0],
      protectedEnemyTypeId: strings[1],
      vanguardEnemyId: strings[2],
      vanguardEnemyTypeId: strings[3],
      sourceKind,
      requestedAmount,
      originalComponentId
    }));
  }
  return Object.freeze({
    active: true,
    cohorts: Object.freeze(projectedCohorts),
    cues: Object.freeze(cues)
  });
}
