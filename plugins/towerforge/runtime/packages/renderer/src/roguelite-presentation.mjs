const MAX_SYNERGIES = 32;
const MAX_TIERS = 8;
const MAX_REQUIRED_COUNT = 65_536;
const MAX_ID_OR_TAG_BYTES = 128;
const MAX_LABEL_BYTES = 256;

const INACTIVE = Object.freeze({ active: false, synergies: Object.freeze([]) });

function ownData(value, key) {
  if (value === null || typeof value !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function record(value, allowedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(descriptors).length > 0) {
    return null;
  }
  const allowed = new Set(allowedKeys);
  const detached = Object.create(null);
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!allowed.has(key) || !descriptor?.enumerable || !("value" in descriptor)) return null;
    Object.defineProperty(detached, key, { value: descriptor.value, enumerable: true });
  }
  return detached;
}

function denseArray(value, maximum) {
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
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
  if (Reflect.ownKeys(descriptors).some((key) => (
    key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)
  ))) return null;
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    result.push(descriptor.value);
  }
  return result;
}

function boundedText(value, maximumBytes) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return new TextEncoder().encode(value).length <= maximumBytes ? value : null;
  } catch {
    return null;
  }
}

function projectRow(value) {
  const row = record(value, [
    "synergyId", "label", "tag", "towerCount", "tierMode", "activeTierRequiredCounts"
  ]);
  if (!row || Object.keys(row).length !== 6) return null;
  const synergyId = boundedText(row.synergyId, MAX_ID_OR_TAG_BYTES);
  const label = boundedText(row.label, MAX_LABEL_BYTES);
  const tag = boundedText(row.tag, MAX_ID_OR_TAG_BYTES);
  if (!synergyId || !label || !tag
    || !Number.isSafeInteger(row.towerCount)
    || row.towerCount < 0
    || (row.tierMode !== "highest" && row.tierMode !== "cumulative")) return null;
  const rawCounts = denseArray(row.activeTierRequiredCounts, MAX_TIERS);
  if (!rawCounts || (row.tierMode === "highest" && rawCounts.length > 1)) return null;
  const counts = [];
  let previous = 0;
  for (const count of rawCounts) {
    if (!Number.isSafeInteger(count) || count <= previous || count > MAX_REQUIRED_COUNT || count > row.towerCount) {
      return null;
    }
    previous = count;
    counts.push(count);
  }
  return Object.freeze({
    synergyId,
    label,
    tag,
    towerCount: row.towerCount,
    tierMode: row.tierMode,
    activeTierRequiredCounts: Object.freeze(counts)
  });
}

/** Project only the authoritative optional engine snapshot; renderers never count towers. */
export function projectRoguelitePresentation(snapshot) {
  const sectionValue = ownData(snapshot, "roguelite");
  if (sectionValue === undefined || sectionValue === null) return INACTIVE;
  const section = record(sectionValue, ["schemaVersion", "synergies"]);
  if (!section || Object.keys(section).length !== 2 || section.schemaVersion !== 1) return undefined;
  const authoredRows = denseArray(section.synergies, MAX_SYNERGIES);
  if (!authoredRows) return undefined;
  const rows = [];
  const seen = new Set();
  for (const value of authoredRows) {
    const row = projectRow(value);
    if (!row || seen.has(row.synergyId)) return undefined;
    seen.add(row.synergyId);
    rows.push(row);
  }
  rows.sort((left, right) => left.synergyId < right.synergyId ? -1 : left.synergyId > right.synergyId ? 1 : 0);
  return Object.freeze({ active: true, synergies: Object.freeze(rows) });
}
