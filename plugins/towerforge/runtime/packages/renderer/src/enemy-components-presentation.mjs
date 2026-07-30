const INACTIVE_ENEMY_COMPONENTS_PRESENTATION = Object.freeze({
  active: false,
  rows: Object.freeze([])
});

const MAX_ROOTS = 4096;
const MAX_COMPONENTS_PER_ROOT = 32;

function ownRecord(value, required, optional) {
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

function data(descriptors, key) {
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
  let descriptors;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) return null;
  } catch {
    return null;
  }
  const keys = Object.keys(descriptors);
  if (keys.length > maximum) return null;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor) || key.length === 0) return null;
  }
  return { descriptors, keys: keys.sort((left, right) => left < right ? -1 : left > right ? 1 : 0) };
}

function finite(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

/** Fail-closed projection over authoritative optional snapshot state; never derives gameplay rules. */
export function projectEnemyComponentsPresentation(snapshot) {
  const sectionValue = ownField(snapshot, "enemyBehaviors");
  if (sectionValue === undefined) return INACTIVE_ENEMY_COMPONENTS_PRESENTATION;
  const section = ownRecord(sectionValue, ["schemaVersion", "components"], []);
  if (!section || data(section, "schemaVersion") !== 1) return INACTIVE_ENEMY_COMPONENTS_PRESENTATION;
  const roots = dictionary(data(section, "components"), MAX_ROOTS);
  if (!roots) return INACTIVE_ENEMY_COMPONENTS_PRESENTATION;
  const rows = [];
  for (const enemyId of roots.keys) {
    const components = dictionary(data(roots.descriptors, enemyId), MAX_COMPONENTS_PER_ROOT);
    if (!components) return INACTIVE_ENEMY_COMPONENTS_PRESENTATION;
    for (const componentId of components.keys) {
      const component = ownRecord(
        data(components.descriptors, componentId),
        ["hp", "maxHp"],
        ["shield"]
      );
      if (!component) return INACTIVE_ENEMY_COMPONENTS_PRESENTATION;
      const hp = data(component, "hp");
      const maxHp = data(component, "maxHp");
      if (!finite(maxHp, Number.MIN_VALUE, Number.MAX_VALUE) || !finite(hp, 0, maxHp)) {
        return INACTIVE_ENEMY_COMPONENTS_PRESENTATION;
      }
      const shieldValue = data(component, "shield");
      let shield = null;
      if (shieldValue !== undefined) {
        const descriptors = ownRecord(
          shieldValue,
          ["current", "capacity", "regenerationDelayRemaining"],
          []
        );
        if (!descriptors) return INACTIVE_ENEMY_COMPONENTS_PRESENTATION;
        const current = data(descriptors, "current");
        const capacity = data(descriptors, "capacity");
        const regenerationDelayRemaining = data(descriptors, "regenerationDelayRemaining");
        if (!finite(capacity, Number.MIN_VALUE, Number.MAX_VALUE)
          || !finite(current, 0, capacity)
          || !finite(regenerationDelayRemaining, 0, Number.MAX_VALUE)) {
          return INACTIVE_ENEMY_COMPONENTS_PRESENTATION;
        }
        shield = Object.freeze({
          current,
          capacity,
          regenerationDelayRemaining,
          ratio: current / capacity
        });
      }
      rows.push(Object.freeze({
        enemyId,
        componentId,
        hp,
        maxHp,
        hpRatio: hp / maxHp,
        destroyed: hp === 0,
        shield
      }));
    }
  }
  return Object.freeze({ active: true, rows: Object.freeze(rows) });
}
