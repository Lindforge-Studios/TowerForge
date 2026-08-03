export const HUD_BUILD_MENU_SCHEMA_VERSION = 1;

export const HUD_BUILD_MENU_PRESET_IDS = Object.freeze([
  "desktop_horizontal_quickbar",
  "vertical_edge_dock",
  "category_catalog_drawer",
  "radial_wheel",
  "contextual_tile_popover",
  "mobile_bottom_sheet",
  "keyboard_command_palette"
]);

export const HUD_INPUT_FAMILIES = Object.freeze(["pointer", "keyboard", "gamepad", "touch"]);

export const HUD_BUILD_MENU_LIMITS = Object.freeze({
  menus: 32,
  itemsPerMenu: 128,
  availabilityEntries: 16,
  visibleRadialItems: 12
});

const PRESET_PRIMITIVES = Object.freeze({
  desktop_horizontal_quickbar: Object.freeze(["dock", "stack", "button"]),
  vertical_edge_dock: Object.freeze(["dock", "stack", "button"]),
  category_catalog_drawer: Object.freeze(["drawer", "grid", "button"]),
  radial_wheel: Object.freeze(["radial_menu", "button"]),
  contextual_tile_popover: Object.freeze(["tile_popover", "grid", "button"]),
  mobile_bottom_sheet: Object.freeze(["drawer", "grid", "button"]),
  keyboard_command_palette: Object.freeze(["modal", "repeater", "button"])
});

const PRESET_ID_SET = new Set(HUD_BUILD_MENU_PRESET_IDS);
const INPUT_FAMILY_SET = new Set(HUD_INPUT_FAMILIES);
const FORM_FACTOR_SET = new Set(["desktop", "tablet", "mobile"]);
const PHASE_SET = new Set(["setup", "live", "between_wave"]);
const ACTION_KIND_SET = new Set(["ui", "command", "signal"]);
const ACTIVATION_CONTROLS = Object.freeze({
  pointer: "primary",
  keyboard: "Enter",
  gamepad: "south",
  touch: "tap"
});
const MENU_KEYS = Object.freeze([
  "schemaVersion", "id", "presetId", "selectorId", "actionId", "availability", "visibleItemLimit"
]);
const AVAILABILITY_KEYS = Object.freeze([
  "inputFamilies", "formFactors", "phases", "requiredCapabilities"
]);

const RECIPES = Object.freeze(HUD_BUILD_MENU_PRESET_IDS.map((id) => Object.freeze({
  schemaVersion: HUD_BUILD_MENU_SCHEMA_VERSION,
  id,
  primitiveTypes: PRESET_PRIMITIVES[id]
})));

export class HudBuildMenuValidationError extends TypeError {
  constructor(fieldPath, message) {
    super(`${fieldPath}: ${message}`);
    this.name = "HudBuildMenuValidationError";
    this.fieldPath = fieldPath;
  }
}

function fail(path, message) {
  throw new HudBuildMenuValidationError(path, message);
}

function inspectRecord(value, path, expectedKeys = undefined) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an own-data object.");
  }
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
    const expected = [...expectedKeys].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
      fail(path, "contains missing or unsupported fields.");
    }
  }
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      fail(`${path}.${key}`, "must be an enumerable own data property; accessors are forbidden.");
    }
    Object.defineProperty(result, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true
    });
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
  if (!Number.isSafeInteger(value.length) || value.length > limit) fail(path, `exceeds the limit of ${limit}.`);
  const keys = Object.keys(descriptors).filter((key) => key !== "length");
  if (keys.length !== value.length) fail(path, "must be dense and cannot contain extra fields.");
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      fail(`${path}[${index}]`, "must be an enumerable own data property.");
    }
    result.push(descriptor.value);
  }
  return result;
}

function boundedId(value, path) {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(value)) {
    fail(path, "must be a bounded identifier.");
  }
  return value;
}

function uniqueStringArray(value, path, allowed = undefined) {
  const input = inspectArray(value, path, HUD_BUILD_MENU_LIMITS.availabilityEntries);
  const seen = new Set();
  for (let index = 0; index < input.length; index += 1) {
    const item = boundedId(input[index], `${path}[${index}]`);
    if (allowed && !allowed.has(item)) fail(`${path}[${index}]`, `unsupported value "${item}".`);
    if (seen.has(item)) fail(path, `contains duplicate value "${item}".`);
    seen.add(item);
  }
  return seen;
}

function deepDetach(value, path, seen = new WeakSet(), depth = 0, budget = { count: 0 }) {
  if (depth > 8) fail(path, "exceeds the detached data depth of 8.");
  budget.count += 1;
  if (budget.count > 2048) fail(path, "exceeds the detached data budget of 2048.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value)) fail(path, "contains an invalid string.");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "must contain finite numbers.");
    return value;
  }
  if (typeof value !== "object") fail(path, "must contain JSON data only.");
  if (seen.has(value)) fail(path, "cannot contain cycles.");
  seen.add(value);
  if (Array.isArray(value)) {
    const input = inspectArray(value, path, HUD_BUILD_MENU_LIMITS.itemsPerMenu);
    const result = input.map((item, index) => deepDetach(item, `${path}[${index}]`, seen, depth + 1, budget));
    seen.delete(value);
    return Object.freeze(result);
  }
  const input = inspectRecord(value, path);
  const result = Object.create(null);
  for (const key of Object.keys(input).sort()) {
    boundedId(key, `${path}.${key}`);
    Object.defineProperty(result, key, {
      value: deepDetach(input[key], `${path}.${key}`, seen, depth + 1, budget),
      enumerable: true,
      configurable: false,
      writable: false
    });
  }
  seen.delete(value);
  return Object.freeze(result);
}

function normalizeActionIds(value) {
  const descriptors = inspectArray(value, "options.availableActions", 256);
  const ids = new Set();
  for (let index = 0; index < descriptors.length; index += 1) {
    const path = `options.availableActions[${index}]`;
    const descriptor = inspectRecord(descriptors[index], path, ["schemaVersion", "id", "labelKey", "kind"]);
    if (descriptor.schemaVersion !== 1) fail(`${path}.schemaVersion`, "must be 1.");
    const id = boundedId(descriptor.id, `${path}.id`);
    if (ids.has(id)) fail("options.availableActions", `contains duplicate action "${id}".`);
    if (typeof descriptor.labelKey !== "string" || descriptor.labelKey.length < 1 || descriptor.labelKey.length > 256) {
      fail(`${path}.labelKey`, "must be a bounded string.");
    }
    if (!ACTION_KIND_SET.has(descriptor.kind)) fail(`${path}.kind`, "must be a supported action kind.");
    ids.add(id);
  }
  return ids;
}

function normalizeSelectorDescriptors(value) {
  const descriptors = inspectArray(value, "options.selectorDescriptors", 256);
  const result = new Map();
  for (let index = 0; index < descriptors.length; index += 1) {
    const path = `options.selectorDescriptors[${index}]`;
    const descriptor = inspectRecord(descriptors[index], path, ["schemaVersion", "id", "valueType", "cardinality"]);
    if (descriptor.schemaVersion !== 1) fail(`${path}.schemaVersion`, "must be 1.");
    const id = boundedId(descriptor.id, `${path}.id`);
    if (result.has(id)) fail("options.selectorDescriptors", `contains duplicate selector "${id}".`);
    if (descriptor.valueType !== "item" || descriptor.cardinality !== "many") {
      fail(path, "build menus require an item selector with cardinality many.");
    }
    result.set(id, true);
  }
  return result;
}

function normalizeContext(value) {
  const context = inspectRecord(value, "options.context", [
    "inputFamily", "formFactor", "phase", "capabilities", "selectedTileId"
  ]);
  if (!INPUT_FAMILY_SET.has(context.inputFamily)) fail("options.context.inputFamily", "is unsupported.");
  if (!FORM_FACTOR_SET.has(context.formFactor)) fail("options.context.formFactor", "is unsupported.");
  if (!PHASE_SET.has(context.phase)) fail("options.context.phase", "is unsupported.");
  const capabilities = uniqueStringArray(context.capabilities, "options.context.capabilities");
  if (context.selectedTileId !== null) boundedId(context.selectedTileId, "options.context.selectedTileId");
  return Object.freeze({
    inputFamily: context.inputFamily,
    formFactor: context.formFactor,
    phase: context.phase,
    capabilities
  });
}

function normalizeState(value) {
  const state = inspectRecord(value, "options.state", ["selectors"]);
  return inspectRecord(state.selectors, "options.state.selectors");
}

function normalizeAvailability(value, path) {
  const availability = inspectRecord(value, path, AVAILABILITY_KEYS);
  return Object.freeze({
    inputFamilies: uniqueStringArray(availability.inputFamilies, `${path}.inputFamilies`, INPUT_FAMILY_SET),
    formFactors: uniqueStringArray(availability.formFactors, `${path}.formFactors`, FORM_FACTOR_SET),
    phases: uniqueStringArray(availability.phases, `${path}.phases`, PHASE_SET),
    requiredCapabilities: uniqueStringArray(availability.requiredCapabilities, `${path}.requiredCapabilities`)
  });
}

function isAvailable(availability, context) {
  if (!availability.inputFamilies.has(context.inputFamily)) return false;
  if (!availability.formFactors.has(context.formFactor)) return false;
  if (!availability.phases.has(context.phase)) return false;
  for (const capability of availability.requiredCapabilities) {
    if (!context.capabilities.has(capability)) return false;
  }
  return true;
}

function normalizeMenu(value, path, actionIds, selectorDescriptors, selectors, context, menuIds) {
  const menu = inspectRecord(value, path, MENU_KEYS);
  if (menu.schemaVersion !== HUD_BUILD_MENU_SCHEMA_VERSION) fail(`${path}.schemaVersion`, "must be 1.");
  const id = boundedId(menu.id, `${path}.id`);
  if (menuIds.has(id)) fail(path, `contains duplicate menu id "${id}".`);
  menuIds.add(id);
  const presetId = boundedId(menu.presetId, `${path}.presetId`);
  if (!PRESET_ID_SET.has(presetId)) fail(`${path}.presetId`, `unsupported preset "${presetId}".`);
  const selectorId = boundedId(menu.selectorId, `${path}.selectorId`);
  if (!selectorDescriptors.has(selectorId)) fail(`${path}.selectorId`, `unknown selector "${selectorId}".`);
  const actionId = boundedId(menu.actionId, `${path}.actionId`);
  if (actionId !== "selectBuildSlot" || !actionIds.has(actionId)) fail(`${path}.actionId`, `unsupported action "${actionId}".`);
  if (!Number.isSafeInteger(menu.visibleItemLimit) || menu.visibleItemLimit < 1
    || menu.visibleItemLimit > HUD_BUILD_MENU_LIMITS.itemsPerMenu) {
    fail(`${path}.visibleItemLimit`, `must be between 1 and ${HUD_BUILD_MENU_LIMITS.itemsPerMenu}.`);
  }
  if (presetId === "radial_wheel" && menu.visibleItemLimit > HUD_BUILD_MENU_LIMITS.visibleRadialItems) {
    fail(`${path}.visibleItemLimit`, `radial menus cannot exceed ${HUD_BUILD_MENU_LIMITS.visibleRadialItems} visible items.`);
  }
  const availability = normalizeAvailability(menu.availability, `${path}.availability`);
  if (!Object.hasOwn(selectors, selectorId)) fail(`options.state.selectors.${selectorId}`, "is missing.");
  const sourceItems = inspectArray(selectors[selectorId], `options.state.selectors.${selectorId}`, HUD_BUILD_MENU_LIMITS.itemsPerMenu);
  const items = sourceItems.map((item, index) => {
    const detached = deepDetach(item, `options.state.selectors.${selectorId}[${index}]`);
    if (detached === null || typeof detached !== "object" || Array.isArray(detached)) {
      fail(`options.state.selectors.${selectorId}[${index}]`, "must be an item record.");
    }
    boundedId(detached.id, `options.state.selectors.${selectorId}[${index}].id`);
    if (Object.hasOwn(detached, "enabled") && typeof detached.enabled !== "boolean") {
      fail(`options.state.selectors.${selectorId}[${index}].enabled`, "must be boolean.");
    }
    return detached;
  });
  if (!isAvailable(availability, context)) return null;
  const visibleItems = Object.freeze(items.slice(0, menu.visibleItemLimit));
  return Object.freeze({
    schemaVersion: HUD_BUILD_MENU_SCHEMA_VERSION,
    id,
    presetId,
    selectorId,
    actionId,
    items: visibleItems,
    overflowItemCount: items.length - visibleItems.length
  });
}

function compile(menuDefinitions, options) {
  const definitions = inspectArray(menuDefinitions, "menuDefinitions", HUD_BUILD_MENU_LIMITS.menus);
  const optionRecord = inspectRecord(options, "options", [
    "availableActions", "selectorDescriptors", "state", "context"
  ]);
  const actionIds = normalizeActionIds(optionRecord.availableActions);
  const selectorDescriptors = normalizeSelectorDescriptors(optionRecord.selectorDescriptors);
  const selectors = normalizeState(optionRecord.state);
  const context = normalizeContext(optionRecord.context);
  const ids = new Set();
  const menus = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const normalized = normalizeMenu(
      definitions[index], `menuDefinitions[${index}]`, actionIds, selectorDescriptors, selectors, context, ids
    );
    if (normalized) menus.push(normalized);
  }
  return Object.freeze({
    schemaVersion: HUD_BUILD_MENU_SCHEMA_VERSION,
    inputFamily: context.inputFamily,
    formFactor: context.formFactor,
    phase: context.phase,
    menus: Object.freeze(menus)
  });
}

function failed(error) {
  return Object.freeze({
    ok: false,
    error: error instanceof Error ? error : new HudBuildMenuValidationError("runtime", "validation failed.")
  });
}

export function createHudBuildMenuPresetRecipesV1() {
  return RECIPES;
}

export function compileHudBuildMenuPlanV1(menuDefinitions, options) {
  try {
    return Object.freeze({ ok: true, plan: compile(menuDefinitions, options) });
  } catch (error) {
    return failed(error);
  }
}

function resolveIntent(plan, activation) {
  const planRecord = inspectRecord(plan, "plan", ["schemaVersion", "inputFamily", "formFactor", "phase", "menus"]);
  if (planRecord.schemaVersion !== HUD_BUILD_MENU_SCHEMA_VERSION) fail("plan.schemaVersion", "must be 1.");
  if (!INPUT_FAMILY_SET.has(planRecord.inputFamily)) fail("plan.inputFamily", "is unsupported.");
  if (!FORM_FACTOR_SET.has(planRecord.formFactor)) fail("plan.formFactor", "is unsupported.");
  if (!PHASE_SET.has(planRecord.phase)) fail("plan.phase", "is unsupported.");
  const menus = inspectArray(planRecord.menus, "plan.menus", HUD_BUILD_MENU_LIMITS.menus);
  const event = inspectRecord(activation, "activation", ["schemaVersion", "inputFamily", "control", "menuId", "itemId"]);
  if (event.schemaVersion !== HUD_BUILD_MENU_SCHEMA_VERSION) fail("activation.schemaVersion", "must be 1.");
  if (!INPUT_FAMILY_SET.has(event.inputFamily) || event.inputFamily !== planRecord.inputFamily) {
    fail("activation.inputFamily", "does not match the compiled plan.");
  }
  if (event.control !== ACTIVATION_CONTROLS[event.inputFamily]) fail("activation.control", "is unsupported for the input family.");
  const menuId = boundedId(event.menuId, "activation.menuId");
  const itemId = boundedId(event.itemId, "activation.itemId");
  let selectedMenu = null;
  for (let index = 0; index < menus.length; index += 1) {
    const candidate = inspectRecord(menus[index], `plan.menus[${index}]`, [
      "schemaVersion", "id", "presetId", "selectorId", "actionId", "items", "overflowItemCount"
    ]);
    if (candidate.id === menuId) {
      selectedMenu = candidate;
      break;
    }
  }
  if (!selectedMenu) fail("activation.menuId", `unknown menu "${menuId}".`);
  if (selectedMenu.actionId !== "selectBuildSlot") fail("plan.menus.actionId", "is unsupported.");
  const items = inspectArray(selectedMenu.items, "plan.menus.items", HUD_BUILD_MENU_LIMITS.itemsPerMenu);
  let selectedItem = null;
  for (let index = 0; index < items.length; index += 1) {
    const item = inspectRecord(items[index], `plan.menus.items[${index}]`);
    if (item.id === itemId) {
      selectedItem = item;
      break;
    }
  }
  if (!selectedItem) fail("activation.itemId", `unknown item "${itemId}".`);
  if (Object.hasOwn(selectedItem, "enabled") && selectedItem.enabled === false) fail("activation.itemId", "item is disabled.");
  return Object.freeze({
    schemaVersion: HUD_BUILD_MENU_SCHEMA_VERSION,
    actionId: selectedMenu.actionId,
    payload: Object.freeze({ slotId: itemId })
  });
}

export function resolveHudBuildMenuIntentV1(plan, activation) {
  try {
    return Object.freeze({ ok: true, intent: resolveIntent(plan, activation) });
  } catch (error) {
    return failed(error);
  }
}
