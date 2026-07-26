import type { GameContentRegistry } from "./registry.js";
import { SHIELD_LIMITS } from "./mechanics.js";
import {
  MOVEMENT_PROFILE_V1_SCHEMA,
  NAVIGATION_LIMITS,
  NavigationProfileValidationError,
  normalizeMovementProfileV1,
  type MovementProfileV1
} from "./navigation-mechanics.js";

/** Closed structural budgets for the first opt-in hero roster schema. */
export const HEROES_LIMITS = Object.freeze({
  definitions: 32,
  idUtf8Bytes: 128,
  labelUtf8Bytes: 128
});

const HERO_ABILITY_COOLDOWN_MAX = 86_400;

export interface HeroUnitDefinitionV1 {
  readonly label: string;
  readonly spawn: "core";
}

export interface HeroesProfileV1 {
  readonly selectedHeroId: string;
  readonly definitions: Readonly<Record<string, HeroUnitDefinitionV1>>;
}

export interface ActiveHeroesMechanicsV1 extends HeroesProfileV1 {
  readonly schemaVersion: 1;
  readonly profileId: string;
}

export interface HeroMovementDefinitionV2 {
  readonly movementProfileId: string;
  readonly speed: number;
}

export interface HeroUnitDefinitionV2 {
  readonly label: string;
  readonly spawn: "core";
  readonly movement: HeroMovementDefinitionV2;
}

export interface HeroesProfileV2 {
  readonly selectedHeroId: string;
  readonly definitions: Readonly<Record<string, HeroUnitDefinitionV2>>;
  readonly movementProfiles: Readonly<Record<string, MovementProfileV1>>;
}

export interface ActiveHeroesMechanicsV2 extends HeroesProfileV2 {
  readonly schemaVersion: 2;
  readonly profileId: string;
}

export interface HeroShieldDefinitionV3 {
  readonly capacity: number;
}

export interface HeroDurabilityDefinitionV3 {
  readonly maxHp: number;
  readonly shield: HeroShieldDefinitionV3 | null;
}

export interface HeroUnitDefinitionV3 extends HeroUnitDefinitionV2 {
  readonly durability: HeroDurabilityDefinitionV3;
}

export interface HeroesProfileV3 {
  readonly selectedHeroId: string;
  readonly definitions: Readonly<Record<string, HeroUnitDefinitionV3>>;
  readonly movementProfiles: Readonly<Record<string, MovementProfileV1>>;
}

export interface ActiveHeroesMechanicsV3 extends HeroesProfileV3 {
  readonly schemaVersion: 3;
  readonly profileId: string;
}

export interface HeroManaDefinitionV4 {
  readonly max: number;
  readonly starting: number;
  readonly regenerationPerUnit: number;
}

export interface HeroActiveAbilityDefinitionV4 {
  readonly id: string;
  readonly label: string;
  readonly target: "enemy";
  readonly manaCost: number;
  readonly cooldown: number;
  readonly range: number;
  readonly damage: number;
}

export interface HeroUnitDefinitionV4 extends HeroUnitDefinitionV3 {
  readonly mana: HeroManaDefinitionV4;
  readonly activeAbility: HeroActiveAbilityDefinitionV4;
}

export interface HeroesProfileV4 {
  readonly selectedHeroId: string;
  readonly definitions: Readonly<Record<string, HeroUnitDefinitionV4>>;
  readonly movementProfiles: Readonly<Record<string, MovementProfileV1>>;
}

export interface ActiveHeroesMechanicsV4 extends HeroesProfileV4 {
  readonly schemaVersion: 4;
  readonly profileId: string;
}

export type ActiveHeroesMechanics =
  | ActiveHeroesMechanicsV1
  | ActiveHeroesMechanicsV2
  | ActiveHeroesMechanicsV3
  | ActiveHeroesMechanicsV4;

const PROFILE_SCHEMA = Object.freeze({
  requiredFields: Object.freeze(["selectedHeroId", "definitions"] as const),
  optionalFields: Object.freeze([] as const),
  additionalProperties: false
});

const DEFINITION_SCHEMA = Object.freeze({
  requiredFields: Object.freeze(["label", "spawn"] as const),
  optionalFields: Object.freeze([] as const),
  additionalProperties: false,
  spawnValues: Object.freeze(["core"] as const)
});

const PROFILE_SCHEMA_V2 = Object.freeze({
  requiredFields: Object.freeze(["selectedHeroId", "definitions", "movementProfiles"] as const),
  optionalFields: Object.freeze([] as const),
  additionalProperties: false
});

const DEFINITION_SCHEMA_V2 = Object.freeze({
  requiredFields: Object.freeze(["label", "spawn", "movement"] as const),
  optionalFields: Object.freeze([] as const),
  additionalProperties: false,
  spawnValues: Object.freeze(["core"] as const)
});

const MOVEMENT_SCHEMA_V2 = Object.freeze({
  requiredFields: Object.freeze(["movementProfileId", "speed"] as const),
  optionalFields: Object.freeze([] as const),
  additionalProperties: false,
  speed: Object.freeze({ exclusiveMinimum: 0, maximum: 20 })
});

const DEFINITION_SCHEMA_V3 = Object.freeze({
  requiredFields: Object.freeze(["label", "spawn", "movement", "durability"] as const),
  optionalFields: Object.freeze([] as const),
  additionalProperties: false,
  spawnValues: Object.freeze(["core"] as const)
});

const DURABILITY_SCHEMA_V3 = Object.freeze({
  requiredFields: Object.freeze(["maxHp", "shield"] as const),
  optionalFields: Object.freeze([] as const),
  additionalProperties: false,
  maxHp: Object.freeze({ exclusiveMinimum: 0, maximum: SHIELD_LIMITS.capacity })
});

const SHIELD_SCHEMA_V3 = Object.freeze({
  nullable: true,
  requiredFields: Object.freeze(["capacity"] as const),
  optionalFields: Object.freeze([] as const),
  additionalProperties: false,
  capacity: Object.freeze({ exclusiveMinimum: 0, maximum: SHIELD_LIMITS.capacity })
});

const DEFINITION_SCHEMA_V4 = Object.freeze({
  requiredFields: Object.freeze(["label", "spawn", "movement", "durability", "mana", "activeAbility"] as const),
  optionalFields: Object.freeze([] as const),
  additionalProperties: false,
  spawnValues: Object.freeze(["core"] as const)
});

const MANA_SCHEMA_V4 = Object.freeze({
  requiredFields: Object.freeze(["max", "starting", "regenerationPerUnit"] as const),
  optionalFields: Object.freeze([] as const),
  additionalProperties: false,
  max: Object.freeze({ exclusiveMinimum: 0, maximum: SHIELD_LIMITS.capacity }),
  starting: Object.freeze({ minimum: 0, maximumFrom: "mana.max" }),
  regenerationPerUnit: Object.freeze({ minimum: 0, maximum: SHIELD_LIMITS.capacity })
});

const ACTIVE_ABILITY_SCHEMA_V4 = Object.freeze({
  requiredFields: Object.freeze(["id", "label", "target", "manaCost", "cooldown", "range", "damage"] as const),
  optionalFields: Object.freeze([] as const),
  additionalProperties: false,
  targetValues: Object.freeze(["enemy"] as const),
  manaCost: Object.freeze({ exclusiveMinimum: 0, maximumFrom: "mana.max" }),
  cooldown: Object.freeze({ minimum: 0, maximum: HERO_ABILITY_COOLDOWN_MAX }),
  range: Object.freeze({ integer: true, minimum: 0, maximum: NAVIGATION_LIMITS.activeMapCells }),
  damage: Object.freeze({ exclusiveMinimum: 0, maximum: SHIELD_LIMITS.capacity })
});

/** Capability-aware authoring descriptor shared by Studio and MCP. */
export const HEROES_MECHANICS_SCHEMA = Object.freeze({
  schemaVersion: 4,
  moduleId: "heroes" as const,
  supportedModuleSchemaVersions: Object.freeze([1, 2, 3, 4] as const),
  profile: PROFILE_SCHEMA,
  definition: DEFINITION_SCHEMA,
  versions: Object.freeze({
    1: Object.freeze({ profile: PROFILE_SCHEMA, definition: DEFINITION_SCHEMA }),
    2: Object.freeze({
      profile: PROFILE_SCHEMA_V2,
      definition: DEFINITION_SCHEMA_V2,
      movement: MOVEMENT_SCHEMA_V2,
      movementProfile: MOVEMENT_PROFILE_V1_SCHEMA
    }),
    3: Object.freeze({
      profile: PROFILE_SCHEMA_V2,
      definition: DEFINITION_SCHEMA_V3,
      movement: MOVEMENT_SCHEMA_V2,
      movementProfile: MOVEMENT_PROFILE_V1_SCHEMA,
      durability: DURABILITY_SCHEMA_V3,
      shield: SHIELD_SCHEMA_V3
    }),
    4: Object.freeze({
      profile: PROFILE_SCHEMA_V2,
      definition: DEFINITION_SCHEMA_V4,
      movement: MOVEMENT_SCHEMA_V2,
      movementProfile: MOVEMENT_PROFILE_V1_SCHEMA,
      durability: DURABILITY_SCHEMA_V3,
      shield: SHIELD_SCHEMA_V3,
      mana: MANA_SCHEMA_V4,
      activeAbility: ACTIVE_ABILITY_SCHEMA_V4
    })
  }),
  limits: HEROES_LIMITS,
  runtimeSnapshot: Object.freeze({
    path: "snapshot.heroes",
    schemaVersions: Object.freeze([1, 2, 3, 4] as const),
    optionalUnlessActive: true,
    versions: Object.freeze({
      1: Object.freeze({ unitFields: Object.freeze(["id", "definitionId", "label", "coord"] as const) }),
      2: Object.freeze({
        unitFields: Object.freeze(["id", "definitionId", "label", "coord", "movement"] as const),
        movementFields: Object.freeze(["targetCoord", "nextCoord", "edgeProgress"] as const)
      }),
      3: Object.freeze({
        unitFields: Object.freeze(["id", "definitionId", "label", "coord", "movement", "durability"] as const),
        movementFields: Object.freeze(["targetCoord", "nextCoord", "edgeProgress"] as const),
        durabilityFields: Object.freeze(["hp", "maxHp", "shield", "defeated"] as const)
      }),
      4: Object.freeze({
        unitFields: Object.freeze([
          "id", "definitionId", "label", "coord", "movement", "durability", "mana", "activeAbility"
        ] as const),
        movementFields: Object.freeze(["targetCoord", "nextCoord", "edgeProgress"] as const),
        durabilityFields: Object.freeze(["hp", "maxHp", "shield", "defeated"] as const),
        manaFields: Object.freeze(["current", "max", "regenerationPerUnit"] as const),
        activeAbilityFields: Object.freeze([
          "id", "label", "target", "manaCost", "cooldown", "cooldownRemaining", "range", "damage", "ready"
        ] as const)
      })
    })
  })
});

export class HeroesProfileValidationError extends Error {
  readonly fieldPath: string;

  constructor(fieldPath: string, message: string) {
    super(message);
    this.name = "HeroesProfileValidationError";
    this.fieldPath = fieldPath;
  }
}

type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function dataRecord(value: unknown, fieldPath: string, label: string): Record<string, unknown> {
  let prototype: object | null;
  let descriptors: DescriptorMap;
  let array = false;
  try {
    array = value !== null && typeof value === "object" && Array.isArray(value);
    if (value !== null && typeof value === "object" && !array) {
      prototype = Object.getPrototypeOf(value);
      descriptors = Object.getOwnPropertyDescriptors(value) as DescriptorMap;
      // Re-check inside the guard so a Proxy that revokes itself while exposing descriptors
      // is rejected as an unsafe inspection rather than accepted or leaked as a raw TypeError.
      array = Array.isArray(value);
    } else {
      prototype = null;
      descriptors = {};
    }
  } catch {
    throw new HeroesProfileValidationError(fieldPath, `${label} could not be inspected safely.`);
  }
  if (value === null || typeof value !== "object" || array || prototype !== Object.prototype) {
    throw new HeroesProfileValidationError(fieldPath, `${label} must be a plain own-data object.`);
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw new HeroesProfileValidationError(fieldPath, `${label} must not contain symbol fields.`);
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new HeroesProfileValidationError(`${fieldPath}.${key}`, `${label} fields must be enumerable own data.`);
    }
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}

function exactFields(
  value: Record<string, unknown>,
  required: readonly string[],
  fieldPath: string,
  label: string
): void {
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new HeroesProfileValidationError(`${fieldPath}.${field}`, `${label} is missing required own field "${field}".`);
    }
  }
  const allowed = new Set(required);
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown !== undefined) {
    throw new HeroesProfileValidationError(`${fieldPath}.${unknown}`, `${label} contains unknown field "${unknown}".`);
  }
}

function boundedText(value: unknown, maximum: number, fieldPath: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()
    || utf8ByteLength(value) > maximum) {
    throw new HeroesProfileValidationError(
      fieldPath,
      `${label} must contain 1..${maximum} UTF-8 bytes without surrounding whitespace.`
    );
  }
  return value;
}

/** Normalize the closed structural shape. The selected-definition reference is semantic. */
export function normalizeHeroesProfileV1(input: unknown, root = "profile"): HeroesProfileV1 {
  const profile = dataRecord(input, root, "Heroes profile");
  exactFields(profile, HEROES_MECHANICS_SCHEMA.profile.requiredFields, root, "Heroes profile");
  const selectedHeroId = boundedText(
    profile.selectedHeroId,
    HEROES_LIMITS.idUtf8Bytes,
    `${root}.selectedHeroId`,
    "Selected hero id"
  );
  const rawDefinitions = dataRecord(profile.definitions, `${root}.definitions`, "Heroes definitions");
  const definitionIds = Object.keys(rawDefinitions).sort(compareBinary);
  if (definitionIds.length < 1 || definitionIds.length > HEROES_LIMITS.definitions) {
    throw new HeroesProfileValidationError(
      `${root}.definitions`,
      `Heroes definitions must contain 1..${HEROES_LIMITS.definitions} entries.`
    );
  }

  const definitions: Record<string, HeroUnitDefinitionV1> = {};
  for (const heroId of definitionIds) {
    boundedText(heroId, HEROES_LIMITS.idUtf8Bytes, `${root}.definitions.${heroId}`, "Hero id");
    const rawDefinition = dataRecord(
      rawDefinitions[heroId],
      `${root}.definitions.${heroId}`,
      `Hero definition "${heroId}"`
    );
    exactFields(
      rawDefinition,
      HEROES_MECHANICS_SCHEMA.definition.requiredFields,
      `${root}.definitions.${heroId}`,
      `Hero definition "${heroId}"`
    );
    const label = boundedText(
      rawDefinition.label,
      HEROES_LIMITS.labelUtf8Bytes,
      `${root}.definitions.${heroId}.label`,
      "Hero label"
    );
    if (rawDefinition.spawn !== "core") {
      throw new HeroesProfileValidationError(
        `${root}.definitions.${heroId}.spawn`,
        "Hero spawn must be the supported value \"core\"."
      );
    }
    Object.defineProperty(definitions, heroId, {
      value: Object.freeze({ label, spawn: "core" as const }),
      enumerable: true
    });
  }
  return Object.freeze({ selectedHeroId, definitions: Object.freeze(definitions) });
}

/** Normalize the closed R5.1B movement-enabled profile without activating navigation. */
export function normalizeHeroesProfileV2(input: unknown, root = "profile"): HeroesProfileV2 {
  const profile = dataRecord(input, root, "Heroes profile");
  exactFields(profile, PROFILE_SCHEMA_V2.requiredFields, root, "Heroes profile");
  const selectedHeroId = boundedText(
    profile.selectedHeroId,
    HEROES_LIMITS.idUtf8Bytes,
    `${root}.selectedHeroId`,
    "Selected hero id"
  );
  const rawMovementProfiles = dataRecord(
    profile.movementProfiles,
    `${root}.movementProfiles`,
    "Heroes movement profiles"
  );
  const movementProfileIds = Object.keys(rawMovementProfiles).sort(compareBinary);
  if (movementProfileIds.length < 1 || movementProfileIds.length > NAVIGATION_LIMITS.movementProfiles) {
    throw new HeroesProfileValidationError(
      `${root}.movementProfiles`,
      `Heroes movement profiles must contain 1..${NAVIGATION_LIMITS.movementProfiles} entries.`
    );
  }
  const movementProfiles: Record<string, MovementProfileV1> = {};
  for (const movementProfileId of movementProfileIds) {
    boundedText(
      movementProfileId,
      HEROES_LIMITS.idUtf8Bytes,
      `${root}.movementProfiles.${movementProfileId}`,
      "Movement profile id"
    );
    let normalized: MovementProfileV1;
    try {
      normalized = normalizeMovementProfileV1(
        rawMovementProfiles[movementProfileId],
        `${root}.movementProfiles.${movementProfileId}`
      );
    } catch (error) {
      if (error instanceof NavigationProfileValidationError) {
        throw new HeroesProfileValidationError(error.fieldPath, error.message);
      }
      throw error;
    }
    Object.defineProperty(movementProfiles, movementProfileId, {
      value: normalized,
      enumerable: true
    });
  }

  const rawDefinitions = dataRecord(profile.definitions, `${root}.definitions`, "Heroes definitions");
  const definitionIds = Object.keys(rawDefinitions).sort(compareBinary);
  if (definitionIds.length < 1 || definitionIds.length > HEROES_LIMITS.definitions) {
    throw new HeroesProfileValidationError(
      `${root}.definitions`,
      `Heroes definitions must contain 1..${HEROES_LIMITS.definitions} entries.`
    );
  }
  const definitions: Record<string, HeroUnitDefinitionV2> = {};
  for (const heroId of definitionIds) {
    boundedText(heroId, HEROES_LIMITS.idUtf8Bytes, `${root}.definitions.${heroId}`, "Hero id");
    const definitionRoot = `${root}.definitions.${heroId}`;
    const rawDefinition = dataRecord(rawDefinitions[heroId], definitionRoot, `Hero definition "${heroId}"`);
    exactFields(rawDefinition, DEFINITION_SCHEMA_V2.requiredFields, definitionRoot, `Hero definition "${heroId}"`);
    const label = boundedText(
      rawDefinition.label,
      HEROES_LIMITS.labelUtf8Bytes,
      `${definitionRoot}.label`,
      "Hero label"
    );
    if (rawDefinition.spawn !== "core") {
      throw new HeroesProfileValidationError(`${definitionRoot}.spawn`, "Hero spawn must be the supported value \"core\".");
    }
    const movementRoot = `${definitionRoot}.movement`;
    const movement = dataRecord(rawDefinition.movement, movementRoot, `Hero movement "${heroId}"`);
    exactFields(movement, MOVEMENT_SCHEMA_V2.requiredFields, movementRoot, `Hero movement "${heroId}"`);
    const movementProfileId = boundedText(
      movement.movementProfileId,
      HEROES_LIMITS.idUtf8Bytes,
      `${movementRoot}.movementProfileId`,
      "Hero movement profile id"
    );
    const speed = movement.speed;
    if (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0 || speed > 20) {
      throw new HeroesProfileValidationError(
        `${movementRoot}.speed`,
        "Hero movement speed must be finite and inside (0, 20]."
      );
    }
    Object.defineProperty(definitions, heroId, {
      value: Object.freeze({
        label,
        spawn: "core" as const,
        movement: Object.freeze({ movementProfileId, speed })
      }),
      enumerable: true
    });
  }
  return Object.freeze({
    selectedHeroId,
    definitions: Object.freeze(definitions),
    movementProfiles: Object.freeze(movementProfiles)
  });
}

/** Normalize the closed R5.2A durability profile while retaining the v2 movement contract. */
export function normalizeHeroesProfileV3(input: unknown, root = "profile"): HeroesProfileV3 {
  const profile = dataRecord(input, root, "Heroes profile");
  exactFields(profile, PROFILE_SCHEMA_V2.requiredFields, root, "Heroes profile");
  const selectedHeroId = boundedText(
    profile.selectedHeroId,
    HEROES_LIMITS.idUtf8Bytes,
    `${root}.selectedHeroId`,
    "Selected hero id"
  );
  const rawMovementProfiles = dataRecord(
    profile.movementProfiles,
    `${root}.movementProfiles`,
    "Heroes movement profiles"
  );
  const movementProfileIds = Object.keys(rawMovementProfiles).sort(compareBinary);
  if (movementProfileIds.length < 1 || movementProfileIds.length > NAVIGATION_LIMITS.movementProfiles) {
    throw new HeroesProfileValidationError(
      `${root}.movementProfiles`,
      `Heroes movement profiles must contain 1..${NAVIGATION_LIMITS.movementProfiles} entries.`
    );
  }
  const movementProfiles: Record<string, MovementProfileV1> = {};
  for (const movementProfileId of movementProfileIds) {
    boundedText(
      movementProfileId,
      HEROES_LIMITS.idUtf8Bytes,
      `${root}.movementProfiles.${movementProfileId}`,
      "Movement profile id"
    );
    let normalized: MovementProfileV1;
    try {
      normalized = normalizeMovementProfileV1(
        rawMovementProfiles[movementProfileId],
        `${root}.movementProfiles.${movementProfileId}`
      );
    } catch (error) {
      if (error instanceof NavigationProfileValidationError) {
        throw new HeroesProfileValidationError(error.fieldPath, error.message);
      }
      throw error;
    }
    Object.defineProperty(movementProfiles, movementProfileId, { value: normalized, enumerable: true });
  }

  const rawDefinitions = dataRecord(profile.definitions, `${root}.definitions`, "Heroes definitions");
  const definitionIds = Object.keys(rawDefinitions).sort(compareBinary);
  if (definitionIds.length < 1 || definitionIds.length > HEROES_LIMITS.definitions) {
    throw new HeroesProfileValidationError(
      `${root}.definitions`,
      `Heroes definitions must contain 1..${HEROES_LIMITS.definitions} entries.`
    );
  }
  const definitions: Record<string, HeroUnitDefinitionV3> = {};
  for (const heroId of definitionIds) {
    boundedText(heroId, HEROES_LIMITS.idUtf8Bytes, `${root}.definitions.${heroId}`, "Hero id");
    const definitionRoot = `${root}.definitions.${heroId}`;
    const rawDefinition = dataRecord(rawDefinitions[heroId], definitionRoot, `Hero definition "${heroId}"`);
    exactFields(rawDefinition, DEFINITION_SCHEMA_V3.requiredFields, definitionRoot, `Hero definition "${heroId}"`);
    const label = boundedText(
      rawDefinition.label,
      HEROES_LIMITS.labelUtf8Bytes,
      `${definitionRoot}.label`,
      "Hero label"
    );
    if (rawDefinition.spawn !== "core") {
      throw new HeroesProfileValidationError(`${definitionRoot}.spawn`, "Hero spawn must be the supported value \"core\".");
    }
    const movementRoot = `${definitionRoot}.movement`;
    const movement = dataRecord(rawDefinition.movement, movementRoot, `Hero movement "${heroId}"`);
    exactFields(movement, MOVEMENT_SCHEMA_V2.requiredFields, movementRoot, `Hero movement "${heroId}"`);
    const movementProfileId = boundedText(
      movement.movementProfileId,
      HEROES_LIMITS.idUtf8Bytes,
      `${movementRoot}.movementProfileId`,
      "Hero movement profile id"
    );
    const speed = movement.speed;
    if (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0 || speed > 20) {
      throw new HeroesProfileValidationError(
        `${movementRoot}.speed`,
        "Hero movement speed must be finite and inside (0, 20]."
      );
    }
    const durabilityRoot = `${definitionRoot}.durability`;
    const durability = dataRecord(rawDefinition.durability, durabilityRoot, `Hero durability "${heroId}"`);
    exactFields(durability, DURABILITY_SCHEMA_V3.requiredFields, durabilityRoot, `Hero durability "${heroId}"`);
    const maxHp = durability.maxHp;
    if (typeof maxHp !== "number" || !Number.isFinite(maxHp) || maxHp <= 0 || maxHp > SHIELD_LIMITS.capacity) {
      throw new HeroesProfileValidationError(
        `${durabilityRoot}.maxHp`,
        `Hero durability maxHp must be finite and inside (0, ${SHIELD_LIMITS.capacity}].`
      );
    }
    let shield: HeroShieldDefinitionV3 | null = null;
    if (durability.shield !== null) {
      const shieldRoot = `${durabilityRoot}.shield`;
      const rawShield = dataRecord(durability.shield, shieldRoot, `Hero shield "${heroId}"`);
      exactFields(rawShield, SHIELD_SCHEMA_V3.requiredFields, shieldRoot, `Hero shield "${heroId}"`);
      const capacity = rawShield.capacity;
      if (typeof capacity !== "number" || !Number.isFinite(capacity) || capacity <= 0 || capacity > SHIELD_LIMITS.capacity) {
        throw new HeroesProfileValidationError(
          `${shieldRoot}.capacity`,
          `Hero shield capacity must be finite and inside (0, ${SHIELD_LIMITS.capacity}].`
        );
      }
      shield = Object.freeze({ capacity });
    }
    Object.defineProperty(definitions, heroId, {
      value: Object.freeze({
        label,
        spawn: "core" as const,
        movement: Object.freeze({ movementProfileId, speed }),
        durability: Object.freeze({ maxHp, shield })
      }),
      enumerable: true
    });
  }
  return Object.freeze({
    selectedHeroId,
    definitions: Object.freeze(definitions),
    movementProfiles: Object.freeze(movementProfiles)
  });
}

/** Normalize the closed R5.3A single targeted active-ability profile. */
export function normalizeHeroesProfileV4(input: unknown, root = "profile"): HeroesProfileV4 {
  const profile = dataRecord(input, root, "Heroes profile");
  exactFields(profile, PROFILE_SCHEMA_V2.requiredFields, root, "Heroes profile");
  const rawDefinitions = dataRecord(profile.definitions, `${root}.definitions`, "Heroes definitions");
  const legacyDefinitions: Record<string, unknown> = {};
  for (const heroId of Object.keys(rawDefinitions).sort(compareBinary)) {
    const definitionRoot = `${root}.definitions.${heroId}`;
    const rawDefinition = dataRecord(rawDefinitions[heroId], definitionRoot, `Hero definition "${heroId}"`);
    exactFields(rawDefinition, DEFINITION_SCHEMA_V4.requiredFields, definitionRoot, `Hero definition "${heroId}"`);
    Object.defineProperty(legacyDefinitions, heroId, {
      value: {
        label: rawDefinition.label,
        spawn: rawDefinition.spawn,
        movement: rawDefinition.movement,
        durability: rawDefinition.durability
      },
      enumerable: true
    });
  }
  const durable = normalizeHeroesProfileV3({
    selectedHeroId: profile.selectedHeroId,
    definitions: legacyDefinitions,
    movementProfiles: profile.movementProfiles
  }, root);
  const definitions: Record<string, HeroUnitDefinitionV4> = {};
  for (const heroId of Object.keys(durable.definitions).sort(compareBinary)) {
    const definitionRoot = `${root}.definitions.${heroId}`;
    const rawDefinition = dataRecord(rawDefinitions[heroId], definitionRoot, `Hero definition "${heroId}"`);
    const manaRoot = `${definitionRoot}.mana`;
    const rawMana = dataRecord(rawDefinition.mana, manaRoot, `Hero mana "${heroId}"`);
    exactFields(rawMana, MANA_SCHEMA_V4.requiredFields, manaRoot, `Hero mana "${heroId}"`);
    const max = rawMana.max;
    const starting = rawMana.starting;
    const regenerationPerUnit = rawMana.regenerationPerUnit;
    if (typeof max !== "number" || !Number.isFinite(max) || max <= 0 || max > SHIELD_LIMITS.capacity) {
      throw new HeroesProfileValidationError(manaRoot + ".max", "Hero mana max must be finite and positive within the maximum range.");
    }
    if (typeof starting !== "number" || !Number.isFinite(starting) || starting < 0 || starting > max) {
      throw new HeroesProfileValidationError(manaRoot + ".starting", "Hero starting mana must be finite inside the authored mana range.");
    }
    if (typeof regenerationPerUnit !== "number" || !Number.isFinite(regenerationPerUnit)
      || regenerationPerUnit < 0 || regenerationPerUnit > SHIELD_LIMITS.capacity) {
      throw new HeroesProfileValidationError(
        manaRoot + ".regenerationPerUnit",
        "Hero mana regeneration must be finite inside the supported range."
      );
    }
    const abilityRoot = `${definitionRoot}.activeAbility`;
    const rawAbility = dataRecord(rawDefinition.activeAbility, abilityRoot, `Hero active ability "${heroId}"`);
    exactFields(rawAbility, ACTIVE_ABILITY_SCHEMA_V4.requiredFields, abilityRoot, `Hero active ability "${heroId}"`);
    const id = boundedText(rawAbility.id, HEROES_LIMITS.idUtf8Bytes, abilityRoot + ".id", "Hero ability id");
    const label = boundedText(rawAbility.label, HEROES_LIMITS.labelUtf8Bytes, abilityRoot + ".label", "Hero ability label");
    if (rawAbility.target !== "enemy") {
      throw new HeroesProfileValidationError(abilityRoot + ".target", "Hero active ability target field must be enemy.");
    }
    const manaCost = rawAbility.manaCost;
    if (typeof manaCost !== "number" || !Number.isFinite(manaCost) || manaCost <= 0 || manaCost > max) {
      throw new HeroesProfileValidationError(abilityRoot + ".manaCost", "Hero ability mana cost must be finite and positive inside the mana range.");
    }
    const cooldown = rawAbility.cooldown;
    if (typeof cooldown !== "number" || !Number.isFinite(cooldown)
      || cooldown < 0 || cooldown > HERO_ABILITY_COOLDOWN_MAX) {
      throw new HeroesProfileValidationError(abilityRoot + ".cooldown", "Hero ability cooldown must be finite inside the supported range.");
    }
    const range = rawAbility.range;
    if (typeof range !== "number" || !Number.isSafeInteger(range)
      || range < 0 || range > NAVIGATION_LIMITS.activeMapCells) {
      throw new HeroesProfileValidationError(abilityRoot + ".range", "Hero ability range must be an integer inside the supported range.");
    }
    const damage = rawAbility.damage;
    if (typeof damage !== "number" || !Number.isFinite(damage) || damage <= 0 || damage > SHIELD_LIMITS.capacity) {
      throw new HeroesProfileValidationError(abilityRoot + ".damage", "Hero ability damage must be finite and positive within the maximum range.");
    }
    Object.defineProperty(definitions, heroId, {
      value: Object.freeze({
        ...durable.definitions[heroId]!,
        mana: Object.freeze({ max, starting, regenerationPerUnit }),
        activeAbility: Object.freeze({ id, label, target: "enemy" as const, manaCost, cooldown, range, damage })
      }),
      enumerable: true
    });
  }
  return Object.freeze({
    selectedHeroId: durable.selectedHeroId,
    definitions: Object.freeze(definitions),
    movementProfiles: durable.movementProfiles
  });
}

function ownData(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** Resolve a detached profile only when the mission genuinely selected a supported heroes version. */
export function resolveActiveHeroesMechanics(
  content: GameContentRegistry,
  missionId: string
): ActiveHeroesMechanics | undefined {
  const capability = content.missions[missionId]?.capabilities.heroes;
  if (!capability?.active || capability.profileId === undefined) return undefined;
  const module = ownData(ownData(content.mechanics, "modules"), "heroes");
  const schemaVersion = ownData(module, "schemaVersion");
  if ((schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== 4)
    || ownData(module, "enabled") !== true) {
    return undefined;
  }
  const profile = ownData(ownData(module, "profiles"), capability.profileId);
  let normalized: HeroesProfileV1 | HeroesProfileV2 | HeroesProfileV3 | HeroesProfileV4;
  try {
    normalized = schemaVersion === 1
      ? normalizeHeroesProfileV1(profile, `modules.heroes.profiles.${capability.profileId}`)
      : schemaVersion === 2
        ? normalizeHeroesProfileV2(profile, `modules.heroes.profiles.${capability.profileId}`)
        : schemaVersion === 3
          ? normalizeHeroesProfileV3(profile, `modules.heroes.profiles.${capability.profileId}`)
          : normalizeHeroesProfileV4(profile, `modules.heroes.profiles.${capability.profileId}`);
  } catch {
    return undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(normalized.definitions, normalized.selectedHeroId)) return undefined;
  if (schemaVersion === 2 || schemaVersion === 3 || schemaVersion === 4) {
    const moving = normalized as HeroesProfileV2 | HeroesProfileV3 | HeroesProfileV4;
    const definition = moving.definitions[moving.selectedHeroId];
    if (!definition || !Object.prototype.hasOwnProperty.call(moving.movementProfiles, definition.movement.movementProfileId)) {
      return undefined;
    }
    return schemaVersion === 2
      ? Object.freeze({
          schemaVersion: 2 as const,
          profileId: capability.profileId,
          selectedHeroId: moving.selectedHeroId,
          definitions: (moving as HeroesProfileV2).definitions,
          movementProfiles: moving.movementProfiles
        })
      : schemaVersion === 3
        ? Object.freeze({
          schemaVersion: 3 as const,
          profileId: capability.profileId,
          selectedHeroId: moving.selectedHeroId,
          definitions: (moving as HeroesProfileV3).definitions,
          movementProfiles: moving.movementProfiles
        })
        : Object.freeze({
          schemaVersion: 4 as const,
          profileId: capability.profileId,
          selectedHeroId: moving.selectedHeroId,
          definitions: (moving as HeroesProfileV4).definitions,
          movementProfiles: moving.movementProfiles
        });
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    profileId: capability.profileId,
    selectedHeroId: normalized.selectedHeroId,
    definitions: normalized.definitions
  });
}

function compareBinary(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
