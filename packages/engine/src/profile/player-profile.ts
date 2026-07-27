import type { GameContentRegistry } from "../content/registry.js";
import { canonicalStringify } from "../simulation/stable-digest.js";

export const PLAYER_PROFILE_SCHEMA_VERSION = 3 as const;

export const PLAYER_PROFILE_LIMITS = Object.freeze({
  jsonBytes: 1 * 1_024 * 1_024,
  collectionEntries: 10_000,
  warnings: 1_000
});

export interface PlayerProfilePersistentFields {
  readonly clearedMissionIds: readonly string[];
  readonly starsByMission: Readonly<Record<string, number>>;
  readonly metaResources: Readonly<Record<string, number>>;
  readonly upgradeLevels: Readonly<Record<string, number>>;
  readonly selectedDifficultyId: string;
}

/** Migration input retained for explicit v2 -> v3 decoding only. */
export interface PlayerProfileV2 extends PlayerProfilePersistentFields {
  readonly version: 2;
}

/** Canonical persistent player profile. */
export interface PlayerProfileV3 extends PlayerProfilePersistentFields {
  readonly version: typeof PLAYER_PROFILE_SCHEMA_VERSION;
}

export type PlayerProfile = PlayerProfileV3;

export interface PlayerProfileMigration {
  readonly id: string;
  readonly description: string;
}

export interface PlayerProfileWarning {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type PlayerProfileSource = "v3" | "v2" | "legacy-array" | "legacy-object";

export interface DecodedPlayerProfile {
  readonly profile: PlayerProfileV3;
  readonly source: PlayerProfileSource;
  readonly migrations: readonly PlayerProfileMigration[];
  readonly warnings: readonly PlayerProfileWarning[];
}

export interface PlayerProfileLaunchOptions {
  readonly difficultyId: string;
  readonly metaUpgradeLevels: Record<string, number>;
}

export type PlayerProfileFailureCode =
  | "unknown_difficulty"
  | "unknown_upgrade"
  | "upgrade_max_level"
  | "insufficient_meta_resources"
  | "invalid_upgrade_cost"
  | "unknown_mission"
  | "invalid_earned_stars"
  | "invalid_mission_reward";

export interface PlayerProfileFailure {
  readonly ok: false;
  readonly code: PlayerProfileFailureCode;
  readonly profile: PlayerProfileV3;
}

export type PlayerDifficultySelectionResult = PlayerProfileFailure | {
  readonly ok: true;
  readonly code: "difficulty_selected" | "difficulty_unchanged";
  readonly profile: PlayerProfileV3;
};

export type PlayerMetaUpgradePurchaseResult = PlayerProfileFailure | {
  readonly ok: true;
  readonly code: "upgrade_purchased";
  readonly profile: PlayerProfileV3;
  readonly upgradeId: string;
  readonly previousLevel: number;
  readonly newLevel: number;
};

export type PlayerMissionClearResult = (PlayerProfileFailure & {
  readonly grantedResources?: never;
  readonly newlyUnlockedMissionIds?: never;
}) | {
  readonly ok: true;
  readonly code: "mission_clear_recorded";
  readonly profile: PlayerProfileV3;
  readonly missionId: string;
  readonly firstClear: boolean;
  readonly previousStars: number;
  /** Stars achieved by this clear; the profile keeps the greater historical best. */
  readonly earnedStars: number;
  readonly grantedResources: Readonly<Record<string, number>>;
  readonly newlyUnlockedMissionIds: readonly string[];
};

export class UnsupportedPlayerProfileVersionError extends Error {
  readonly code = "UNSUPPORTED_PLAYER_PROFILE_VERSION" as const;
  readonly version: number;

  constructor(version: number) {
    super(`Unsupported player profile version "${version}".`);
    this.name = "UnsupportedPlayerProfileVersionError";
    this.version = version;
  }
}

type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;
type ProfileFields = ReadonlyMap<string, unknown>;

const PROFILE_KEYS = Object.freeze([
  "version",
  "clearedMissionIds",
  "starsByMission",
  "metaResources",
  "upgradeLevels",
  "selectedDifficultyId"
] as const);
const PROFILE_KEY_SET = new Set<string>(PROFILE_KEYS);
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_PROFILE_DEPTH = 64;
const MAX_PROFILE_NODES = PLAYER_PROFILE_LIMITS.collectionEntries * 8 + 1_024;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) bytes += 1;
    else if (codeUnit <= 0x7ff) bytes += 2;
    else if (
      codeUnit >= 0xd800
      && codeUnit <= 0xdbff
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function hasTopLevelNumericVersionMember(source: string): boolean {
  let index = 0;
  while (index < source.length && /\s/u.test(source[index]!)) index += 1;
  if (source[index] !== "{") return false;

  let depth = 1;
  index += 1;
  while (index < source.length && depth > 0) {
    const character = source[index]!;
    if (character === '"') {
      const start = index;
      index += 1;
      let terminated = false;
      while (index < source.length) {
        const stringCharacter = source[index]!;
        if (stringCharacter === "\\") {
          index += 2;
          continue;
        }
        index += 1;
        if (stringCharacter === '"') {
          terminated = true;
          break;
        }
      }
      if (!terminated) return false;

      // A JSON spelling of the seven ASCII code units in "version" is at most
      // seven six-byte unicode escapes plus the surrounding quotes.
      if (depth === 1 && index - start <= 44) {
        let key: unknown;
        try {
          key = JSON.parse(source.slice(start, index)) as unknown;
        } catch {
          return false;
        }
        if (key === "version") {
          let cursor = index;
          while (cursor < source.length && /\s/u.test(source[cursor]!)) cursor += 1;
          if (source[cursor] === ":") {
            cursor += 1;
            while (cursor < source.length && /\s/u.test(source[cursor]!)) cursor += 1;
            const firstValueCharacter = source[cursor];
            if (firstValueCharacter === "-" || (firstValueCharacter !== undefined && firstValueCharacter >= "0" && firstValueCharacter <= "9")) {
              return true;
            }
          }
        }
      }
      continue;
    }
    if (character === "{" || character === "[") {
      depth += 1;
      index += 1;
      continue;
    }
    if (character === "}" || character === "]") {
      depth -= 1;
      index += 1;
      continue;
    }
    index += 1;
  }
  return false;
}

function oversizedFutureProfileVersion(source: string): number | undefined {
  // Ordinary oversized/corrupt inputs retain the pre-parse byte boundary. Only a
  // lexically top-level numeric version candidate is parsed so a future format can
  // remain opaque to the current codec instead of being mistaken for corrupt data.
  if (!hasTopLevelNumericVersionMember(source)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(parsed, "version");
  const version = descriptor && "value" in descriptor ? descriptor.value : undefined;
  return typeof version === "number"
    && Number.isSafeInteger(version)
    && version > PLAYER_PROFILE_SCHEMA_VERSION
    ? version
    : undefined;
}

/**
 * Capture an untrusted profile into plain detached data while validating its budget.
 * Each source object is inspected through one descriptor snapshot; later profile
 * processing must only read the detached result. Non-finite numbers are retained
 * because the profile normalizer intentionally repairs them.
 */
function captureSafeBoundedInput(value: unknown, detectFutureRootVersion = false): unknown {
  const ancestors = new WeakSet<object>();
  let bytes = 0;
  let nodes = 0;

  const emit = (valueToMeasure: string): void => {
    bytes += utf8ByteLength(valueToMeasure);
    if (bytes > PLAYER_PROFILE_LIMITS.jsonBytes) {
      throw new Error(`Player profile exceeds the ${PLAYER_PROFILE_LIMITS.jsonBytes} byte budget.`);
    }
  };

  const visit = (current: unknown, depth: number): unknown => {
    if (depth > MAX_PROFILE_DEPTH) throw new Error("Player profile exceeds the nesting depth limit.");
    nodes += 1;
    if (nodes > MAX_PROFILE_NODES) throw new Error("Player profile exceeds the node budget.");

    if (current === null) {
      emit("null");
      return null;
    }
    if (typeof current === "string") {
      emit(JSON.stringify(current));
      return current;
    }
    if (typeof current === "boolean") {
      emit(current ? "true" : "false");
      return current;
    }
    if (typeof current === "number") {
      emit(Number.isFinite(current) ? (Object.is(current, -0) ? "0" : JSON.stringify(current)) : "null");
      return current;
    }
    if (typeof current !== "object") {
      throw new Error(`Player profile rejects unsupported ${typeof current} values.`);
    }
    if (ancestors.has(current)) throw new Error("Player profile rejects values containing a cycle.");

    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype) {
          throw new Error("Player profile accepts plain arrays only.");
        }
        const descriptors = Object.getOwnPropertyDescriptors(current) as unknown as DescriptorMap;
        if (Object.getOwnPropertySymbols(descriptors).length > 0) {
          throw new Error("Player profile rejects symbol keys.");
        }
        const lengthDescriptor = descriptors.length;
        if (!lengthDescriptor || !("value" in lengthDescriptor)) {
          throw new Error("Player profile array length must be a data property.");
        }
        const length = lengthDescriptor.value as unknown;
        if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
          throw new Error("Player profile array length is invalid.");
        }
        if (length > PLAYER_PROFILE_LIMITS.collectionEntries) {
          throw new Error(`Player profile collection exceeds the ${PLAYER_PROFILE_LIMITS.collectionEntries} entry limit.`);
        }
        const elementKeys = Object.keys(descriptors).filter((key) => key !== "length");
        if (elementKeys.length !== length) {
          throw new Error("Player profile rejects sparse arrays or arrays with extra properties.");
        }
        emit("[");
        const detached: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          if (index > 0) emit(",");
          const descriptor = descriptors[String(index)];
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw new Error("Player profile array entries must be enumerable data properties; accessors are rejected.");
          }
          detached.push(visit(descriptor.value, depth + 1));
        }
        emit("]");
        return detached;
      }

      if (Object.getPrototypeOf(current) !== Object.prototype) {
        throw new Error("Player profile accepts plain objects with the standard prototype only.");
      }
      const descriptors = Object.getOwnPropertyDescriptors(current) as DescriptorMap;
      if (Object.getOwnPropertySymbols(descriptors).length > 0) {
        throw new Error("Player profile rejects symbol keys.");
      }
      if (depth === 0 && detectFutureRootVersion) {
        const versionDescriptor = descriptors.version;
        if (
          versionDescriptor
          && "value" in versionDescriptor
          && Number.isSafeInteger(versionDescriptor.value)
          && (versionDescriptor.value as number) > PLAYER_PROFILE_SCHEMA_VERSION
        ) {
          throw new UnsupportedPlayerProfileVersionError(versionDescriptor.value as number);
        }
      }
      const keys = Object.keys(descriptors).sort();
      if (keys.length > PLAYER_PROFILE_LIMITS.collectionEntries) {
        throw new Error(`Player profile collection exceeds the ${PLAYER_PROFILE_LIMITS.collectionEntries} entry limit.`);
      }
      for (const key of keys) {
        // The envelope is closed and must never accept pollution-shaped fields. Nested
        // records, however, use authored domain IDs and are copied with defineProperty;
        // `__proto__` and `constructor` are therefore safe and valid there.
        if (depth === 0 && UNSAFE_KEYS.has(key)) {
          throw new Error(`Player profile rejects unsafe prototype key "${key}".`);
        }
        const descriptor = descriptors[key];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new Error("Player profile object fields must be enumerable data properties; accessors are rejected.");
        }
      }
      emit("{");
      const detached: Record<string, unknown> = {};
      for (let index = 0; index < keys.length; index += 1) {
        if (index > 0) emit(",");
        const key = keys[index]!;
        emit(JSON.stringify(key));
        emit(":");
        Object.defineProperty(detached, key, {
          value: visit(descriptors[key]!.value, depth + 1),
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
      emit("}");
      return detached;
    } finally {
      ancestors.delete(current);
    }
  };

  return visit(value, 0);
}

function objectFields(value: unknown, context: string): ProfileFields {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${context} must be a plain object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as DescriptorMap;
  const fields = new Map<string, unknown>();
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error(`${context} fields must be enumerable data properties; accessors are rejected.`);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function arrayItems(value: unknown, context: string): readonly unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as DescriptorMap;
  const length = descriptors.length?.value as unknown;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    throw new Error(`${context} has an invalid array length.`);
  }
  const items: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error(`${context} rejects sparse arrays and accessors.`);
    }
    items.push(descriptor.value);
  }
  return items;
}

function setRecordValue(record: Record<string, number>, key: string, value: number): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true
  });
}

class WarningCollector {
  private readonly collected: PlayerProfileWarning[] = [];
  private truncated = false;

  add(code: string, path: string, message: string): void {
    if (this.truncated) return;
    if (this.collected.length >= PLAYER_PROFILE_LIMITS.warnings) {
      this.collected[PLAYER_PROFILE_LIMITS.warnings - 1] = Object.freeze({
        code: "warnings_truncated",
        path: "$",
        message: `Additional player profile warnings were omitted after reaching the ${PLAYER_PROFILE_LIMITS.warnings} warning limit.`
      });
      this.truncated = true;
      return;
    }
    this.collected.push(Object.freeze({ code, path, message }));
  }

  finish(): readonly PlayerProfileWarning[] {
    return Object.freeze(this.collected.slice());
  }
}

function normalizedNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim().length > 0) return Number(value);
  return undefined;
}

function diagnosticValueLabel(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (value === Number.POSITIVE_INFINITY) return "Infinity";
    if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
    return Object.is(value, -0) ? "0" : `${value}`;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return "[array]";
  if (typeof value === "object") return "[object]";
  return `[${typeof value}]`;
}

function normalizeNonnegativeNumber(
  value: unknown,
  path: string,
  warnings: WarningCollector,
  options: { integer?: boolean; maximum?: number } = {}
): number {
  const parsed = normalizedNumber(value);
  let normalized = parsed !== undefined && Number.isFinite(parsed) ? parsed : 0;
  if (normalized < 0) normalized = 0;
  if (options.integer) normalized = Math.floor(normalized);
  if (options.maximum !== undefined) normalized = Math.min(normalized, options.maximum);
  if (parsed === undefined || !Number.isFinite(parsed) || normalized !== parsed || typeof value !== "number") {
    warnings.add(
      "number_normalized",
      path,
      `Player profile value at ${path} was normalized to ${normalized}.`
    );
  }
  return Object.is(normalized, -0) ? 0 : normalized;
}

function freezeProfile(profile: {
  version: typeof PLAYER_PROFILE_SCHEMA_VERSION;
  clearedMissionIds: string[];
  starsByMission: Record<string, number>;
  metaResources: Record<string, number>;
  upgradeLevels: Record<string, number>;
  selectedDifficultyId: string;
}): PlayerProfileV3 {
  Object.freeze(profile.clearedMissionIds);
  Object.freeze(profile.starsByMission);
  Object.freeze(profile.metaResources);
  Object.freeze(profile.upgradeLevels);
  return Object.freeze(profile);
}

export function createEmptyPlayerProfile(content: GameContentRegistry): PlayerProfileV3 {
  const metaResources: Record<string, number> = {};
  for (const currency of content.metaProgression.currencies) setRecordValue(metaResources, currency.id, 0);
  const upgradeLevels: Record<string, number> = {};
  for (const upgradeId of Object.keys(content.metaProgression.upgrades)) setRecordValue(upgradeLevels, upgradeId, 0);
  return freezeProfile({
    version: PLAYER_PROFILE_SCHEMA_VERSION,
    clearedMissionIds: [],
    starsByMission: {},
    metaResources,
    upgradeLevels,
    selectedDifficultyId: content.defaultDifficultyId
  });
}

function normalizeProfile(
  fields: ProfileFields,
  content: GameContentRegistry,
  warnings: WarningCollector
): PlayerProfileV3 {
  for (const key of fields.keys()) {
    if (!PROFILE_KEY_SET.has(key)) {
      warnings.add("extra_field_dropped", `$.${key}`, `Extra player profile field "${key}" was dropped.`);
    }
  }

  const clearedMissionIds: string[] = [];
  const seenMissions = new Set<string>();
  const rawClears = arrayItems(fields.get("clearedMissionIds"), "Player profile clearedMissionIds");
  if (fields.has("clearedMissionIds") && !rawClears) {
    warnings.add("invalid_collection", "$.clearedMissionIds", "Player profile clearedMissionIds was not an array and was reset.");
  }
  for (let index = 0; index < (rawClears?.length ?? 0); index += 1) {
    const missionId = rawClears![index];
    const path = `$.clearedMissionIds[${index}]`;
    if (typeof missionId !== "string" || !Object.prototype.hasOwnProperty.call(content.missions, missionId)) {
      warnings.add("unknown_mission_dropped", path, `Unknown mission "${diagnosticValueLabel(missionId)}" was dropped.`);
      continue;
    }
    if (seenMissions.has(missionId)) {
      warnings.add("duplicate_mission_dropped", path, `Duplicate mission "${missionId}" was dropped.`);
      continue;
    }
    seenMissions.add(missionId);
    clearedMissionIds.push(missionId);
  }

  const starsByMission: Record<string, number> = {};
  let starFields: ProfileFields | undefined;
  if (fields.has("starsByMission")) {
    const rawStars = fields.get("starsByMission");
    if (rawStars !== null && typeof rawStars === "object" && !Array.isArray(rawStars)) {
      starFields = objectFields(rawStars, "Player profile starsByMission");
    } else {
      warnings.add("invalid_collection", "$.starsByMission", "Player profile starsByMission was not an object and was reset.");
    }
  }
  if (starFields) {
    for (const missionId of starFields.keys()) {
      if (!Object.prototype.hasOwnProperty.call(content.missions, missionId)) {
        warnings.add("unknown_mission_dropped", `$.starsByMission.${missionId}`, `Unknown mission "${missionId}" was dropped from stars.`);
      }
    }
    for (const missionId of Object.keys(content.missions)) {
      if (!starFields.has(missionId)) continue;
      const maximum = content.missions[missionId]?.objectives?.stars?.length ?? 0;
      setRecordValue(
        starsByMission,
        missionId,
        normalizeNonnegativeNumber(starFields.get(missionId), `$.starsByMission.${missionId}`, warnings, { integer: true, maximum })
      );
    }
  }

  const metaResources: Record<string, number> = {};
  let resourceFields: ProfileFields | undefined;
  if (fields.has("metaResources")) {
    const rawResources = fields.get("metaResources");
    if (rawResources !== null && typeof rawResources === "object" && !Array.isArray(rawResources)) {
      resourceFields = objectFields(rawResources, "Player profile metaResources");
    } else {
      warnings.add("invalid_collection", "$.metaResources", "Player profile metaResources was not an object and was reset.");
    }
  }
  const currencyIds = new Set(content.metaProgression.currencies.map((currency) => currency.id));
  if (resourceFields) {
    for (const currencyId of resourceFields.keys()) {
      if (!currencyIds.has(currencyId)) {
        warnings.add("unknown_currency_dropped", `$.metaResources.${currencyId}`, `Unknown currency "${currencyId}" was dropped.`);
      }
    }
  }
  for (const currency of content.metaProgression.currencies) {
    setRecordValue(
      metaResources,
      currency.id,
      resourceFields?.has(currency.id)
        ? normalizeNonnegativeNumber(resourceFields.get(currency.id), `$.metaResources.${currency.id}`, warnings)
        : 0
    );
  }

  const upgradeLevels: Record<string, number> = {};
  let upgradeFields: ProfileFields | undefined;
  if (fields.has("upgradeLevels")) {
    const rawUpgrades = fields.get("upgradeLevels");
    if (rawUpgrades !== null && typeof rawUpgrades === "object" && !Array.isArray(rawUpgrades)) {
      upgradeFields = objectFields(rawUpgrades, "Player profile upgradeLevels");
    } else {
      warnings.add("invalid_collection", "$.upgradeLevels", "Player profile upgradeLevels was not an object and was reset.");
    }
  }
  const authoredUpgrades = content.metaProgression.upgrades;
  if (upgradeFields) {
    for (const upgradeId of upgradeFields.keys()) {
      if (!Object.prototype.hasOwnProperty.call(authoredUpgrades, upgradeId)) {
        warnings.add("unknown_upgrade_dropped", `$.upgradeLevels.${upgradeId}`, `Unknown upgrade "${upgradeId}" was dropped.`);
      }
    }
  }
  for (const upgradeId of Object.keys(authoredUpgrades)) {
    setRecordValue(
      upgradeLevels,
      upgradeId,
      upgradeFields?.has(upgradeId)
        ? normalizeNonnegativeNumber(upgradeFields.get(upgradeId), `$.upgradeLevels.${upgradeId}`, warnings, {
            integer: true,
            maximum: Math.max(0, Math.floor(authoredUpgrades[upgradeId]?.maxLevel ?? 0))
          })
        : 0
    );
  }

  let selectedDifficultyId = content.defaultDifficultyId;
  if (fields.has("selectedDifficultyId")) {
    const candidate = fields.get("selectedDifficultyId");
    if (typeof candidate === "string" && content.difficulties.some((difficulty) => difficulty.id === candidate)) {
      selectedDifficultyId = candidate;
    } else {
      warnings.add(
        "unknown_difficulty_defaulted",
        "$.selectedDifficultyId",
        `Player profile difficulty "${diagnosticValueLabel(candidate)}" is unknown; defaulted to "${content.defaultDifficultyId}".`
      );
    }
  }

  return freezeProfile({
    version: PLAYER_PROFILE_SCHEMA_VERSION,
    clearedMissionIds,
    starsByMission,
    metaResources,
    upgradeLevels,
    selectedDifficultyId
  });
}

function frozenMigrations(source: PlayerProfileSource): readonly PlayerProfileMigration[] {
  if (source === "v3") return Object.freeze([]);
  const migrations: PlayerProfileMigration[] = [];
  if (source === "legacy-array") {
    migrations.push(Object.freeze({
      id: "legacy-clears-array-to-profile-v2",
      description: "Migrated the legacy cleared-mission array to player profile v2."
    }));
  } else if (source === "legacy-object") {
    migrations.push(Object.freeze({
      id: "legacy-object-to-profile-v2",
      description: "Migrated the legacy unversioned/version-1 object to player profile v2."
    }));
  }
  migrations.push(Object.freeze({
    id: "player-profile-v2-to-v3",
    description: "Migrated player profile v2 to player profile v3 without changing persistent progress."
  }));
  return Object.freeze(migrations);
}

export function decodePlayerProfile(value: unknown, content: GameContentRegistry): DecodedPlayerProfile {
  const captured = captureSafeBoundedInput(value, true);
  const warnings = new WarningCollector();
  let source: PlayerProfileSource;
  let fields: ProfileFields;

  if (Array.isArray(captured)) {
    source = "legacy-array";
    fields = new Map([["clearedMissionIds", captured]]);
  } else {
    fields = objectFields(captured, "Player profile");
    if (!fields.has("version")) source = "legacy-object";
    else {
      const version = fields.get("version");
      if (version === PLAYER_PROFILE_SCHEMA_VERSION) source = "v3";
      else if (version === 2) source = "v2";
      else if (version === 1) source = "legacy-object";
      else if (typeof version === "number" && Number.isSafeInteger(version) && version > PLAYER_PROFILE_SCHEMA_VERSION) {
        throw new UnsupportedPlayerProfileVersionError(version);
      } else {
        throw new Error(`Invalid player profile version "${diagnosticValueLabel(version)}".`);
      }
    }
  }

  const result: DecodedPlayerProfile = {
    profile: normalizeProfile(fields, content, warnings),
    source,
    migrations: frozenMigrations(source),
    warnings: warnings.finish()
  };
  return Object.freeze(result);
}

export function parsePlayerProfileJson(source: string, content: GameContentRegistry): DecodedPlayerProfile {
  if (typeof source !== "string") throw new Error("Player profile JSON source must be a string.");
  if (utf8ByteLength(source) > PLAYER_PROFILE_LIMITS.jsonBytes) {
    const futureVersion = oversizedFutureProfileVersion(source);
    if (futureVersion !== undefined) throw new UnsupportedPlayerProfileVersionError(futureVersion);
    throw new Error(`Player profile JSON exceeds the ${PLAYER_PROFILE_LIMITS.jsonBytes} byte budget.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (cause) {
    throw new Error("Player profile JSON is malformed.", { cause });
  }
  return decodePlayerProfile(parsed, content);
}

function assertSerializableProfile(profile: PlayerProfileV3): PlayerProfileV3 {
  const captured = captureSafeBoundedInput(profile);
  const fields = objectFields(captured, "Player profile");
  if (fields.size !== PROFILE_KEYS.length || PROFILE_KEYS.some((key) => !fields.has(key))) {
    throw new Error("Player profile contains missing or unsupported fields.");
  }
  if (fields.get("version") !== PLAYER_PROFILE_SCHEMA_VERSION) {
    throw new Error("Player profile version must be 3 for serialization.");
  }
  const clears = arrayItems(fields.get("clearedMissionIds"), "Player profile clearedMissionIds");
  if (!clears || clears.some((missionId) => typeof missionId !== "string")) {
    throw new Error("Player profile clearedMissionIds must contain strings.");
  }
  for (const [fieldName, integer] of [
    ["starsByMission", true],
    ["metaResources", false],
    ["upgradeLevels", true]
  ] as const) {
    const values = objectFields(fields.get(fieldName), `Player profile ${fieldName}`);
    for (const value of values.values()) {
      if (
        typeof value !== "number"
        || !Number.isFinite(value)
        || value < 0
        || (integer && !Number.isInteger(value))
      ) {
        throw new Error(`Player profile ${fieldName} contains an invalid value.`);
      }
    }
  }
  if (typeof fields.get("selectedDifficultyId") !== "string") {
    throw new Error("Player profile selectedDifficultyId must be a string.");
  }
  return freezeProfile({
    version: PLAYER_PROFILE_SCHEMA_VERSION,
    clearedMissionIds: [...clears] as string[],
    starsByMission: copyNumberRecord(fields.get("starsByMission") as Readonly<Record<string, number>>),
    metaResources: copyNumberRecord(fields.get("metaResources") as Readonly<Record<string, number>>),
    upgradeLevels: copyNumberRecord(fields.get("upgradeLevels") as Readonly<Record<string, number>>),
    selectedDifficultyId: fields.get("selectedDifficultyId") as string
  });
}

export function serializePlayerProfile(profile: PlayerProfileV3): string {
  const captured = assertSerializableProfile(profile);
  return canonicalStringify(captured, {
    maxDepth: MAX_PROFILE_DEPTH,
    maxNodes: MAX_PROFILE_NODES,
    maxBytes: PLAYER_PROFILE_LIMITS.jsonBytes
  });
}

export function getPlayerProfileLaunchOptions(profile: PlayerProfileV3): PlayerProfileLaunchOptions {
  const captured = assertSerializableProfile(profile);
  return {
    difficultyId: captured.selectedDifficultyId,
    metaUpgradeLevels: copyNumberRecord(captured.upgradeLevels)
  };
}

function frozenFailure(code: PlayerProfileFailureCode, profile: PlayerProfileV3): PlayerProfileFailure {
  return Object.freeze({ ok: false, code, profile });
}

function ownDataValue(record: unknown, key: string): unknown {
  if (record === null || typeof record !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function ownNumberOrZero(record: unknown, key: string): number {
  const value = ownDataValue(record, key);
  return typeof value === "number" ? value : 0;
}

function copyNumberRecord(source: Readonly<Record<string, number>>): Record<string, number> {
  const copy: Record<string, number> = {};
  for (const key of Object.keys(source)) setRecordValue(copy, key, ownNumberOrZero(source, key));
  return copy;
}

function copyProfile(profile: PlayerProfileV3, changes: {
  clearedMissionIds?: string[];
  starsByMission?: Record<string, number>;
  metaResources?: Record<string, number>;
  upgradeLevels?: Record<string, number>;
  selectedDifficultyId?: string;
} = {}): PlayerProfileV3 {
  return freezeProfile({
    version: PLAYER_PROFILE_SCHEMA_VERSION,
    clearedMissionIds: changes.clearedMissionIds ?? [...profile.clearedMissionIds],
    starsByMission: changes.starsByMission ?? copyNumberRecord(profile.starsByMission),
    metaResources: changes.metaResources ?? copyNumberRecord(profile.metaResources),
    upgradeLevels: changes.upgradeLevels ?? copyNumberRecord(profile.upgradeLevels),
    selectedDifficultyId: changes.selectedDifficultyId ?? profile.selectedDifficultyId
  });
}

function metaCurrencyIds(content: GameContentRegistry): readonly string[] {
  return content.metaProgression.currencies.map((currency) => currency.id);
}

function isValidMetaResourceBag(value: unknown, currencyIds: ReadonlySet<string>): value is Readonly<Record<string, number>> {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(descriptors).length > 0) return false;
  for (const currencyId of Object.keys(descriptors)) {
    const descriptor = descriptors[currencyId];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return false;
    const amount = descriptor.value as unknown;
    if (!currencyIds.has(currencyId) || typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      return false;
    }
  }
  return true;
}

export function selectPlayerDifficulty(
  profile: PlayerProfileV3,
  content: GameContentRegistry,
  difficultyId: string
): PlayerDifficultySelectionResult {
  const captured = assertSerializableProfile(profile);
  if (!content.difficulties.some((difficulty) => difficulty.id === difficultyId)) {
    return frozenFailure("unknown_difficulty", profile);
  }
  if (captured.selectedDifficultyId === difficultyId) {
    return Object.freeze({ ok: true, code: "difficulty_unchanged", profile });
  }
  return Object.freeze({
    ok: true,
    code: "difficulty_selected",
    profile: copyProfile(captured, { selectedDifficultyId: difficultyId })
  });
}

export function purchasePlayerMetaUpgrade(
  profile: PlayerProfileV3,
  content: GameContentRegistry,
  upgradeId: string
): PlayerMetaUpgradePurchaseResult {
  const captured = assertSerializableProfile(profile);
  if (!Object.prototype.hasOwnProperty.call(content.metaProgression.upgrades, upgradeId)) {
    return frozenFailure("unknown_upgrade", profile);
  }

  const upgrade = ownDataValue(content.metaProgression.upgrades, upgradeId) as
    GameContentRegistry["metaProgression"]["upgrades"][string];
  const previousLevel = ownNumberOrZero(captured.upgradeLevels, upgradeId);
  if (previousLevel >= upgrade.maxLevel) return frozenFailure("upgrade_max_level", profile);

  const currencyIds = metaCurrencyIds(content);
  const currencyIdSet = new Set(currencyIds);
  const cost: unknown = upgrade.costs[previousLevel];
  if (!isValidMetaResourceBag(cost, currencyIdSet)) return frozenFailure("invalid_upgrade_cost", profile);

  for (const currencyId of currencyIds) {
    if (ownNumberOrZero(captured.metaResources, currencyId) < ownNumberOrZero(cost, currencyId)) {
      return frozenFailure("insufficient_meta_resources", profile);
    }
  }

  const metaResources = copyNumberRecord(captured.metaResources);
  for (const currencyId of currencyIds) {
    setRecordValue(
      metaResources,
      currencyId,
      ownNumberOrZero(captured.metaResources, currencyId) - ownNumberOrZero(cost, currencyId)
    );
  }
  const upgradeLevels = copyNumberRecord(captured.upgradeLevels);
  const newLevel = previousLevel + 1;
  setRecordValue(upgradeLevels, upgradeId, newLevel);

  return Object.freeze({
    ok: true,
    code: "upgrade_purchased",
    profile: copyProfile(captured, { metaResources, upgradeLevels }),
    upgradeId,
    previousLevel,
    newLevel
  });
}

export function isPlayerMissionUnlocked(
  profile: PlayerProfileV3,
  content: GameContentRegistry,
  missionId: string
): boolean {
  const captured = assertSerializableProfile(profile);
  if (!Object.prototype.hasOwnProperty.call(content.missions, missionId)) return false;
  const node = content.worldMap.missionNodes.find((candidate) => candidate.missionId === missionId);
  if (!node) return true;
  const clearedMissionIds = new Set(captured.clearedMissionIds);
  return node.unlockRequiresMissionIds.every((requiredId) => clearedMissionIds.has(requiredId));
}

export function newlyUnlockedPlayerMissionIds(
  profile: PlayerProfileV3,
  content: GameContentRegistry,
  clearedMissionId: string
): readonly string[] {
  const captured = assertSerializableProfile(profile);
  if (!captured.clearedMissionIds.includes(clearedMissionId)) return Object.freeze([]);
  const clearedMissionIds = new Set(captured.clearedMissionIds);
  const newlyUnlocked: string[] = [];

  for (const missionId of Object.keys(content.missions)) {
    const node = content.worldMap.missionNodes.find((candidate) => candidate.missionId === missionId);
    if (
      !node
      || clearedMissionIds.has(missionId)
      || !node.unlockRequiresMissionIds.includes(clearedMissionId)
      || !node.unlockRequiresMissionIds.every((requiredId) => clearedMissionIds.has(requiredId))
    ) {
      continue;
    }
    newlyUnlocked.push(missionId);
  }

  return Object.freeze(newlyUnlocked);
}

export function recordPlayerMissionClear(
  profile: PlayerProfileV3,
  content: GameContentRegistry,
  missionId: string,
  earnedStars: number
): PlayerMissionClearResult {
  const captured = assertSerializableProfile(profile);
  if (!Object.prototype.hasOwnProperty.call(content.missions, missionId)) {
    return frozenFailure("unknown_mission", profile);
  }

  const maximumStars = content.missions[missionId]!.objectives?.stars?.length ?? 0;
  if (!Number.isFinite(earnedStars) || !Number.isInteger(earnedStars) || earnedStars < 0 || earnedStars > maximumStars) {
    return frozenFailure("invalid_earned_stars", profile);
  }

  const reward = Object.prototype.hasOwnProperty.call(content.metaProgression.rewardsByMission, missionId)
    ? ownDataValue(content.metaProgression.rewardsByMission, missionId) as
      GameContentRegistry["metaProgression"]["rewardsByMission"][string]
    : undefined;
  const firstClearReward = reward && typeof reward === "object" ? ownDataValue(reward, "firstClear") : undefined;
  const repeatClearReward = reward && typeof reward === "object" ? ownDataValue(reward, "repeatClear") : undefined;
  const perStarReward = reward && typeof reward === "object" ? ownDataValue(reward, "perStar") : undefined;
  const currencyIds = metaCurrencyIds(content);
  const currencyIdSet = new Set(currencyIds);
  if (
    reward !== undefined
    && (
      reward === null
      || typeof reward !== "object"
      || !isValidMetaResourceBag(firstClearReward ?? {}, currencyIdSet)
      || !isValidMetaResourceBag(repeatClearReward ?? {}, currencyIdSet)
      || !isValidMetaResourceBag(perStarReward ?? {}, currencyIdSet)
    )
  ) {
    return frozenFailure("invalid_mission_reward", profile);
  }

  const firstClear = !captured.clearedMissionIds.includes(missionId);
  const previousStars = ownNumberOrZero(captured.starsByMission, missionId);
  const bestStars = Math.max(previousStars, earnedStars);
  const rewardedStarCount = Math.max(0, bestStars - previousStars);
  const baseReward = firstClear ? firstClearReward : repeatClearReward;
  const grantedResources: Record<string, number> = {};
  const metaResources = copyNumberRecord(captured.metaResources);

  for (const currencyId of currencyIds) {
    const amount = ownNumberOrZero(baseReward as Readonly<Record<string, number>>, currencyId)
      + ownNumberOrZero(perStarReward as Readonly<Record<string, number>>, currencyId) * rewardedStarCount;
    const newBalance = ownNumberOrZero(captured.metaResources, currencyId) + amount;
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(newBalance)) {
      return frozenFailure("invalid_mission_reward", profile);
    }
    if (amount > 0) setRecordValue(grantedResources, currencyId, amount);
    setRecordValue(metaResources, currencyId, newBalance);
  }

  const clearedMissionIds = [...captured.clearedMissionIds];
  if (firstClear) clearedMissionIds.push(missionId);
  const starsByMission = copyNumberRecord(captured.starsByMission);
  setRecordValue(starsByMission, missionId, bestStars);
  const nextProfile = copyProfile(captured, { clearedMissionIds, starsByMission, metaResources });
  const newlyUnlockedMissionIds = firstClear
    ? newlyUnlockedPlayerMissionIds(nextProfile, content, missionId)
    : Object.freeze([] as string[]);

  return Object.freeze({
    ok: true,
    code: "mission_clear_recorded",
    profile: nextProfile,
    missionId,
    firstClear,
    previousStars,
    earnedStars,
    grantedResources: Object.freeze(grantedResources),
    newlyUnlockedMissionIds
  });
}
