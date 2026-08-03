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

const PROFILE_KEYS = [
  "schemaVersion", "label", "breakpoints", "commonNodes", "variants", "screens", "screenGraph", "assetRoles"
];
const VARIANT_IDS = ["desktop", "tablet", "mobile"];
const SURFACES = new Set([
  "title", "profile_selection", "loading", "mission_selection", "campaign_selection", "story", "setup",
  "gameplay", "between_wave", "draft", "pause", "settings", "victory", "defeat", "result",
  "recoverable_error"
]);

class HudCatalogValidationError extends TypeError {
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
    if (!("value" in descriptor) || !descriptor.enumerable) fail(`${path}.${key}`, "must be an enumerable own data property; accessors are forbidden.");
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

function normalizeViewport(value, path) {
  const record = inspectRecord(value, path, ["width", "height"]);
  for (const key of ["width", "height"]) {
    if (!Number.isFinite(record[key]) || record[key] <= 0 || record[key] > 16384) {
      fail(`${path}.${key}`, "must be a finite positive number no greater than 16384.");
    }
  }
  return freezeRecord([["width", record.width], ["height", record.height]]);
}

function normalizeVariant(value, path) {
  const record = inspectRecord(value, path, ["schemaVersion", "designViewport", "rootNodeIds"]);
  return freezeRecord([
    ["schemaVersion", schemaV1(record.schemaVersion, `${path}.schemaVersion`)],
    ["designViewport", normalizeViewport(record.designViewport, `${path}.designViewport`)],
    ["rootNodeIds", normalizeStringArray(record.rootNodeIds, `${path}.rootNodeIds`, HUD_CATALOG_LIMITS.nodesPerProfile)]
  ]);
}

function normalizeNode(value, path) {
  const record = inspectRecord(value, path, ["id", "type"]);
  return freezeRecord([
    ["id", boundedId(record.id, `${path}.id`)],
    ["type", boundedId(record.type, `${path}.type`)]
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
  if (screenIds.length > HUD_CATALOG_LIMITS.screensPerProfile) {
    fail(`${path}.screens`, `exceeds the limit of ${HUD_CATALOG_LIMITS.screensPerProfile}.`);
  }
  const screenEntries = screenIds.map((id) => {
    boundedId(id, `${path}.screens.${id}`);
    return [id, normalizeScreen(screensInput[id], `${path}.screens.${id}`)];
  });
  const screens = freezeRecord(screenEntries);
  const graph = normalizeScreenGraph(record.screenGraph, `${path}.screenGraph`, screens);
  const layoutRecords = nodes.length
    + VARIANT_IDS.reduce((sum, id) => sum + variants[id].rootNodeIds.length, 0)
    + screenIds.reduce((sum, id) => sum + screens[id].rootNodeIds.length, 0);
  if (layoutRecords > HUD_CATALOG_LIMITS.layoutRecordsPerProfile) {
    fail(path, `layout records exceed the limit of ${HUD_CATALOG_LIMITS.layoutRecordsPerProfile}.`);
  }

  return freezeRecord([
    ["schemaVersion", HUD_CATALOG_SCHEMA_VERSION],
    ["label", record.label],
    ["breakpoints", freezeRecord([["mobileMax", breakpoints.mobileMax], ["tabletMax", breakpoints.tabletMax]])],
    ["commonNodes", Object.freeze(nodes)],
    ["variants", variants],
    ["screens", screens],
    ["screenGraph", graph],
    ["assetRoles", normalizeAssetRoles(record.assetRoles, `${path}.assetRoles`)]
  ]);
}

export function validateHudCatalogV1(value) {
  try {
    const root = inspectRecord(value, "root", ["schemaVersion", "profiles"]);
    schemaV1(root.schemaVersion, "schemaVersion");
    const profilesInput = inspectRecord(root.profiles, "profiles");
    const profileIds = Object.keys(profilesInput).sort();
    if (profileIds.length > HUD_CATALOG_LIMITS.profiles) {
      fail("profiles", `exceeds the limit of ${HUD_CATALOG_LIMITS.profiles}.`);
    }
    const profiles = freezeRecord(profileIds.map((id) => {
      boundedId(id, `profiles.${id}`);
      return [id, normalizeProfile(profilesInput[id], `profiles.${id}`)];
    }));
    const catalog = freezeRecord([
      ["schemaVersion", HUD_CATALOG_SCHEMA_VERSION],
      ["profiles", profiles]
    ]);
    return Object.freeze({ ok: true, catalog });
  } catch (error) {
    const closedError = error instanceof Error ? error : new TypeError("HUD catalog validation failed closed.");
    return Object.freeze({ ok: false, error: closedError });
  }
}
