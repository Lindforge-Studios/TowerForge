export const PLAYER_PROFILE_STORAGE_PREFIX = "towerforge:progress:";

export function derivePlayerProfileStorageKey(options = {}) {
  const scope = ownDataValue(options, "appId") || ownDataValue(options, "manifestName") || "game";
  return `${PLAYER_PROFILE_STORAGE_PREFIX}${scope}`;
}

function frozenResult(fields) {
  return Object.freeze(fields);
}

function frozenList(value) {
  return Object.freeze(Array.isArray(value) ? [...value] : []);
}

function ownDataValue(value, key) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function unsupportedVersionFrom(error) {
  if (ownDataValue(error, "code") !== "UNSUPPORTED_PLAYER_PROFILE_VERSION") return undefined;
  const version = ownDataValue(error, "version");
  return Number.isSafeInteger(version) ? version : undefined;
}

function decodedLoadResult(decoded) {
  const source = decoded.source;
  return frozenResult({
    code: source === "v3" ? "profile_loaded" : "profile_migrated",
    profile: decoded.profile,
    source,
    migrations: frozenList(decoded.migrations),
    warnings: frozenList(decoded.warnings)
  });
}

export function createPlayerProfileStore(options) {
  const storage = ownDataValue(options, "storage");
  const content = ownDataValue(options, "content");
  const codec = ownDataValue(options, "codec");
  const explicitKey = ownDataValue(options, "key");
  const key = explicitKey ?? derivePlayerProfileStorageKey(options);
  const emptyProfile = () => codec.createEmptyPlayerProfile(content);

  const load = () => {
    if (!storage) {
      return frozenResult({ code: "storage_unavailable", profile: emptyProfile() });
    }

    let raw;
    try {
      raw = storage.getItem(key);
    } catch {
      return frozenResult({ code: "storage_read_failed", profile: emptyProfile() });
    }

    if (raw === null) {
      return frozenResult({ code: "profile_missing", profile: emptyProfile() });
    }
    if (typeof raw !== "string") {
      return frozenResult({ code: "storage_read_failed", profile: emptyProfile() });
    }

    try {
      return decodedLoadResult(codec.parsePlayerProfileJson(raw, content));
    } catch (error) {
      const unsupportedVersion = unsupportedVersionFrom(error);
      if (unsupportedVersion !== undefined) {
        return frozenResult({
          code: "profile_version_unsupported",
          profile: emptyProfile(),
          unsupportedVersion
        });
      }
      return frozenResult({ code: "profile_corrupt", profile: emptyProfile() });
    }
  };

  const save = (profile) => {
    let serialized;
    try {
      serialized = codec.serializePlayerProfile(profile);
    } catch {
      return frozenResult({ code: "profile_invalid" });
    }

    if (!storage) return frozenResult({ code: "storage_unavailable" });

    let existing;
    try {
      existing = storage.getItem(key);
    } catch {
      return frozenResult({ code: "storage_read_failed" });
    }
    if (existing !== null && typeof existing !== "string") {
      return frozenResult({ code: "storage_read_failed" });
    }

    if (typeof existing === "string") {
      try {
        codec.parsePlayerProfileJson(existing, content);
      } catch (error) {
        const unsupportedVersion = unsupportedVersionFrom(error);
        if (unsupportedVersion !== undefined) {
          return frozenResult({ code: "profile_version_unsupported", unsupportedVersion });
        }
      }
    }

    try {
      storage.setItem(key, serialized);
    } catch {
      return frozenResult({ code: "storage_write_failed" });
    }
    return frozenResult({ code: "profile_saved" });
  };

  const reset = () => {
    const profile = emptyProfile();
    if (!storage) return frozenResult({ code: "storage_unavailable", profile });
    try {
      storage.removeItem(key);
    } catch {
      return frozenResult({ code: "storage_remove_failed", profile });
    }
    return frozenResult({ code: "profile_reset", profile });
  };

  return Object.freeze({ load, save, reset });
}
