const BASIC_REGENERATING_SHIELDS_ID = "basic_regenerating_shields";
const BASIC_ELEMENTAL_ARMOR_MATRIX_ID = "basic_elemental_armor_matrix";
const BASIC_VULNERABILITY_MARKS_ID = "basic_vulnerability_marks";
const ELEMENTAL_SHATTER_ID = "elemental_shatter";
const WET_CHAIN_SHOCK_ID = "wet_chain_shock";
const POISON_COMBUSTION_ID = "poison_combustion";
const BASIC_DYNAMIC_NAVIGATION_ID = "basic_dynamic_navigation";
const BASIC_AUTHORED_ELEVATION_ID = "basic_authored_elevation";
const BASIC_ELEVATION_LINE_OF_SIGHT_ID = "basic_elevation_line_of_sight";
const BASIC_ELEVATION_HIGH_GROUND_ID = "basic_elevation_high_ground";
const BASIC_DISPLACEMENT_PHYSICS_ID = "basic_displacement_physics";
const TAGGED_FALL_HAZARDS_ID = "tagged_fall_hazards";
const TAGGED_FLOOD_ID = "tagged_flood";
const TAGGED_MOAT_ID = "tagged_moat";
const TAGGED_DESTRUCTIBLE_BRIDGE_ID = "tagged_destructible_bridge";
const BASIC_ELEMENTAL_SYNERGY_ID = "basic_elemental_synergy";
const BASIC_BOSS_ARTIFACT_LOOT_ID = "basic_boss_artifact_loot";
const BASIC_COMMANDER_HERO_ID = "basic_commander_hero";
const BASIC_MOBILE_COMMANDER_HERO_ID = "basic_mobile_commander_hero";
const BASIC_DURABLE_COMMANDER_HERO_ID = "basic_durable_commander_hero";
const BASIC_TARGETED_HERO_ABILITY_ID = "basic_targeted_hero_ability";
const BASIC_HERO_SKILL_TREE_ID = "basic_hero_skill_tree";
const BASIC_PASSIVE_HERO_AURA_ID = "basic_passive_hero_aura";
const BASIC_DYNAMIC_HERO_BLOCKING_ID = "basic_dynamic_hero_blocking";
const BASIC_POWER_GRID_ID = "basic_power_grid";
const BASIC_LOCAL_AMMUNITION_ID = "basic_local_ammunition";
const BASIC_FACTORY_AMMUNITION_SUPPLY_ID = "basic_factory_ammunition_supply";
const BASIC_ADAPTIVE_WAVE_DIRECTOR_ID = "basic_adaptive_wave_director";
const BASIC_PROCEDURAL_QUESTS_ID = "basic_procedural_quests";
const BASIC_TARGETABLE_BOSS_COMPONENTS_ID = "basic_targetable_boss_components";
const BASIC_LOCAL_COOP_ID = "basic_local_coop";
const BASIC_PARTITIONED_LOCAL_COOP_ID = "basic_partitioned_local_coop";
const BASIC_ASYMMETRIC_SEND_VS_BUILD_ID = "basic_asymmetric_send_vs_build";
const TERRAFORMING_RECIPE_IDS = Object.freeze([
  TAGGED_FLOOD_ID,
  TAGGED_MOAT_ID,
  TAGGED_DESTRUCTIBLE_BRIDGE_ID
]);
const TERRAFORMING_DEFAULT_TRANSITION_IDS = Object.freeze({
  [TAGGED_FLOOD_ID]: "flood",
  [TAGGED_MOAT_ID]: "moat",
  [TAGGED_DESTRUCTIBLE_BRIDGE_ID]: "destroy_bridge"
});
const TERRAFORMING_PARAMETER_SCHEMA = Object.freeze({
  type: "object",
  required: Object.freeze(["sourceTerrainTag", "destinationTerrainId"]),
  additionalProperties: false,
  properties: Object.freeze({
    sourceTerrainTag: Object.freeze({ type: "string", minLength: 1, maxUtf8Bytes: 128 }),
    destinationTerrainId: Object.freeze({ type: "string", minLength: 1, maxUtf8Bytes: 128 }),
    transitionId: Object.freeze({ type: "string", minLength: 1, maxUtf8Bytes: 128 })
  })
});
const ROGUELITE_TOWER_TAG_PARAMETER_SCHEMA = Object.freeze({
  type: "object",
  required: Object.freeze(["towerTypeIds"]),
  additionalProperties: false,
  properties: Object.freeze({
    towerTypeIds: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: 16,
      uniqueItems: true,
      items: Object.freeze({ type: "string", minLength: 1, maxUtf8Bytes: 128 })
    })
  })
});
const ROGUELITE_ARTIFACT_PARAMETER_SCHEMA = Object.freeze({
  type: "object",
  required: Object.freeze(["towerTypeIds", "bossEnemyTypeId"]),
  additionalProperties: false,
  properties: Object.freeze({
    towerTypeIds: ROGUELITE_TOWER_TAG_PARAMETER_SCHEMA.properties.towerTypeIds,
    bossEnemyTypeId: Object.freeze({ type: "string", minLength: 1, maxUtf8Bytes: 128 })
  })
});
const LOGISTICS_POWER_PARAMETER_SCHEMA = Object.freeze({
  type: "object",
  required: Object.freeze(["generatorTowerTypeId", "relayTowerTypeId", "consumerTowerTypeId"]),
  additionalProperties: false,
  properties: Object.freeze({
    generatorTowerTypeId: Object.freeze({ type: "string", minLength: 1, maxUtf8Bytes: 128 }),
    relayTowerTypeId: Object.freeze({ type: "string", minLength: 1, maxUtf8Bytes: 128 }),
    consumerTowerTypeId: Object.freeze({ type: "string", minLength: 1, maxUtf8Bytes: 128 })
  })
});
const LOGISTICS_AMMUNITION_PARAMETER_SCHEMA = Object.freeze({
  type: "object",
  required: Object.freeze([
    "consumerTowerTypeId", "ammoTypeId", "ammoLabel", "capacity",
    "startingAmount", "consumptionPerActivation"
  ]),
  additionalProperties: false,
  properties: Object.freeze({
    consumerTowerTypeId: Object.freeze({ type: "string", minLength: 1, maxUtf8Bytes: 128 }),
    ammoTypeId: Object.freeze({ type: "string", minLength: 1, maxUtf8Bytes: 128 }),
    ammoLabel: Object.freeze({ type: "string", minLength: 1, maxUtf8Bytes: 128 }),
    capacity: Object.freeze({ type: "integer", minimum: 1, maximum: 1_000_000_000 }),
    startingAmount: Object.freeze({ type: "integer", minimum: 0, maximum: 1_000_000_000 }),
    consumptionPerActivation: Object.freeze({ type: "integer", minimum: 1, maximum: 1_000_000_000 })
  })
});
const LOGISTICS_SUPPLY_PARAMETER_NAMES = Object.freeze([
  "producerTowerTypeId", "storageTowerTypeId", "consumerTowerTypeId", "ammoTypeId", "ammoLabel",
  "productionRecipeId", "productionRecipeLabel", "consumerCapacity", "consumerStartingAmount",
  "consumptionPerActivation", "outputAmount", "productionInterval", "producerCapacity",
  "producerStartingAmount", "producerTransferRadius", "producerTransferAmount", "producerTransferInterval",
  "storageCapacity", "storageStartingAmount", "storageTransferRadius", "storageTransferAmount",
  "storageTransferInterval"
]);
const LOGISTICS_SUPPLY_PARAMETER_SCHEMA = Object.freeze({
  type: "object",
  required: LOGISTICS_SUPPLY_PARAMETER_NAMES,
  additionalProperties: false,
  properties: Object.freeze(Object.fromEntries(LOGISTICS_SUPPLY_PARAMETER_NAMES.map((name) => {
    if (["producerTowerTypeId", "storageTowerTypeId", "consumerTowerTypeId", "ammoTypeId", "ammoLabel",
      "productionRecipeId", "productionRecipeLabel"].includes(name)) {
      return [name, Object.freeze({ type: "string", minLength: 1, maxUtf8Bytes: 128 })];
    }
    if (["productionInterval", "producerTransferInterval", "storageTransferInterval"].includes(name)) {
      return [name, Object.freeze({ type: "number", minimum: 0.2, maximum: 1_000_000 })];
    }
    if (["producerTransferRadius", "storageTransferRadius"].includes(name)) {
      return [name, Object.freeze({ type: "integer", minimum: 0, maximum: 64 })];
    }
    return [name, Object.freeze({
      type: "integer",
      minimum: name.endsWith("StartingAmount") ? 0 : 1,
      maximum: 1_000_000_000
    })];
  })))
});
export class MechanicsRecipeParameterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MechanicsRecipeParameterError";
    this.code = code;
  }
}
const BASIC_SHIELD = Object.freeze({
  capacity: 25,
  regeneration: Object.freeze({ ratePerUnit: 1, delayAfterDamage: 3 })
});

const RECIPES = Object.freeze([
  Object.freeze({
    id: BASIC_REGENERATING_SHIELDS_ID,
    label: "Basic Regenerating Shields",
    description: "Opt-in combat profile with a 25-point shield that regenerates after a short delay.",
    suggestedId: BASIC_REGENERATING_SHIELDS_ID,
    moduleSchemaVersion: 1
  }),
  Object.freeze({
    id: BASIC_ELEMENTAL_ARMOR_MATRIX_ID,
    label: "Basic Elemental Armor Matrix",
    description: "Opt-in combat v2 profile with physical, magic, fire, ice, and lightning damage interactions.",
    suggestedId: BASIC_ELEMENTAL_ARMOR_MATRIX_ID,
    moduleSchemaVersion: 2
  }),
  Object.freeze({
    id: BASIC_VULNERABILITY_MARKS_ID,
    label: "Basic Vulnerability Marks",
    description: "Opt-in combat v3 profile that applies a bounded, consumable vulnerability mark from one authored tower type.",
    suggestedId: BASIC_VULNERABILITY_MARKS_ID,
    moduleSchemaVersion: 3
  }),
  Object.freeze({
    id: ELEMENTAL_SHATTER_ID,
    label: "Elemental Shatter",
    description: "Directional fire/ice exposures that consume the opposite exposure and deal a bounded physical critical hit.",
    suggestedId: ELEMENTAL_SHATTER_ID,
    moduleSchemaVersion: 1
  }),
  Object.freeze({
    id: WET_CHAIN_SHOCK_ID,
    label: "Wet Chain Shock",
    description: "Lightning on authored wet terrain fans out to a bounded set of other wet-tile enemies.",
    suggestedId: WET_CHAIN_SHOCK_ID,
    moduleSchemaVersion: 1
  }),
  Object.freeze({
    id: POISON_COMBUSTION_ID,
    label: "Poison Combustion",
    description: "Fire consumes the authored poison status and deals a bounded radius explosion.",
    suggestedId: POISON_COMBUSTION_ID,
    moduleSchemaVersion: 1
  }),
  Object.freeze({
    id: BASIC_DYNAMIC_NAVIGATION_ID,
    label: "Basic Dynamic Navigation",
    description: "Opt-in dynamic-flow profile with independent ground, floating, burrowing, and flying movement presets.",
    suggestedId: BASIC_DYNAMIC_NAVIGATION_ID,
    moduleSchemaVersion: 1
  }),
  Object.freeze({
    id: BASIC_AUTHORED_ELEVATION_ID,
    moduleId: "elevation",
    label: "Basic Authored Elevation",
    description: "Opt-in elevation profile for sparse, author-defined tile levels.",
    suggestedId: BASIC_AUTHORED_ELEVATION_ID,
    moduleSchemaVersion: 1
  }),
  Object.freeze({
    id: BASIC_ELEVATION_LINE_OF_SIGHT_ID,
    moduleId: "elevation",
    label: "Basic Elevation Line of Sight",
    description: "Opt-in elevation v2 profile with deterministic terrain-tag line-of-sight blockers.",
    suggestedId: BASIC_ELEVATION_LINE_OF_SIGHT_ID,
    moduleSchemaVersion: 2
  }),
  Object.freeze({
    id: BASIC_ELEVATION_HIGH_GROUND_ID,
    moduleId: "elevation",
    label: "Basic Elevation High Ground",
    description: "Opt-in elevation v3 profile with bounded pairwise range and immediate tower-damage bonuses.",
    suggestedId: BASIC_ELEVATION_HIGH_GROUND_ID,
    moduleSchemaVersion: 3
  }),
  Object.freeze({
    id: BASIC_DISPLACEMENT_PHYSICS_ID,
    moduleId: "physics",
    label: "Basic Displacement Physics",
    description: "Empty opt-in physics v1 profile for bounded tile push and pull effects.",
    suggestedId: BASIC_DISPLACEMENT_PHYSICS_ID,
    moduleSchemaVersion: 1
  }),
  Object.freeze({
    id: TAGGED_FALL_HAZARDS_ID,
    moduleId: "physics",
    label: "Tagged Fall Hazards",
    description: "Opt-in physics v1 profile that treats the authored fall_hazard terrain tag as a terminal chasm.",
    suggestedId: TAGGED_FALL_HAZARDS_ID,
    moduleSchemaVersion: 1
  }),
  Object.freeze({
    id: TAGGED_FLOOD_ID,
    moduleId: "terraforming",
    label: "Tagged Flood",
    description: "Inert opt-in terrain transition from one authored source tag to one authored destination terrain.",
    suggestedId: TAGGED_FLOOD_ID,
    moduleSchemaVersion: 1,
    parameterSchema: TERRAFORMING_PARAMETER_SCHEMA
  }),
  Object.freeze({
    id: TAGGED_MOAT_ID,
    moduleId: "terraforming",
    label: "Tagged Moat",
    description: "Inert opt-in moat transition bound only to author-selected terrain content.",
    suggestedId: TAGGED_MOAT_ID,
    moduleSchemaVersion: 1,
    parameterSchema: TERRAFORMING_PARAMETER_SCHEMA
  }),
  Object.freeze({
    id: TAGGED_DESTRUCTIBLE_BRIDGE_ID,
    moduleId: "terraforming",
    label: "Tagged Destructible Bridge",
    description: "Inert opt-in bridge destruction transition bound only to author-selected terrain content.",
    suggestedId: TAGGED_DESTRUCTIBLE_BRIDGE_ID,
    moduleSchemaVersion: 1,
    parameterSchema: TERRAFORMING_PARAMETER_SCHEMA
  }),
  Object.freeze({
    id: BASIC_ELEMENTAL_SYNERGY_ID,
    moduleId: "roguelite",
    label: "Basic Elemental Synergy",
    description: "Inert roguelite v1 profile with highest-tier 2/4/6 elemental tower damage bonuses.",
    suggestedId: BASIC_ELEMENTAL_SYNERGY_ID,
    moduleSchemaVersion: 1,
    parameterSchema: ROGUELITE_TOWER_TAG_PARAMETER_SCHEMA
  }),
  Object.freeze({
    id: BASIC_BOSS_ARTIFACT_LOOT_ID,
    moduleId: "roguelite",
    label: "Basic Boss Artifact Loot",
    description: "Inert roguelite v2 profile with typed tower slots and one deterministic boss artifact drop.",
    suggestedId: BASIC_BOSS_ARTIFACT_LOOT_ID,
    moduleSchemaVersion: 2,
    parameterSchema: ROGUELITE_ARTIFACT_PARAMETER_SCHEMA
  }),
  Object.freeze({
    id: BASIC_COMMANDER_HERO_ID,
    moduleId: "heroes",
    label: "Basic Commander Hero",
    description: "Inert heroes v1 profile with one static commander spawned at the authored mission core.",
    suggestedId: BASIC_COMMANDER_HERO_ID,
    moduleSchemaVersion: 1
  }),
  Object.freeze({
    id: BASIC_MOBILE_COMMANDER_HERO_ID,
    moduleId: "heroes",
    label: "Basic Mobile Commander Hero",
    description: "Inert heroes v2 profile with one commander and a heroes-owned deterministic ground movement profile.",
    suggestedId: BASIC_MOBILE_COMMANDER_HERO_ID,
    moduleSchemaVersion: 2
  }),
  Object.freeze({
    id: BASIC_DURABLE_COMMANDER_HERO_ID,
    moduleId: "heroes",
    label: "Basic Durable Commander Hero",
    description: "Inert heroes v3 profile with deterministic movement, bounded HP, and an optional absorb-first shield.",
    suggestedId: BASIC_DURABLE_COMMANDER_HERO_ID,
    moduleSchemaVersion: 3
  }),
  Object.freeze({
    id: BASIC_TARGETED_HERO_ABILITY_ID,
    moduleId: "heroes",
    label: "Basic Targeted Hero Ability",
    description: "Inert heroes v4 profile with bounded mana and one deterministic enemy-targeted damage ability.",
    suggestedId: BASIC_TARGETED_HERO_ABILITY_ID,
    moduleSchemaVersion: 4
  }),
  Object.freeze({
    id: BASIC_HERO_SKILL_TREE_ID,
    moduleId: "heroes",
    label: "Basic Hero Skill Tree",
    description: "Inert heroes v5 profile with a battle-local deterministic active-ability damage skill tree.",
    suggestedId: BASIC_HERO_SKILL_TREE_ID,
    moduleSchemaVersion: 5
  }),
  Object.freeze({
    id: BASIC_PASSIVE_HERO_AURA_ID,
    moduleId: "heroes",
    label: "Basic Passive Hero Aura",
    description: "Inert heroes v6 profile with a tower-damage aura whose membership is engine-owned.",
    suggestedId: BASIC_PASSIVE_HERO_AURA_ID,
    moduleSchemaVersion: 6
  }),
  Object.freeze({
    id: BASIC_DYNAMIC_HERO_BLOCKING_ID,
    moduleId: "heroes",
    label: "Basic Dynamic Hero Blocking",
    description: "Inert heroes v7 profile that holds only explicitly authored dynamic-navigation movement profiles.",
    suggestedId: BASIC_DYNAMIC_HERO_BLOCKING_ID,
    moduleSchemaVersion: 7
  }),
  Object.freeze({
    id: BASIC_POWER_GRID_ID,
    moduleId: "logistics",
    label: "Basic Power Grid",
    description: "Inert logistics v1 profile with one explicit generator, relay, and fire-capable consumer.",
    suggestedId: BASIC_POWER_GRID_ID,
    moduleSchemaVersion: 1,
    parameterSchema: LOGISTICS_POWER_PARAMETER_SCHEMA
  }),
  Object.freeze({
    id: BASIC_LOCAL_AMMUNITION_ID,
    moduleId: "logistics",
    label: "Basic Local Ammunition",
    description: "Inert logistics v2 profile with one finite local magazine for a fire-capable tower.",
    suggestedId: BASIC_LOCAL_AMMUNITION_ID,
    moduleSchemaVersion: 2,
    parameterSchema: LOGISTICS_AMMUNITION_PARAMETER_SCHEMA
  }),
  Object.freeze({
    id: BASIC_FACTORY_AMMUNITION_SUPPLY_ID,
    moduleId: "logistics",
    label: "Basic Factory Ammunition Supply",
    description: "Inert logistics v3 profile with one producer, storage, and refillable fire-capable consumer.",
    suggestedId: BASIC_FACTORY_AMMUNITION_SUPPLY_ID,
    moduleSchemaVersion: 3,
    parameterSchema: LOGISTICS_SUPPLY_PARAMETER_SCHEMA
  }),
  Object.freeze({
    id: BASIC_ADAPTIVE_WAVE_DIRECTOR_ID,
    moduleId: "director",
    label: "Basic Adaptive Wave Director",
    description: "Opt-in deterministic Director v1 profile that selects only from one authored counter pool.",
    suggestedId: BASIC_ADAPTIVE_WAVE_DIRECTOR_ID,
    moduleSchemaVersion: 1
  }),
  Object.freeze({
    id: BASIC_PROCEDURAL_QUESTS_ID,
    moduleId: "quests",
    label: "Basic Procedural Quests",
    description: "Inert quests v1 profile that selects seeded source-specific battle challenges.",
    suggestedId: BASIC_PROCEDURAL_QUESTS_ID,
    moduleSchemaVersion: 1
  }),
  Object.freeze({
    id: BASIC_TARGETABLE_BOSS_COMPONENTS_ID,
    moduleId: "enemyBehaviors",
    label: "Basic Targetable Boss Components",
    description: "Inert enemyBehaviors v1 profile with one targetable component and one deterministic tower priority binding.",
    suggestedId: BASIC_TARGETABLE_BOSS_COMPONENTS_ID,
    moduleSchemaVersion: 1
  }),
  Object.freeze({
    id: BASIC_LOCAL_COOP_ID,
    moduleId: "multiplayer",
    label: "Basic Local Co-op",
    description: "Opt-in deterministic local co-op v1 profile with shared resources and routes.",
    suggestedId: BASIC_LOCAL_COOP_ID,
    moduleSchemaVersion: 1
  }),
  Object.freeze({
    id: BASIC_PARTITIONED_LOCAL_COOP_ID,
    moduleId: "multiplayer",
    label: "Basic Partitioned Local Co-op",
    description: "Opt-in deterministic local co-op v1 profile with per-player resources and shared authored routes.",
    suggestedId: BASIC_PARTITIONED_LOCAL_COOP_ID,
    moduleSchemaVersion: 1
  }),
  Object.freeze({
    id: BASIC_ASYMMETRIC_SEND_VS_BUILD_ID,
    moduleId: "multiplayer",
    label: "Basic Asymmetric Send vs Build",
    description: "Opt-in deterministic asymmetric v2 profile with one project-bound authored enemy send.",
    suggestedId: BASIC_ASYMMETRIC_SEND_VS_BUILD_ID,
    moduleSchemaVersion: 2
  })
]);

export function listMechanicsRecipes() {
  return RECIPES.map((recipe) => ({ ...recipe }));
}

/**
 * Materialize a recipe against explicit project entities. We intentionally choose at most one
 * deterministic target of each kind: applying a recipe must not silently opt every future entity
 * into the mechanic. Authors can add more rows in Mechanics Hub or through the guarded tool.
 */
export function materializeMechanicsRecipe(recipeId, context = {}) {
  const recipe = RECIPES.find((candidate) => candidate.id === recipeId);
  if (!recipe) throw new Error(`Unknown mechanics recipe "${recipeId}".`);

  const parameterField = inspectParameterField(context);
  if (recipeId === BASIC_ELEMENTAL_SYNERGY_ID) {
    if (parameterField.kind === "absent") {
      throw new MechanicsRecipeParameterError(
        "roguelite_recipe_parameters_required",
        "Roguelite recipe parameters are required and must contain towerTypeIds."
      );
    }
    if (parameterField.kind === "invalid") {
      throw invalidRogueliteRecipeParameter("Roguelite recipe parameters must be an enumerable own data field.");
    }
    return materializeElementalSynergyRecipe(recipe, context, parameterField.value);
  }
  if (recipeId === BASIC_BOSS_ARTIFACT_LOOT_ID) {
    if (parameterField.kind === "absent") {
      throw new MechanicsRecipeParameterError(
        "roguelite_recipe_parameters_required",
        "Artifact recipe parameters are required and must contain towerTypeIds and bossEnemyTypeId."
      );
    }
    if (parameterField.kind === "invalid") {
      throw invalidRogueliteRecipeParameter("Artifact recipe parameters must be enumerable own data.");
    }
    return materializeBossArtifactRecipe(recipe, context, parameterField.value);
  }
  if (TERRAFORMING_RECIPE_IDS.includes(recipeId)) {
    if (parameterField.kind === "absent") {
      throw new MechanicsRecipeParameterError(
        "terraform_recipe_parameters_required",
        "Terraforming recipe parameters are required and must be a closed object."
      );
    }
    if (parameterField.kind === "invalid") {
      throw invalidTerraformingRecipeParameter("Terraforming recipe parameters must be an enumerable own data field.");
    }
    return materializeTerraformingRecipe(recipe, context, parameterField.value);
  }
  if (recipeId === BASIC_POWER_GRID_ID) {
    if (parameterField.kind === "absent") {
      throw invalidLogisticsRecipeParameter(
        "Logistics recipe parameters are required and must name generator, relay, and consumer tower roles."
      );
    }
    if (parameterField.kind === "invalid") {
      throw invalidLogisticsRecipeParameter("Logistics recipe parameters must be enumerable own data.");
    }
    return materializePowerGridRecipe(recipe, context, parameterField.value);
  }
  if (recipeId === BASIC_LOCAL_AMMUNITION_ID) {
    if (parameterField.kind === "absent") {
      throw invalidLogisticsRecipeParameter(
        "Local ammunition recipe parameters are required and must define one finite magazine."
      );
    }
    if (parameterField.kind === "invalid") {
      throw invalidLogisticsRecipeParameter("Local ammunition recipe parameters must be enumerable own data.");
    }
    return materializeLocalAmmunitionRecipe(recipe, context, parameterField.value);
  }
  if (recipeId === BASIC_FACTORY_AMMUNITION_SUPPLY_ID) {
    if (parameterField.kind === "absent") {
      throw invalidLogisticsRecipeParameter(
        "Factory ammunition supply recipe parameters are required and must define three distinct tower roles."
      );
    }
    if (parameterField.kind === "invalid") {
      throw invalidLogisticsRecipeParameter("Factory ammunition supply parameters must be enumerable own data.");
    }
    return materializeFactoryAmmunitionSupplyRecipe(recipe, context, parameterField.value);
  }
  if (parameterField.kind !== "absent") {
    throw new MechanicsRecipeParameterError(
      "terraform_recipe_parameter_invalid",
      `Mechanics recipe "${recipeId}" does not accept parameters.`
    );
  }

  const missionId = chooseId(context.defaultMissionId, context.missionIds);
  if ([ELEMENTAL_SHATTER_ID, WET_CHAIN_SHOCK_ID, POISON_COMBUSTION_ID].includes(recipeId)) {
    return materializeReactionRecipe(recipe, missionId, context);
  }
  if (recipeId === BASIC_DYNAMIC_NAVIGATION_ID) {
    return materializeDynamicNavigationRecipe(recipe, missionId);
  }
  if (recipeId === BASIC_ADAPTIVE_WAVE_DIRECTOR_ID) {
    const counterEnemyId = chooseId("armored_brute", context.enemyIds) ?? "";
    return {
      ...recipe,
      entity: {
        moduleId: "director",
        moduleSchemaVersion: 1,
        missionId: missionId ?? "",
        profileId: recipe.suggestedId,
        profile: {
          counterPool: {
            dominant_damage_guard: {
              label: "Dominant damage guard",
              priority: 100,
              conditions: [{
                metric: "damage_share",
                key: "physical",
                operator: "gte",
                threshold: 0.6
              }],
              groups: [{
                enemyId: counterEnemyId,
                count: 2,
                spawnInterval: 0.75,
                startDelay: 0
              }],
              threatCost: 8
            }
          },
          threatBudget: { base: 10, perWave: 5 },
          fairness: {
            minimumWaveIndex: 1,
            maxConsecutiveUses: 1,
            maxAddedGroups: 2,
            maxAddedEnemies: 8
          }
        }
      }
    };
  }
  if (recipeId === BASIC_PROCEDURAL_QUESTS_ID) {
    const towerTypeId = chooseId(undefined, context.missionDamagingTowerIds);
    const abilityId = chooseId(undefined, context.missionDamagingAbilityIds);
    if (towerTypeId === undefined && abilityId === undefined) {
      throw new MechanicsRecipeParameterError(
        "quest_recipe_source_unavailable",
        "Basic procedural quests require at least one damaging tower or damaging authored ability in the selected mission."
      );
    }
    const definitions = {
      ...(towerTypeId === undefined ? {} : { tower_finisher: {
        label: "Tower finisher",
        weight: 1,
        objective: { kind: "kill_with_source", count: 10, source: { kind: "tower", id: towerTypeId } }
      } }),
      ...(abilityId === undefined ? {} : {
        ability_finisher: {
          label: "Ability finisher",
          weight: 1,
          objective: { kind: "kill_with_source", count: 5, source: { kind: "ability", id: abilityId } }
        }
      })
    };
    return {
      ...recipe,
      entity: {
        moduleId: "quests",
        moduleSchemaVersion: 1,
        missionId: missionId ?? "",
        profileId: recipe.suggestedId,
        profile: {
          selectionCount: Math.min(2, Object.keys(definitions).length),
          definitions
        }
      }
    };
  }
  if (recipeId === BASIC_TARGETABLE_BOSS_COMPONENTS_ID) {
    const bossEnemyTypeId = firstSafeId(context.enemyIds);
    if (bossEnemyTypeId === undefined) {
      throw new MechanicsRecipeParameterError(
        "enemy_behaviors_recipe_context_required",
        "Basic targetable boss components require at least one authored enemy in the project."
      );
    }
    const towerTypeId = firstSafeId(context.towerIds);
    const bosses = safeRecord();
    const components = safeRecord();
    defineOwn(components, "core", {
      maxHp: 20,
      hitRegion: { kind: "circle", offsetX: 0, offsetY: 0, radius: 0.25 },
      tags: ["core"]
    });
    defineOwn(bosses, bossEnemyTypeId, { components });
    const profile = { bosses };
    if (towerTypeId !== undefined) {
      const towers = safeRecord();
      defineOwn(towers, towerTypeId, { priorityTags: ["core"] });
      profile.targeting = { towers };
    }
    return {
      ...recipe,
      entity: {
        moduleId: "enemyBehaviors",
        moduleSchemaVersion: 1,
        missionId: missionId ?? "",
        profileId: recipe.suggestedId,
        profile
      }
    };
  }
  if (recipeId === BASIC_LOCAL_COOP_ID) {
    return {
      ...recipe,
      entity: {
        moduleId: "multiplayer",
        moduleSchemaVersion: 1,
        missionId: missionId ?? "",
        profileId: recipe.suggestedId,
        profile: {
          mode: "local_coop",
          fixedTickUnits: 1,
          maxPlayers: 4,
          ownership: { towerControl: "shared", resources: "shared", routes: "shared" }
        }
      }
    };
  }
  if (recipeId === BASIC_PARTITIONED_LOCAL_COOP_ID) {
    return {
      ...recipe,
      entity: {
        moduleId: "multiplayer",
        moduleSchemaVersion: 1,
        missionId: missionId ?? "",
        profileId: recipe.suggestedId,
        profile: {
          mode: "local_coop",
          fixedTickUnits: 1,
          maxPlayers: 4,
          ownership: { towerControl: "owner_only", resources: "partitioned", routes: "shared" }
        }
      }
    };
  }
  if (recipeId === BASIC_ASYMMETRIC_SEND_VS_BUILD_ID) {
    const enemyTypeId = chooseId("armored_brute", context.enemyIds) ?? "";
    return {
      ...recipe,
      entity: {
        moduleId: "multiplayer",
        moduleSchemaVersion: 2,
        missionId: missionId ?? "",
        profileId: recipe.suggestedId,
        profile: {
          mode: "asymmetric_send_vs_build",
          fixedTickUnits: 1,
          maxPlayers: 2,
          ownership: { towerControl: "owner_only", resources: "partitioned", routes: "partitioned" },
          sendPool: {
            basic_send: {
              enemyTypeId,
              cost: { coins: 10 },
              income: { coins: 1 },
              spawnDelayUnits: 0
            }
          }
        }
      }
    };
  }
  if (recipeId === BASIC_COMMANDER_HERO_ID) {
    return {
      ...recipe,
      entity: {
        moduleId: "heroes",
        moduleSchemaVersion: 1,
        missionId: missionId ?? "",
        profileId: recipe.suggestedId,
        profile: {
          selectedHeroId: "commander",
          definitions: {
            commander: { label: "Commander", spawn: "core" }
          }
        }
      }
    };
  }
  if (recipeId === BASIC_MOBILE_COMMANDER_HERO_ID) {
    return {
      ...recipe,
      entity: {
        moduleId: "heroes",
        moduleSchemaVersion: 2,
        missionId: missionId ?? "",
        profileId: recipe.suggestedId,
        profile: {
          selectedHeroId: "commander",
          definitions: {
            commander: {
              label: "Commander",
              spawn: "core",
              movement: { movementProfileId: "ground", speed: 1 }
            }
          },
          movementProfiles: {
            ground: {
              label: "Ground",
              terrainMode: "respect_walkable",
              towerOccupancy: "blocked",
              defaultTerrainCost: 1_000
            }
          }
        }
      }
    };
  }
  if (recipeId === BASIC_DURABLE_COMMANDER_HERO_ID) {
    return {
      ...recipe,
      entity: {
        moduleId: "heroes",
        moduleSchemaVersion: 3,
        missionId: missionId ?? "",
        profileId: recipe.suggestedId,
        profile: {
          selectedHeroId: "commander",
          definitions: {
            commander: {
              label: "Commander",
              spawn: "core",
              movement: { movementProfileId: "ground", speed: 1 },
              durability: { maxHp: 100, shield: { capacity: 25 } }
            }
          },
          movementProfiles: {
            ground: {
              label: "Ground",
              terrainMode: "respect_walkable",
              towerOccupancy: "blocked",
              defaultTerrainCost: 1_000
            }
          }
        }
      }
    };
  }
  if (recipeId === BASIC_TARGETED_HERO_ABILITY_ID) {
    return {
      ...recipe,
      entity: {
        moduleId: "heroes",
        moduleSchemaVersion: 4,
        missionId: missionId ?? "",
        profileId: recipe.suggestedId,
        profile: {
          selectedHeroId: "commander",
          definitions: {
            commander: {
              label: "Commander",
              spawn: "core",
              movement: { movementProfileId: "ground", speed: 1 },
              durability: { maxHp: 100, shield: { capacity: 25 } },
              mana: { max: 100, starting: 60, regenerationPerUnit: 5 },
              activeAbility: {
                id: "arc_bolt",
                label: "Arc Bolt",
                target: "enemy",
                manaCost: 20,
                cooldown: 3,
                range: 6,
                damage: 30
              }
            }
          },
          movementProfiles: {
            ground: {
              label: "Ground",
              terrainMode: "respect_walkable",
              towerOccupancy: "blocked",
              defaultTerrainCost: 1_000
            }
          }
        }
      }
    };
  }
  if (recipeId === BASIC_HERO_SKILL_TREE_ID) {
    return {
      ...recipe,
      entity: {
        moduleId: "heroes",
        moduleSchemaVersion: 5,
        missionId: missionId ?? "",
        profileId: recipe.suggestedId,
        profile: {
          selectedHeroId: "commander",
          definitions: {
            commander: {
              label: "Commander",
              spawn: "core",
              movement: { movementProfileId: "ground", speed: 1 },
              durability: { maxHp: 100, shield: { capacity: 25 } },
              mana: { max: 100, starting: 60, regenerationPerUnit: 5 },
              activeAbility: {
                id: "arc_bolt",
                label: "Arc Bolt",
                target: "enemy",
                manaCost: 20,
                cooldown: 3,
                range: 6,
                damage: 30
              },
              skillTree: {
                points: { starting: 1, perInterwave: 1 },
                nodes: {
                  focused_cast: {
                    label: "Focused Cast",
                    description: "Increase active ability damage by twenty-five percent.",
                    cost: 1,
                    requires: [],
                    effects: [{
                      kind: "modifier",
                      scope: "hero_ability_damage",
                      modifier: { target: "damage", operation: "multiplier", value: 1.25 }
                    }]
                  },
                  overcharge: {
                    label: "Overcharge",
                    description: "Add ten damage after Focused Cast is unlocked.",
                    cost: 1,
                    requires: ["focused_cast"],
                    effects: [{
                      kind: "modifier",
                      scope: "hero_ability_damage",
                      modifier: { target: "damage", operation: "flat", value: 10 }
                    }]
                  }
                }
              }
            }
          },
          movementProfiles: {
            ground: {
              label: "Ground",
              terrainMode: "respect_walkable",
              towerOccupancy: "blocked",
              defaultTerrainCost: 1_000
            }
          }
        }
      }
    };
  }
  if (recipeId === BASIC_PASSIVE_HERO_AURA_ID) {
    return {
      ...recipe,
      entity: {
        moduleId: "heroes",
        moduleSchemaVersion: 6,
        missionId: missionId ?? "",
        profileId: recipe.suggestedId,
        profile: {
          selectedHeroId: "commander",
          definitions: {
            commander: {
              label: "Aura Commander",
              spawn: "core",
              movement: { movementProfileId: "ground", speed: 1 },
              durability: { maxHp: 100, shield: { capacity: 25 } },
              mana: { max: 100, starting: 60, regenerationPerUnit: 5 },
              activeAbility: {
                id: "arc_bolt",
                label: "Arc Bolt",
                target: "enemy",
                manaCost: 20,
                cooldown: 3,
                range: 6,
                damage: 30
              },
              skillTree: null,
              passiveAura: {
                id: "command_link",
                label: "Command Link",
                radius: 3,
                effects: [{
                  kind: "modifier",
                  scope: "tower_damage",
                  modifier: { target: "damage", operation: "additive_ratio", value: 0.2 }
                }]
              }
            }
          },
          movementProfiles: {
            ground: {
              label: "Ground",
              terrainMode: "respect_walkable",
              towerOccupancy: "blocked",
              defaultTerrainCost: 1_000
            }
          }
        }
      }
    };
  }
  if (recipeId === BASIC_DYNAMIC_HERO_BLOCKING_ID) {
    return {
      ...recipe,
      entity: {
        moduleId: "heroes",
        moduleSchemaVersion: 7,
        missionId: missionId ?? "",
        profileId: recipe.suggestedId,
        profile: {
          selectedHeroId: "commander",
          definitions: {
            commander: {
              label: "Blocking Commander",
              spawn: "core",
              movement: { movementProfileId: "hero_ground", speed: 1 },
              durability: { maxHp: 100, shield: { capacity: 25 } },
              mana: { max: 100, starting: 60, regenerationPerUnit: 5 },
              activeAbility: {
                id: "arc_bolt",
                label: "Arc Bolt",
                target: "enemy",
                manaCost: 20,
                cooldown: 3,
                range: 6,
                damage: 30
              },
              skillTree: null,
              passiveAura: null,
              blocking: { blockCapacity: 2, movementProfileIds: ["ground"] }
            }
          },
          movementProfiles: {
            hero_ground: {
              label: "Hero Ground",
              terrainMode: "respect_walkable",
              towerOccupancy: "blocked",
              defaultTerrainCost: 1_000
            }
          }
        }
      }
    };
  }
  if (recipeId === BASIC_AUTHORED_ELEVATION_ID) {
    return {
      ...recipe,
      entity: {
        moduleId: "elevation",
        moduleSchemaVersion: 1,
        missionId: missionId ?? "",
        profileId: recipe.suggestedId,
        profile: {}
      }
    };
  }
  if (recipeId === BASIC_ELEVATION_LINE_OF_SIGHT_ID) {
    const terrainTag = "opaque";
    const prerequisites = { terrainTags: [terrainTag] };
    const terrainTags = new Set(sortedSafeIds(ownDataValue(context, "terrainTags")));
    return {
      ...recipe,
      prerequisites,
      unmetPrerequisites: terrainTags.has(terrainTag)
        ? []
        : [{ code: "elevation_terrain_tag_missing", terrainTag }],
      entity: {
        moduleId: "elevation",
        moduleSchemaVersion: 2,
        missionId: missionId ?? "",
        profileId: recipe.suggestedId,
        profile: { lineOfSight: { terrainBlockerTags: [terrainTag] } }
      }
    };
  }
  if (recipeId === BASIC_ELEVATION_HIGH_GROUND_ID) {
    return {
      ...recipe,
      entity: {
        moduleId: "elevation",
        moduleSchemaVersion: 3,
        missionId: missionId ?? "",
        profileId: recipe.suggestedId,
        profile: {
          highGround: {
            maximumEffectiveElevationDelta: 3,
            rangeBonusPerElevation: 1,
            damageBonusBasisPointsPerElevation: 1_000
          }
        }
      }
    };
  }
  if (recipeId === BASIC_DISPLACEMENT_PHYSICS_ID || recipeId === TAGGED_FALL_HAZARDS_ID) {
    return {
      ...recipe,
      entity: {
        moduleId: "physics",
        moduleSchemaVersion: 1,
        missionId: missionId ?? "",
        profileId: recipe.suggestedId,
        profile: recipeId === TAGGED_FALL_HAZARDS_ID
          ? { fallHazardTerrainTags: ["fall_hazard"] }
          : {}
      }
    };
  }
  const moduleSchemaVersion = effectiveCombatModuleSchemaVersion(recipe.moduleSchemaVersion, context);
  if (recipeId === BASIC_ELEMENTAL_ARMOR_MATRIX_ID) {
    return materializeArmorRecipe(recipe, moduleSchemaVersion, missionId, context.enemyIds);
  }
  if (recipeId === BASIC_VULNERABILITY_MARKS_ID) {
    return materializeMarksRecipe(recipe, moduleSchemaVersion, missionId, context.towerIds);
  }
  const enemyId = firstSafeId(context.enemyIds);
  const towerId = firstSafeId(context.destructibleTowerIds);
  const enemies = safeRecord();
  const towers = safeRecord();
  if (enemyId !== undefined) defineOwn(enemies, enemyId, cloneShield());
  if (towerId !== undefined) defineOwn(towers, towerId, cloneShield());

  return {
    ...recipe,
    entity: {
      moduleId: "combat",
      moduleSchemaVersion,
      missionId: missionId ?? "",
      profileId: recipe.suggestedId,
      enabled: true,
      profile: { shields: { enemies, towers } }
    }
  };
}

function materializePowerGridRecipe(recipe, context, parameterValue) {
  const parameters = inspectLogisticsRecipeParameters(parameterValue);
  const generatorTowerTypeId = boundedLogisticsRecipeId(parameters.generatorTowerTypeId, "generatorTowerTypeId");
  const relayTowerTypeId = boundedLogisticsRecipeId(parameters.relayTowerTypeId, "relayTowerTypeId");
  const consumerTowerTypeId = boundedLogisticsRecipeId(parameters.consumerTowerTypeId, "consumerTowerTypeId");
  if (new Set([generatorTowerTypeId, relayTowerTypeId, consumerTowerTypeId]).size !== 3) {
    throw invalidLogisticsRecipeParameter("Logistics generator, relay, and consumer roles must use three distinct tower IDs.");
  }
  const towerIds = new Set(sortedSafeIds(ownDataValue(context, "towerIds")));
  for (const towerTypeId of [generatorTowerTypeId, relayTowerTypeId, consumerTowerTypeId]) {
    if (!towerIds.has(towerTypeId)) {
      throw invalidLogisticsRecipeParameter(`Logistics recipe references unknown authored tower "${towerTypeId}".`);
    }
  }
  const attackKinds = ownDataValue(context, "towerAttackKindsByTowerId");
  const consumerAttackKind = ownDataValue(attackKinds, consumerTowerTypeId);
  if (!["single", "pulse", "sniper", "antiair", "splash", "pipeline"].includes(consumerAttackKind)) {
    throw invalidLogisticsRecipeParameter(
      `Logistics consumer "${consumerTowerTypeId}" must use a fire-capable attack kind.`
    );
  }
  const generators = safeRecord();
  const relays = safeRecord();
  const consumers = safeRecord();
  defineOwn(generators, generatorTowerTypeId, { output: 20, linkRadius: 4, coverageRadius: 3 });
  defineOwn(relays, relayTowerTypeId, { linkRadius: 5, coverageRadius: 4 });
  defineOwn(consumers, consumerTowerTypeId, { demand: 8, priority: 10 });
  return {
    ...recipe,
    entity: {
      moduleId: "logistics",
      moduleSchemaVersion: 1,
      missionId: chooseId(context.defaultMissionId, context.missionIds) ?? "",
      profileId: recipe.suggestedId,
      profile: { power: { generators, relays, consumers } }
    }
  };
}

function materializeLocalAmmunitionRecipe(recipe, context, parameterValue) {
  const parameters = inspectLocalAmmunitionRecipeParameters(parameterValue);
  const consumerTowerTypeId = boundedLogisticsRecipeId(parameters.consumerTowerTypeId, "consumerTowerTypeId");
  const ammoTypeId = boundedLogisticsRecipeId(parameters.ammoTypeId, "ammoTypeId");
  const ammoLabel = boundedLogisticsRecipeId(parameters.ammoLabel, "ammoLabel");
  const towerIds = new Set(sortedSafeIds(ownDataValue(context, "towerIds")));
  if (!towerIds.has(consumerTowerTypeId)) {
    throw invalidLogisticsRecipeParameter(
      `Local ammunition recipe references unknown authored tower "${consumerTowerTypeId}".`
    );
  }
  const attackKind = ownDataValue(ownDataValue(context, "towerAttackKindsByTowerId"), consumerTowerTypeId);
  if (!["single", "pulse", "sniper", "antiair", "splash", "pipeline"].includes(attackKind)) {
    throw invalidLogisticsRecipeParameter(
      `Local ammunition consumer "${consumerTowerTypeId}" must use a fire-capable attack kind.`
    );
  }
  const capacity = boundedLogisticsRecipeInteger(parameters.capacity, "capacity", 1, 1_000_000_000);
  const consumptionPerActivation = boundedLogisticsRecipeInteger(
    parameters.consumptionPerActivation, "consumptionPerActivation", 1, capacity
  );
  const startingAmount = boundedLogisticsRecipeInteger(
    parameters.startingAmount, "startingAmount", 0, capacity
  );
  const types = safeRecord();
  const towerInventories = safeRecord();
  defineOwn(types, ammoTypeId, { label: ammoLabel });
  defineOwn(towerInventories, consumerTowerTypeId, {
    ammoTypeId, capacity, startingAmount, consumptionPerActivation
  });
  return {
    ...recipe,
    entity: {
      moduleId: "logistics",
      moduleSchemaVersion: 2,
      missionId: chooseId(context.defaultMissionId, context.missionIds) ?? "",
      profileId: recipe.suggestedId,
      profile: { power: null, ammunition: { types, towerInventories } }
    }
  };
}

function materializeFactoryAmmunitionSupplyRecipe(recipe, context, parameterValue) {
  const parameters = inspectFactoryAmmunitionSupplyParameters(parameterValue);
  const producerTowerTypeId = boundedLogisticsRecipeId(parameters.producerTowerTypeId, "producerTowerTypeId");
  const storageTowerTypeId = boundedLogisticsRecipeId(parameters.storageTowerTypeId, "storageTowerTypeId");
  const consumerTowerTypeId = boundedLogisticsRecipeId(parameters.consumerTowerTypeId, "consumerTowerTypeId");
  if (new Set([producerTowerTypeId, storageTowerTypeId, consumerTowerTypeId]).size !== 3) {
    throw invalidLogisticsRecipeParameter(
      "Factory ammunition supply producer, storage, and consumer roles must use three distinct tower IDs."
    );
  }
  const towerIds = new Set(sortedSafeIds(ownDataValue(context, "towerIds")));
  for (const towerTypeId of [producerTowerTypeId, storageTowerTypeId, consumerTowerTypeId]) {
    if (!towerIds.has(towerTypeId)) {
      throw invalidLogisticsRecipeParameter(
        `Factory ammunition supply recipe references unknown authored tower "${towerTypeId}".`
      );
    }
  }
  const attackKind = ownDataValue(ownDataValue(context, "towerAttackKindsByTowerId"), consumerTowerTypeId);
  if (!["single", "pulse", "sniper", "antiair", "splash", "pipeline"].includes(attackKind)) {
    throw invalidLogisticsRecipeParameter(
      `Factory ammunition supply consumer "${consumerTowerTypeId}" must use a fire-capable attack kind.`
    );
  }
  const ammoTypeId = boundedLogisticsRecipeId(parameters.ammoTypeId, "ammoTypeId");
  const ammoLabel = boundedLogisticsRecipeId(parameters.ammoLabel, "ammoLabel");
  const productionRecipeId = boundedLogisticsRecipeId(parameters.productionRecipeId, "productionRecipeId");
  const productionRecipeLabel = boundedLogisticsRecipeId(
    parameters.productionRecipeLabel, "productionRecipeLabel"
  );
  const consumerCapacity = boundedLogisticsRecipeInteger(
    parameters.consumerCapacity, "consumerCapacity", 1, 1_000_000_000
  );
  const consumerStartingAmount = boundedLogisticsRecipeInteger(
    parameters.consumerStartingAmount, "consumerStartingAmount", 0, consumerCapacity
  );
  const consumptionPerActivation = boundedLogisticsRecipeInteger(
    parameters.consumptionPerActivation, "consumptionPerActivation", 1, consumerCapacity
  );
  const producerCapacity = boundedLogisticsRecipeInteger(
    parameters.producerCapacity, "producerCapacity", 1, 1_000_000_000
  );
  const producerStartingAmount = boundedLogisticsRecipeInteger(
    parameters.producerStartingAmount, "producerStartingAmount", 0, producerCapacity
  );
  const outputAmount = boundedLogisticsRecipeInteger(
    parameters.outputAmount, "outputAmount", 1, producerCapacity
  );
  const producerTransferRadius = boundedLogisticsRecipeInteger(
    parameters.producerTransferRadius, "producerTransferRadius", 0, 64
  );
  const producerTransferAmount = boundedLogisticsRecipeInteger(
    parameters.producerTransferAmount, "producerTransferAmount", 1, producerCapacity
  );
  const productionInterval = boundedLogisticsRecipeNumber(
    parameters.productionInterval, "productionInterval", 0.2, 1_000_000
  );
  const producerTransferInterval = boundedLogisticsRecipeNumber(
    parameters.producerTransferInterval, "producerTransferInterval", 0.2, 1_000_000
  );
  const storageCapacity = boundedLogisticsRecipeInteger(
    parameters.storageCapacity, "storageCapacity", 1, 1_000_000_000
  );
  const storageStartingAmount = boundedLogisticsRecipeInteger(
    parameters.storageStartingAmount, "storageStartingAmount", 0, storageCapacity
  );
  const storageTransferRadius = boundedLogisticsRecipeInteger(
    parameters.storageTransferRadius, "storageTransferRadius", 0, 64
  );
  const storageTransferAmount = boundedLogisticsRecipeInteger(
    parameters.storageTransferAmount, "storageTransferAmount", 1, storageCapacity
  );
  const storageTransferInterval = boundedLogisticsRecipeNumber(
    parameters.storageTransferInterval, "storageTransferInterval", 0.2, 1_000_000
  );

  const types = safeRecord();
  const towerInventories = safeRecord();
  const productionRecipes = safeRecord();
  const producers = safeRecord();
  const storages = safeRecord();
  defineOwn(types, ammoTypeId, { label: ammoLabel });
  defineOwn(towerInventories, consumerTowerTypeId, {
    ammoTypeId, capacity: consumerCapacity, startingAmount: consumerStartingAmount,
    consumptionPerActivation
  });
  defineOwn(productionRecipes, productionRecipeId, {
    label: productionRecipeLabel, ammoTypeId, outputAmount, interval: productionInterval
  });
  defineOwn(producers, producerTowerTypeId, {
    recipeId: productionRecipeId, capacity: producerCapacity, startingAmount: producerStartingAmount,
    transferRadius: producerTransferRadius, transferAmount: producerTransferAmount,
    transferInterval: producerTransferInterval
  });
  defineOwn(storages, storageTowerTypeId, {
    ammoTypeId, capacity: storageCapacity, startingAmount: storageStartingAmount,
    transferRadius: storageTransferRadius, transferAmount: storageTransferAmount,
    transferInterval: storageTransferInterval
  });
  const { description: _description, ...inertRecipe } = recipe;
  return {
    ...inertRecipe,
    entity: {
      moduleId: "logistics",
      moduleSchemaVersion: 3,
      missionId: chooseId(context.defaultMissionId, context.missionIds) ?? "",
      profileId: recipe.suggestedId,
      profile: {
        power: null,
        ammunition: { types, towerInventories },
        supply: { productionRecipes, producers, storages }
      }
    }
  };
}

function inspectLogisticsRecipeParameters(value) {
  if (!isPlainRecord(value)) {
    throw invalidLogisticsRecipeParameter("Logistics recipe parameters must be a closed ordinary object.");
  }
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw invalidLogisticsRecipeParameter("Logistics recipe parameters could not be inspected safely.");
  }
  const allowed = ["generatorTowerTypeId", "relayTowerTypeId", "consumerTowerTypeId"];
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !allowed.includes(key))) {
    throw invalidLogisticsRecipeParameter("Logistics recipe parameters are closed to the three explicit power roles.");
  }
  const result = safeRecord();
  for (const key of allowed) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw invalidLogisticsRecipeParameter(`Logistics recipe parameter ${key} is required as enumerable own data.`);
    }
    defineOwn(result, key, descriptor.value);
  }
  return result;
}

function inspectLocalAmmunitionRecipeParameters(value) {
  if (!isPlainRecord(value)) {
    throw invalidLogisticsRecipeParameter("Local ammunition recipe parameters must be a closed ordinary object.");
  }
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw invalidLogisticsRecipeParameter("Local ammunition recipe parameters could not be inspected safely.");
  }
  const allowed = [
    "consumerTowerTypeId", "ammoTypeId", "ammoLabel", "capacity",
    "startingAmount", "consumptionPerActivation"
  ];
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !allowed.includes(key))) {
    throw invalidLogisticsRecipeParameter("Local ammunition recipe parameters are closed to six explicit fields.");
  }
  const result = safeRecord();
  for (const key of allowed) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw invalidLogisticsRecipeParameter(`Local ammunition recipe parameter ${key} is required as enumerable own data.`);
    }
    defineOwn(result, key, descriptor.value);
  }
  return result;
}

function inspectFactoryAmmunitionSupplyParameters(value) {
  if (!isPlainRecord(value)) {
    throw invalidLogisticsRecipeParameter(
      "Factory ammunition supply recipe parameters must be a closed ordinary object."
    );
  }
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw invalidLogisticsRecipeParameter("Factory ammunition supply parameters could not be inspected safely.");
  }
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string"
    || !LOGISTICS_SUPPLY_PARAMETER_NAMES.includes(key))) {
    throw invalidLogisticsRecipeParameter(
      "Factory ammunition supply recipe parameters are closed to the 22 explicit fields."
    );
  }
  const result = safeRecord();
  for (const key of LOGISTICS_SUPPLY_PARAMETER_NAMES) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw invalidLogisticsRecipeParameter(
        `Factory ammunition supply recipe parameter ${key} is required as enumerable own data.`
      );
    }
    defineOwn(result, key, descriptor.value);
  }
  return result;
}

function boundedLogisticsRecipeInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw invalidLogisticsRecipeParameter(
      `Local ammunition recipe parameter ${name} must be a safe integer from ${minimum} through ${maximum}.`
    );
  }
  return value;
}

function boundedLogisticsRecipeNumber(value, name, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalidLogisticsRecipeParameter(
      `Factory ammunition supply recipe parameter ${name} must be a finite number from ${minimum} through ${maximum}.`
    );
  }
  return value;
}

function boundedLogisticsRecipeId(value, name) {
  if (typeof value !== "string" || value.length === 0 || utf8ByteLength(value) > 128) {
    throw invalidLogisticsRecipeParameter(`Logistics recipe parameter ${name} must contain 1..128 UTF-8 bytes.`);
  }
  return value;
}

function invalidLogisticsRecipeParameter(message) {
  return new MechanicsRecipeParameterError("logistics_recipe_parameter_invalid", message);
}

function materializeElementalSynergyRecipe(recipe, context, parameterValue) {
  const parameters = inspectRogueliteParameters(parameterValue);
  const towerTypeIds = inspectTowerTypeIds(parameters.towerTypeIds);
  const authoredTowerIds = new Set(sortedSafeIds(ownDataValue(context, "towerIds")));
  for (const towerTypeId of towerTypeIds) {
    if (!authoredTowerIds.has(towerTypeId)) {
      throw new MechanicsRecipeParameterError(
        "roguelite_recipe_tower_missing",
        `Recipe parameter towerTypeIds references unknown authored tower "${towerTypeId}".`
      );
    }
  }

  const currentTags = ownDataValue(context, "towerTagsByTowerId");
  const towerTags = safeRecord();
  for (const towerTypeId of towerTypeIds.sort(compareBinary)) {
    const existing = sortedSafeIds(ownDataValue(currentTags, towerTypeId));
    defineOwn(towerTags, towerTypeId, [...new Set([...existing, "elemental"])].sort(compareBinary));
  }
  const synergies = safeRecord();
  defineOwn(synergies, "elemental_convergence", {
    label: "Elemental Convergence",
    tag: "elemental",
    tiers: [
      { requiredCount: 2, modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.10 }] },
      { requiredCount: 4, modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.20 }] },
      { requiredCount: 6, modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.30 }] }
    ]
  });
  return {
    ...recipe,
    entity: {
      moduleId: "roguelite",
      moduleSchemaVersion: 1,
      profileId: recipe.suggestedId,
      profile: { synergies },
      towerTags
    }
  };
}

function materializeBossArtifactRecipe(recipe, context, parameterValue) {
  const parameters = inspectArtifactParameters(parameterValue);
  const towerTypeIds = inspectTowerTypeIds(parameters.towerTypeIds);
  const bossEnemyTypeId = boundedRogueliteRecipeId(parameters.bossEnemyTypeId, "bossEnemyTypeId");
  const authoredTowerIds = new Set(sortedSafeIds(ownDataValue(context, "towerIds")));
  for (const towerTypeId of towerTypeIds) {
    if (!authoredTowerIds.has(towerTypeId)) {
      throw new MechanicsRecipeParameterError(
        "roguelite_recipe_tower_missing",
        `Recipe parameter towerTypeIds references unknown authored tower "${towerTypeId}".`
      );
    }
  }
  const authoredEnemyIds = new Set(sortedSafeIds(ownDataValue(context, "enemyIds")));
  if (!authoredEnemyIds.has(bossEnemyTypeId)) {
    throw new MechanicsRecipeParameterError(
      "roguelite_recipe_enemy_missing",
      `Recipe parameter bossEnemyTypeId references unknown authored enemy "${bossEnemyTypeId}".`
    );
  }
  const towerSlots = safeRecord();
  for (const towerTypeId of [...towerTypeIds].sort(compareBinary)) {
    defineOwn(towerSlots, towerTypeId, [{ slotId: "core", slotType: "core" }]);
  }
  const bossLootTables = safeRecord();
  defineOwn(bossLootTables, bossEnemyTypeId, {
    rolls: 1,
    entries: [{ artifactId: "boss_trophy", weight: 1 }]
  });
  const definitions = safeRecord();
  defineOwn(definitions, "boss_trophy", {
    label: "Boss Trophy",
    slotType: "core",
    modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.1 }]
  });
  return {
    ...recipe,
    entity: {
      moduleId: "roguelite",
      moduleSchemaVersion: 2,
      profileId: recipe.suggestedId,
      profile: {
        synergies: safeRecord(),
        artifacts: { definitions, towerSlots, bossLootTables }
      }
    }
  };
}

function inspectArtifactParameters(value) {
  if (!isPlainRecord(value)) {
    throw invalidRogueliteRecipeParameter("Artifact recipe parameters must be a closed ordinary object.");
  }
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw invalidRogueliteRecipeParameter("Artifact recipe parameters could not be inspected safely.");
  }
  if (Reflect.ownKeys(descriptors).some((key) => key !== "towerTypeIds" && key !== "bossEnemyTypeId")) {
    throw invalidRogueliteRecipeParameter(
      "Artifact recipe parameters are closed; only towerTypeIds and bossEnemyTypeId are allowed."
    );
  }
  const towerTypeIds = descriptors.towerTypeIds;
  const bossEnemyTypeId = descriptors.bossEnemyTypeId;
  if (!towerTypeIds?.enumerable || !("value" in towerTypeIds)
    || !bossEnemyTypeId?.enumerable || !("value" in bossEnemyTypeId)) {
    throw invalidRogueliteRecipeParameter(
      "Artifact recipe parameters towerTypeIds and bossEnemyTypeId are required as enumerable own data fields."
    );
  }
  return { towerTypeIds: towerTypeIds.value, bossEnemyTypeId: bossEnemyTypeId.value };
}

function boundedRogueliteRecipeId(value, name) {
  if (typeof value !== "string" || value.length === 0 || utf8ByteLength(value) > 128) {
    throw invalidRogueliteRecipeParameter(
      `Roguelite recipe parameter ${name} must contain 1..128 UTF-8 bytes.`
    );
  }
  return value;
}

function inspectRogueliteParameters(value) {
  if (!isPlainRecord(value)) {
    throw invalidRogueliteRecipeParameter("Roguelite recipe parameters must be a closed ordinary object.");
  }
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw invalidRogueliteRecipeParameter("Roguelite recipe parameters could not be inspected safely.");
  }
  if (Reflect.ownKeys(descriptors).some((key) => key !== "towerTypeIds")) {
    throw invalidRogueliteRecipeParameter("Roguelite recipe parameters are closed; only towerTypeIds is allowed.");
  }
  const descriptor = descriptors.towerTypeIds;
  if (!descriptor?.enumerable || !("value" in descriptor)) {
    throw invalidRogueliteRecipeParameter("Roguelite recipe parameter towerTypeIds is required as an enumerable own data field.");
  }
  return { towerTypeIds: descriptor.value };
}

function inspectTowerTypeIds(value) {
  let descriptors;
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error();
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw invalidRogueliteRecipeParameter("Roguelite recipe parameter towerTypeIds must be an ordinary array.");
  }
  const length = descriptors.length && "value" in descriptors.length ? descriptors.length.value : undefined;
  if (!Number.isSafeInteger(length) || length < 1 || length > 16) {
    throw invalidRogueliteRecipeParameter("Roguelite recipe parameter towerTypeIds must contain 1..16 tower IDs.");
  }
  if (Reflect.ownKeys(descriptors).some((key) => {
    if (key === "length") return false;
    return typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length;
  })) {
    throw invalidRogueliteRecipeParameter("Roguelite recipe parameter towerTypeIds must be a dense closed array.");
  }
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string"
      || descriptor.value.length === 0 || utf8ByteLength(descriptor.value) > 128) {
      throw invalidRogueliteRecipeParameter(`Roguelite recipe parameter towerTypeIds[${index}] must contain 1..128 UTF-8 bytes.`);
    }
    result.push(descriptor.value);
  }
  if (new Set(result).size !== result.length) {
    throw invalidRogueliteRecipeParameter("Roguelite recipe parameter towerTypeIds must contain unique tower IDs.");
  }
  return result;
}

function invalidRogueliteRecipeParameter(message) {
  return new MechanicsRecipeParameterError("roguelite_recipe_parameter_invalid", message);
}

function materializeTerraformingRecipe(recipe, context, parameterValue) {
  const parameters = inspectTerraformingParameters(parameterValue);
  const sourceTerrainTag = boundedRecipeParameter(parameters.sourceTerrainTag, "sourceTerrainTag");
  const destinationTerrainId = boundedRecipeParameter(parameters.destinationTerrainId, "destinationTerrainId");
  const transitionId = parameters.transitionId === undefined
    ? TERRAFORMING_DEFAULT_TRANSITION_IDS[recipe.id]
    : boundedRecipeParameter(parameters.transitionId, "transitionId");
  const terrainTags = new Set(inspectStringCatalog(ownDataValue(context, "terrainTags"), "terrainTags"));
  const terrainIds = new Set(inspectStringCatalog(ownDataValue(context, "terrainIds"), "terrainIds"));
  if (!terrainTags.has(sourceTerrainTag)) {
    throw new MechanicsRecipeParameterError(
      "terraform_recipe_source_tag_missing",
      `Recipe parameter sourceTerrainTag "${sourceTerrainTag}" is not an authored terrain tag.`
    );
  }
  if (!terrainIds.has(destinationTerrainId)) {
    throw new MechanicsRecipeParameterError(
      "terraform_recipe_destination_missing",
      `Recipe parameter destinationTerrainId "${destinationTerrainId}" is not an authored terrain ID.`
    );
  }

  const terrainTransitions = safeRecord();
  defineOwn(terrainTransitions, transitionId, {
    fromTerrainTags: [sourceTerrainTag],
    toTerrainId: destinationTerrainId
  });
  return {
    ...recipe,
    entity: {
      moduleId: "terraforming",
      moduleSchemaVersion: 1,
      profileId: recipe.suggestedId,
      profile: { terrainTransitions }
    },
    towerScriptSnippet: {
      minimumSchemaVersion: 6,
      action: {
        action: "terraformTiles",
        operations: [{ kind: "set_terrain", target: "eventTile", transitionId }]
      }
    }
  };
}

function inspectTerraformingParameters(value) {
  if (!isPlainRecord(value)) {
    throw invalidTerraformingRecipeParameter("Terraforming recipe parameters must be a closed ordinary object.");
  }
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw invalidTerraformingRecipeParameter("Terraforming recipe parameters could not be inspected safely.");
  }
  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    throw invalidTerraformingRecipeParameter("Terraforming recipe parameters are closed; symbol fields are not allowed.");
  }
  const result = safeRecord();
  for (const key of Object.keys(descriptors).sort(compareBinary)) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw invalidTerraformingRecipeParameter(`Terraforming recipe parameter "${key}" must be an enumerable own data field.`);
    }
    if (!["sourceTerrainTag", "destinationTerrainId", "transitionId"].includes(key)) {
      throw invalidTerraformingRecipeParameter(`Terraforming recipe parameters are closed; unknown parameter "${key}" is not allowed.`);
    }
    defineOwn(result, key, descriptor.value);
  }
  for (const required of ["sourceTerrainTag", "destinationTerrainId"]) {
    if (!Object.hasOwn(result, required)) {
      throw invalidTerraformingRecipeParameter(`Terraforming recipe parameter "${required}" is required.`);
    }
  }
  return result;
}

function inspectParameterField(context) {
  if (!isPlainRecord(context)) return { kind: "invalid" };
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(context, "parameters");
  } catch {
    return { kind: "invalid" };
  }
  if (descriptor === undefined) return { kind: "absent" };
  if (!descriptor.enumerable || !("value" in descriptor)) return { kind: "invalid" };
  return { kind: "value", value: descriptor.value };
}

function boundedRecipeParameter(value, name) {
  if (typeof value !== "string") {
    throw invalidTerraformingRecipeParameter(`Terraforming recipe parameter "${name}" must be a string.`);
  }
  if (value.length === 0 || utf8ByteLength(value) > 128) {
    throw invalidTerraformingRecipeParameter(`Terraforming recipe parameter "${name}" must contain 1..128 UTF-8 bytes.`);
  }
  return value;
}

function inspectStringCatalog(value, name) {
  let array;
  let prototype;
  let descriptors;
  try {
    array = Array.isArray(value);
    prototype = array ? Object.getPrototypeOf(value) : undefined;
    descriptors = array ? Object.getOwnPropertyDescriptors(value) : undefined;
  } catch {
    throw invalidTerraformingRecipeParameter(`Terraforming recipe context ${name} could not be inspected safely.`);
  }
  if (!array || prototype !== Array.prototype) {
    throw invalidTerraformingRecipeParameter(`Terraforming recipe context ${name} must be an ordinary array.`);
  }
  const length = descriptors.length && "value" in descriptors.length ? descriptors.length.value : undefined;
  if (!Number.isSafeInteger(length) || Reflect.ownKeys(descriptors).some((key) => {
    if (key === "length") return false;
    return typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length;
  })) {
    throw invalidTerraformingRecipeParameter(`Terraforming recipe context ${name} must be a dense own-data array.`);
  }
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string") {
      throw invalidTerraformingRecipeParameter(`Terraforming recipe context ${name}[${index}] must be an own string value.`);
    }
    result.push(descriptor.value);
  }
  return result.sort(compareBinary);
}

function isPlainRecord(value) {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function invalidTerraformingRecipeParameter(message) {
  return new MechanicsRecipeParameterError("terraform_recipe_parameter_invalid", message);
}

function materializeDynamicNavigationRecipe(recipe, missionId) {
  return {
    ...recipe,
    entity: {
      moduleId: "navigation",
      moduleSchemaVersion: 1,
      missionId: missionId ?? "",
      profileId: recipe.suggestedId,
      enabled: true,
      profile: {
        mode: "dynamic_flow",
        defaultMovementProfileId: "ground",
        movementProfiles: {
          ground: {
            label: "Ground",
            terrainMode: "respect_walkable",
            towerOccupancy: "blocked",
            defaultTerrainCost: 1000
          },
          floating: {
            label: "Floating",
            terrainMode: "respect_walkable",
            towerOccupancy: "ignored",
            defaultTerrainCost: 1000
          },
          burrowing: {
            label: "Burrowing",
            terrainMode: "ignore_walkable",
            towerOccupancy: "ignored",
            defaultTerrainCost: 1000
          },
          flying: {
            label: "Flying",
            terrainMode: "ignore_walkable",
            towerOccupancy: "ignored",
            defaultTerrainCost: 1000
          }
        }
      }
    }
  };
}

function materializeReactionRecipe(recipe, missionId, context) {
  const prerequisites = reactionPrerequisites(recipe.id);
  const unmetPrerequisites = unresolvedReactionPrerequisites(prerequisites, context);
  let profile;

  if (recipe.id === ELEMENTAL_SHATTER_ID) {
    profile = {
      exposures: {
        definitions: {
          fire: { label: "Fire", duration: 4, maxStacks: 1 },
          ice: { label: "Ice", duration: 4, maxStacks: 1 }
        },
        applications: {
          damageTypes: {
            fire: [{ exposureId: "fire", stacks: 1 }],
            ice: [{ exposureId: "ice", stacks: 1 }]
          }
        }
      },
      reactions: {
        shatter_fire_into_ice: shatterDefinition("fire", "ice"),
        shatter_ice_into_fire: shatterDefinition("ice", "fire")
      }
    };
  } else if (recipe.id === WET_CHAIN_SHOCK_ID) {
    profile = {
      reactions: {
        chain_shock: {
          label: "Chain Shock",
          trigger: { damageTypes: ["lightning"] },
          requirements: [{ kind: "terrain_tag", tag: "wet" }],
          effects: {
            chain: {
              kind: "damage",
              amount: { kind: "source_after_modifiers", multiplier: 0.5 },
              damageType: "lightning",
              target: { kind: "terrain_tag", tag: "wet", maxTargets: 32 },
              allowReactions: false
            }
          }
        }
      }
    };
  } else {
    profile = {
      reactions: {
        combustion: {
          label: "Combustion",
          trigger: { damageTypes: ["fire"] },
          requirements: [{ kind: "status", statusId: "poison", consume: "clear" }],
          effects: {
            explosion: {
              kind: "damage",
              amount: { kind: "source_after_modifiers", multiplier: 1 },
              damageType: "fire",
              target: { kind: "radius", radius: 2, maxTargets: 32 },
              allowReactions: false
            }
          }
        }
      }
    };
  }

  return {
    ...recipe,
    prerequisites,
    unmetPrerequisites,
    entity: {
      moduleId: "reactions",
      moduleSchemaVersion: 1,
      missionId: missionId ?? "",
      profileId: recipe.suggestedId,
      enabled: true,
      profile
    }
  };
}

function reactionPrerequisites(recipeId) {
  if (recipeId === ELEMENTAL_SHATTER_ID) {
    return { combat: { moduleSchemaVersions: [2, 3], damageTypes: ["fire", "ice", "physical"] }, terrainTags: [] };
  }
  if (recipeId === WET_CHAIN_SHOCK_ID) {
    return { combat: { moduleSchemaVersions: [2, 3], damageTypes: ["lightning"] }, terrainTags: ["wet"] };
  }
  return { combat: { moduleSchemaVersions: [2, 3], damageTypes: ["fire"] }, terrainTags: [] };
}

function unresolvedReactionPrerequisites(prerequisites, context) {
  const issues = [];
  const activeVersion = ownDataValue(context, "activeCombatModuleSchemaVersion");
  if (!prerequisites.combat.moduleSchemaVersions.includes(activeVersion)) {
    issues.push({
      code: "dependency_missing",
      moduleId: "combat",
      supportedModuleSchemaVersions: [...prerequisites.combat.moduleSchemaVersions]
    });
  }
  const damageTypes = new Set(sortedSafeIds(ownDataValue(context, "activeCombatDamageTypeIds")));
  for (const damageTypeId of prerequisites.combat.damageTypes) {
    if (!damageTypes.has(damageTypeId)) {
      issues.push({ code: "reaction_damage_type_missing", moduleId: "combat", damageTypeId });
    }
  }
  const terrainTags = new Set(sortedSafeIds(ownDataValue(context, "terrainTags")));
  for (const terrainTag of prerequisites.terrainTags) {
    if (!terrainTags.has(terrainTag)) {
      issues.push({ code: "reaction_terrain_tag_missing", terrainTag });
    }
  }
  return issues;
}

function shatterDefinition(triggerDamageType, requiredExposureId) {
  return {
    label: "Shatter",
    trigger: { damageTypes: [triggerDamageType] },
    requirements: [{ kind: "exposure", exposureId: requiredExposureId, consume: "all" }],
    suppressTriggerExposureApplications: true,
    effects: {
      critical: {
        kind: "damage",
        amount: { kind: "source_after_modifiers", multiplier: 2 },
        damageType: "physical",
        target: { kind: "primary" },
        allowReactions: false
      }
    }
  };
}

function materializeArmorRecipe(recipe, moduleSchemaVersion, missionId, enemyIds) {
  const damageTypes = safeRecord();
  for (const [id, label] of [
    ["physical", "Physical"],
    ["magic", "Magic"],
    ["fire", "Fire"],
    ["ice", "Ice"],
    ["lightning", "Lightning"]
  ]) {
    defineOwn(damageTypes, id, { label });
  }

  const armorTypes = safeRecord();
  defineOwn(armorTypes, "plated", {
    label: "Plated",
    defaultMultiplier: 1,
    multipliers: {
      physical: 0.65,
      magic: 1.1,
      fire: 0.8,
      ice: 1.2,
      lightning: 1.25
    }
  });
  defineOwn(armorTypes, "warded", {
    label: "Warded",
    defaultMultiplier: 1,
    multipliers: {
      physical: 1.15,
      magic: 0.6,
      fire: 0.75,
      ice: 0.75,
      lightning: 0.75
    }
  });

  const enemies = safeRecord();
  const enemyId = firstSafeId(enemyIds);
  if (enemyId !== undefined) defineOwn(enemies, enemyId, "plated");

  return {
    ...recipe,
    entity: {
      moduleId: "combat",
      moduleSchemaVersion,
      missionId: missionId ?? "",
      profileId: recipe.suggestedId,
      enabled: true,
      profile: {
        damageTypes,
        armorTypes,
        armorAssignments: { enemies }
      }
    }
  };
}

function materializeMarksRecipe(recipe, moduleSchemaVersion, missionId, towerIds) {
  const definitions = safeRecord();
  defineOwn(definitions, "exposed", {
    label: "Exposed",
    duration: 3,
    maxStacks: 3,
    multiplier: 1.25,
    consumePolicy: "consume_one"
  });

  const towers = safeRecord();
  const towerId = firstSafeId(towerIds);
  if (towerId !== undefined) {
    defineOwn(towers, towerId, [{ markId: "exposed", stacks: 1 }]);
  }

  return {
    ...recipe,
    entity: {
      moduleId: "combat",
      moduleSchemaVersion,
      missionId: missionId ?? "",
      profileId: recipe.suggestedId,
      enabled: true,
      profile: {
        marks: {
          definitions,
          bindings: { towers }
        }
      }
    }
  };
}

function effectiveCombatModuleSchemaVersion(recipeVersion, context) {
  const authoredVersion = ownDataValue(ownDataValue(context, "moduleSchemaVersions"), "combat");
  if (authoredVersion === undefined) return recipeVersion;
  if (!Number.isInteger(authoredVersion) || authoredVersion < 1 || authoredVersion > 3) {
    throw new Error(`Cannot materialize a combat recipe for unsupported module schemaVersion "${String(authoredVersion)}".`);
  }
  return Math.max(recipeVersion, authoredVersion);
}

function chooseId(preferred, candidates) {
  const ids = sortedSafeIds(candidates);
  return typeof preferred === "string" && ids.includes(preferred) ? preferred : ids[0];
}

function firstSafeId(ids) {
  return sortedSafeIds(ids)[0];
}

function sortedSafeIds(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id) => typeof id === "string" && id.length > 0).sort(compareBinary);
}

function compareBinary(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cloneShield() {
  return {
    capacity: BASIC_SHIELD.capacity,
    regeneration: {
      ratePerUnit: BASIC_SHIELD.regeneration.ratePerUnit,
      delayAfterDamage: BASIC_SHIELD.regeneration.delayAfterDamage
    }
  };
}

function safeRecord() {
  return Object.create(null);
}

function ownDataValue(value, key) {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable && "value" in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function defineOwn(record, key, value) {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true
  });
}
