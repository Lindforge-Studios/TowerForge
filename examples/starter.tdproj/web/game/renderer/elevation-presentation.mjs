const MAX_ELEVATION_OVERRIDES = 65_536;
const MAX_ELEVATION_CUES = 4_096;
const MAX_ELEVATION_COORDINATE = 1_000_000;
const MAX_ELEVATION_VALUE = 1_000_000;
const elevationPresentationCache = new WeakMap();

const INACTIVE_ELEVATION_CUES = Object.freeze({
  active: false,
  cues: Object.freeze([])
});

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
    Object.defineProperty(detached, key, { value: descriptor.value, enumerable: true });
  }
  return detached;
}

function denseArray(value, maximumLength) {
  if (!Array.isArray(value)) return null;
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  if (prototype !== Array.prototype || Object.getOwnPropertySymbols(descriptors).length > 0) return null;
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximumLength) return null;
  const detached = [];
  for (const key of Object.keys(descriptors)) {
    if (key === "length") continue;
    const descriptor = descriptors[key];
    if (
      !/^(0|[1-9]\d*)$/.test(key)
      || Number(key) >= length
      || !descriptor?.enumerable
      || !("value" in descriptor)
    ) return null;
    detached[Number(key)] = descriptor.value;
  }
  return Object.keys(descriptors).length === length + 1 && detached.length === length ? detached : null;
}

function compareCanonical(left, right) {
  return left.r - right.r || left.q - right.q;
}

function retainCanonicalCandidate(heap, candidate) {
  if (heap.length < MAX_ELEVATION_CUES) {
    heap.push(candidate);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareCanonical(heap[parent], heap[index]) >= 0) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
    return;
  }
  if (compareCanonical(candidate, heap[0]) >= 0) return;
  heap[0] = candidate;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let greatest = index;
    if (left < heap.length && compareCanonical(heap[left], heap[greatest]) > 0) greatest = left;
    if (right < heap.length && compareCanonical(heap[right], heap[greatest]) > 0) greatest = right;
    if (greatest === index) break;
    [heap[index], heap[greatest]] = [heap[greatest], heap[index]];
    index = greatest;
  }
}

function isFrozenObject(value) {
  try {
    return Object.isFrozen(value);
  } catch {
    return false;
  }
}

/** Convert the optional engine elevation section into detached visual cues. */
export function projectElevationCues(value) {
  if (value === undefined || value === null) return INACTIVE_ELEVATION_CUES;
  if (typeof value !== "object") return undefined;
  const cached = elevationPresentationCache.get(value);
  if (cached !== undefined) return cached;
  const section = dataRecord(value, ["schemaVersion", "defaultElevation", "overrides"]);
  if (
    !section
    || !Object.hasOwn(section, "schemaVersion")
    || !Object.hasOwn(section, "defaultElevation")
    || !Object.hasOwn(section, "overrides")
    || section.schemaVersion !== 1
    || section.defaultElevation !== 0
  ) return undefined;
  const overrides = denseArray(section.overrides, MAX_ELEVATION_OVERRIDES);
  if (overrides === null) return undefined;

  const seen = new Set();
  const retained = [];
  let cacheable = isFrozenObject(value) && isFrozenObject(section.overrides);
  for (const authored of overrides) {
    cacheable = cacheable && isFrozenObject(authored);
    const entry = dataRecord(authored, ["q", "r", "elevation"]);
    if (
      !entry
      || !Object.hasOwn(entry, "q")
      || !Object.hasOwn(entry, "r")
      || !Object.hasOwn(entry, "elevation")
      || !Number.isSafeInteger(entry.q)
      || !Number.isSafeInteger(entry.r)
      || entry.q < 0
      || entry.r < 0
      || entry.q > MAX_ELEVATION_COORDINATE
      || entry.r > MAX_ELEVATION_COORDINATE
      || !Number.isSafeInteger(entry.elevation)
      || entry.elevation === 0
      || Math.abs(entry.elevation) > MAX_ELEVATION_VALUE
    ) return undefined;
    const key = `${entry.q},${entry.r}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    retainCanonicalCandidate(retained, { q: entry.q, r: entry.r, elevation: entry.elevation });
  }
  retained.sort(compareCanonical);
  const cues = Object.freeze(retained.map((entry) => Object.freeze({
    coord: Object.freeze({ q: entry.q, r: entry.r }),
    elevation: entry.elevation,
    label: entry.elevation > 0 ? `+${entry.elevation}` : String(entry.elevation)
  })));
  const overflowCount = overrides.length - cues.length;
  const presentation = Object.freeze({
    active: true,
    defaultElevation: 0,
    cues,
    ...(overflowCount > 0 ? { overflowCount } : {})
  });
  if (cacheable) elevationPresentationCache.set(value, presentation);
  return presentation;
}
