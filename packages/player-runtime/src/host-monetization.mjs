const ALLOWED_KINDS = new Set(["banner", "interstitial", "purchase_link"]);
const ALLOWED_SURFACES = new Set(["top", "bottom", "menu", "between_waves"]);
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_PLACEMENTS = 16;

/**
 * Connects authored mount points to an optional page-owned host adapter. This module has no engine
 * import and cannot grant resources, change simulation state, load scripts, or collect telemetry.
 */
export function createHostMonetizationRuntimeV1(options = {}) {
  const placements = normalizeHook(options.hook);
  const root = options.root ?? globalThis.document;
  const adapter = options.adapter ?? globalThis.TowerForgeMonetizationHost;
  let mounted = false;

  return Object.freeze({
    schemaVersion: 1,
    placements,
    mount() {
      if (mounted) return { mounted: 0, available: Boolean(adapter) };
      mounted = true;
      if (!adapter || typeof adapter.mountPlacement !== "function" || !root?.querySelector) {
        return { mounted: 0, available: false };
      }
      let count = 0;
      for (const placement of placements) {
        const element = root.querySelector(`[data-towerforge-monetization-placement="${placement.id}"]`);
        if (!element) continue;
        adapter.mountPlacement(Object.freeze({ ...placement, element }));
        count += 1;
      }
      return { mounted: count, available: true };
    },
    showInterstitial(surface = "between_waves") {
      if (surface !== "between_waves" || typeof adapter?.showInterstitial !== "function") return false;
      const placement = placements.find(item => item.kind === "interstitial" && item.surface === surface);
      if (!placement) return false;
      adapter.showInterstitial(Object.freeze({ ...placement }));
      return true;
    },
    dispose() {
      if (typeof adapter?.dispose === "function") adapter.dispose();
    }
  });
}

function normalizeHook(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Host monetization hook must be an object.");
  const root = capture(value, ["schemaVersion", "placements"], "Host monetization hook");
  if (root.schemaVersion !== 1) throw new Error("Host monetization schemaVersion must be 1.");
  if (!Array.isArray(root.placements) || root.placements.length > MAX_PLACEMENTS) {
    throw new Error(`Host monetization placements must be a dense array of at most ${MAX_PLACEMENTS} items.`);
  }
  const ids = new Set();
  const placements = root.placements.map((value, index) => {
    if (!Object.hasOwn(root.placements, index)) throw new Error("Host monetization placements must not be sparse.");
    const item = capture(value, ["id", "kind", "surface"], `Host monetization placement ${index}`);
    if (typeof item.id !== "string" || !ID.test(item.id) || ids.has(item.id)) throw new Error("Host monetization placement id is invalid or duplicated.");
    if (!ALLOWED_KINDS.has(item.kind) || !ALLOWED_SURFACES.has(item.surface)) throw new Error("Host monetization placement kind or surface is unsupported.");
    ids.add(item.id);
    return Object.freeze({ id: item.id, kind: item.kind, surface: item.surface });
  });
  return Object.freeze(placements);
}

function capture(value, allowedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const output = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.includes(key)) throw new Error(`${label} contains an unsupported field.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) throw new Error(`${label} must contain enumerable own data only.`);
    output[key] = descriptor.value;
  }
  return output;
}
