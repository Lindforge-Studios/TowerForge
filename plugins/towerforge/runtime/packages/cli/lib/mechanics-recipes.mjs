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
