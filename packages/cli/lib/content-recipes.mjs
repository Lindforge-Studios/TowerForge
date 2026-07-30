import {
  MechanicsRecipeParameterError,
  listMechanicsRecipes,
  materializeMechanicsRecipe
} from "./mechanics-recipes.mjs";

const RECIPES = Object.freeze({
  enemies: [
    recipe("grunt", "Grunt", "Baseline ground unit for early waves.", {
      label: "Grunt", maxHp: 12, speed: 1, coreDamage: 1, reward: { coins: 3 }, coinReward: 3, color: 0x79b86a, hitRadius: 0.5
    }),
    recipe("runner", "Runner", "Fast, fragile pressure unit that ignores water slow.", {
      label: "Runner", maxHp: 7, speed: 2.4, coreDamage: 1, reward: { coins: 3 }, coinReward: 3, color: 0xe4c85b, hitRadius: 0.4, ignoresWaterSlow: true
    }),
    recipe("tank", "Tank", "Slow armored body with high core damage.", {
      label: "Tank", maxHp: 70, speed: 0.45, coreDamage: 3, reward: { coins: 12 }, coinReward: 12, color: 0x8d759f, hitRadius: 0.85, pathCollisionRadius: 0.9, armor: { kind: "pierce_only" }
    }),
    recipe("flying", "Flying", "Direct-path air target for anti-air checks.", {
      label: "Flying", maxHp: 20, speed: 1.4, coreDamage: 2, reward: { coins: 6 }, coinReward: 6, color: 0x67b6d6, hitRadius: 0.5, movementKind: "direct_flying", targetClass: "flying"
    }),
    recipe("healer", "Healer", "Support unit that restores nearby enemies.", {
      label: "Healer", maxHp: 24, speed: 0.8, coreDamage: 1, reward: { coins: 8 }, coinReward: 8, color: 0x74cfa3, hitRadius: 0.55, healAura: { radius: 2, healPerUnit: 0.35, includeSelf: false, stacks: false }
    }),
    recipe("boss", "Boss", "Durable encounter unit that disrupts and attacks towers.", {
      label: "Boss", maxHp: 450, speed: 0.32, coreDamage: 10, reward: { coins: 60 }, coinReward: 60, color: 0xd65d67, hitRadius: 1, pathCollisionRadius: 1, towerDisrupt: { interval: 8, radius: 3, duration: 3 }, towerAttack: { interval: 5, damage: 15, range: 2.5 }
    })
  ],
  towers: [
    recipe("pipeline_chain", "Pipeline Chain", "Preferred composable tower: deterministic targeting, chained delivery, ordered damage and slow effects.", {
      label: "Pipeline Chain Tower", cost: { coins: 85 }, footprintRadius: 1, range: 5,
      attack: {
        kind: "pipeline",
        interval: 1.5,
        targeting: { classes: ["ground", "flying"], mode: "first", maxTargets: 1 },
        delivery: { kind: "chain", maxJumps: 3, jumpRadius: 2.5, damageFalloff: 0.8 },
        effects: [
          { kind: "damage", amount: 7, damageType: "arc" },
          { kind: "status", status: { slow: { factor: 0.8, duration: 1.5 }, slowAffectsClasses: ["ground", "flying"] } }
        ],
        upgradeCosts: [{ coins: 65 }, { coins: 95 }]
      }
    }),
    recipe("single", "Single Target", "Reliable general-purpose tower with stack upgrades.", {
      label: "Single Target Tower", cost: { coins: 45 }, footprintRadius: 1, range: 5,
      attack: { kind: "single", fireRate: 1.4, damagePerStack: 1, startingStacks: 3, maxStacks: 8, upgradeCost: 35 }
    }),
    recipe("pulse", "Pulse", "Aura damage with a lingering damage-over-time effect.", {
      label: "Pulse Tower", cost: { coins: 70 }, footprintRadius: 1, range: 3.5,
      attack: { kind: "pulse", pulseRate: 1, pulseDamage: 1.2, dotDamagePerUnit: 0.15, dotDuration: 5, pulseRateByLevel: [1, 1.25, 1.5], upgradeCosts: [{ coins: 55 }, { coins: 80 }] }
    }),
    recipe("sniper", "Sniper", "Long-range burst damage that prioritizes large targets.", {
      label: "Sniper Tower", cost: { coins: 90 }, footprintRadius: 1, range: 7,
      attack: { kind: "sniper", interval: 2.5, damage: 18, targetPriority: "largest_hp", rangeByLevel: [7, 8, 9], upgradeCosts: [{ coins: 70 }, { coins: 100 }] }
    }),
    recipe("antiair", "Anti-Air", "Dedicated defense against flying enemies.", {
      label: "Anti-Air Tower", cost: { coins: 60 }, footprintRadius: 1, range: 6,
      attack: { kind: "antiair", fireRate: 1.6, damage: 4, maxTargetsByLevel: [1, 2, 3], upgradeCosts: [{ coins: 50 }, { coins: 75 }] }
    }),
    recipe("splash", "Splash Control", "Area damage with slow for dense ground waves.", {
      label: "Splash Tower", cost: { coins: 80 }, footprintRadius: 1, range: 4,
      attack: { kind: "splash", interval: 2, damage: 6, splashDamage: 3, armoredChipDamage: 1, splashRadius: 1.2, slowFactor: 0.65, slowDuration: 2.5, intervalByLevel: [2, 1.7, 1.4], upgradeCosts: [{ coins: 60 }, { coins: 90 }] }
    }),
    recipe("support_buff", "Support Buff", "Aura that accelerates the project's damaging towers.", {
      label: "Support Tower", cost: { coins: 75 }, footprintRadius: 1, range: 3,
      attack: { kind: "support_buff", auraRadius: 3, fireRateMultiplierByLevel: [1.2, 1.3, 1.4], affectsTowerIds: [], upgradeCosts: [{ coins: 55 }, { coins: 80 }] }
    })
  ],
  missions: [
    recipe("classic", "Classic Defense", "Clear every wave with the standard economy.", {
      label: "Classic Defense", description: "Defend the core and clear every wave.", availability: "playable", startingCoreHp: 20, startingResources: { coins: 120 }, prepTimeUnits: 30, buildTowerIds: [], abilityIds: []
    }),
    recipe("survival", "Timed Survival", "Stay alive for a fixed duration, even after waves clear.", {
      label: "Timed Survival", description: "Survive until the timer expires.", availability: "playable", startingCoreHp: 20, startingResources: { coins: 120 }, prepTimeUnits: 20, buildTowerIds: [], abilityIds: [],
      objectives: { victory: [{ id: "survive", label: "Survive", kind: "surviveSeconds", seconds: 180 }], failure: [{ id: "leak_limit", label: "Leak limit", kind: "maxLeaks", maxLeaks: 12 }] }
    }),
    recipe("economy", "Economy Challenge", "Clear waves while growing the coin reserve.", {
      label: "Economy Challenge", description: "Clear the assault and finish with a strong reserve.", availability: "playable", startingCoreHp: 20, startingResources: { coins: 90 }, prepTimeUnits: 25, buildTowerIds: [], abilityIds: [],
      economy: { perWaveClear: { coins: 12 }, interestRate: 0.05, interestCap: { coins: 20 }, sellRefundRatio: 0.65 },
      objectives: { victory: [{ id: "clear_waves", label: "Clear all waves", kind: "clearWaves" }, { id: "reserve", label: "Build a reserve", kind: "accumulateResource", resourceId: "coins", amount: 180 }] }
    }),
    recipe("perfect_defense", "Perfect Defense", "No-leak challenge with an explicit perfect star.", {
      label: "Perfect Defense", description: "Clear every wave without a single leak.", availability: "playable", startingCoreHp: 20, startingResources: { coins: 140 }, prepTimeUnits: 30, buildTowerIds: [], abilityIds: [],
      objectives: { victory: [{ id: "clear_waves", label: "Clear all waves", kind: "clearWaves" }], failure: [{ id: "no_leaks", label: "No leaks", kind: "maxLeaks", maxLeaks: 0 }], stars: [{ id: "perfect", label: "Perfect defense", kind: "maxLeaks", maxLeaks: 0 }] }
    })
  ]
});

function recipe(id, label, description, entity) {
  return { id, label, description, suggestedId: id, entity };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export const CONTENT_RECIPE_COLLECTIONS = Object.freeze([...Object.keys(RECIPES), "mechanics"]);

export function listContentRecipes(collection) {
  assertCollection(collection);
  if (collection === "mechanics") return listMechanicsRecipes();
  return RECIPES[collection].map(({ entity, ...metadata }) => ({ ...metadata, attackKind: entity.attack?.kind ?? null }));
}

export function materializeContentRecipe(collection, recipeId, context = {}) {
  assertCollection(collection);
  if (collection === "mechanics") return materializeMechanicsRecipe(recipeId, context);
  const source = RECIPES[collection].find((item) => item.id === recipeId);
  if (!source) throw new Error(`Unknown ${collection} recipe "${recipeId}".`);
  if (ownDataFieldPresent(context, "parameters")) {
    throw new MechanicsRecipeParameterError(
      "terraform_recipe_parameter_invalid",
      `Content recipe "${collection}/${recipeId}" does not accept parameters.`
    );
  }
  const result = clone(source);
  result.entity.id = result.suggestedId;

  if (collection === "towers" && result.entity.attack?.kind === "support_buff") {
    result.entity.attack.affectsTowerIds = [...(context.towerIds ?? [])];
  }
  if (collection === "missions") {
    result.entity.mapId = context.mapIds?.[0] ?? "";
    result.entity.waveSetId = context.waveSetIds?.[0] ?? "";
    result.entity.buildTowerIds = [...(context.towerIds ?? [])];
    result.entity.abilityIds = [...(context.abilityIds ?? [])];
  }
  return result;
}

function ownDataFieldPresent(value, key) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  try {
    return Object.getOwnPropertyDescriptor(value, key) !== undefined;
  } catch {
    return true;
  }
}

export function contentRecipeContext(files) {
  const balance = files.balance ?? files;
  const towerEntries = Object.entries(balance.towers ?? files.towers ?? {});
  const abilityEntries = Object.entries(balance.abilities ?? files.abilities ?? {});
  const missionIds = Object.keys(balance.missions ?? {});
  const defaultMissionId = balance.defaultMissionId ?? files.manifest?.defaultMissionId;
  const missionId = missionIds.includes(defaultMissionId) ? defaultMissionId : [...missionIds].sort(compareBinary)[0];
  const selectedProfiles = ownDataValue(ownDataValue(ownDataValue(balance.missions, missionId), "mechanics"), "profiles");
  const selectedMission = ownDataValue(balance.missions, missionId);
  const combatProfileId = ownDataValue(selectedProfiles, "combat");
  const modules = ownDataValue(files.mechanics, "modules");
  const combatModule = ownDataValue(modules, "combat");
  const combatProfiles = ownDataValue(combatModule, "profiles");
  const combatProfile = typeof combatProfileId === "string" ? ownDataValue(combatProfiles, combatProfileId) : undefined;
  const damageTypes = ownDataValue(combatProfile, "damageTypes");
  const combatEnemyShields = ownDataValue(ownDataValue(combatProfile, "shields"), "enemies");
  const missionTowerIds = Array.isArray(ownDataValue(selectedMission, "buildTowerIds"))
    ? [...ownDataValue(selectedMission, "buildTowerIds")].sort(compareBinary)
    : [];
  const missionAbilityIds = Array.isArray(ownDataValue(selectedMission, "abilityIds"))
    ? [...ownDataValue(selectedMission, "abilityIds")].sort(compareBinary)
    : [];
  const towersById = new Map(towerEntries);
  const abilitiesById = new Map(abilityEntries);
  return {
    mapIds: Object.keys(files.maps ?? {}),
    waveSetIds: Object.keys(balance.waveSets ?? files.waveSets ?? {}),
    towerIds: towerEntries.map(([id]) => id).sort(compareBinary),
    towerAttackKindsByTowerId: Object.fromEntries(towerEntries
      .map(([id, tower]) => [id, tower?.attack?.kind])
      .filter(([, kind]) => typeof kind === "string")
      .sort(([left], [right]) => compareBinary(left, right))),
    towerTagsByTowerId: authoredTowerTags(towerEntries),
    abilityIds: abilityEntries.map(([id]) => id).sort(compareBinary),
    missionTowerIds,
    missionAbilityIds,
    missionDamagingTowerIds: missionTowerIds.filter((id) => authoredTowerDealsDamage(towersById.get(id))),
    missionDamagingAbilityIds: missionAbilityIds.filter((id) => authoredAbilityDealsDamage(id, abilitiesById.get(id))),
    defaultMissionId,
    missionIds,
    enemyIds: Object.keys(balance.enemies ?? files.enemies ?? {}),
    ...(combatProfile === undefined ? {} : {
      shieldedEnemyIds: isRecord(combatEnemyShields)
        ? Object.keys(combatEnemyShields).sort(compareBinary)
        : []
    }),
    moduleSchemaVersions: mechanicsModuleSchemaVersions(files.mechanics),
    activeCombatModuleSchemaVersion: combatModule?.enabled === true && typeof combatProfileId === "string"
      ? ownDataValue(combatModule, "schemaVersion")
      : undefined,
    activeCombatDamageTypeIds: isRecord(damageTypes) ? Object.keys(damageTypes).sort(compareBinary) : [],
    terrainIds: isRecord(balance.terrainTypes) ? Object.keys(balance.terrainTypes).sort(compareBinary) : [],
    terrainTags: authoredTerrainTags(balance.terrainTypes),
    destructibleTowerIds: towerEntries
      .filter(([, tower]) => Number.isFinite(tower?.maxHp) && tower.maxHp > 0)
      .map(([id]) => id)
  };
}

function authoredTowerDealsDamage(tower) {
  const attack = ownDataValue(tower, "attack");
  const kind = ownDataValue(attack, "kind");
  if (["single", "pulse", "sniper", "antiair", "splash"].includes(kind)) return true;
  return kind === "pipeline" && authoredEffects(attack).some((effect) => (
    ownDataValue(effect, "kind") === "damage"
    && Number.isFinite(ownDataValue(effect, "amount"))
    && ownDataValue(effect, "amount") > 0
  ));
}

function authoredAbilityDealsDamage(abilityId, ability) {
  const effects = authoredEffects(ability);
  return effects.some((effect) => (
    ownDataValue(effect, "kind") === "damage"
    && Number.isFinite(ownDataValue(effect, "amount"))
    && ownDataValue(effect, "amount") > 0
  )) || (effects.length === 0
    && ownDataValue(ability, "effects") === undefined
    && abilityId === "strike"
    && Number.isFinite(ownDataValue(ability, "damage"))
    && ownDataValue(ability, "damage") > 0);
}

function authoredEffects(owner) {
  const effects = ownDataValue(owner, "effects");
  if (!Array.isArray(effects)) return [];
  try {
    const descriptors = Object.getOwnPropertyDescriptors(effects);
    if (Object.getOwnPropertySymbols(descriptors).length > 0) return [];
    const itemKeys = Object.keys(descriptors).filter((key) => key !== "length");
    if (itemKeys.length !== effects.length) return [];
    const result = [];
    for (let index = 0; index < effects.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return [];
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return [];
  }
}

function authoredTowerTags(towerEntries) {
  const result = Object.create(null);
  for (const [towerId, tower] of [...towerEntries].sort(([left], [right]) => compareBinary(left, right))) {
    const tags = ownDataValue(tower, "tags");
    if (!Array.isArray(tags)) continue;
    const normalized = [...new Set(tags.filter((tag) => typeof tag === "string" && tag.length > 0))]
      .sort(compareBinary);
    if (normalized.length === 0) continue;
    Object.defineProperty(result, towerId, {
      value: normalized,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return result;
}

function authoredTerrainTags(terrainTypes) {
  if (!isRecord(terrainTypes)) return [];
  const tags = new Set();
  for (const terrainId of Object.keys(terrainTypes).sort(compareBinary).slice(0, 4096)) {
    const authoredTags = ownDataValue(ownDataValue(terrainTypes, terrainId), "tags");
    if (!Array.isArray(authoredTags)) continue;
    for (const tag of authoredTags.slice(0, 256)) {
      if (typeof tag === "string" && tag.length > 0) tags.add(tag);
    }
  }
  return [...tags].sort(compareBinary);
}

function mechanicsModuleSchemaVersions(mechanics) {
  const versions = Object.create(null);
  const modules = ownDataValue(mechanics, "modules");
  if (!isRecord(modules)) return versions;

  let moduleIds;
  try {
    moduleIds = Object.keys(modules).slice(0, 64).sort(compareBinary);
  } catch {
    return versions;
  }
  for (const moduleId of moduleIds) {
    const module = ownDataValue(modules, moduleId);
    const schemaVersion = ownDataValue(module, "schemaVersion");
    if (Number.isInteger(schemaVersion) && schemaVersion > 0) {
      Object.defineProperty(versions, moduleId, {
        value: schemaVersion,
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
  }
  return versions;
}

function ownDataValue(value, key) {
  if (!isRecord(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable && "value" in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function compareBinary(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertCollection(collection) {
  if (!CONTENT_RECIPE_COLLECTIONS.includes(collection)) {
    throw new Error(`Unknown recipe collection "${collection}". Expected one of ${CONTENT_RECIPE_COLLECTIONS.join(", ")}.`);
  }
}
