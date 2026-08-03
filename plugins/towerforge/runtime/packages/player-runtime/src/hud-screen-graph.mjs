import {
  HUD_CATALOG_LIMITS,
  HUD_SCREEN_CONDITION_OPERATORS,
  HUD_SCREEN_EVENTS,
  HUD_SCREEN_GRAPH_SCHEMA_VERSION,
  HUD_SYSTEM_RECOVERY_SCREEN_ID,
  validateHudCatalogV1
} from "./hud-catalog.mjs";

export {
  HUD_SCREEN_CONDITION_OPERATORS,
  HUD_SCREEN_EVENTS,
  HUD_SCREEN_GRAPH_SCHEMA_VERSION,
  HUD_SYSTEM_RECOVERY_SCREEN_ID
};

const EVENT_SET = new Set(HUD_SCREEN_EVENTS);
const OPERATOR_SET = new Set(HUD_SCREEN_CONDITION_OPERATORS);
const VALUE_TYPES = new Set(["boolean", "number", "string", "item"]);
const CARDINALITIES = new Set(["one", "many"]);

const SYSTEM_RECOVERY = Object.freeze({
  schemaVersion: HUD_SCREEN_GRAPH_SCHEMA_VERSION,
  screenId: HUD_SYSTEM_RECOVERY_SCREEN_ID,
  surface: "recoverable_error",
  builtIn: true,
  removable: false
});

class HudScreenGraphValidationError extends TypeError {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "HudScreenGraphValidationError";
    this.fieldPath = path;
  }
}

function fail(path, message) {
  throw new HudScreenGraphValidationError(path, message);
}

function inspectRecord(value, path, expectedKeys = undefined) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an own-data object.");
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(path, "must be an inspectable own-data object.");
  }
  if (prototype !== Object.prototype && prototype !== null) fail(path, "must be a plain own-data object.");
  if (Object.getOwnPropertySymbols(descriptors).length > 0) fail(path, "cannot contain symbol keys.");
  const keys = Object.keys(descriptors).sort();
  if (expectedKeys) {
    const expected = new Set(expectedKeys);
    for (const key of keys) if (!expected.has(key)) fail(`${path}.${key}`, `unknown field "${key}".`);
    for (const key of expectedKeys) if (!Object.hasOwn(descriptors, key)) fail(`${path}.${key}`, "missing required field.");
  }
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !descriptor.enumerable) fail(`${path}.${key}`, "must be enumerable own data; accessors are forbidden.");
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true, configurable: true, writable: true });
  }
  return result;
}

function inspectArray(value, path, limit) {
  if (!Array.isArray(value)) fail(path, "must be a dense own-data array.");
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(path, "must be an inspectable dense own-data array.");
  }
  if (prototype !== Array.prototype) fail(path, "must be a plain array.");
  if (Object.getOwnPropertySymbols(descriptors).length > 0) fail(path, "cannot contain symbol keys.");
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > limit) fail(path, `exceeds the limit of ${limit}.`);
  const keys = Object.keys(descriptors).filter((key) => key !== "length");
  if (keys.length !== length) fail(path, "must be dense and cannot contain extra fields.");
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail(`${path}[${index}]`, "must be enumerable own data.");
    result.push(descriptor.value);
  }
  return result;
}

function descriptorId(value, path) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(value)) {
    fail(path, "must be a bounded descriptor identifier.");
  }
  return value;
}

function validateScalar(value, valueType, path) {
  if (valueType === "number" && (typeof value !== "number" || !Number.isFinite(value))) fail(path, "must be a finite number.");
  if (valueType === "string" && (typeof value !== "string" || value.length > 2048)) fail(path, "must be a bounded string.");
  if (valueType === "boolean" && typeof value !== "boolean") fail(path, "must be a boolean.");
  if (valueType === "item") fail(path, "item selectors cannot be used as scalar screen conditions.");
}

function cloneDetachedJson(value, path, seen = new WeakSet(), depth = 0, budget = { count: 0 }) {
  if (depth > 8) fail(path, "exceeds detached data depth 8.");
  budget.count += 1;
  if (budget.count > 2048) fail(path, "exceeds detached data budget 2048.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "must contain finite numbers.");
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 2048) fail(path, "must contain bounded strings.");
    return value;
  }
  if (typeof value !== "object") fail(path, "must contain JSON data only.");
  if (seen.has(value)) fail(path, "cannot contain cycles.");
  seen.add(value);
  if (Array.isArray(value)) {
    const input = inspectArray(value, path, HUD_CATALOG_LIMITS.repeaterItemsPerScreen);
    const result = Object.freeze(input.map((item, index) => cloneDetachedJson(item, `${path}[${index}]`, seen, depth + 1, budget)));
    seen.delete(value);
    return result;
  }
  const input = inspectRecord(value, path);
  const result = Object.create(null);
  for (const key of Object.keys(input).sort()) {
    Object.defineProperty(result, key, {
      value: cloneDetachedJson(input[key], `${path}.${key}`, seen, depth + 1, budget),
      enumerable: true,
      configurable: false,
      writable: false
    });
  }
  seen.delete(value);
  return Object.freeze(result);
}

function validateStateValue(value, descriptor, path) {
  if (descriptor.cardinality === "many") {
    if (!Array.isArray(value)) fail(path, "must be an array for cardinality many.");
    for (let index = 0; index < value.length; index += 1) {
      if (descriptor.valueType === "item") {
        if (value[index] === null || typeof value[index] !== "object" || Array.isArray(value[index])) {
          fail(`${path}[${index}]`, "must be a detached item record.");
        }
      } else {
        validateScalar(value[index], descriptor.valueType, `${path}[${index}]`);
      }
    }
    return;
  }
  if (descriptor.valueType === "item") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, "must be a detached item record.");
    return;
  }
  validateScalar(value, descriptor.valueType, path);
}

function normalizeDescriptors(value) {
  const input = inspectArray(value, "options.selectorDescriptors", 256);
  const descriptors = new Map();
  for (let index = 0; index < input.length; index += 1) {
    const path = `options.selectorDescriptors[${index}]`;
    const record = inspectRecord(input[index], path, ["schemaVersion", "id", "valueType", "cardinality"]);
    if (record.schemaVersion !== 1) fail(`${path}.schemaVersion`, "must be 1.");
    const id = descriptorId(record.id, `${path}.id`);
    if (descriptors.has(id)) fail("options.selectorDescriptors", `duplicate selector id "${id}".`);
    if (!VALUE_TYPES.has(record.valueType)) fail(`${path}.valueType`, "unsupported selector value type.");
    if (!CARDINALITIES.has(record.cardinality)) fail(`${path}.cardinality`, "unsupported selector cardinality.");
    descriptors.set(id, Object.freeze({ valueType: record.valueType, cardinality: record.cardinality }));
  }
  return descriptors;
}

function normalizeState(value, descriptors) {
  const state = inspectRecord(value, "options.state", ["selectors"]);
  const selectors = inspectRecord(state.selectors, "options.state.selectors");
  const detached = Object.create(null);
  for (const id of Object.keys(selectors).sort()) {
    const descriptor = descriptors.get(id);
    if (!descriptor) fail(`options.state.selectors.${id}`, `selector "${id}" has no descriptor.`);
    const value = cloneDetachedJson(selectors[id], `options.state.selectors.${id}`);
    validateStateValue(value, descriptor, `options.state.selectors.${id}`);
    Object.defineProperty(detached, id, {
      value, enumerable: true, configurable: false, writable: false
    });
  }
  return Object.freeze(detached);
}

function validateConditions(profile, descriptors, state) {
  for (const transition of profile.screenGraph.transitions) {
    for (const condition of transition.conditions) {
      const descriptor = descriptors.get(condition.selectorId);
      if (!descriptor) fail(`profile.screenGraph.transitions.${transition.id}`, `unknown selector "${condition.selectorId}".`);
      if (descriptor.cardinality !== "one") fail(`profile.screenGraph.transitions.${transition.id}`, "conditions require cardinality-one selectors.");
      if (!OPERATOR_SET.has(condition.operator)) fail(`profile.screenGraph.transitions.${transition.id}`, "contains an unknown operator.");
      validateScalar(condition.value, descriptor.valueType, `profile.screenGraph.transitions.${transition.id}.value`);
      if (!Object.hasOwn(state, condition.selectorId)) {
        fail("options.state.selectors", `missing selector value "${condition.selectorId}".`);
      }
    }
  }
}

function compare(condition, actual) {
  switch (condition.operator) {
    case "equals": return actual === condition.value;
    case "not_equals": return actual !== condition.value;
    case "less_than": return typeof actual === "number" && typeof condition.value === "number" && actual < condition.value;
    case "less_than_or_equal": return typeof actual === "number" && typeof condition.value === "number" && actual <= condition.value;
    case "greater_than": return typeof actual === "number" && typeof condition.value === "number" && actual > condition.value;
    case "greater_than_or_equal": return typeof actual === "number" && typeof condition.value === "number" && actual >= condition.value;
    case "truthy": return Boolean(actual);
    case "falsy": return !actual;
    default: return false;
  }
}

function frozenSnapshot(currentScreenId, recoveryActive) {
  return Object.freeze({
    schemaVersion: HUD_SCREEN_GRAPH_SCHEMA_VERSION,
    currentScreenId,
    recoveryActive
  });
}

function createSession({ ok, profile, descriptors, initialState, error }) {
  let currentScreenId = ok ? profile.screenGraph.initialScreenId : HUD_SYSTEM_RECOVERY_SCREEN_ID;
  let recoveryActive = !ok;
  let state = initialState;

  function enterRecovery(reason) {
    currentScreenId = HUD_SYSTEM_RECOVERY_SCREEN_ID;
    recoveryActive = true;
    return Object.freeze({
      ok: false,
      transitioned: false,
      currentScreenId,
      recoveryActive,
      ...(reason ? { error: reason } : {})
    });
  }

  function dispatch(event, stateOverride = undefined) {
    try {
      if (recoveryActive || !ok) return enterRecovery(error);
      if (typeof event !== "string" || !EVENT_SET.has(event)) return enterRecovery(new TypeError("Unknown HUD screen event."));
      const runtimeState = stateOverride === undefined ? state : normalizeState(stateOverride, descriptors);
      validateConditions(profile, descriptors, runtimeState);
      if (stateOverride !== undefined) state = runtimeState;
      const previousScreenId = currentScreenId;
      for (const transition of profile.screenGraph.transitions) {
        if (transition.event !== event) continue;
        if (Object.hasOwn(transition, "fromScreenId") && transition.fromScreenId !== currentScreenId) continue;
        if (!transition.conditions.every((condition) => compare(condition, runtimeState[condition.selectorId]))) continue;
        currentScreenId = transition.targetScreenId;
        return Object.freeze({
          ok: true,
          transitioned: true,
          transitionId: transition.id,
          previousScreenId,
          currentScreenId,
          recoveryActive: false
        });
      }
      return Object.freeze({ ok: true, transitioned: false, currentScreenId, recoveryActive: false });
    } catch (dispatchError) {
      return enterRecovery(dispatchError instanceof Error ? dispatchError : new TypeError("HUD screen dispatch failed closed."));
    }
  }

  return Object.freeze({
    ok,
    ...(error ? { error } : {}),
    systemRecovery: SYSTEM_RECOVERY,
    snapshot: () => frozenSnapshot(currentScreenId, recoveryActive),
    dispatch
  });
}

export function createHudScreenGraphSessionV1(profileValue, optionsValue) {
  try {
    const options = inspectRecord(optionsValue, "options", ["selectorDescriptors", "state"]);
    const descriptors = normalizeDescriptors(options.selectorDescriptors);
    const state = normalizeState(options.state, descriptors);
    const validation = validateHudCatalogV1({ schemaVersion: 1, profiles: { active: profileValue } });
    if (!validation.ok) throw validation.error;
    const profile = validation.catalog.profiles.active;
    if (profile.screenGraph.schemaVersion !== HUD_SCREEN_GRAPH_SCHEMA_VERSION) fail("profile.screenGraph.schemaVersion", "must be 1.");
    if (profile.screenGraph.transitions.length > HUD_CATALOG_LIMITS.transitionsPerProfile) fail("profile.screenGraph.transitions", "exceeds transition budget.");
    validateConditions(profile, descriptors, state);
    return createSession({ ok: true, profile, descriptors, initialState: state });
  } catch (error) {
    const closedError = error instanceof Error ? error : new TypeError("HUD screen graph session failed closed.");
    return createSession({ ok: false, error: closedError });
  }
}
