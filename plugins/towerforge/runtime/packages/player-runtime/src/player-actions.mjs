export const PLAYER_ACTION_DESCRIPTOR_SCHEMA_VERSION = 1;

const DEFINITIONS = [
  ["continueSession", "player.action.continue_session", "ui"],
  ["pause", "player.action.pause", "ui"],
  ["cameraPan", "player.action.camera_pan", "ui"],
  ["cameraZoom", "player.action.camera_zoom", "ui"],
  ["cameraReset", "player.action.camera_reset", "ui"],
  ["fullscreen", "player.action.fullscreen", "ui"],
  ["openSettings", "player.action.open_settings", "ui"],
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

export function createPlayerActionRegistry(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("Player action registry options must be an object.");
  const descriptors = options.descriptors;
  const handlers = options.handlers;
  if (!Array.isArray(descriptors)) throw new TypeError("Player action descriptors must be an array.");
  if (!handlers || typeof handlers !== "object" || Array.isArray(handlers)) throw new TypeError("Player action handlers must be an object.");
  const ids = new Set();
  const detachedDescriptors = descriptors.map((descriptor) => {
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)
      || typeof descriptor.id !== "string" || !descriptor.id || ids.has(descriptor.id)) {
      throw new TypeError("Player action descriptors must have unique string ids.");
    }
    if (typeof handlers[descriptor.id] !== "function") throw new TypeError(`Missing player action handler "${descriptor.id}".`);
    ids.add(descriptor.id);
    return Object.freeze({ ...descriptor });
  });
  return Object.freeze({
    descriptors: Object.freeze(detachedDescriptors),
    invoke(id, payload = {}) {
      if (!ids.has(id)) return Object.freeze({ ok: false, code: "unsupported_player_action" });
      return handlers[id](payload);
    }
  });
}
