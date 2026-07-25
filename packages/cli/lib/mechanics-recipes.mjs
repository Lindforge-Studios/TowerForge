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

  const missionId = chooseId(context.defaultMissionId, context.missionIds);
  if ([ELEMENTAL_SHATTER_ID, WET_CHAIN_SHOCK_ID, POISON_COMBUSTION_ID].includes(recipeId)) {
    return materializeReactionRecipe(recipe, missionId, context);
  }
  if (recipeId === BASIC_DYNAMIC_NAVIGATION_ID) {
    return materializeDynamicNavigationRecipe(recipe, missionId);
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
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
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
