export const PLAYER_SESSION_SAVE_SCHEMA_VERSION = 1;

const SAVE_KEYS = Object.freeze(["schemaVersion", "activeMissionId", "checkpoint", "journalSuffix", "contentDigest", "capabilityDigest", "savedAt"]);
const CAPABILITY_DIGEST_PATTERN = /^tf-capabilities-v1:[a-f0-9]{16}$/i;

function capabilityMissingError() {
  const error = new TypeError("capabilityDigest is required.");
  Object.defineProperty(error, "code", { value: "session_capability_missing", enumerable: false });
  return error;
}

function ownData(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${field} must be a plain object.`);
  }
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError(`${field} cannot contain symbol keys.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw new TypeError(`${field}.${key} must be an own data property.`);
    result[key] = descriptor.value;
  }
  return result;
}

function cloneOwnData(value, field, seen = new WeakSet(), depth = 0) {
  if (depth > 64) throw new RangeError(`${field} exceeds the supported nesting depth.`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${field} contains a non-finite number.`);
    return value;
  }
  if (typeof value !== "object") throw new TypeError(`${field} contains an unsupported value.`);
  if (seen.has(value)) throw new TypeError(`${field} must not be cyclic.`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > 100_000) throw new RangeError(`${field} exceeds the supported array limit.`);
    const copy = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) throw new TypeError(`${field} must not be sparse.`);
      copy.push(cloneOwnData(value[index], `${field}[${index}]`, seen, depth + 1));
    }
    seen.delete(value);
    return copy;
  }
  const record = ownData(value, field);
  const copy = {};
  for (const [key, entry] of Object.entries(record)) copy[key] = cloneOwnData(entry, `${field}.${key}`, seen, depth + 1);
  seen.delete(value);
  return copy;
}

function normalize(value) {
  const record = ownData(value, "sessionSave");
  for (const key of Object.keys(record)) if (!SAVE_KEYS.includes(key)) throw new TypeError(`Unknown session save field "${key}".`);
  if (record.schemaVersion !== PLAYER_SESSION_SAVE_SCHEMA_VERSION) throw new RangeError("Unsupported PlayerSessionSave schemaVersion.");
  if (typeof record.activeMissionId !== "string" || !record.activeMissionId || record.activeMissionId.length > 256) throw new TypeError("activeMissionId is invalid.");
  if (!record.checkpoint || typeof record.checkpoint !== "object") throw new TypeError("checkpoint is required.");
  if (!Array.isArray(record.journalSuffix) || record.journalSuffix.length > 100_000) throw new TypeError("journalSuffix is invalid.");
  if (typeof record.contentDigest !== "string" || !(/^[a-f0-9]{64}$/i.test(record.contentDigest) || /^tf-content-v1:[a-f0-9]{16}$/i.test(record.contentDigest))) {
    throw new TypeError("contentDigest is invalid.");
  }
  if (record.capabilityDigest === undefined) throw capabilityMissingError();
  if (typeof record.capabilityDigest !== "string" || !CAPABILITY_DIGEST_PATTERN.test(record.capabilityDigest)) {
    throw new TypeError("capabilityDigest is invalid.");
  }
  if (typeof record.savedAt !== "string" || !Number.isFinite(Date.parse(record.savedAt))) throw new TypeError("savedAt must be an ISO timestamp.");
  const result = {
    schemaVersion: PLAYER_SESSION_SAVE_SCHEMA_VERSION,
    activeMissionId: record.activeMissionId,
    checkpoint: cloneOwnData(record.checkpoint, "checkpoint"),
    journalSuffix: cloneOwnData(record.journalSuffix, "journalSuffix"),
    contentDigest: record.contentDigest,
    capabilityDigest: record.capabilityDigest,
    savedAt: record.savedAt
  };
  return Object.freeze(result);
}

export function serializePlayerSessionSaveV1(value) {
  return JSON.stringify(normalize(value));
}

export function parsePlayerSessionSaveV1(raw) {
  if (typeof raw !== "string") throw new TypeError("Serialized session save must be a string.");
  return normalize(JSON.parse(raw));
}

export function createRotatingPlayerSessionStore(options) {
  const record = ownData(options, "options");
  const storage = record.storage;
  const baseKey = record.baseKey;
  const codec = record.codec;
  const restore = record.restore;
  const expectedContentDigest = record.expectedContentDigest;
  const expectedCapabilityDigest = record.expectedCapabilityDigest;
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") throw new TypeError("storage port is invalid.");
  if (typeof baseKey !== "string" || !baseKey) throw new TypeError("baseKey is required.");
  if (!codec || typeof codec.parse !== "function" || typeof codec.serialize !== "function") throw new TypeError("codec is invalid.");
  if (typeof restore !== "function") throw new TypeError("restore callback is required.");
  if (expectedCapabilityDigest !== undefined
    && typeof expectedCapabilityDigest !== "function"
    && (typeof expectedCapabilityDigest !== "string" || !CAPABILITY_DIGEST_PATTERN.test(expectedCapabilityDigest))) {
    throw new TypeError("expectedCapabilityDigest must be a canonical digest or resolver.");
  }
  const headKey = `${baseKey}:head`;
  const slotKeys = Object.freeze([`${baseKey}:slot-0`, `${baseKey}:slot-1`]);
  const slotKey = (slot) => slotKeys[slot];
  let mutationTail = Promise.resolve();

  const enqueueMutation = (operation) => {
    const pending = mutationTail.then(operation, operation);
    mutationTail = pending.then(() => undefined, () => undefined);
    return pending;
  };

  const save = (value) => {
    const serialized = codec.serialize(value);
    return enqueueMutation(async () => {
      const current = await storage.getItem(headKey);
      const slot = current === "0" ? 1 : 0;
      await storage.setItem(slotKey(slot), serialized);
      await storage.setItem(headKey, String(slot));
      return Object.freeze({ code: "session_saved", slot });
    });
  };

  const loadLatest = async () => {
    await mutationTail;
    let head;
    try { head = await storage.getItem(headKey); } catch { return Object.freeze({ code: "session_unavailable" }); }
    const primary = head === "1" ? 1 : 0;
    let found = false;
    let contentMismatch = false;
    let capabilityMissing = false;
    let capabilityMismatch = false;
    for (const slot of [primary, 1 - primary]) {
      try {
        const raw = await storage.getItem(slotKey(slot));
        if (raw === null) continue;
        found = true;
        if (typeof raw !== "string") continue;
        const value = codec.parse(raw);
        if (typeof expectedContentDigest === "string" && value.contentDigest !== expectedContentDigest) {
          contentMismatch = true;
          continue;
        }
        if (typeof value.capabilityDigest !== "string") {
          capabilityMissing = true;
          continue;
        }
        if (expectedCapabilityDigest !== undefined) {
          let expected;
          try {
            expected = typeof expectedCapabilityDigest === "function"
              ? expectedCapabilityDigest(value)
              : expectedCapabilityDigest;
          } catch {
            capabilityMismatch = true;
            continue;
          }
          if (typeof expected !== "string" || !CAPABILITY_DIGEST_PATTERN.test(expected)
            || value.capabilityDigest !== expected) {
            capabilityMismatch = true;
            continue;
          }
        }
        const restored = await restore(value);
        return Object.freeze({ code: "session_loaded", slot, restored });
      } catch (error) {
        if (error?.code === "session_capability_missing") capabilityMissing = true;
        // A complete previous slot is the recovery boundary.
      }
    }
    return Object.freeze({ code: capabilityMissing
      ? "session_capability_missing"
      : capabilityMismatch
        ? "session_capability_mismatch"
        : contentMismatch
          ? "session_content_mismatch"
          : found ? "session_corrupt" : "session_missing" });
  };

  const reset = () => enqueueMutation(async () => {
    if (typeof storage.removeItem !== "function") return Object.freeze({ code: "session_remove_unavailable" });
    await storage.removeItem(slotKey(0));
    await storage.removeItem(slotKey(1));
    await storage.removeItem(headKey);
    return Object.freeze({ code: "session_reset" });
  });
  return Object.freeze({ save, loadLatest, reset });
}
