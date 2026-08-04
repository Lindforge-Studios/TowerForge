export const SPLASH_CATALOG_SCHEMA_VERSION = 1;

export const SPLASH_CATALOG_LIMITS = Object.freeze({
  playlists: 16,
  itemsPerPlaylist: 8,
  totalPlaybackMs: 30_000
});

export const SPLASH_ITEM_DEFAULTS = Object.freeze({
  displayMs: 1_800,
  minimumMs: 600,
  transitionMs: 220,
  fit: "contain",
  transition: "fade_scale"
});

const CATALOG_KEYS = Object.freeze(["schemaVersion", "playlists"]);
const PLAYLIST_KEYS = Object.freeze(["schemaVersion", "label", "items"]);
const ITEM_KEYS = Object.freeze([
  "id", "spriteId", "accessibleLabel", "caption", "backgroundColor",
  "fit", "transition", "displayMs", "minimumMs", "transitionMs"
]);
const REQUIRED_ITEM_KEYS = Object.freeze([
  "id", "spriteId", "accessibleLabel", "backgroundColor"
]);
const FITS = new Set(["contain", "cover"]);
const TRANSITIONS = new Set(["cut", "fade", "fade_scale"]);

export class SplashCatalogValidationError extends TypeError {
  constructor(fieldPath, message) {
    super(`${fieldPath}: ${message}`);
    this.name = "SplashCatalogValidationError";
    this.fieldPath = fieldPath;
  }
}

function fail(fieldPath, message) {
  throw new SplashCatalogValidationError(fieldPath, message);
}

function inspectRecord(value, fieldPath, allowedKeys, requiredKeys = allowedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(fieldPath, "must be a plain own-data object.");
  }
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(fieldPath, "must be an inspectable own-data object.");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail(fieldPath, "must be a plain own-data object.");
  }
  if (Reflect.ownKeys(descriptors).some((key) => typeof key === "symbol")) {
    fail(fieldPath, "cannot contain symbol keys.");
  }
  const allowed = allowedKeys === undefined ? undefined : new Set(allowedKeys);
  for (const key of Object.keys(descriptors)) {
    if (allowed && !allowed.has(key)) fail(`${fieldPath}.${key}`, `unknown field "${key}".`);
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || descriptor.enumerable !== true) {
      fail(`${fieldPath}.${key}`, "must be an enumerable own data property; accessors are forbidden.");
    }
  }
  for (const key of requiredKeys ?? []) {
    if (!Object.hasOwn(descriptors, key)) fail(`${fieldPath}.${key}`, "is required.");
  }
  return Object.fromEntries(Object.keys(descriptors).map((key) => [key, descriptors[key].value]));
}

function inspectArray(value, fieldPath, limit) {
  if (!Array.isArray(value)) fail(fieldPath, "must be a dense own-data array.");
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(fieldPath, "must be an inspectable dense own-data array.");
  }
  if (prototype !== Array.prototype) fail(fieldPath, "must be a plain array.");
  if (Reflect.ownKeys(descriptors).some((key) => typeof key === "symbol")) {
    fail(fieldPath, "cannot contain symbol keys.");
  }
  const lengthDescriptor = descriptors.length;
  if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value)) {
    fail(fieldPath, "must have a safe integer length.");
  }
  const length = lengthDescriptor.value;
  if (length > limit) fail(fieldPath, `exceeds the limit of ${limit}.`);
  const keys = Object.keys(descriptors).filter((key) => key !== "length");
  if (keys.length !== length) fail(fieldPath, "must be dense and cannot contain extra fields.");
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      fail(`${fieldPath}.${index}`, "must be an enumerable own data property.");
    }
    result.push(descriptor.value);
  }
  return result;
}

function schemaV1(value, fieldPath) {
  if (value !== SPLASH_CATALOG_SCHEMA_VERSION) {
    fail(fieldPath, Number.isSafeInteger(value) && value > SPLASH_CATALOG_SCHEMA_VERSION
      ? `future schemaVersion ${value} is not supported.`
      : `must be ${SPLASH_CATALOG_SCHEMA_VERSION}.`);
  }
  return SPLASH_CATALOG_SCHEMA_VERSION;
}

function boundedString(value, fieldPath, { max = 512, identifier = false } = {}) {
  if (typeof value !== "string" || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(fieldPath, `must be a non-empty bounded ${identifier ? "identifier" : "plain-text string"}.`);
  }
  if (!identifier && value.trim().length === 0) fail(fieldPath, "must not contain only whitespace.");
  return value;
}

function boundedTiming(value, fieldPath, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(fieldPath, `must be a safe integer from ${min} to ${max}.`);
  }
  return value;
}

function normalizeItem(value, fieldPath) {
  const item = inspectRecord(value, fieldPath, ITEM_KEYS, REQUIRED_ITEM_KEYS);
  const normalized = {
    id: boundedString(item.id, `${fieldPath}.id`, { max: 128, identifier: true }),
    spriteId: boundedString(item.spriteId, `${fieldPath}.spriteId`, { max: 128, identifier: true }),
    accessibleLabel: boundedString(item.accessibleLabel, `${fieldPath}.accessibleLabel`, { max: 512 }),
    ...(item.caption === undefined
      ? {}
      : { caption: boundedString(item.caption, `${fieldPath}.caption`, { max: 2_048 }) }),
    backgroundColor: item.backgroundColor,
    displayMs: item.displayMs ?? SPLASH_ITEM_DEFAULTS.displayMs,
    minimumMs: item.minimumMs ?? SPLASH_ITEM_DEFAULTS.minimumMs,
    transitionMs: item.transitionMs ?? SPLASH_ITEM_DEFAULTS.transitionMs,
    fit: item.fit ?? SPLASH_ITEM_DEFAULTS.fit,
    transition: item.transition ?? SPLASH_ITEM_DEFAULTS.transition
  };
  if (typeof normalized.backgroundColor !== "string" || !/^#[0-9a-f]{6}$/iu.test(normalized.backgroundColor)) {
    fail(`${fieldPath}.backgroundColor`, "must use six-digit hexadecimal notation such as #0b0f0d.");
  }
  if (!FITS.has(normalized.fit)) fail(`${fieldPath}.fit`, "must be contain or cover.");
  if (!TRANSITIONS.has(normalized.transition)) fail(`${fieldPath}.transition`, "must be cut, fade, or fade_scale.");
  boundedTiming(normalized.displayMs, `${fieldPath}.displayMs`, 700, 10_000);
  boundedTiming(normalized.minimumMs, `${fieldPath}.minimumMs`, 300, 2_000);
  boundedTiming(normalized.transitionMs, `${fieldPath}.transitionMs`, 0, 600);
  if (normalized.minimumMs > normalized.displayMs) {
    fail(`${fieldPath}.minimumMs`, "must not exceed displayMs.");
  }
  return Object.freeze(normalized);
}

function normalizePlaylist(value, fieldPath) {
  const playlist = inspectRecord(value, fieldPath, PLAYLIST_KEYS);
  schemaV1(playlist.schemaVersion, `${fieldPath}.schemaVersion`);
  const items = inspectArray(playlist.items, `${fieldPath}.items`, SPLASH_CATALOG_LIMITS.itemsPerPlaylist);
  if (items.length === 0) fail(`${fieldPath}.items`, "must contain at least one splash item.");
  const ids = new Set();
  const normalizedItems = items.map((item, index) => {
    const normalized = normalizeItem(item, `${fieldPath}.items.${index}`);
    if (ids.has(normalized.id)) fail(`${fieldPath}.items.${index}.id`, `duplicate item id "${normalized.id}".`);
    ids.add(normalized.id);
    return normalized;
  });
  const totalPlaybackMs = normalizedItems.reduce((sum, item) => sum + item.displayMs + item.transitionMs, 0);
  if (totalPlaybackMs > SPLASH_CATALOG_LIMITS.totalPlaybackMs) {
    fail(`${fieldPath}.items`, `total authored playback exceeds ${SPLASH_CATALOG_LIMITS.totalPlaybackMs} ms.`);
  }
  return Object.freeze({
    schemaVersion: SPLASH_CATALOG_SCHEMA_VERSION,
    label: boundedString(playlist.label, `${fieldPath}.label`, { max: 256 }),
    items: Object.freeze(normalizedItems)
  });
}

function normalizeCatalog(value) {
  const catalog = inspectRecord(value, "root", CATALOG_KEYS);
  schemaV1(catalog.schemaVersion, "schemaVersion");
  const playlists = inspectRecord(catalog.playlists, "playlists", undefined, []);
  const playlistIds = Object.keys(playlists).sort();
  if (playlistIds.length > SPLASH_CATALOG_LIMITS.playlists) {
    fail("playlists", `exceeds the limit of ${SPLASH_CATALOG_LIMITS.playlists}.`);
  }
  const normalizedPlaylists = Object.create(null);
  for (const playlistId of playlistIds) {
    boundedString(playlistId, `playlists.${playlistId}`, { max: 128, identifier: true });
    Object.defineProperty(normalizedPlaylists, playlistId, {
      value: normalizePlaylist(playlists[playlistId], `playlists.${playlistId}`),
      enumerable: true,
      configurable: false,
      writable: false
    });
  }
  return Object.freeze({
    schemaVersion: SPLASH_CATALOG_SCHEMA_VERSION,
    playlists: Object.freeze(normalizedPlaylists)
  });
}

/** Validate and normalize untrusted authored splash data without invoking accessors. */
export function validateSplashCatalogV1(value) {
  try {
    return Object.freeze({ ok: true, catalog: normalizeCatalog(value) });
  } catch (error) {
    const safe = error instanceof SplashCatalogValidationError
      ? error
      : new SplashCatalogValidationError("root", "could not be inspected safely.");
    return Object.freeze({
      ok: false,
      error: Object.freeze({ fieldPath: safe.fieldPath, message: safe.message.replace(/^.*?: /u, "") })
    });
  }
}

/** Compile one normalized, detached presentation plan for build/Studio previews. */
export function compileSplashPlaylistPlanV1(value, playlistId, options = {}) {
  const result = validateSplashCatalogV1(value);
  if (!result.ok) throw new SplashCatalogValidationError(result.error.fieldPath, result.error.message);
  const id = boundedString(playlistId, "playlistId", { max: 128, identifier: true });
  if (!Object.hasOwn(result.catalog.playlists, id)) fail("playlistId", `references missing playlist "${id}".`);
  const playlist = result.catalog.playlists[id];
  const reducedMotion = options?.reducedMotion === true;
  const items = Object.freeze(playlist.items.map((item) => Object.freeze({
    ...item,
    ...(reducedMotion ? { transitionMs: 0 } : {})
  })));
  return Object.freeze({
    schemaVersion: SPLASH_CATALOG_SCHEMA_VERSION,
    playlistId: id,
    label: playlist.label,
    items,
    totalPlaybackMs: items.reduce((sum, item) => sum + item.displayMs + item.transitionMs, 0)
  });
}
