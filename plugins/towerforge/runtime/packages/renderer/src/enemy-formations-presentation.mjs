const INACTIVE = Object.freeze({ active: false, rows: Object.freeze([]) });
const MAX_FORMATION_ENEMIES = 4096;
const ROLES = new Set(["vanguard", "body", "support"]);

function ownDataRecord(value, required, optional = []) {
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

function dictionary(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) return null;
    const keys = Object.keys(descriptors);
    if (keys.length > MAX_FORMATION_ENEMIES) return null;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!key || !descriptor?.enumerable || !("value" in descriptor)) return null;
    }
    return { descriptors, keys: keys.sort((left, right) => left < right ? -1 : left > right ? 1 : 0) };
  } catch {
    return null;
  }
}

/** Fail-closed projection over active authoritative membership state. */
export function projectEnemyFormationsPresentation(snapshot) {
  const enemyBehaviorsValue = ownField(snapshot, "enemyBehaviors");
  if (enemyBehaviorsValue === undefined) return INACTIVE;
  const enemyBehaviors = ownDataRecord(enemyBehaviorsValue, ["schemaVersion", "components"], ["formations"]);
  if (!enemyBehaviors || field(enemyBehaviors, "schemaVersion") !== 1) return INACTIVE;
  const formationsValue = field(enemyBehaviors, "formations");
  if (formationsValue === undefined) return INACTIVE;
  const formations = ownDataRecord(formationsValue, ["schemaVersion", "enemies"], ["protection"]);
  if (!formations || field(formations, "schemaVersion") !== 1) return INACTIVE;
  const enemies = dictionary(field(formations, "enemies"));
  if (!enemies) return INACTIVE;

  const rows = [];
  for (const enemyId of enemies.keys) {
    const membership = ownDataRecord(field(enemies.descriptors, enemyId), ["cohortId", "role"]);
    if (!membership) return INACTIVE;
    const cohortId = field(membership, "cohortId");
    const role = field(membership, "role");
    if (typeof cohortId !== "string" || cohortId.length === 0 || !ROLES.has(role)) return INACTIVE;
    rows.push(Object.freeze({ enemyId, cohortId, role }));
  }
  return Object.freeze({ active: true, rows: Object.freeze(rows) });
}
