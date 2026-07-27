import { projectElevationCues } from "./elevation-presentation.mjs";

const MAX_COORDINATE = 1_000_000;
const MAX_EVENTS = 4_096;
const MAX_ROOTS = 1_024;
const MAX_GROUPS = 512;
const MAX_TARGETS_PER_GROUP = 64;
const MAX_TARGETS = 1_024;
const INACTIVE = Object.freeze({
  active: false,
  terrainInvalidations: Object.freeze([]),
  elevationInvalidations: Object.freeze([])
});

// Renderer input is untrusted at this boundary: read own data descriptors only, so a malformed
// snapshot cannot execute getters/proxies while the player is drawing a frame.
function ownRecord(value, allowed) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length) return null;
    const copy = {};
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (!allowed.has(key) || !descriptor.enumerable || !("value" in descriptor)) return null;
      Object.defineProperty(copy, key, { value: descriptor.value, enumerable: true });
    }
    return copy;
  } catch { return null; }
}

function ownDenseArray(value, maximum) {
  if (!Array.isArray(value)) return null;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length) return null;
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
    if (Object.keys(descriptors).length !== length + 1) return null;
    const result = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !("value" in descriptor)) return null;
      result.push(descriptor.value);
    }
    return result;
  } catch { return null; }
}

function coord(value) {
  const record = ownRecord(value, new Set(["q", "r"]));
  if (!record || !Object.hasOwn(record, "q") || !Object.hasOwn(record, "r")) return null;
  if (![record.q, record.r].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_COORDINATE)) return null;
  return { q: record.q, r: record.r };
}
function coordinateValues(q, r) {
  return [q, r].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_COORDINATE) ? { q, r } : null;
}

function safeString(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try { return BufferSafe.byteLength(value) <= 128; }
  catch { return false; }
}

// TextEncoder is available in current browsers and Node. This tiny fallback keeps the projector
// usable in older embedded webviews without importing Node APIs into the renderer.
const BufferSafe = { byteLength(value) { return typeof TextEncoder === "function" ? new TextEncoder().encode(value).length : unescape(encodeURIComponent(value)).length; } };

function eventRoots(events) {
  if (events === undefined) return { terrain: [], elevation: [] };
  const values = ownDenseArray(events, MAX_EVENTS);
  if (values === null) return null;
  const terrain = new Map();
  const elevation = new Map();
  for (const authored of values) {
    let type;
    try {
      if (!authored || typeof authored !== "object" || Array.isArray(authored) || Object.getPrototypeOf(authored) !== Object.prototype || Object.getOwnPropertySymbols(authored).length) return null;
      const descriptor = Object.getOwnPropertyDescriptor(authored, "type");
      if (!descriptor?.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string") return null;
      type = descriptor.value;
    } catch { return null; }
    // Engine event streams carry many unrelated events. Their payload stays opaque to this
    // visual-only projector, including hostile accessor fields.
    if (type !== "terrainChanged" && type !== "elevationChanged") continue;
    const typeProbe = ownRecord(authored, new Set(["type", "coord", "fromTerrain", "toTerrain", "terrainMetadata", "source", "fromElevation", "toElevation"]));
    if (!typeProbe) return null;
    if (typeProbe.type === "terrainChanged") {
      const exactKeys = ["type", "coord", "fromTerrain", "toTerrain", "terrainMetadata", "source"];
      if (Object.keys(typeProbe).length !== exactKeys.length || !exactKeys.every((key) => Object.hasOwn(typeProbe, key))
        || !["script", "ability", "restore"].includes(typeProbe.source)
        || !safeString(typeProbe.fromTerrain) || !safeString(typeProbe.toTerrain) || typeProbe.fromTerrain === typeProbe.toTerrain) return null;
      const root = coord(typeProbe.coord); if (!root) return null;
      terrain.set(`${root.q},${root.r}`, root);
    } else if (typeProbe.type === "elevationChanged") {
      const exactKeys = ["type", "coord", "fromElevation", "toElevation", "source"];
      if (Object.keys(typeProbe).length !== exactKeys.length || !exactKeys.every((key) => Object.hasOwn(typeProbe, key))
        || !["script", "restore"].includes(typeProbe.source)
        || ![typeProbe.fromElevation, typeProbe.toElevation].every((n) => Number.isSafeInteger(n) && Math.abs(n) <= MAX_COORDINATE)
        || typeProbe.fromElevation === typeProbe.toElevation) return null;
      const root = coord(typeProbe.coord); if (!root) return null;
      elevation.set(`${root.q},${root.r}`, root);
    }
  }
  if (terrain.size + elevation.size > MAX_ROOTS) return null;
  return { terrain: [...terrain.values()], elevation: [...elevation.values()] };
}

function activeTargets(section) {
  const record = ownRecord(section, new Set(["schemaVersion", "pendingExpiryGroups"]));
  if (!record || Object.keys(record).length !== 2 || record.schemaVersion !== 1) return null;
  const groups = ownDenseArray(record.pendingExpiryGroups, MAX_GROUPS);
  if (groups === null) return null;
  let previousSequence = 0; const seenTargets = new Set();
  let total = 0;
  for (const authored of groups) {
    const group = ownRecord(authored, new Set(["sequence", "remaining", "targets"]));
    if (!group || Object.keys(group).length !== 3 || !Number.isSafeInteger(group.sequence) || group.sequence <= previousSequence
      || !Number.isFinite(group.remaining) || group.remaining < 0 || group.remaining > 1_000_000_000) return null;
    previousSequence = group.sequence;
    const targets = ownDenseArray(group.targets, MAX_TARGETS_PER_GROUP);
    if (targets === null || targets.length === 0 || (total += targets.length) > MAX_TARGETS) return null;
    for (const authoredTarget of targets) {
      const item = ownRecord(authoredTarget, new Set(["layer", "q", "r"]));
      if (!item || Object.keys(item).length !== 3 || !["terrain", "elevation"].includes(item.layer)) return null;
      const root = coordinateValues(item.q, item.r); if (!root) return null;
      const key = `${item.layer}:${root.q},${root.r}`;
      if (seenTargets.has(key)) return null;
      seenTargets.add(key);
    }
  }
  return true;
}

function canonical(items) { return items.sort((a, b) => a.r - b.r || a.q - b.q); }
function frozenCoords(items) { return Object.freeze(canonical(items).map(({ q, r }) => Object.freeze({ q, r }))); }

/** Present only authoritative terraforming snapshot data; never derive gameplay or animations. */
export function projectTerraformingPresentation(snapshot) {
  if (snapshot === undefined || snapshot === null || typeof snapshot !== "object") return INACTIVE;
  let descriptors;
  try {
    if (Object.getPrototypeOf(snapshot) !== Object.prototype || Object.getOwnPropertySymbols(snapshot).length) return undefined;
    descriptors = Object.getOwnPropertyDescriptors(snapshot);
  } catch { return undefined; }
  const field = (name) => {
    const descriptor = descriptors[name];
    return descriptor === undefined ? undefined : (descriptor.enumerable && "value" in descriptor ? descriptor.value : Symbol.for("invalid"));
  };
  const terraforming = field("terraforming");
  if (terraforming === undefined || terraforming === null) return INACTIVE;
  if (terraforming === Symbol.for("invalid")) return undefined;
  if (!activeTargets(terraforming)) return undefined;
  const lastEvents = field("lastEvents");
  const elevationSection = field("elevation");
  if (lastEvents === Symbol.for("invalid") || elevationSection === Symbol.for("invalid")) return undefined;
  const events = eventRoots(lastEvents); if (!events) return undefined;
  const elevationPresentation = projectElevationCues(elevationSection);
  if (elevationPresentation === undefined) return undefined;
  return Object.freeze({
    active: true,
    terrainInvalidations: frozenCoords(events.terrain),
    elevationInvalidations: frozenCoords(events.elevation),
    elevationPresentation
  });
}
