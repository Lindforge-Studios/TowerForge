import type { GameContentRegistry } from "./registry.js";

/** Closed structural and runtime budgets for the opt-in Logistics v1 power grid. */
export const LOGISTICS_POWER_LIMITS = Object.freeze({
  entriesPerRole: 4_096,
  entriesTotal: 4_096,
  idUtf8Bytes: 128,
  output: 1_000_000_000_000,
  demand: 1_000_000_000_000,
  radius: 64,
  priority: 1_000_000,
  liveParticipants: 4_096,
  liveNodes: 1_024,
  undirectedEdges: 65_536
});

/** Closed structural and runtime budgets for opt-in Logistics v2 local ammunition. */
export const LOGISTICS_AMMUNITION_LIMITS = Object.freeze({
  types: 256,
  towerInventories: 4_096,
  liveInventories: 4_096,
  idUtf8Bytes: 128,
  labelUtf8Bytes: 128,
  capacity: 1_000_000_000
});

/** Closed structural and runtime budgets for opt-in Logistics v3 ammunition supply. */
export const LOGISTICS_SUPPLY_LIMITS = Object.freeze({
  productionRecipes: 256,
  producers: 4_096,
  storages: 4_096,
  authoredSourcesTotal: 4_096,
  liveSources: 1_024,
  liveAmmunitionInventories: 4_096,
  directedTransferEdges: 65_536,
  idUtf8Bytes: 128,
  labelUtf8Bytes: 128,
  inventoryCapacity: 1_000_000_000,
  amount: 1_000_000_000,
  transferRadius: 64,
  minimumInterval: 0.2,
  maximumInterval: 1_000_000
});

export interface LogisticsGeneratorDefinitionV1 {
  readonly output: number;
  readonly linkRadius: number;
  readonly coverageRadius: number;
}

export interface LogisticsRelayDefinitionV1 {
  readonly linkRadius: number;
  readonly coverageRadius: number;
}

export interface LogisticsConsumerDefinitionV1 {
  readonly demand: number;
  readonly priority: number;
}

export interface LogisticsPowerDefinitionV1 {
  readonly generators: Readonly<Record<string, LogisticsGeneratorDefinitionV1>>;
  readonly relays: Readonly<Record<string, LogisticsRelayDefinitionV1>>;
  readonly consumers: Readonly<Record<string, LogisticsConsumerDefinitionV1>>;
}

export interface LogisticsProfileV1 {
  readonly power: LogisticsPowerDefinitionV1 | null;
}

export interface LogisticsAmmunitionTypeDefinitionV2 {
  readonly label: string;
}

export interface LogisticsTowerInventoryDefinitionV2 {
  readonly ammoTypeId: string;
  readonly capacity: number;
  readonly startingAmount: number;
  readonly consumptionPerActivation: number;
}

export interface LogisticsAmmunitionDefinitionV2 {
  readonly types: Readonly<Record<string, LogisticsAmmunitionTypeDefinitionV2>>;
  readonly towerInventories: Readonly<Record<string, LogisticsTowerInventoryDefinitionV2>>;
}

export interface LogisticsProfileV2 {
  readonly power: LogisticsPowerDefinitionV1 | null;
  readonly ammunition: LogisticsAmmunitionDefinitionV2 | null;
}

export interface LogisticsProductionRecipeDefinitionV3 {
  readonly label: string;
  readonly ammoTypeId: string;
  readonly outputAmount: number;
  readonly interval: number;
}

export interface LogisticsProducerDefinitionV3 {
  readonly recipeId: string;
  readonly capacity: number;
  readonly startingAmount: number;
  readonly transferRadius: number;
  readonly transferAmount: number;
  readonly transferInterval: number;
}

export interface LogisticsStorageDefinitionV3 {
  readonly ammoTypeId: string;
  readonly capacity: number;
  readonly startingAmount: number;
  readonly transferRadius: number;
  readonly transferAmount: number;
  readonly transferInterval: number;
}

export interface LogisticsSupplyDefinitionV3 {
  readonly productionRecipes: Readonly<Record<string, LogisticsProductionRecipeDefinitionV3>>;
  readonly producers: Readonly<Record<string, LogisticsProducerDefinitionV3>>;
  readonly storages: Readonly<Record<string, LogisticsStorageDefinitionV3>>;
}

export interface LogisticsProfileV3 extends LogisticsProfileV2 {
  readonly supply: LogisticsSupplyDefinitionV3 | null;
}

export interface ActiveLogisticsMechanicsV1 extends LogisticsProfileV1 {
  readonly schemaVersion: 1;
  readonly profileId: string;
}

export interface ActiveLogisticsMechanicsV2 extends LogisticsProfileV2 {
  readonly schemaVersion: 2;
  readonly profileId: string;
}

export interface ActiveLogisticsMechanicsV3 extends LogisticsProfileV3 {
  readonly schemaVersion: 3;
  readonly profileId: string;
}

export type ActiveLogisticsMechanics =
  | ActiveLogisticsMechanicsV1
  | ActiveLogisticsMechanicsV2
  | ActiveLogisticsMechanicsV3;

export const LOGISTICS_MECHANICS_SCHEMA = Object.freeze({
  schemaVersion: 3,
  moduleId: "logistics",
  supportedModuleSchemaVersions: Object.freeze([1, 2, 3] as const),
  profile: Object.freeze({
    requiredFields: Object.freeze(["power", "ammunition", "supply"] as const),
    optionalFields: Object.freeze([] as const),
    additionalProperties: false
  }),
  profileVersions: Object.freeze({
    1: Object.freeze({
      requiredFields: Object.freeze(["power"] as const),
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    2: Object.freeze({
      requiredFields: Object.freeze(["power", "ammunition"] as const),
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    3: Object.freeze({
      requiredFields: Object.freeze(["power", "ammunition", "supply"] as const),
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    })
  }),
  power: Object.freeze({
    nullable: true,
    requiredFields: Object.freeze(["generators", "relays", "consumers"] as const),
    optionalFields: Object.freeze([] as const),
    additionalProperties: false,
    generator: Object.freeze({
      requiredFields: Object.freeze(["output", "linkRadius", "coverageRadius"] as const),
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    relay: Object.freeze({
      requiredFields: Object.freeze(["linkRadius", "coverageRadius"] as const),
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    consumer: Object.freeze({
      requiredFields: Object.freeze(["demand", "priority"] as const),
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    })
  }),
  ammunition: Object.freeze({
    nullable: true,
    requiredFields: Object.freeze(["types", "towerInventories"] as const),
    optionalFields: Object.freeze([] as const),
    additionalProperties: false,
    type: Object.freeze({
      requiredFields: Object.freeze(["label"] as const),
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    towerInventory: Object.freeze({
      requiredFields: Object.freeze([
        "ammoTypeId", "capacity", "startingAmount", "consumptionPerActivation"
      ] as const),
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    fireCapableAttackKinds: Object.freeze([
      "single", "pulse", "sniper", "antiair", "splash", "pipeline"
    ] as const),
    limits: LOGISTICS_AMMUNITION_LIMITS
  }),
  supply: Object.freeze({
    nullable: true,
    requiredFields: Object.freeze(["productionRecipes", "producers", "storages"] as const),
    optionalFields: Object.freeze([] as const),
    additionalProperties: false,
    productionRecipe: Object.freeze({
      requiredFields: Object.freeze(["label", "ammoTypeId", "outputAmount", "interval"] as const),
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    producer: Object.freeze({
      requiredFields: Object.freeze([
        "recipeId", "capacity", "startingAmount", "transferRadius", "transferAmount", "transferInterval"
      ] as const),
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    storage: Object.freeze({
      requiredFields: Object.freeze([
        "ammoTypeId", "capacity", "startingAmount", "transferRadius", "transferAmount", "transferInterval"
      ] as const),
      optionalFields: Object.freeze([] as const),
      additionalProperties: false
    }),
    limits: LOGISTICS_SUPPLY_LIMITS
  }),
  limits: Object.freeze({
    power: LOGISTICS_POWER_LIMITS,
    ammunition: LOGISTICS_AMMUNITION_LIMITS,
    supply: LOGISTICS_SUPPLY_LIMITS
  }),
  runtimeSnapshot: Object.freeze({
    schemaVersion: 3,
    fields: Object.freeze(["schemaVersion", "power", "ammunition", "supply"] as const),
    powerFields: Object.freeze(["components", "nodes", "consumers"] as const),
    ammunitionFields: Object.freeze(["inventories"] as const),
    supplyFields: Object.freeze(["producers", "storages", "edges"] as const)
  }),
  checkpoint: Object.freeze({
    schemaVersion: 2,
    fields: Object.freeze(["schemaVersion", "ammunition", "supply"] as const),
    supplyFields: Object.freeze(["producers", "storages"] as const)
  })
});

export class LogisticsProfileValidationError extends Error {
  constructor(readonly fieldPath: string, message: string) {
    super(message);
    this.name = "LogisticsProfileValidationError";
  }
}

type OwnDataRecord = Record<string, unknown>;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function inspectOwnDataRecord(value: unknown, fieldPath: string, label: string): OwnDataRecord {
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    descriptors = value !== null && typeof value === "object"
      ? Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>
      : {};
  } catch {
    throw new LogisticsProfileValidationError(fieldPath, `${label} could not be inspected safely.`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || (prototype !== Object.prototype && prototype !== null)) {
    throw new LogisticsProfileValidationError(fieldPath, `${label} must be a plain object with own data fields.`);
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw new LogisticsProfileValidationError(fieldPath, `${label} must not contain symbol fields.`);
  }
  const result = Object.create(null) as OwnDataRecord;
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new LogisticsProfileValidationError(
        `${fieldPath}.${key}`,
        `${label} field "${key}" must be an enumerable own data field; accessors are not allowed.`
      );
    }
    result[key] = descriptor.value;
  }
  return result;
}

function exactFields(record: OwnDataRecord, fields: readonly string[], fieldPath: string, label: string): void {
  const allowed = new Set(fields);
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      throw new LogisticsProfileValidationError(`${fieldPath}.${field}`, `${label} is missing required field "${field}".`);
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new LogisticsProfileValidationError(`${fieldPath}.${key}`, `${label} is closed; unknown field "${key}".`);
    }
  }
}

function boundedPositive(value: unknown, maximum: number, fieldPath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new LogisticsProfileValidationError(
      fieldPath,
      `${fieldPath} must be a finite positive number with maximum ${maximum}.`
    );
  }
  return value;
}

function boundedRadius(value: unknown, fieldPath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)
    || value < 0 || value > LOGISTICS_POWER_LIMITS.radius) {
    throw new LogisticsProfileValidationError(
      fieldPath,
      `${fieldPath} must be a finite integer in 0..${LOGISTICS_POWER_LIMITS.radius}.`
    );
  }
  return value;
}

function boundedPriority(value: unknown, fieldPath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value)
    || value < 0 || value > LOGISTICS_POWER_LIMITS.priority) {
    throw new LogisticsProfileValidationError(
      fieldPath,
      `${fieldPath} priority must be a finite safe integer in 0..${LOGISTICS_POWER_LIMITS.priority}.`
    );
  }
  return value;
}

function boundedUtf8String(value: unknown, maximum: number, fieldPath: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || utf8ByteLength(value) > maximum) {
    throw new LogisticsProfileValidationError(
      fieldPath,
      `${label} must contain 1..${maximum} UTF-8 bytes.`
    );
  }
  return value;
}

function boundedSafeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fieldPath: string
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value)
    || value < minimum || value > maximum) {
    throw new LogisticsProfileValidationError(
      fieldPath,
      `${fieldPath} must be a finite safe integer in ${minimum}..${maximum}.`
    );
  }
  return value;
}

function inspectRoleRecord(
  value: unknown,
  fieldPath: string,
  role: "generator" | "relay" | "consumer"
): OwnDataRecord {
  const record = inspectOwnDataRecord(value, fieldPath, `Logistics ${role} record`);
  const ids = Object.keys(record);
  if (ids.length > LOGISTICS_POWER_LIMITS.entriesPerRole) {
    throw new LogisticsProfileValidationError(
      fieldPath,
      `Logistics ${role} record exceeds the ${LOGISTICS_POWER_LIMITS.entriesPerRole} entry budget.`
    );
  }
  for (const id of ids) {
    if (id.length === 0 || utf8ByteLength(id) > LOGISTICS_POWER_LIMITS.idUtf8Bytes) {
      throw new LogisticsProfileValidationError(
        `${fieldPath}.${id}`,
        `Logistics tower type id must contain 1..${LOGISTICS_POWER_LIMITS.idUtf8Bytes} UTF-8 bytes.`
      );
    }
  }
  return record;
}

function normalizeGenerators(value: unknown): Readonly<Record<string, LogisticsGeneratorDefinitionV1>> {
  const root = "profile.power.generators";
  const record = inspectRoleRecord(value, root, "generator");
  const entries = Object.keys(record).sort().map((id) => {
    const path = `${root}.${id}`;
    const definition = inspectOwnDataRecord(record[id], path, "Logistics generator definition");
    exactFields(definition, ["output", "linkRadius", "coverageRadius"], path, "Logistics generator definition");
    return [id, Object.freeze({
      output: boundedPositive(definition.output, LOGISTICS_POWER_LIMITS.output, `${path}.output`),
      linkRadius: boundedRadius(definition.linkRadius, `${path}.linkRadius`),
      coverageRadius: boundedRadius(definition.coverageRadius, `${path}.coverageRadius`)
    })] as const;
  });
  return Object.freeze(Object.fromEntries(entries));
}

function normalizeRelays(value: unknown): Readonly<Record<string, LogisticsRelayDefinitionV1>> {
  const root = "profile.power.relays";
  const record = inspectRoleRecord(value, root, "relay");
  const entries = Object.keys(record).sort().map((id) => {
    const path = `${root}.${id}`;
    const definition = inspectOwnDataRecord(record[id], path, "Logistics relay definition");
    exactFields(definition, ["linkRadius", "coverageRadius"], path, "Logistics relay definition");
    return [id, Object.freeze({
      linkRadius: boundedRadius(definition.linkRadius, `${path}.linkRadius`),
      coverageRadius: boundedRadius(definition.coverageRadius, `${path}.coverageRadius`)
    })] as const;
  });
  return Object.freeze(Object.fromEntries(entries));
}

function normalizeConsumers(value: unknown): Readonly<Record<string, LogisticsConsumerDefinitionV1>> {
  const root = "profile.power.consumers";
  const record = inspectRoleRecord(value, root, "consumer");
  const entries = Object.keys(record).sort().map((id) => {
    const path = `${root}.${id}`;
    const definition = inspectOwnDataRecord(record[id], path, "Logistics consumer definition");
    exactFields(definition, ["demand", "priority"], path, "Logistics consumer definition");
    return [id, Object.freeze({
      demand: boundedPositive(definition.demand, LOGISTICS_POWER_LIMITS.demand, `${path}.demand`),
      priority: boundedPriority(definition.priority, `${path}.priority`)
    })] as const;
  });
  return Object.freeze(Object.fromEntries(entries));
}

/** Normalize one supported v1 profile without executing accessors or retaining authored references. */
export function normalizeLogisticsProfileV1(value: unknown): LogisticsProfileV1 {
  const profile = inspectOwnDataRecord(value, "profile", "Logistics profile");
  exactFields(profile, ["power"], "profile", "Logistics profile");
  if (profile.power === null) return Object.freeze({ power: null });
  const power = inspectOwnDataRecord(profile.power, "profile.power", "Logistics power definition");
  exactFields(power, ["generators", "relays", "consumers"], "profile.power", "Logistics power definition");

  // Inspect record shapes and cardinality before traversing any nested definition.
  const generatorsRecord = inspectRoleRecord(power.generators, "profile.power.generators", "generator");
  const relaysRecord = inspectRoleRecord(power.relays, "profile.power.relays", "relay");
  const consumersRecord = inspectRoleRecord(power.consumers, "profile.power.consumers", "consumer");
  const total = Object.keys(generatorsRecord).length + Object.keys(relaysRecord).length
    + Object.keys(consumersRecord).length;
  if (total > LOGISTICS_POWER_LIMITS.entriesTotal) {
    throw new LogisticsProfileValidationError(
      "profile.power",
      `Logistics power records exceed the ${LOGISTICS_POWER_LIMITS.entriesTotal} total entry budget.`
    );
  }
  const roles = new Set<string>();
  for (const [role, record] of [
    ["generators", generatorsRecord], ["relays", relaysRecord], ["consumers", consumersRecord]
  ] as const) {
    for (const id of Object.keys(record)) {
      if (roles.has(id)) {
        throw new LogisticsProfileValidationError(
          `profile.power.${role}.${id}`,
          `Tower type "${id}" occurs in more than one Logistics power role.`
        );
      }
      roles.add(id);
    }
  }

  return Object.freeze({
    power: Object.freeze({
      generators: normalizeGenerators(generatorsRecord),
      relays: normalizeRelays(relaysRecord),
      consumers: normalizeConsumers(consumersRecord)
    })
  });
}

function inspectAmmunitionRecord(
  value: unknown,
  fieldPath: string,
  label: string,
  limit: number
): OwnDataRecord {
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    descriptors = value !== null && typeof value === "object"
      ? Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>
      : {};
  } catch {
    throw new LogisticsProfileValidationError(fieldPath, `${label} could not be inspected safely.`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || (prototype !== Object.prototype && prototype !== null)) {
    throw new LogisticsProfileValidationError(fieldPath, `${label} must be a plain object with own data fields.`);
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw new LogisticsProfileValidationError(fieldPath, `${label} must not contain symbol fields.`);
  }
  const ids = Object.keys(descriptors);
  if (ids.length > limit) {
    throw new LogisticsProfileValidationError(fieldPath, `${label} exceeds the ${limit} entry budget.`);
  }
  const record = Object.create(null) as OwnDataRecord;
  for (const id of ids) {
    boundedUtf8String(id, LOGISTICS_AMMUNITION_LIMITS.idUtf8Bytes, `${fieldPath}.${id}`, `${label} id`);
    const descriptor = descriptors[id];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new LogisticsProfileValidationError(
        `${fieldPath}.${id}`,
        `${label} field "${id}" must be an enumerable own data field; accessors are not allowed.`
      );
    }
    record[id] = descriptor.value;
  }
  return record;
}

function normalizeAmmunition(value: unknown): LogisticsAmmunitionDefinitionV2 {
  const root = "profile.ammunition";
  const ammunition = inspectOwnDataRecord(value, root, "Logistics ammunition definition");
  exactFields(ammunition, ["types", "towerInventories"], root, "Logistics ammunition definition");
  const typeRecord = inspectAmmunitionRecord(
    ammunition.types,
    `${root}.types`,
    "Logistics ammunition types",
    LOGISTICS_AMMUNITION_LIMITS.types
  );
  const inventoryRecord = inspectAmmunitionRecord(
    ammunition.towerInventories,
    `${root}.towerInventories`,
    "Logistics ammunition tower inventories",
    LOGISTICS_AMMUNITION_LIMITS.towerInventories
  );
  const types = Object.freeze(Object.fromEntries(Object.keys(typeRecord).sort().map((id) => {
    const path = `${root}.types.${id}`;
    const definition = inspectOwnDataRecord(typeRecord[id], path, "Logistics ammunition type");
    exactFields(definition, ["label"], path, "Logistics ammunition type");
    return [id, Object.freeze({
      label: boundedUtf8String(
        definition.label,
        LOGISTICS_AMMUNITION_LIMITS.labelUtf8Bytes,
        `${path}.label`,
        "Logistics ammunition type label"
      )
    })] as const;
  })));
  const towerInventories = Object.freeze(Object.fromEntries(Object.keys(inventoryRecord).sort().map((towerTypeId) => {
    const path = `${root}.towerInventories.${towerTypeId}`;
    const definition = inspectOwnDataRecord(inventoryRecord[towerTypeId], path, "Logistics tower inventory");
    exactFields(
      definition,
      ["ammoTypeId", "capacity", "startingAmount", "consumptionPerActivation"],
      path,
      "Logistics tower inventory"
    );
    const capacity = boundedSafeInteger(
      definition.capacity,
      1,
      LOGISTICS_AMMUNITION_LIMITS.capacity,
      `${path}.capacity`
    );
    return [towerTypeId, Object.freeze({
      ammoTypeId: boundedUtf8String(
        definition.ammoTypeId,
        LOGISTICS_AMMUNITION_LIMITS.idUtf8Bytes,
        `${path}.ammoTypeId`,
        "Logistics ammunition type reference"
      ),
      capacity,
      startingAmount: boundedSafeInteger(definition.startingAmount, 0, capacity, `${path}.startingAmount`),
      consumptionPerActivation: boundedSafeInteger(
        definition.consumptionPerActivation,
        1,
        capacity,
        `${path}.consumptionPerActivation`
      )
    })] as const;
  })));
  return Object.freeze({ types, towerInventories });
}

/** Normalize one supported v2 profile without executing accessors or retaining authored references. */
export function normalizeLogisticsProfileV2(value: unknown): LogisticsProfileV2 {
  const profile = inspectOwnDataRecord(value, "profile", "Logistics profile");
  exactFields(profile, ["power", "ammunition"], "profile", "Logistics profile");
  const power = normalizeLogisticsProfileV1({ power: profile.power }).power;
  const ammunition = profile.ammunition === null ? null : normalizeAmmunition(profile.ammunition);
  return Object.freeze({ power, ammunition });
}

function inspectSupplyRecord(
  value: unknown,
  fieldPath: string,
  label: string,
  limit: number
): OwnDataRecord {
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = value !== null && typeof value === "object" ? Object.getPrototypeOf(value) : null;
    descriptors = value !== null && typeof value === "object"
      ? Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>
      : {};
  } catch {
    throw new LogisticsProfileValidationError(fieldPath, `${label} could not be inspected safely.`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || (prototype !== Object.prototype && prototype !== null)) {
    throw new LogisticsProfileValidationError(fieldPath, `${label} must be a plain object with own data fields.`);
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw new LogisticsProfileValidationError(fieldPath, `${label} must not contain symbol fields.`);
  }
  const ids = Object.keys(descriptors);
  if (ids.length > limit) {
    throw new LogisticsProfileValidationError(fieldPath, `${label} exceeds the ${limit} entry budget.`);
  }
  const record = Object.create(null) as OwnDataRecord;
  for (const id of ids) {
    boundedUtf8String(id, LOGISTICS_SUPPLY_LIMITS.idUtf8Bytes, `${fieldPath}.${id}`, `${label} id`);
    const descriptor = descriptors[id];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new LogisticsProfileValidationError(
        `${fieldPath}.${id}`,
        `${label} field "${id}" must be an enumerable own data field; accessors are not allowed.`
      );
    }
    record[id] = descriptor.value;
  }
  return record;
}

function boundedSupplyInterval(value: unknown, fieldPath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)
    || value < LOGISTICS_SUPPLY_LIMITS.minimumInterval
    || value > LOGISTICS_SUPPLY_LIMITS.maximumInterval) {
    throw new LogisticsProfileValidationError(
      fieldPath,
      `${fieldPath} must be finite and in ${LOGISTICS_SUPPLY_LIMITS.minimumInterval}`
        + `..${LOGISTICS_SUPPLY_LIMITS.maximumInterval}.`
    );
  }
  return value;
}

function boundedSupplyRadius(value: unknown, fieldPath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value)
    || value < 0 || value > LOGISTICS_SUPPLY_LIMITS.transferRadius) {
    throw new LogisticsProfileValidationError(
      fieldPath,
      `${fieldPath} must be a finite safe integer in 0..${LOGISTICS_SUPPLY_LIMITS.transferRadius}.`
    );
  }
  return value;
}

function normalizeSupply(value: unknown): LogisticsSupplyDefinitionV3 {
  const root = "profile.supply";
  const supply = inspectOwnDataRecord(value, root, "Logistics supply definition");
  exactFields(
    supply,
    ["productionRecipes", "producers", "storages"],
    root,
    "Logistics supply definition"
  );

  // Inspect every top-level record and enforce budgets before reading a nested authored value.
  const recipeRecord = inspectSupplyRecord(
    supply.productionRecipes,
    `${root}.productionRecipes`,
    "Logistics production recipes",
    LOGISTICS_SUPPLY_LIMITS.productionRecipes
  );
  const producerRecord = inspectSupplyRecord(
    supply.producers,
    `${root}.producers`,
    "Logistics producers",
    LOGISTICS_SUPPLY_LIMITS.producers
  );
  const storageRecord = inspectSupplyRecord(
    supply.storages,
    `${root}.storages`,
    "Logistics storages",
    LOGISTICS_SUPPLY_LIMITS.storages
  );
  if (Object.keys(producerRecord).length + Object.keys(storageRecord).length
    > LOGISTICS_SUPPLY_LIMITS.authoredSourcesTotal) {
    throw new LogisticsProfileValidationError(
      root,
      `Logistics producers and storages exceed the ${LOGISTICS_SUPPLY_LIMITS.authoredSourcesTotal}`
        + " combined source budget."
    );
  }
  for (const towerTypeId of Object.keys(producerRecord)) {
    if (Object.prototype.hasOwnProperty.call(storageRecord, towerTypeId)) {
      throw new LogisticsProfileValidationError(
        `${root}.storages.${towerTypeId}`,
        `Tower type "${towerTypeId}" cannot have both producer and storage supply roles.`
      );
    }
  }

  const productionRecipes = Object.freeze(Object.fromEntries(
    Object.keys(recipeRecord).sort().map((recipeId) => {
      const path = `${root}.productionRecipes.${recipeId}`;
      const definition = inspectOwnDataRecord(recipeRecord[recipeId], path, "Logistics production recipe");
      exactFields(
        definition,
        ["label", "ammoTypeId", "outputAmount", "interval"],
        path,
        "Logistics production recipe"
      );
      return [recipeId, Object.freeze({
        label: boundedUtf8String(
          definition.label,
          LOGISTICS_SUPPLY_LIMITS.labelUtf8Bytes,
          `${path}.label`,
          "Logistics production recipe label"
        ),
        ammoTypeId: boundedUtf8String(
          definition.ammoTypeId,
          LOGISTICS_SUPPLY_LIMITS.idUtf8Bytes,
          `${path}.ammoTypeId`,
          "Logistics ammunition type reference"
        ),
        outputAmount: boundedSafeInteger(
          definition.outputAmount,
          1,
          LOGISTICS_SUPPLY_LIMITS.amount,
          `${path}.outputAmount`
        ),
        interval: boundedSupplyInterval(definition.interval, `${path}.interval`)
      })] as const;
    })
  ));

  const producers = Object.freeze(Object.fromEntries(
    Object.keys(producerRecord).sort().map((towerTypeId) => {
      const path = `${root}.producers.${towerTypeId}`;
      const definition = inspectOwnDataRecord(producerRecord[towerTypeId], path, "Logistics producer");
      exactFields(
        definition,
        ["recipeId", "capacity", "startingAmount", "transferRadius", "transferAmount", "transferInterval"],
        path,
        "Logistics producer"
      );
      const capacity = boundedSafeInteger(
        definition.capacity,
        1,
        LOGISTICS_SUPPLY_LIMITS.inventoryCapacity,
        `${path}.capacity`
      );
      return [towerTypeId, Object.freeze({
        recipeId: boundedUtf8String(
          definition.recipeId,
          LOGISTICS_SUPPLY_LIMITS.idUtf8Bytes,
          `${path}.recipeId`,
          "Logistics production recipe reference"
        ),
        capacity,
        startingAmount: boundedSafeInteger(definition.startingAmount, 0, capacity, `${path}.startingAmount`),
        transferRadius: boundedSupplyRadius(definition.transferRadius, `${path}.transferRadius`),
        transferAmount: boundedSafeInteger(definition.transferAmount, 1, capacity, `${path}.transferAmount`),
        transferInterval: boundedSupplyInterval(definition.transferInterval, `${path}.transferInterval`)
      })] as const;
    })
  ));

  const storages = Object.freeze(Object.fromEntries(
    Object.keys(storageRecord).sort().map((towerTypeId) => {
      const path = `${root}.storages.${towerTypeId}`;
      const definition = inspectOwnDataRecord(storageRecord[towerTypeId], path, "Logistics storage");
      exactFields(
        definition,
        ["ammoTypeId", "capacity", "startingAmount", "transferRadius", "transferAmount", "transferInterval"],
        path,
        "Logistics storage"
      );
      const capacity = boundedSafeInteger(
        definition.capacity,
        1,
        LOGISTICS_SUPPLY_LIMITS.inventoryCapacity,
        `${path}.capacity`
      );
      return [towerTypeId, Object.freeze({
        ammoTypeId: boundedUtf8String(
          definition.ammoTypeId,
          LOGISTICS_SUPPLY_LIMITS.idUtf8Bytes,
          `${path}.ammoTypeId`,
          "Logistics ammunition type reference"
        ),
        capacity,
        startingAmount: boundedSafeInteger(definition.startingAmount, 0, capacity, `${path}.startingAmount`),
        transferRadius: boundedSupplyRadius(definition.transferRadius, `${path}.transferRadius`),
        transferAmount: boundedSafeInteger(definition.transferAmount, 1, capacity, `${path}.transferAmount`),
        transferInterval: boundedSupplyInterval(definition.transferInterval, `${path}.transferInterval`)
      })] as const;
    })
  ));

  for (const [towerTypeId, producer] of Object.entries(producers)) {
    if (!Object.prototype.hasOwnProperty.call(productionRecipes, producer.recipeId)) continue;
    const recipe = productionRecipes[producer.recipeId]!;
    if (recipe.outputAmount > producer.capacity) {
      throw new LogisticsProfileValidationError(
        `${root}.producers.${towerTypeId}.capacity`,
        `Logistics producer capacity must be at least referenced recipe outputAmount ${recipe.outputAmount}.`
      );
    }
  }

  return Object.freeze({ productionRecipes, producers, storages });
}

/** Normalize one supported v3 profile without executing accessors or retaining authored references. */
export function normalizeLogisticsProfileV3(value: unknown): LogisticsProfileV3 {
  const profile = inspectOwnDataRecord(value, "profile", "Logistics profile");
  exactFields(profile, ["power", "ammunition", "supply"], "profile", "Logistics profile");
  const base = normalizeLogisticsProfileV2({ power: profile.power, ammunition: profile.ammunition });
  if (profile.supply !== null && base.ammunition === null) {
    throw new LogisticsProfileValidationError(
      "profile.supply",
      "Logistics supply requires a non-null ammunition definition."
    );
  }
  const supply = profile.supply === null ? null : normalizeSupply(profile.supply);
  return Object.freeze({ power: base.power, ammunition: base.ammunition, supply });
}

/** Resolve only a selected, enabled, supported Logistics profile. */
export function resolveActiveLogisticsMechanics(
  content: GameContentRegistry,
  missionId: string
): ActiveLogisticsMechanics | undefined {
  const mission = content.missions[missionId];
  const capability = mission?.capabilities.logistics;
  if (!mission || !capability?.active || capability.profileId === undefined) return undefined;
  const module = content.mechanics.modules.logistics;
  if (!module || (module.schemaVersion !== 1 && module.schemaVersion !== 2 && module.schemaVersion !== 3)) {
    return undefined;
  }
  const authored = module.profiles[capability.profileId];
  try {
    if (module.schemaVersion === 1) {
      const normalized = normalizeLogisticsProfileV1(authored);
      return Object.freeze({
        schemaVersion: 1 as const,
        profileId: capability.profileId,
        power: normalized.power
      });
    }
    if (module.schemaVersion === 2) {
      const normalized = normalizeLogisticsProfileV2(authored);
      return Object.freeze({
        schemaVersion: 2 as const,
        profileId: capability.profileId,
        power: normalized.power,
        ammunition: normalized.ammunition
      });
    }
    const normalized = normalizeLogisticsProfileV3(authored);
    return Object.freeze({
      schemaVersion: 3 as const,
      profileId: capability.profileId,
      power: normalized.power,
      ammunition: normalized.ammunition,
      supply: normalized.supply
    });
  } catch {
    return undefined;
  }
}
