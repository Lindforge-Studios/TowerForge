import type { GameContentRegistry } from "./registry.js";
import { resolveCapabilitySet } from "./mechanics.js";

export const MULTIPLAYER_LIMITS = Object.freeze({
  players: 64,
  idUtf8Bytes: 128,
  minimumFixedTickUnits: 0.000_001,
  maximumFixedTickUnits: 1_000_000,
  journalEntries: 100_000,
  sendDefinitions: 1_024,
  resourcesPerSend: 64,
  maximumResourceAmount: 1_000_000_000_000
});

export type MultiplayerModeV1 = "local_coop";
export type MultiplayerTowerControlV1 = "owner_only" | "shared";

export interface MultiplayerOwnershipV1 {
  readonly towerControl: MultiplayerTowerControlV1;
  readonly resources: "shared" | "partitioned";
  readonly routes: "shared" | "partitioned";
}

export interface MultiplayerProfileV1 {
  readonly mode: MultiplayerModeV1;
  readonly fixedTickUnits: number;
  readonly maxPlayers: number;
  readonly ownership: MultiplayerOwnershipV1;
}

export interface ActiveMultiplayerMechanicsV1 extends MultiplayerProfileV1 {
  readonly schemaVersion: 1;
  readonly profileId: string;
}

export interface MultiplayerSendDefinitionV2 {
  readonly enemyTypeId: string;
  readonly cost: Readonly<Record<string, number>>;
  readonly income: Readonly<Record<string, number>>;
  readonly spawnDelayUnits: number;
  readonly routeId?: string;
}

export interface MultiplayerProfileV2 {
  readonly mode: "asymmetric_send_vs_build";
  readonly fixedTickUnits: number;
  readonly maxPlayers: 2;
  readonly ownership: {
    readonly towerControl: MultiplayerTowerControlV1;
    readonly resources: "partitioned";
    readonly routes: "partitioned";
  };
  readonly sendPool: Readonly<Record<string, MultiplayerSendDefinitionV2>>;
}

export type ActiveMultiplayerMechanicsV2 = Readonly<{
  readonly schemaVersion: 2;
  readonly profileId: string;
} & (MultiplayerProfileV1 | MultiplayerProfileV2)>;

export type ActiveMultiplayerMechanics = ActiveMultiplayerMechanicsV1 | ActiveMultiplayerMechanicsV2;

export const MULTIPLAYER_MECHANICS_SCHEMA = Object.freeze({
  schemaVersion: 1,
  moduleId: "multiplayer",
  supportedModuleSchemaVersions: Object.freeze([1, 2] as const),
  profilesByModuleVersion: Object.freeze({
    1: Object.freeze({
      modes: Object.freeze(["local_coop"] as const),
      requiredFields: Object.freeze(["mode", "fixedTickUnits", "maxPlayers", "ownership"] as const)
    }),
    2: Object.freeze({
      modes: Object.freeze(["local_coop", "asymmetric_send_vs_build"] as const),
      requiredFieldsByMode: Object.freeze({
        local_coop: Object.freeze(["mode", "fixedTickUnits", "maxPlayers", "ownership"] as const),
        asymmetric_send_vs_build: Object.freeze(["mode", "fixedTickUnits", "maxPlayers", "ownership", "sendPool"] as const)
      }),
      sendDefinition: Object.freeze({
        requiredFields: Object.freeze(["enemyTypeId", "cost", "income", "spawnDelayUnits"] as const),
        optionalFields: Object.freeze(["routeId"] as const),
        additionalProperties: false
      })
    })
  }),
  profile: Object.freeze({
    requiredFields: Object.freeze(["mode", "fixedTickUnits", "maxPlayers", "ownership"] as const),
    optionalFields: Object.freeze([] as const),
    additionalProperties: false,
    modes: Object.freeze(["local_coop"] as const)
  }),
  ownership: Object.freeze({
    requiredFields: Object.freeze(["towerControl", "resources", "routes"] as const),
    optionalFields: Object.freeze([] as const),
    additionalProperties: false,
    towerControl: Object.freeze(["owner_only", "shared"] as const),
    resources: Object.freeze(["shared", "partitioned"] as const),
    routes: Object.freeze(["shared", "partitioned"] as const)
  }),
  limits: MULTIPLAYER_LIMITS
});

export class MultiplayerProfileValidationError extends Error {
  readonly fieldPath: string;
  readonly structural: boolean;

  constructor(fieldPath: string, message: string, structural = true) {
    super(message);
    this.name = "MultiplayerProfileValidationError";
    this.fieldPath = fieldPath;
    this.structural = structural;
  }
}

type OwnRecord = Record<string, unknown>;

function inspectOwnRecord(value: unknown, fieldPath: string, label: string): OwnRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MultiplayerProfileValidationError(fieldPath, `${label} must be a plain object.`);
  }
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>;
  } catch {
    throw new MultiplayerProfileValidationError(fieldPath, `${label} could not be inspected safely.`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new MultiplayerProfileValidationError(fieldPath, `${label} must be a plain object.`);
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw new MultiplayerProfileValidationError(fieldPath, `${label} must not contain symbol fields.`);
  }
  const result: OwnRecord = {};
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new MultiplayerProfileValidationError(
        `${fieldPath}.${key}`,
        `${label} fields must be enumerable own data properties.`
      );
    }
    Object.defineProperty(result, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return result;
}

function exactFields(
  record: OwnRecord,
  fields: readonly string[],
  fieldPath: string,
  label: string,
  optionalFields: readonly string[] = []
): void {
  const expected = new Set([...fields, ...optionalFields]);
  for (const key of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new MultiplayerProfileValidationError(`${fieldPath}.${key}`, `${label} field "${key}" is required.`);
    }
  }
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) {
      throw new MultiplayerProfileValidationError(
        `${fieldPath}.${key}`,
        `${label} is closed; unsupported field "${key}".`
      );
    }
  }
}

/** Descriptor-safe normalization of the complete local co-op v1 profile. */
export function normalizeMultiplayerProfileV1(value: unknown): MultiplayerProfileV1 {
  const profile = inspectOwnRecord(value, "profile", "Multiplayer profile");
  exactFields(profile, ["mode", "fixedTickUnits", "maxPlayers", "ownership"], "profile", "Multiplayer profile");

  if (profile.mode !== "local_coop") {
    throw new MultiplayerProfileValidationError(
      "profile.mode",
      "Multiplayer mode must be local_coop in schema v1.",
      false
    );
  }
  if (typeof profile.fixedTickUnits !== "number"
    || !Number.isFinite(profile.fixedTickUnits)
    || profile.fixedTickUnits < MULTIPLAYER_LIMITS.minimumFixedTickUnits
    || profile.fixedTickUnits > MULTIPLAYER_LIMITS.maximumFixedTickUnits) {
    throw new MultiplayerProfileValidationError(
      "profile.fixedTickUnits",
      `Multiplayer fixedTickUnits must be within ${MULTIPLAYER_LIMITS.minimumFixedTickUnits}..${MULTIPLAYER_LIMITS.maximumFixedTickUnits}.`,
      false
    );
  }
  if (typeof profile.maxPlayers !== "number"
    || !Number.isSafeInteger(profile.maxPlayers)
    || profile.maxPlayers < 2
    || profile.maxPlayers > MULTIPLAYER_LIMITS.players) {
    throw new MultiplayerProfileValidationError(
      "profile.maxPlayers",
      `Multiplayer maxPlayers must be an integer within 2..${MULTIPLAYER_LIMITS.players}.`,
      false
    );
  }

  const ownership = inspectOwnRecord(profile.ownership, "profile.ownership", "Multiplayer ownership");
  exactFields(
    ownership,
    ["towerControl", "resources", "routes"],
    "profile.ownership",
    "Multiplayer ownership"
  );
  if (ownership.towerControl !== "owner_only" && ownership.towerControl !== "shared") {
    throw new MultiplayerProfileValidationError(
      "profile.ownership.towerControl",
      "Multiplayer towerControl must be owner_only or shared.",
      false
    );
  }
  if (ownership.resources !== "shared" && ownership.resources !== "partitioned") {
    throw new MultiplayerProfileValidationError(
      "profile.ownership.resources",
      "Multiplayer v1 resources must be shared or partitioned.",
      false
    );
  }
  if (ownership.routes !== "shared" && ownership.routes !== "partitioned") {
    throw new MultiplayerProfileValidationError(
      "profile.ownership.routes",
      "Multiplayer v1 routes must be shared or partitioned.",
      false
    );
  }

  return Object.freeze({
    mode: "local_coop" as const,
    fixedTickUnits: Object.is(profile.fixedTickUnits, -0) ? 0 : profile.fixedTickUnits,
    maxPlayers: profile.maxPlayers,
    ownership: Object.freeze({
      towerControl: ownership.towerControl,
      resources: ownership.resources,
      routes: ownership.routes
    })
  });
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) bytes += 1;
    else if (codeUnit <= 0x7ff) bytes += 2;
    else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function boundedId(value: unknown, fieldPath: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()
    || utf8ByteLength(value) > MULTIPLAYER_LIMITS.idUtf8Bytes) {
    throw new MultiplayerProfileValidationError(fieldPath, `${label} must be a non-empty bounded id.`, false);
  }
  return value;
}

function normalizeResourceBag(value: unknown, fieldPath: string): Readonly<Record<string, number>> {
  const bag = inspectOwnRecord(value, fieldPath, "Multiplayer resource bag");
  const keys = Object.keys(bag).sort();
  if (keys.length > MULTIPLAYER_LIMITS.resourcesPerSend) {
    throw new MultiplayerProfileValidationError(fieldPath, "Multiplayer resource bag exceeds its entry limit.", false);
  }
  const normalized: Record<string, number> = {};
  for (const resourceId of keys) {
    boundedId(resourceId, `${fieldPath}.${resourceId}`, "Multiplayer resource id");
    const amount = bag[resourceId];
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0
      || amount > MULTIPLAYER_LIMITS.maximumResourceAmount) {
      throw new MultiplayerProfileValidationError(
        `${fieldPath}.${resourceId}`,
        "Multiplayer resource amount must be finite, non-negative and within budget.",
        false
      );
    }
    Object.defineProperty(normalized, resourceId, {
      value: Object.is(amount, -0) ? 0 : amount,
      enumerable: true,
      configurable: false,
      writable: false
    });
  }
  return Object.freeze(normalized);
}

/** Descriptor-safe normalization of the complete asymmetric send-vs-build v2 profile. */
export function normalizeMultiplayerProfileV2(value: unknown): MultiplayerProfileV1 | MultiplayerProfileV2 {
  const candidate = inspectOwnRecord(value, "profile", "Multiplayer profile");
  if (candidate.mode === "local_coop") return normalizeMultiplayerProfileV1(value);
  const profile = inspectOwnRecord(value, "profile", "Multiplayer profile");
  exactFields(
    profile,
    ["mode", "fixedTickUnits", "maxPlayers", "ownership", "sendPool"],
    "profile",
    "Multiplayer profile"
  );
  if (profile.mode !== "asymmetric_send_vs_build") {
    throw new MultiplayerProfileValidationError(
      "profile.mode",
      "Multiplayer mode must be asymmetric_send_vs_build in schema v2.",
      false
    );
  }
  if (typeof profile.fixedTickUnits !== "number" || !Number.isFinite(profile.fixedTickUnits)
    || profile.fixedTickUnits < MULTIPLAYER_LIMITS.minimumFixedTickUnits
    || profile.fixedTickUnits > MULTIPLAYER_LIMITS.maximumFixedTickUnits) {
    throw new MultiplayerProfileValidationError("profile.fixedTickUnits", "Multiplayer fixedTickUnits is out of bounds.", false);
  }
  if (profile.maxPlayers !== 2) {
    throw new MultiplayerProfileValidationError("profile.maxPlayers", "Asymmetric matches require exactly two players.", false);
  }
  const ownership = inspectOwnRecord(profile.ownership, "profile.ownership", "Multiplayer ownership");
  exactFields(ownership, ["towerControl", "resources", "routes"], "profile.ownership", "Multiplayer ownership");
  if (ownership.towerControl !== "owner_only" && ownership.towerControl !== "shared") {
    throw new MultiplayerProfileValidationError("profile.ownership.towerControl", "Multiplayer towerControl is invalid.", false);
  }
  if (ownership.resources !== "partitioned" || ownership.routes !== "partitioned") {
    throw new MultiplayerProfileValidationError(
      "profile.ownership",
      "Asymmetric matches require partitioned resources and routes.",
      false
    );
  }
  const sendPool = inspectOwnRecord(profile.sendPool, "profile.sendPool", "Multiplayer send pool");
  const sendIds = Object.keys(sendPool).sort();
  if (sendIds.length === 0 || sendIds.length > MULTIPLAYER_LIMITS.sendDefinitions) {
    throw new MultiplayerProfileValidationError("profile.sendPool", "Multiplayer send pool must be non-empty and within budget.", false);
  }
  const normalizedPool: Record<string, MultiplayerSendDefinitionV2> = {};
  for (const sendId of sendIds) {
    boundedId(sendId, `profile.sendPool.${sendId}`, "Multiplayer send id");
    const root = `profile.sendPool.${sendId}`;
    const send = inspectOwnRecord(sendPool[sendId], root, "Multiplayer send definition");
    exactFields(
      send,
      ["enemyTypeId", "cost", "income", "spawnDelayUnits"],
      root,
      "Multiplayer send definition",
      ["routeId"]
    );
    const enemyTypeId = boundedId(send.enemyTypeId, `${root}.enemyTypeId`, "Enemy type id");
    if (typeof send.spawnDelayUnits !== "number" || !Number.isFinite(send.spawnDelayUnits)
      || send.spawnDelayUnits < 0 || send.spawnDelayUnits > MULTIPLAYER_LIMITS.maximumFixedTickUnits) {
      throw new MultiplayerProfileValidationError(`${root}.spawnDelayUnits`, "Spawn delay is out of bounds.", false);
    }
    Object.defineProperty(normalizedPool, sendId, {
      value: Object.freeze({
        enemyTypeId,
        cost: normalizeResourceBag(send.cost, `${root}.cost`),
        income: normalizeResourceBag(send.income, `${root}.income`),
        spawnDelayUnits: Object.is(send.spawnDelayUnits, -0) ? 0 : send.spawnDelayUnits,
        ...(send.routeId === undefined ? {} : {
          routeId: boundedId(send.routeId, `${root}.routeId`, "Route id")
        })
      }),
      enumerable: true,
      configurable: false,
      writable: false
    });
  }
  return Object.freeze({
    mode: "asymmetric_send_vs_build" as const,
    fixedTickUnits: Object.is(profile.fixedTickUnits, -0) ? 0 : profile.fixedTickUnits,
    maxPlayers: 2 as const,
    ownership: Object.freeze({
      towerControl: ownership.towerControl,
      resources: "partitioned" as const,
      routes: "partitioned" as const
    }),
    sendPool: Object.freeze(normalizedPool)
  });
}

/** Resolve only a selected, enabled, supported multiplayer profile. */
export function resolveActiveMultiplayerMechanics(
  content: GameContentRegistry,
  missionId: string
): ActiveMultiplayerMechanics | undefined {
  const mission = content.missions[missionId];
  const capability = mission
    ? resolveCapabilitySet(content.mechanics, mission.mechanics).multiplayer
    : undefined;
  if (!mission || !capability?.active || capability.profileId === undefined) return undefined;
  const module = content.mechanics.modules.multiplayer;
  if (!module || module.enabled !== true || (module.schemaVersion !== 1 && module.schemaVersion !== 2)) return undefined;
  try {
    if (module.schemaVersion === 1) {
      const profile = normalizeMultiplayerProfileV1(module.profiles[capability.profileId]);
      return Object.freeze({ schemaVersion: 1 as const, profileId: capability.profileId, ...profile });
    }
    const profile = normalizeMultiplayerProfileV2(module.profiles[capability.profileId]);
    return Object.freeze({ schemaVersion: 2 as const, profileId: capability.profileId, ...profile });
  } catch {
    return undefined;
  }
}
