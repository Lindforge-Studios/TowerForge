export const HUD_CATALOG_SCHEMA_VERSION = 1;

export const HUD_CATALOG_LIMITS = Object.freeze({
  profiles: 16,
  screensPerProfile: 32,
  nodesPerProfile: 512,
  nestingDepth: 16,
  layoutRecordsPerProfile: 1536,
  transitionsPerProfile: 256,
  conditionTermsPerTransition: 16,
  visibleRadialItems: 12,
  repeaterItemsPerScreen: 128
});

export const HUD_COMPONENT_TYPES = Object.freeze([
  "text", "localized_text", "image", "icon", "counter", "progress_bar", "status_chip",
  "button", "toggle", "slider", "select", "panel", "nine_slice", "stack", "grid", "dock",
  "drawer", "modal", "repeater", "build_menu", "ability_bar", "selected_entity_card",
  "radial_menu", "tile_popover"
]);
export const HUD_COMPONENT_STATES = Object.freeze([
  "normal", "hover", "pressed", "disabled", "selected", "focused"
]);
export const HUD_LAYOUT_LAYERS = Object.freeze(["background", "content", "overlay", "modal", "system"]);

const COMPONENT_TYPE_SET = new Set(HUD_COMPONENT_TYPES);
const COMPONENT_STATE_SET = new Set(HUD_COMPONENT_STATES);
const LAYER_SET = new Set(HUD_LAYOUT_LAYERS);
const PROFILE_KEYS = [
  "schemaVersion", "label", "breakpoints", "commonNodes", "variants", "screens", "screenGraph", "assetRoles"
];
const NODE_KEYS = ["schemaVersion", "id", "type", "childIds", "properties", "bindings", "states"];
const VARIANT_IDS = ["desktop", "tablet", "mobile"];
const SURFACES = new Set([
  "title", "profile_selection", "loading", "mission_selection", "campaign_selection", "story", "setup",
  "gameplay", "between_wave", "draft", "pause", "settings", "victory", "defeat", "result",
  "recoverable_error"
]);
const ACTION_EVENTS = new Set(["activate", "change", "toggle", "select", "open", "close"]);
const FORBIDDEN_DATA_KEYS = /^(?:javascript|html|css|style|stylesheet|class|className|url|uri|href|src|path|host|eval|code)$/iu;
const UNSAFE_STRING = /^(?:javascript:|data:|https?:|file:|\/|\\|\.\.[/\\])/iu;

export class HudCatalogValidationError extends TypeError {
  constructor(fieldPath, message) {
    super(`${fieldPath}: ${message}`);
    this.name = "HudCatalogValidationError";
    this.fieldPath = fieldPath;
  }
}

function fail(path, message) {
  throw new HudCatalogValidationError(path, message);
}

function inspectRecord(value, path, allowedKeys = undefined) {
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
  if (allowedKeys) {
    const allowed = new Set(allowedKeys);
    for (const key of keys) if (!allowed.has(key)) fail(`${path}.${key}`, `unknown field "${key}".`);
    for (const key of allowedKeys) if (!Object.hasOwn(descriptors, key)) fail(`${path}.${key}`, "missing required field.");
  }
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !descriptor.enumerable) {
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
  const elementKeys = Object.keys(descriptors).filter((key) => key !== "length");
  if (elementKeys.length !== value.length) fail(path, "must be dense and cannot contain extra fields.");
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
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(path, "must be a non-empty bounded JSON identifier.");
  }
  return value;
}

function descriptorId(value, path) {
  boundedId(value, path);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(value)) fail(path, "must be a descriptor identifier, not an object path.");
  return value;
}

function schemaV1(value, path) {
  if (value !== HUD_CATALOG_SCHEMA_VERSION) {
    fail(path, Number.isInteger(value) && value > HUD_CATALOG_SCHEMA_VERSION
      ? `future schemaVersion ${value} is not supported.`
      : `must be ${HUD_CATALOG_SCHEMA_VERSION}.`);
  }
  return HUD_CATALOG_SCHEMA_VERSION;
}

function freezeRecord(entries) {
  const result = Object.create(null);
  for (const [key, value] of entries) {
    Object.defineProperty(result, key, { value, enumerable: true, configurable: false, writable: false });
  }
  return Object.freeze(result);
}

function normalizeStringArray(value, path, limit) {
  const input = inspectArray(value, path, limit);
  return Object.freeze(input.map((item, index) => boundedId(item, `${path}[${index}]`)));
}

function normalizeBoundedJson(value, path, seen = new WeakSet(), depth = 0, budget = { count: 0 }) {
  if (depth > 8) fail(path, "exceeds the maximum data depth of 8.");
  budget.count += 1;
  if (budget.count > 256) fail(path, "exceeds the bounded data value budget of 256.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "must contain only finite numbers.");
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 2048 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(path, "contains an invalid string.");
    if (UNSAFE_STRING.test(value)) fail(path, "cannot contain a URL or host path.");
    return value;
  }
  if (typeof value !== "object") fail(path, "must be JSON data.");
  if (seen.has(value)) fail(path, "cannot contain cycles.");
  seen.add(value);
  if (Array.isArray(value)) {
    const input = inspectArray(value, path, 128);
    const result = Object.freeze(input.map((item, index) => normalizeBoundedJson(item, `${path}[${index}]`, seen, depth + 1, budget)));
    seen.delete(value);
    return result;
  }
  const input = inspectRecord(value, path);
  const entries = Object.keys(input).sort().map((key) => {
    if (FORBIDDEN_DATA_KEYS.test(key)) fail(`${path}.${key}`, "executable, markup, style, URL and host-path fields are forbidden.");
    boundedId(key, `${path}.${key}`);
    return [key, normalizeBoundedJson(input[key], `${path}.${key}`, seen, depth + 1, budget)];
  });
  seen.delete(value);
  return freezeRecord(entries);
}

function normalizeViewport(value, path) {
  const record = inspectRecord(value, path, ["width", "height"]);
  for (const key of ["width", "height"]) {
    if (!Number.isFinite(record[key]) || record[key] <= 0 || record[key] > 16384) {
      fail(`${path}.${key}`, "must be a finite positive number no greater than 16384.");
    }
  }
  return freezeRecord([["width", record.width], ["height", record.height]]);
}

function boundedLayoutNumber(value, path, { positive = false, integer = false, maximum = 16384 } = {}) {
  if (!Number.isFinite(value) || (positive && value < 0) || (integer && !Number.isSafeInteger(value)) || Math.abs(value) > maximum) {
    fail(path, `must be a bounded${positive ? " non-negative" : ""} finite number.`);
  }
  return value;
}

function normalizeSize(value, path) {
  const record = inspectRecord(value, path, ["width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight"]);
  const entries = [];
  for (const key of ["width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight"]) {
    entries.push([key, boundedLayoutNumber(record[key], `${path}.${key}`, { positive: true })]);
  }
  if (record.minWidth > record.width || record.width > record.maxWidth
    || record.minHeight > record.height || record.height > record.maxHeight) {
    fail(path, "minimum, preferred and maximum sizes must be ordered.");
  }
  return freezeRecord(entries);
}

function normalizePlacement(value, path) {
  const probe = inspectRecord(value, path);
  const kind = probe.kind;
  if (kind === "anchor") {
    const record = inspectRecord(value, path, ["kind", "horizontal", "vertical", "offsetX", "offsetY"]);
    if (!["left", "center", "right", "stretch"].includes(record.horizontal)) fail(`${path}.horizontal`, "unsupported anchor.");
    if (!["top", "center", "bottom", "stretch"].includes(record.vertical)) fail(`${path}.vertical`, "unsupported anchor.");
    return freezeRecord([
      ["kind", kind], ["horizontal", record.horizontal], ["vertical", record.vertical],
      ["offsetX", boundedLayoutNumber(record.offsetX, `${path}.offsetX`)],
      ["offsetY", boundedLayoutNumber(record.offsetY, `${path}.offsetY`)]
    ]);
  }
  if (kind === "flow") {
    const record = inspectRecord(value, path, ["kind", "order", "grow"]);
    return freezeRecord([
      ["kind", kind],
      ["order", boundedLayoutNumber(record.order, `${path}.order`, { integer: true, maximum: 4096 })],
      ["grow", boundedLayoutNumber(record.grow, `${path}.grow`, { positive: true, maximum: 1024 })]
    ]);
  }
  if (kind === "dock") {
    const record = inspectRecord(value, path, ["kind", "edge", "offset", "order"]);
    if (!["top", "right", "bottom", "left", "fill"].includes(record.edge)) fail(`${path}.edge`, "unsupported dock edge.");
    return freezeRecord([
      ["kind", kind], ["edge", record.edge],
      ["offset", boundedLayoutNumber(record.offset, `${path}.offset`)],
      ["order", boundedLayoutNumber(record.order, `${path}.order`, { integer: true, maximum: 4096 })]
    ]);
  }
  if (kind === "stack" || kind === "grid") {
    const record = inspectRecord(value, path, kind === "stack"
      ? ["kind", "order", "gap"]
      : ["kind", "row", "column", "rowSpan", "columnSpan"]);
    const entries = [["kind", kind]];
    for (const key of Object.keys(record).filter((key) => key !== "kind").sort()) {
      entries.push([key, boundedLayoutNumber(record[key], `${path}.${key}`, { positive: true, integer: true, maximum: 4096 })]);
    }
    return freezeRecord(entries);
  }
  fail(`${path}.kind`, `unsupported placement kind "${String(kind)}".`);
}

function normalizeLayout(value, path) {
  const record = inspectRecord(value, path, ["schemaVersion", "layer", "safeArea", "placement", "size"]);
  schemaV1(record.schemaVersion, `${path}.schemaVersion`);
  if (!LAYER_SET.has(record.layer)) fail(`${path}.layer`, `unsupported layer "${String(record.layer)}".`);
  if (typeof record.safeArea !== "boolean") fail(`${path}.safeArea`, "must be a boolean.");
  return freezeRecord([
    ["schemaVersion", HUD_CATALOG_SCHEMA_VERSION], ["layer", record.layer], ["safeArea", record.safeArea],
    ["placement", normalizePlacement(record.placement, `${path}.placement`)],
    ["size", normalizeSize(record.size, `${path}.size`)]
  ]);
}

function normalizeLayouts(value, path) {
  const record = inspectRecord(value, path);
  const ids = Object.keys(record).sort();
  if (ids.length > HUD_CATALOG_LIMITS.layoutRecordsPerProfile) fail(path, `exceeds the limit of ${HUD_CATALOG_LIMITS.layoutRecordsPerProfile}.`);
  return freezeRecord(ids.map((id) => [boundedId(id, `${path}.${id}`), normalizeLayout(record[id], `${path}.${id}`)]));
}

function normalizeVariant(value, path) {
  const probe = inspectRecord(value, path);
  const hasLayouts = Object.hasOwn(probe, "layouts");
  const record = inspectRecord(value, path, hasLayouts
    ? ["schemaVersion", "designViewport", "rootNodeIds", "layouts"]
    : ["schemaVersion", "designViewport", "rootNodeIds"]);
  const entries = [
    ["schemaVersion", schemaV1(record.schemaVersion, `${path}.schemaVersion`)],
    ["designViewport", normalizeViewport(record.designViewport, `${path}.designViewport`)],
    ["rootNodeIds", normalizeStringArray(record.rootNodeIds, `${path}.rootNodeIds`, HUD_CATALOG_LIMITS.nodesPerProfile)]
  ];
  if (hasLayouts) entries.push(["layouts", normalizeLayouts(record.layouts, `${path}.layouts`)]);
  return freezeRecord(entries);
}

function normalizeBindings(value, path) {
  const record = inspectRecord(value, path, ["data", "actions"]);
  const data = inspectArray(record.data, `${path}.data`, 64).map((binding, index) => {
    const itemPath = `${path}.data[${index}]`;
    const item = inspectRecord(binding, itemPath, ["slot", "selectorId"]);
    return freezeRecord([
      ["slot", descriptorId(item.slot, `${itemPath}.slot`)],
      ["selectorId", descriptorId(item.selectorId, `${itemPath}.selectorId`)]
    ]);
  });
  const actions = inspectArray(record.actions, `${path}.actions`, 64).map((binding, index) => {
    const itemPath = `${path}.actions[${index}]`;
    const item = inspectRecord(binding, itemPath, ["event", "actionId", "payload"]);
    if (!ACTION_EVENTS.has(item.event)) fail(`${itemPath}.event`, `unsupported action event "${String(item.event)}".`);
    return freezeRecord([
      ["event", item.event],
      ["actionId", descriptorId(item.actionId, `${itemPath}.actionId`)],
      ["payload", normalizeBoundedJson(item.payload, `${itemPath}.payload`)]
    ]);
  });
  return freezeRecord([["data", Object.freeze(data)], ["actions", Object.freeze(actions)]]);
}

function normalizeStates(value, path) {
  const record = inspectRecord(value, path);
  const stateIds = Object.keys(record).sort();
  if (!stateIds.includes("normal")) fail(`${path}.normal`, "missing required normal state.");
  const entries = stateIds.map((id) => {
    if (!COMPONENT_STATE_SET.has(id)) fail(`${path}.${id}`, `unsupported component state "${id}".`);
    const state = inspectRecord(record[id], `${path}.${id}`, ["visible", "enabled"]);
    if (typeof state.visible !== "boolean" || typeof state.enabled !== "boolean") fail(`${path}.${id}`, "visible and enabled must be booleans.");
    return [id, freezeRecord([["visible", state.visible], ["enabled", state.enabled]])];
  });
  return freezeRecord(entries);
}

function normalizeNode(value, path) {
  const probe = inspectRecord(value, path);
  const rich = Object.hasOwn(probe, "schemaVersion") || Object.hasOwn(probe, "childIds")
    || Object.hasOwn(probe, "properties") || Object.hasOwn(probe, "bindings") || Object.hasOwn(probe, "states");
  const record = inspectRecord(value, path, rich ? NODE_KEYS : ["id", "type"]);
  const type = boundedId(record.type, `${path}.type`);
  if (!COMPONENT_TYPE_SET.has(type)) fail(`${path}.type`, `unsupported component type "${type}".`);
  if (!rich) return freezeRecord([["id", boundedId(record.id, `${path}.id`)], ["type", type]]);
  return freezeRecord([
    ["schemaVersion", schemaV1(record.schemaVersion, `${path}.schemaVersion`)],
    ["id", boundedId(record.id, `${path}.id`)], ["type", type],
    ["childIds", normalizeStringArray(record.childIds, `${path}.childIds`, HUD_CATALOG_LIMITS.nodesPerProfile)],
    ["properties", normalizeBoundedJson(record.properties, `${path}.properties`)],
    ["bindings", normalizeBindings(record.bindings, `${path}.bindings`)],
    ["states", normalizeStates(record.states, `${path}.states`)]
  ]);
}

function normalizeScreen(value, path) {
  const record = inspectRecord(value, path, ["schemaVersion", "surface", "rootNodeIds"]);
  if (!SURFACES.has(record.surface)) fail(`${path}.surface`, `unsupported surface "${String(record.surface)}".`);
  return freezeRecord([
    ["schemaVersion", schemaV1(record.schemaVersion, `${path}.schemaVersion`)],
    ["surface", record.surface],
    ["rootNodeIds", normalizeStringArray(record.rootNodeIds, `${path}.rootNodeIds`, HUD_CATALOG_LIMITS.nodesPerProfile)]
  ]);
}

function normalizeScreenGraph(value, path, screens) {
  const record = inspectRecord(value, path, ["schemaVersion", "initialScreenId", "transitions"]);
  const initialScreenId = boundedId(record.initialScreenId, `${path}.initialScreenId`);
  if (!Object.hasOwn(screens, initialScreenId)) fail(`${path}.initialScreenId`, `references missing screen "${initialScreenId}".`);
  const transitions = inspectArray(record.transitions, `${path}.transitions`, HUD_CATALOG_LIMITS.transitionsPerProfile);
  if (transitions.length > 0) fail(`${path}.transitions`, "transition records are introduced by the R21.3 contract.");
  return freezeRecord([
    ["schemaVersion", schemaV1(record.schemaVersion, `${path}.schemaVersion`)],
    ["initialScreenId", initialScreenId],
    ["transitions", Object.freeze([])]
  ]);
}

function normalizeAssetRoles(value, path) {
  const record = inspectRecord(value, path);
  const entries = [];
  for (const key of Object.keys(record).sort()) {
    boundedId(key, `${path}.${key}`);
    entries.push([key, boundedId(record[key], `${path}.${key}`)]);
  }
  return freezeRecord(entries);
}

function validateNodeReferences(nodes, variants, screens, path) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const referencedRoots = [
    ...VARIANT_IDS.flatMap((id) => variants[id].rootNodeIds),
    ...Object.values(screens).flatMap((screen) => screen.rootNodeIds)
  ];
  for (const id of referencedRoots) if (!nodeMap.has(id)) fail(path, `references missing node "${id}".`);
  const visiting = new Set();
  const visited = new Set();
  function visit(id, depth) {
    if (depth > HUD_CATALOG_LIMITS.nestingDepth) fail(path, `node graph exceeds nesting depth ${HUD_CATALOG_LIMITS.nestingDepth}.`);
    if (visiting.has(id)) fail(path, `node graph contains a cycle at "${id}".`);
    if (visited.has(id)) return;
    visiting.add(id);
    const node = nodeMap.get(id);
    for (const childId of node?.childIds ?? []) {
      if (!nodeMap.has(childId)) fail(path, `node "${id}" references missing child "${childId}".`);
      visit(childId, depth + 1);
    }
    const templateId = node?.properties?.itemTemplateNodeId;
    if (templateId !== undefined) {
      boundedId(templateId, `${path}.${id}.properties.itemTemplateNodeId`);
      if (!nodeMap.has(templateId)) fail(path, `node "${id}" references missing template "${templateId}".`);
      visit(templateId, depth + 1);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of referencedRoots) visit(id, 1);
}

function normalizeProfile(value, path) {
  const record = inspectRecord(value, path, PROFILE_KEYS);
  schemaV1(record.schemaVersion, `${path}.schemaVersion`);
  if (typeof record.label !== "string" || record.label.length < 1 || record.label.length > 256) {
    fail(`${path}.label`, "must be a non-empty string no longer than 256 characters.");
  }
  const breakpoints = inspectRecord(record.breakpoints, `${path}.breakpoints`, ["mobileMax", "tabletMax"]);
  if (!Number.isSafeInteger(breakpoints.mobileMax) || !Number.isSafeInteger(breakpoints.tabletMax)
    || breakpoints.mobileMax < 1 || breakpoints.mobileMax >= breakpoints.tabletMax || breakpoints.tabletMax > 16384) {
    fail(`${path}.breakpoints`, "mobileMax and tabletMax must be finite, positive and strictly ordered.");
  }

  const nodeInputs = inspectArray(record.commonNodes, `${path}.commonNodes`, HUD_CATALOG_LIMITS.nodesPerProfile);
  const nodes = nodeInputs.map((node, index) => normalizeNode(node, `${path}.commonNodes[${index}]`));
  const nodeIds = new Set();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) fail(`${path}.commonNodes`, `duplicate node id "${node.id}".`);
    nodeIds.add(node.id);
  }

  const variantsInput = inspectRecord(record.variants, `${path}.variants`, VARIANT_IDS);
  const variants = freezeRecord(VARIANT_IDS.map((id) => [id, normalizeVariant(variantsInput[id], `${path}.variants.${id}`)]));

  const screensInput = inspectRecord(record.screens, `${path}.screens`);
  const screenIds = Object.keys(screensInput).sort();
  if (screenIds.length > HUD_CATALOG_LIMITS.screensPerProfile) fail(`${path}.screens`, `exceeds the limit of ${HUD_CATALOG_LIMITS.screensPerProfile}.`);
  const screens = freezeRecord(screenIds.map((id) => {
    boundedId(id, `${path}.screens.${id}`);
    return [id, normalizeScreen(screensInput[id], `${path}.screens.${id}`)];
  }));
  const graph = normalizeScreenGraph(record.screenGraph, `${path}.screenGraph`, screens);
  validateNodeReferences(nodes, variants, screens, `${path}.commonNodes`);
  const layoutRecords = nodes.length
    + VARIANT_IDS.reduce((sum, id) => sum + variants[id].rootNodeIds.length
      + (Object.hasOwn(variants[id], "layouts") ? Object.keys(variants[id].layouts).length : 0), 0)
    + screenIds.reduce((sum, id) => sum + screens[id].rootNodeIds.length, 0);
  if (layoutRecords > HUD_CATALOG_LIMITS.layoutRecordsPerProfile) fail(path, `layout records exceed the limit of ${HUD_CATALOG_LIMITS.layoutRecordsPerProfile}.`);

  return freezeRecord([
    ["schemaVersion", HUD_CATALOG_SCHEMA_VERSION], ["label", record.label],
    ["breakpoints", freezeRecord([["mobileMax", breakpoints.mobileMax], ["tabletMax", breakpoints.tabletMax]])],
    ["commonNodes", Object.freeze(nodes)], ["variants", variants], ["screens", screens],
    ["screenGraph", graph], ["assetRoles", normalizeAssetRoles(record.assetRoles, `${path}.assetRoles`)]
  ]);
}

export function validateHudCatalogV1(value) {
  try {
    const root = inspectRecord(value, "root", ["schemaVersion", "profiles"]);
    schemaV1(root.schemaVersion, "schemaVersion");
    const profilesInput = inspectRecord(root.profiles, "profiles");
    const profileIds = Object.keys(profilesInput).sort();
    if (profileIds.length > HUD_CATALOG_LIMITS.profiles) fail("profiles", `exceeds the limit of ${HUD_CATALOG_LIMITS.profiles}.`);
    const profiles = freezeRecord(profileIds.map((id) => {
      boundedId(id, `profiles.${id}`);
      return [id, normalizeProfile(profilesInput[id], `profiles.${id}`)];
    }));
    return Object.freeze({
      ok: true,
      catalog: freezeRecord([["schemaVersion", HUD_CATALOG_SCHEMA_VERSION], ["profiles", profiles]])
    });
  } catch (error) {
    const closedError = error instanceof Error ? error : new TypeError("HUD catalog validation failed closed.");
    return Object.freeze({ ok: false, error: closedError });
  }
}
