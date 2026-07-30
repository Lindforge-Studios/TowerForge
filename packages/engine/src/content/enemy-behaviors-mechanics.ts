import type { GameContentRegistry } from "./registry.js";
import { resolveCapabilitySet, SHIELD_LIMITS, type ShieldDefinition } from "./mechanics.js";

export const ENEMY_BEHAVIORS_LIMITS = Object.freeze({
  bossesPerProfile: 256,
  componentsPerRoot: 32,
  towerBindingsPerProfile: 256,
  tagsPerComponent: 32,
  priorityTagsPerBinding: 32,
  idOrTagUtf8Bytes: 128,
  labelUtf8Bytes: 256,
  maxHp: 1_000_000_000_000,
  hitRegionOffset: 4,
  hitRegionRadius: 8
});

export const BOSS_COMPONENT_ABILITY_IDS = Object.freeze([
  "towerAttack", "towerDisrupt", "healAura"
] as const);

export type BossComponentAbilityIdV1 = (typeof BOSS_COMPONENT_ABILITY_IDS)[number];

export interface BossComponentHitRegionV1 {
  readonly kind: "circle";
  readonly offsetX: number;
  readonly offsetY: number;
  readonly radius: number;
}

export interface BossComponentDefinitionV1 {
  readonly maxHp: number;
  readonly hitRegion: BossComponentHitRegionV1;
  readonly label?: string;
  readonly tags?: readonly string[];
  readonly shield?: ShieldDefinition;
  readonly armorTypeId?: string;
  readonly disablesAbilities?: readonly BossComponentAbilityIdV1[];
}

export interface BossComponentsDefinitionV1 {
  readonly components: Readonly<Record<string, BossComponentDefinitionV1>>;
}

export interface BossComponentTowerTargetingV1 {
  readonly priorityTags: readonly string[];
}

export interface EnemyBehaviorsProfileV1 {
  readonly bosses: Readonly<Record<string, BossComponentsDefinitionV1>>;
  readonly targeting?: {
    readonly towers: Readonly<Record<string, BossComponentTowerTargetingV1>>;
  };
}

export interface ActiveEnemyBehaviorsV1 extends EnemyBehaviorsProfileV1 {
  readonly schemaVersion: 1;
  readonly profileId: string;
}

export class EnemyBehaviorsProfileValidationError extends Error {}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function record(value: unknown, path: string, maximumEntries?: number): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new EnemyBehaviorsProfileValidationError(`${path} must be a plain object.`);
  }
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>;
  } catch {
    throw new EnemyBehaviorsProfileValidationError(`${path} could not be inspected safely.`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new EnemyBehaviorsProfileValidationError(`${path} must be a plain object with no custom prototype.`);
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw new EnemyBehaviorsProfileValidationError(`${path} rejects symbol fields.`);
  }
  const keys = Object.keys(descriptors);
  if (maximumEntries !== undefined && keys.length > maximumEntries) {
    throw new EnemyBehaviorsProfileValidationError(`${path} exceeds the maximum limit of ${maximumEntries} entries.`);
  }
  const detached = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new EnemyBehaviorsProfileValidationError(`${path}.${key} must be an enumerable own data property; accessors are forbidden.`);
    }
    Object.defineProperty(detached, key, { value: descriptor.value, enumerable: true });
  }
  return detached;
}

function closed(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], path: string): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new EnemyBehaviorsProfileValidationError(`${path} is closed; unknown field "${key}".`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new EnemyBehaviorsProfileValidationError(`${path}.${key} is required.`);
    }
  }
}

function boundedString(value: unknown, path: string, maximumBytes: number): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()
    || /[\u0000-\u001f\u007f]/.test(value) || utf8Bytes(value) > maximumBytes) {
    throw new EnemyBehaviorsProfileValidationError(`${path} must be a bounded non-empty UTF-8 string of at most ${maximumBytes} bytes.`);
  }
  return value;
}

function finite(value: unknown, path: string, minimum: number, maximum: number, exclusiveMinimum = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)
    || (exclusiveMinimum ? value <= minimum : value < minimum) || value > maximum) {
    throw new EnemyBehaviorsProfileValidationError(`${path} must be finite and in the supported range.`);
  }
  return value;
}

function denseStringSet(
  value: unknown,
  path: string,
  maximumLength: number,
  allowed?: readonly string[],
  allowEmpty = true
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new EnemyBehaviorsProfileValidationError(`${path} must be a dense array.`);
  }
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error();
    descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
  } catch {
    throw new EnemyBehaviorsProfileValidationError(`${path} could not be inspected safely as a dense array.`);
  }
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < (allowEmpty ? 0 : 1) || length > maximumLength
    || Object.getOwnPropertySymbols(descriptors).length > 0
    || Object.keys(descriptors).filter((key) => key !== "length").length !== length) {
    throw new EnemyBehaviorsProfileValidationError(`${path} must be a bounded dense array.`);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new EnemyBehaviorsProfileValidationError(`${path}[${index}] must be an enumerable own data property.`);
    }
    const item = boundedString(descriptor.value, `${path}[${index}]`, ENEMY_BEHAVIORS_LIMITS.idOrTagUtf8Bytes);
    if (allowed && !allowed.includes(item)) {
      throw new EnemyBehaviorsProfileValidationError(`${path}[${index}] contains unsupported value "${item}".`);
    }
    if (seen.has(item)) throw new EnemyBehaviorsProfileValidationError(`${path} contains duplicate value "${item}".`);
    seen.add(item);
    result.push(item);
  }
  return Object.freeze(result);
}

function normalizeShield(value: unknown, path: string): ShieldDefinition {
  const shield = record(value, path);
  closed(shield, ["capacity"], ["regeneration"], path);
  const capacity = finite(shield.capacity, `${path}.capacity`, 0, SHIELD_LIMITS.capacity, true);
  if (shield.regeneration === undefined) return Object.freeze({ capacity });
  const regeneration = record(shield.regeneration, `${path}.regeneration`);
  closed(regeneration, ["ratePerUnit"], ["delayAfterDamage"], `${path}.regeneration`);
  const ratePerUnit = finite(
    regeneration.ratePerUnit,
    `${path}.regeneration.ratePerUnit`,
    0,
    SHIELD_LIMITS.ratePerUnit,
    true
  );
  const delayAfterDamage = regeneration.delayAfterDamage === undefined
    ? undefined
    : finite(
        regeneration.delayAfterDamage,
        `${path}.regeneration.delayAfterDamage`,
        0,
        SHIELD_LIMITS.delayAfterDamage
      );
  return Object.freeze({
    capacity,
    regeneration: Object.freeze({
      ratePerUnit,
      ...(delayAfterDamage === undefined ? {} : { delayAfterDamage })
    })
  });
}

function normalizeComponent(value: unknown, path: string): BossComponentDefinitionV1 {
  const component = record(value, path);
  closed(
    component,
    ["maxHp", "hitRegion"],
    ["label", "tags", "shield", "armorTypeId", "disablesAbilities"],
    path
  );
  const hitRegion = record(component.hitRegion, `${path}.hitRegion`);
  closed(hitRegion, ["kind", "offsetX", "offsetY", "radius"], [], `${path}.hitRegion`);
  if (hitRegion.kind !== "circle") {
    throw new EnemyBehaviorsProfileValidationError(`${path}.hitRegion.kind must be "circle".`);
  }
  const normalizedHitRegion = Object.freeze({
    kind: "circle" as const,
    offsetX: finite(
      hitRegion.offsetX,
      `${path}.hitRegion.offsetX`,
      -ENEMY_BEHAVIORS_LIMITS.hitRegionOffset,
      ENEMY_BEHAVIORS_LIMITS.hitRegionOffset
    ),
    offsetY: finite(
      hitRegion.offsetY,
      `${path}.hitRegion.offsetY`,
      -ENEMY_BEHAVIORS_LIMITS.hitRegionOffset,
      ENEMY_BEHAVIORS_LIMITS.hitRegionOffset
    ),
    radius: finite(hitRegion.radius, `${path}.hitRegion.radius`, 0, ENEMY_BEHAVIORS_LIMITS.hitRegionRadius, true)
  });
  const label = component.label === undefined
    ? undefined
    : boundedString(component.label, `${path}.label`, ENEMY_BEHAVIORS_LIMITS.labelUtf8Bytes);
  const tags = component.tags === undefined
    ? undefined
    : denseStringSet(component.tags, `${path}.tags`, ENEMY_BEHAVIORS_LIMITS.tagsPerComponent);
  const armorTypeId = component.armorTypeId === undefined
    ? undefined
    : boundedString(component.armorTypeId, `${path}.armorTypeId`, ENEMY_BEHAVIORS_LIMITS.idOrTagUtf8Bytes);
  const disablesAbilities = component.disablesAbilities === undefined
    ? undefined
    : denseStringSet(
        component.disablesAbilities,
        `${path}.disablesAbilities`,
        BOSS_COMPONENT_ABILITY_IDS.length,
        BOSS_COMPONENT_ABILITY_IDS
      ) as readonly BossComponentAbilityIdV1[];
  return Object.freeze({
    maxHp: finite(component.maxHp, `${path}.maxHp`, 0, ENEMY_BEHAVIORS_LIMITS.maxHp, true),
    hitRegion: normalizedHitRegion,
    ...(label === undefined ? {} : { label }),
    ...(tags === undefined ? {} : { tags }),
    ...(component.shield === undefined ? {} : { shield: normalizeShield(component.shield, `${path}.shield`) }),
    ...(armorTypeId === undefined ? {} : { armorTypeId }),
    ...(disablesAbilities === undefined ? {} : { disablesAbilities })
  });
}

/** Closed hostile-data-safe parser that returns detached, binary-ordered, deeply frozen own data. */
export function normalizeEnemyBehaviorsProfileV1(value: unknown): EnemyBehaviorsProfileV1 {
  const profile = record(value, "enemyBehaviors profile");
  closed(profile, ["bosses"], ["targeting"], "enemyBehaviors profile");
  const bossesInput = record(profile.bosses, "enemyBehaviors profile.bosses", ENEMY_BEHAVIORS_LIMITS.bossesPerProfile);
  const bossIds = Object.keys(bossesInput).sort();
  if (bossIds.length === 0) {
    throw new EnemyBehaviorsProfileValidationError("enemyBehaviors profile.bosses must contain at least one boss.");
  }
  const bosses = Object.create(null) as Record<string, BossComponentsDefinitionV1>;
  for (const bossId of bossIds) {
    boundedString(bossId, "enemyBehaviors boss id", ENEMY_BEHAVIORS_LIMITS.idOrTagUtf8Bytes);
    const bossPath = `enemyBehaviors profile.bosses.${bossId}`;
    const boss = record(bossesInput[bossId], bossPath);
    closed(boss, ["components"], [], bossPath);
    const componentsInput = record(
      boss.components,
      `${bossPath}.components`,
      ENEMY_BEHAVIORS_LIMITS.componentsPerRoot
    );
    const componentIds = Object.keys(componentsInput).sort();
    if (componentIds.length === 0) {
      throw new EnemyBehaviorsProfileValidationError(`${bossPath}.components must contain at least one component.`);
    }
    const components = Object.create(null) as Record<string, BossComponentDefinitionV1>;
    for (const componentId of componentIds) {
      boundedString(componentId, `${bossPath} component id`, ENEMY_BEHAVIORS_LIMITS.idOrTagUtf8Bytes);
      Object.defineProperty(components, componentId, {
        value: normalizeComponent(componentsInput[componentId], `${bossPath}.components.${componentId}`),
        enumerable: true
      });
    }
    Object.defineProperty(bosses, bossId, {
      value: Object.freeze({ components: Object.freeze(components) }),
      enumerable: true
    });
  }

  let targeting: EnemyBehaviorsProfileV1["targeting"];
  if (profile.targeting !== undefined) {
    const targetingInput = record(profile.targeting, "enemyBehaviors profile.targeting");
    closed(targetingInput, ["towers"], [], "enemyBehaviors profile.targeting");
    const towersInput = record(
      targetingInput.towers,
      "enemyBehaviors profile.targeting.towers",
      ENEMY_BEHAVIORS_LIMITS.towerBindingsPerProfile
    );
    const towers = Object.create(null) as Record<string, BossComponentTowerTargetingV1>;
    for (const towerId of Object.keys(towersInput).sort()) {
      boundedString(towerId, "enemyBehaviors targeting tower id", ENEMY_BEHAVIORS_LIMITS.idOrTagUtf8Bytes);
      const bindingPath = `enemyBehaviors profile.targeting.towers.${towerId}`;
      const binding = record(towersInput[towerId], bindingPath);
      closed(binding, ["priorityTags"], [], bindingPath);
      Object.defineProperty(towers, towerId, {
        value: Object.freeze({
          priorityTags: denseStringSet(
            binding.priorityTags,
            `${bindingPath}.priorityTags`,
            ENEMY_BEHAVIORS_LIMITS.priorityTagsPerBinding,
            undefined,
            false
          )
        }),
        enumerable: true
      });
    }
    targeting = Object.freeze({ towers: Object.freeze(towers) });
  }
  return Object.freeze({ bosses: Object.freeze(bosses), ...(targeting === undefined ? {} : { targeting }) });
}

export function resolveActiveEnemyBehaviorsV1(
  content: GameContentRegistry,
  missionId: string
): ActiveEnemyBehaviorsV1 | undefined {
  const mission = content.missions[missionId];
  const capability = mission ? resolveCapabilitySet(content.mechanics, mission.mechanics).enemyBehaviors : undefined;
  if (!mission || !capability?.active || !capability.profileId) return undefined;
  const module = content.mechanics.modules.enemyBehaviors;
  if (!module || module.schemaVersion !== 1 || module.enabled !== true) return undefined;
  const profile = module.profiles[capability.profileId];
  if (profile === undefined) return undefined;
  try {
    return Object.freeze({
      schemaVersion: 1,
      profileId: capability.profileId,
      ...normalizeEnemyBehaviorsProfileV1(profile)
    });
  } catch {
    return undefined;
  }
}
