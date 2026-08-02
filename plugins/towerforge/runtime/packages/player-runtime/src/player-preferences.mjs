export const PLAYER_PREFERENCES_SCHEMA_VERSION = 1;

const KEYS = Object.freeze([
  "schemaVersion", "locale", "uiScale", "quality", "fullscreen", "cameraZoom",
  "soundEnabled", "sfxVolume", "musicVolume", "motion", "keyBindings"
]);
const QUALITY = new Set(["auto", "low", "balanced", "high"]);
const MOTION = new Set(["auto", "reduced", "full"]);

function ownRecord(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${field} must be a plain object.`);
  }
  const record = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError(`${field} cannot contain symbol keys.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw new TypeError(`${field}.${key} must be an own data property.`);
    record[key] = descriptor.value;
  }
  return record;
}

function numberBetween(value, min, max, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${field} must be between ${min} and ${max}.`);
  }
  return value;
}

function normalize(value) {
  const record = ownRecord(value, "preferences");
  for (const key of Object.keys(record)) if (!KEYS.includes(key)) throw new TypeError(`Unknown preferences field "${key}".`);
  if (record.schemaVersion !== PLAYER_PREFERENCES_SCHEMA_VERSION) throw new RangeError("Unsupported PlayerPreferences schemaVersion.");
  if (typeof record.locale !== "string" || !record.locale.trim() || record.locale.length > 64) throw new TypeError("locale must be a non-empty string.");
  if (!QUALITY.has(record.quality)) throw new TypeError("quality is not supported.");
  if (!MOTION.has(record.motion)) throw new TypeError("motion is not supported.");
  if (typeof record.fullscreen !== "boolean" || typeof record.soundEnabled !== "boolean") throw new TypeError("Boolean preferences are invalid.");
  const bindings = ownRecord(record.keyBindings, "keyBindings");
  if (Object.keys(bindings).length > 64) throw new RangeError("keyBindings exceeds the supported limit.");
  for (const [actionId, key] of Object.entries(bindings)) {
    if (!actionId || actionId.length > 96 || typeof key !== "string" || !key || key.length > 64) throw new TypeError("keyBindings contains an invalid entry.");
  }
  return Object.freeze({
    schemaVersion: PLAYER_PREFERENCES_SCHEMA_VERSION,
    locale: record.locale,
    uiScale: numberBetween(record.uiScale, 0.75, 2, "uiScale"),
    quality: record.quality,
    fullscreen: record.fullscreen,
    cameraZoom: numberBetween(record.cameraZoom, 0.1, 8, "cameraZoom"),
    soundEnabled: record.soundEnabled,
    sfxVolume: numberBetween(record.sfxVolume, 0, 1, "sfxVolume"),
    musicVolume: numberBetween(record.musicVolume, 0, 1, "musicVolume"),
    motion: record.motion,
    keyBindings: Object.freeze({ ...bindings })
  });
}

export function createDefaultPlayerPreferences() {
  return normalize({
    schemaVersion: PLAYER_PREFERENCES_SCHEMA_VERSION,
    locale: "auto",
    uiScale: 1,
    quality: "auto",
    fullscreen: false,
    cameraZoom: 1,
    soundEnabled: true,
    sfxVolume: 0.5,
    musicVolume: 0.35,
    motion: "auto",
    keyBindings: {}
  });
}

export function serializePlayerPreferencesV1(value) {
  return JSON.stringify(normalize(value));
}

export function parsePlayerPreferencesV1(raw) {
  if (typeof raw !== "string") throw new TypeError("Serialized preferences must be a string.");
  return normalize(JSON.parse(raw));
}
