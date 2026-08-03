const SLOT_KEYS = Object.freeze(["slot-0", "slot-1"]);

function validateOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("Native storage options are required.");
  const descriptors = Object.getOwnPropertyDescriptors(options);
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== "string" || !descriptors[key] || !("value" in descriptors[key])) {
      throw new TypeError("Native storage options must contain only own data.");
    }
  }
  if (typeof options.invoke !== "function") throw new TypeError("Native invoke function is required.");
  if (typeof options.baseKey !== "string" || !options.baseKey || options.baseKey.length > 512) {
    throw new TypeError("Native storage baseKey is invalid.");
  }
  return { invoke: options.invoke, baseKey: options.baseKey };
}

function logicalKey(baseKey, key) {
  if (key === `${baseKey}:head`) return Object.freeze({ kind: "head" });
  for (let slot = 0; slot < SLOT_KEYS.length; slot += 1) {
    if (key === `${baseKey}:${SLOT_KEYS[slot]}`) return Object.freeze({ kind: "slot", slot });
  }
  throw new RangeError("Native storage key is outside the supported head and session slots.");
}

export function createNativeStorageBridgeV1(options) {
  const { invoke, baseKey } = validateOptions(options);
  return Object.freeze({
    async getItem(key) {
      const resolved = logicalKey(baseKey, key);
      const value = resolved.kind === "head"
        ? await invoke("player_session_read_head")
        : await invoke("player_session_read_slot", { slot: resolved.slot });
      return value === undefined ? null : value;
    },
    async setItem(key, value) {
      if (typeof value !== "string") throw new TypeError("Native session storage accepts string values only.");
      const resolved = logicalKey(baseKey, key);
      if (resolved.kind === "head") {
        if (value !== "0" && value !== "1") throw new RangeError("Native session head must name slot 0 or 1.");
        await invoke("player_session_write_head", { slot: Number(value) });
      } else {
        await invoke("player_session_write_slot", { slot: resolved.slot, value });
      }
    },
    async removeItem(key) {
      const resolved = logicalKey(baseKey, key);
      if (resolved.kind === "head") await invoke("player_session_remove_head");
      else await invoke("player_session_remove_slot", { slot: resolved.slot });
    }
  });
}

export function resolveNativePlayerInvokeV1(runtime = globalThis) {
  const invoke = runtime?.__TAURI_INTERNALS__?.invoke;
  return typeof invoke === "function" ? invoke.bind(runtime.__TAURI_INTERNALS__) : null;
}

export function installNativePlayerLifecycleV1(options) {
  if (!options || typeof options !== "object") throw new TypeError("Native lifecycle options are required.");
  const invoke = options.invoke;
  const save = options.save;
  const onResume = options.onResume ?? (() => {});
  const document = options.document ?? globalThis.document;
  const window = options.window ?? globalThis.window;
  const runtime = options.runtime ?? globalThis;
  if (typeof invoke !== "function" || typeof save !== "function" || typeof onResume !== "function") {
    throw new TypeError("Native lifecycle callbacks are invalid.");
  }
  let pendingPromise = null;
  const flush = () => {
    if (pendingPromise) return pendingPromise;
    pendingPromise = (async () => {
      await invoke("player_set_pending_write", { pending: true });
      try {
        return await save();
      } finally {
        await invoke("player_set_pending_write", { pending: false });
      }
    })().finally(() => { pendingPromise = null; });
    return pendingPromise;
  };
  const visibilitychange = () => { if (document?.hidden) void flush(); };
  const pagehide = () => { void flush(); };
  const suspend = () => { void flush(); };
  const resume = () => { onResume(); };
  let closing = false;
  const closeRequested = () => {
    if (closing) return;
    closing = true;
    void flush()
      .then(() => invoke("player_finish_close"))
      .catch(() => { closing = false; });
  };
  document?.addEventListener?.("visibilitychange", visibilitychange);
  window?.addEventListener?.("pagehide", pagehide);
  window?.addEventListener?.("towerforge-native-suspend", suspend);
  window?.addEventListener?.("towerforge-native-resume", resume);
  window?.addEventListener?.("towerforge-native-close-requested", closeRequested);
  const internals = runtime?.__TAURI_INTERNALS__;
  if (typeof internals?.transformCallback === "function") {
    for (const [event, callback] of [
      ["towerforge-native-suspend", suspend],
      ["towerforge-native-resume", resume],
      ["towerforge-native-close-requested", closeRequested]
    ]) {
      const handler = internals.transformCallback(callback);
      void invoke("plugin:event|listen", { event, target: { kind: "Any" }, handler });
    }
  }
  return Object.freeze({
    flush,
    setFullscreen: (fullscreen) => invoke("player_set_fullscreen", { fullscreen: Boolean(fullscreen) }),
    requestClose: closeRequested,
    dispose() {
      document?.removeEventListener?.("visibilitychange", visibilitychange);
      window?.removeEventListener?.("pagehide", pagehide);
      window?.removeEventListener?.("towerforge-native-suspend", suspend);
      window?.removeEventListener?.("towerforge-native-resume", resume);
      window?.removeEventListener?.("towerforge-native-close-requested", closeRequested);
    }
  });
}
