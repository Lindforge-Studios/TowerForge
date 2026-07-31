const MAX_ZONE_TILES = 4_096;
const MAX_ID_UTF8_BYTES = 128;

export const INACTIVE_WEATHER_PRESENTATION = Object.freeze({
  active: false,
  zoneKind: null,
  tiles: Object.freeze([])
});

function ownField(record, key) {
  if (record === null || typeof record !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function closedRecord(value, fields) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) return null;
    for (const field of fields) {
      if (!descriptors[field]?.enumerable || !("value" in descriptors[field])) return null;
    }
    return descriptors;
  } catch {
    return null;
  }
}

function denseArray(value, maximum) {
  if (!Array.isArray(value)) return null;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length && "value" in descriptors.length ? descriptors.length.value : -1;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
    const rows = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !("value" in descriptor)) return null;
      rows.push(descriptor.value);
    }
    if (Object.keys(descriptors).some((key) => key !== "length"
      && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= length))) return null;
    return rows;
  } catch {
    return null;
  }
}

function boundedId(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value)
    && new TextEncoder().encode(value).length <= MAX_ID_UTF8_BYTES;
}

function projectCoord(value) {
  const descriptors = closedRecord(value, ["q", "r"]);
  if (!descriptors) return null;
  const q = descriptors.q.value;
  const r = descriptors.r.value;
  return Number.isSafeInteger(q) && Number.isSafeInteger(r) ? Object.freeze({ q, r }) : null;
}

function projectZone(value) {
  const kind = ownField(value, "kind");
  if (kind === "all_map") {
    return closedRecord(value, ["kind"])
      ? Object.freeze({ zoneKind: "all_map", tiles: Object.freeze([]) })
      : null;
  }
  if (kind !== "tiles" || !closedRecord(value, ["kind", "tiles"])) return null;
  const authoredTiles = denseArray(ownField(value, "tiles"), MAX_ZONE_TILES);
  if (!authoredTiles) return null;
  const tiles = [];
  const keys = new Set();
  for (const value of authoredTiles) {
    const coord = projectCoord(value);
    if (!coord) return null;
    const key = `${coord.q},${coord.r}`;
    if (keys.has(key)) return null;
    keys.add(key);
    tiles.push(coord);
  }
  tiles.sort((left, right) => left.q - right.q || left.r - right.r);
  return Object.freeze({ zoneKind: "tiles", tiles: Object.freeze(tiles) });
}

/** Fail-closed display projection over the authoritative optional Weather v1 snapshot. */
export function projectWeatherPresentation(snapshot) {
  const weather = ownField(snapshot, "weather");
  const weatherFields = closedRecord(weather, ["schemaVersion", "profileId", "active"]);
  if (!weatherFields || weatherFields.schemaVersion.value !== 1 || !boundedId(weatherFields.profileId.value)) {
    return INACTIVE_WEATHER_PRESENTATION;
  }
  const active = weatherFields.active.value;
  if (active === null) return INACTIVE_WEATHER_PRESENTATION;
  const fields = closedRecord(active, [
    "waveIndex", "choiceId", "weatherId", "zoneId", "zone", "elapsedUnits"
  ]);
  if (!fields
    || !Number.isSafeInteger(fields.waveIndex.value) || fields.waveIndex.value < 0
    || !boundedId(fields.choiceId.value) || !boundedId(fields.weatherId.value) || !boundedId(fields.zoneId.value)
    || typeof fields.elapsedUnits.value !== "number" || !Number.isFinite(fields.elapsedUnits.value)
    || fields.elapsedUnits.value < 0) return INACTIVE_WEATHER_PRESENTATION;
  const zone = projectZone(fields.zone.value);
  if (!zone) return INACTIVE_WEATHER_PRESENTATION;
  return Object.freeze({
    active: true,
    profileId: weatherFields.profileId.value,
    waveIndex: fields.waveIndex.value,
    choiceId: fields.choiceId.value,
    weatherId: fields.weatherId.value,
    zoneId: fields.zoneId.value,
    elapsedUnits: fields.elapsedUnits.value,
    zoneKind: zone.zoneKind,
    tiles: zone.tiles
  });
}
