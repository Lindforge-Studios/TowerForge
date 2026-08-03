export const PLAYER_ACTION_DESCRIPTOR_SCHEMA_VERSION = 1;

const DEFINITIONS = [
  ["continueSession", "player.action.continue_session", "ui"],
  ["pause", "player.action.pause", "ui"],
  ["cameraPan", "player.action.camera_pan", "ui"],
  ["cameraZoom", "player.action.camera_zoom", "ui"],
  ["cameraReset", "player.action.camera_reset", "ui"],
  ["selectBuildSlot", "player.action.select_build_slot", "ui"],
  ["selectAbilitySlot", "player.action.select_ability_slot", "ui"],
  ["speedDown", "player.action.speed_down", "ui"],
  ["speedUp", "player.action.speed_up", "ui"],
  ["fullscreen", "player.action.fullscreen", "ui"],
  ["openSettings", "player.action.open_settings", "ui"],
  ["navigate", "player.action.navigate", "ui"],
  ["back", "player.action.back", "ui"],
  ["openSurface", "player.action.open_surface", "ui"],
  ["closeSurface", "player.action.close_surface", "ui"],
  ["toggleSurface", "player.action.toggle_surface", "ui"],
  ["startWave", "player.action.start_wave", "command"],
  ["placeTower", "player.action.place_tower", "command"],
  ["upgradeTower", "player.action.upgrade_tower", "command"],
  ["sellTower", "player.action.sell_tower", "command"],
  ["setTargetMode", "player.action.set_target_mode", "command"],
  ["useAbility", "player.action.use_ability", "command"],
  ["moveHero", "player.action.move_hero", "command"],
  ["useHeroAbility", "player.action.use_hero_ability", "command"],
  ["unlockHeroSkill", "player.action.unlock_hero_skill", "command"],
  ["socketArtifact", "player.action.socket_artifact", "command"],
  ["unsocketArtifact", "player.action.unsocket_artifact", "command"],
  ["configureTowerModules", "player.action.configure_tower_modules", "command"],
  ["emitSignal", "player.action.emit_signal", "signal"]
];

const REGISTRY = Object.freeze(DEFINITIONS.map(([id, labelKey, kind]) => Object.freeze({
  schemaVersion: PLAYER_ACTION_DESCRIPTOR_SCHEMA_VERSION,
  id,
  labelKey,
  kind
})));

export function createDefaultPlayerActionDescriptors() {
  return REGISTRY;
}

const DESCRIPTOR_KEYS = Object.freeze(["schemaVersion", "id", "labelKey", "kind"]);
const DESCRIPTOR_KINDS = new Set(["ui", "command", "signal"]);
const MAX_ACTION_DESCRIPTORS = 256;

function ownDataRecord(value, field, expectedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${field} must be a plain object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(descriptors).length > 0) throw new TypeError(`${field} cannot contain symbol keys.`);
  const keys = Object.keys(descriptors).sort();
  const expected = [...expectedKeys].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${field} contains missing or unsupported fields.`);
  }
  const result = Object.create(null);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${field}.${key} must be an enumerable own data property.`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function ownDataArray(value, field) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${field} must be a plain array.`);
  }
  if (value.length > MAX_ACTION_DESCRIPTORS) throw new RangeError(`${field} exceeds the descriptor limit.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(descriptors).length > 0) throw new TypeError(`${field} cannot contain symbol keys.`);
  const elementKeys = Object.keys(descriptors).filter((key) => key !== "length");
  if (elementKeys.length !== value.length) throw new TypeError(`${field} must be dense and cannot contain extra fields.`);
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${field}[${index}] must be an enumerable own data property.`);
    }
    result.push(descriptor.value);
  }
  return result;
}

export function createPlayerActionRegistry(options) {
  const optionRecord = ownDataRecord(options, "Player action registry options", ["descriptors", "handlers"]);
  const descriptors = ownDataArray(optionRecord.descriptors, "Player action descriptors");
  const ids = new Set();
  const detachedDescriptors = descriptors.map((descriptor) => {
    const record = ownDataRecord(descriptor, "Player action descriptor", DESCRIPTOR_KEYS);
    if (record.schemaVersion !== PLAYER_ACTION_DESCRIPTOR_SCHEMA_VERSION
      || typeof record.id !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(record.id)
      || typeof record.labelKey !== "string" || !record.labelKey || record.labelKey.length > 256
      || !DESCRIPTOR_KINDS.has(record.kind) || ids.has(record.id)) {
      throw new TypeError("Player action descriptors must have unique string ids.");
    }
    ids.add(record.id);
    return Object.freeze({
      schemaVersion: PLAYER_ACTION_DESCRIPTOR_SCHEMA_VERSION,
      id: record.id,
      labelKey: record.labelKey,
      kind: record.kind
    });
  });
  const handlerRecord = ownDataRecord(optionRecord.handlers, "Player action handlers", ids);
  const detachedHandlers = new Map();
  for (const id of ids) {
    if (typeof handlerRecord[id] !== "function") throw new TypeError(`Missing player action handler "${id}".`);
    detachedHandlers.set(id, handlerRecord[id]);
  }
  return Object.freeze({
    descriptors: Object.freeze(detachedDescriptors),
    invoke(id, payload = {}) {
      if (!ids.has(id)) return Object.freeze({ ok: false, code: "unsupported_player_action" });
      return detachedHandlers.get(id)(payload);
    }
  });
}
