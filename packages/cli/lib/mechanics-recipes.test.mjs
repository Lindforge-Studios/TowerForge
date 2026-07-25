import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listMechanicsRecipes, materializeMechanicsRecipe } from "./mechanics-recipes.mjs";

const mechanicsRecipesSource = fs.readFileSync(path.resolve("packages/cli/lib/mechanics-recipes.mjs"), "utf8");

const context = {
  defaultMissionId: "mission_b",
  missionIds: ["mission_c", "mission_b", "mission_a"],
  enemyIds: ["zeta", "alpha", "middle"],
  towerIds: ["tower_z", "tower_a"],
  destructibleTowerIds: ["tower_z", "tower_a"],
  activeCombatModuleSchemaVersion: 3,
  activeCombatDamageTypeIds: ["physical", "lightning", "ice", "fire"],
  terrainTags: ["wet", "path"]
};

describe("combat mechanics recipes", () => {
  it("keeps the shield recipe explicitly on combat module v1 without armor fields", () => {
    expect(listMechanicsRecipes().map((recipe) => recipe.id)).toContain("basic_regenerating_shields");

    const recipe = materializeMechanicsRecipe("basic_regenerating_shields", context);
    expect(recipe.entity).toMatchObject({
      moduleId: "combat",
      moduleSchemaVersion: 1,
      missionId: "mission_b",
      profileId: "basic_regenerating_shields",
      enabled: true,
      profile: { shields: { enemies: expect.any(Object), towers: expect.any(Object) } }
    });
    expect(recipe.entity.profile).not.toHaveProperty("damageTypes");
    expect(recipe.entity.profile).not.toHaveProperty("armorTypes");
    expect(recipe.entity.profile).not.toHaveProperty("armorAssignments");
  });

  it.each([2, 3])("materializes a shield-only recipe at existing combat module v%s", (moduleSchemaVersion) => {
    const recipe = materializeMechanicsRecipe("basic_regenerating_shields", {
      ...context,
      moduleSchemaVersions: { combat: moduleSchemaVersion }
    });

    expect(recipe.entity).toMatchObject({
      moduleId: "combat",
      moduleSchemaVersion,
      profileId: "basic_regenerating_shields",
      profile: { shields: expect.any(Object) }
    });
    expect(recipe.entity.profile).not.toHaveProperty("armorTypes");
    expect(recipe.entity.profile).not.toHaveProperty("marks");
  });

  it("materializes a deterministic project-bound basic elemental armor matrix on combat v2", () => {
    expect(listMechanicsRecipes().map((recipe) => recipe.id)).toContain("basic_elemental_armor_matrix");

    const first = materializeMechanicsRecipe("basic_elemental_armor_matrix", context);
    const reordered = materializeMechanicsRecipe("basic_elemental_armor_matrix", {
      ...context,
      missionIds: [...context.missionIds].reverse(),
      enemyIds: [...context.enemyIds].reverse(),
      towerIds: [...context.towerIds].reverse(),
      destructibleTowerIds: [...context.destructibleTowerIds].reverse()
    });
    expect(reordered).toEqual(first);
    expect(first.entity).toMatchObject({
      moduleId: "combat",
      moduleSchemaVersion: 2,
      missionId: "mission_b",
      profileId: "basic_elemental_armor_matrix",
      enabled: true,
      profile: {
        damageTypes: expect.any(Object),
        armorTypes: expect.any(Object),
        armorAssignments: { enemies: expect.any(Object) }
      }
    });

    const { damageTypes, armorTypes, armorAssignments } = first.entity.profile;
    expect(Object.keys(damageTypes)).toEqual(expect.arrayContaining(["physical", "magic", "fire", "ice", "lightning"]));
    expect(Object.keys(armorTypes).length).toBeGreaterThan(0);
    for (const armor of Object.values(armorTypes)) {
      expect(typeof armor.label).toBe("string");
      expect(Object.keys(armor.multipliers).every((damageTypeId) => Object.hasOwn(damageTypes, damageTypeId))).toBe(true);
    }
    const assignments = Object.entries(armorAssignments.enemies);
    expect(assignments).toHaveLength(1);
    expect(assignments[0][0]).toBe("alpha");
    expect(Object.hasOwn(armorTypes, assignments[0][1])).toBe(true);
  });

  it("materializes a deterministic opt-in vulnerability mark recipe on combat v3", () => {
    expect(listMechanicsRecipes().map((recipe) => recipe.id)).toContain("basic_vulnerability_marks");

    const first = materializeMechanicsRecipe("basic_vulnerability_marks", {
      ...context,
      moduleSchemaVersions: { combat: 2 }
    });
    const reordered = materializeMechanicsRecipe("basic_vulnerability_marks", {
      ...context,
      moduleSchemaVersions: { combat: 1 },
      missionIds: [...context.missionIds].reverse(),
      enemyIds: [...context.enemyIds].reverse(),
      towerIds: [...context.towerIds].reverse(),
      destructibleTowerIds: [...context.destructibleTowerIds].reverse()
    });

    expect(reordered).toEqual(first);
    expect(first.entity).toMatchObject({
      moduleId: "combat",
      moduleSchemaVersion: 3,
      missionId: "mission_b",
      profileId: "basic_vulnerability_marks",
      enabled: true,
      profile: {
        marks: {
          definitions: {
            exposed: {
              label: expect.any(String),
              duration: expect.any(Number),
              maxStacks: expect.any(Number),
              multiplier: expect.any(Number),
              consumePolicy: expect.stringMatching(/^(retain|consume_one|consume_all)$/)
            }
          },
          bindings: {
            towers: { tower_a: [{ markId: "exposed", stacks: 1 }] }
          }
        }
      }
    });
    expect(Object.keys(first.entity.profile.marks.bindings.towers)).toHaveLength(1);
  });
});

describe("R1.5 reaction mechanics recipes", () => {
  it("materializes directional Fire/Ice Shatter with explicit combat prerequisites", () => {
    expect(listMechanicsRecipes().map((recipe) => recipe.id)).toContain("elemental_shatter");
    const recipe = materializeMechanicsRecipe("elemental_shatter", context);

    expect(recipe).toMatchObject({
      prerequisites: {
        combat: { moduleSchemaVersions: [2, 3], damageTypes: ["fire", "ice", "physical"] },
        terrainTags: []
      },
      unmetPrerequisites: [],
      entity: {
        moduleId: "reactions",
        moduleSchemaVersion: 1,
        missionId: "mission_b",
        profileId: "elemental_shatter",
        enabled: true
      }
    });
    expect(Object.keys(recipe.entity.profile.exposures.definitions).sort()).toEqual(["fire", "ice"]);
    expect(Object.keys(recipe.entity.profile.reactions).sort()).toEqual([
      "shatter_fire_into_ice", "shatter_ice_into_fire"
    ]);
    for (const reaction of Object.values(recipe.entity.profile.reactions)) {
      expect(reaction).toMatchObject({
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
      });
    }
  });

  it("materializes wet Chain Shock with exact bounded targets and reports a missing wet tag", () => {
    expect(listMechanicsRecipes().map((recipe) => recipe.id)).toContain("wet_chain_shock");
    const recipe = materializeMechanicsRecipe("wet_chain_shock", context);
    expect(recipe).toMatchObject({
      prerequisites: {
        combat: { moduleSchemaVersions: [2, 3], damageTypes: ["lightning"] },
        terrainTags: ["wet"]
      },
      unmetPrerequisites: [],
      entity: { moduleId: "reactions", moduleSchemaVersion: 1, profileId: "wet_chain_shock" }
    });
    expect(recipe.entity.profile.reactions.chain_shock).toMatchObject({
      trigger: { damageTypes: ["lightning"] },
      requirements: [{ kind: "terrain_tag", tag: "wet" }],
      effects: {
        chain: {
          amount: { kind: "source_after_modifiers", multiplier: 0.5 },
          damageType: "lightning",
          target: { kind: "terrain_tag", tag: "wet", maxTargets: 32 },
          allowReactions: false
        }
      }
    });

    const missing = materializeMechanicsRecipe("wet_chain_shock", { ...context, terrainTags: [] });
    expect(missing.unmetPrerequisites).toContainEqual(expect.objectContaining({
      code: "reaction_terrain_tag_missing",
      terrainTag: "wet"
    }));
  });

  it("materializes poison Combustion without patching poison, combat, or terrain content", () => {
    expect(listMechanicsRecipes().map((recipe) => recipe.id)).toContain("poison_combustion");
    const recipe = materializeMechanicsRecipe("poison_combustion", context);
    expect(recipe).toMatchObject({
      prerequisites: {
        combat: { moduleSchemaVersions: [2, 3], damageTypes: ["fire"] },
        terrainTags: []
      },
      unmetPrerequisites: [],
      entity: { moduleId: "reactions", moduleSchemaVersion: 1, profileId: "poison_combustion" }
    });
    expect(recipe.entity.profile.reactions.combustion).toMatchObject({
      trigger: { damageTypes: ["fire"] },
      requirements: [{ kind: "status", statusId: "poison", consume: "clear" }],
      effects: {
        explosion: {
          amount: { kind: "source_after_modifiers", multiplier: 1 },
          damageType: "fire",
          target: { kind: "radius", radius: 2, maxTargets: 32 },
          allowReactions: false
        }
      }
    });
    expect(recipe.entity).not.toHaveProperty("combatPatch");
    expect(recipe.entity).not.toHaveProperty("balancePatch");
    expect(recipe.entity).not.toHaveProperty("terrainPatch");
  });
});

describe("R2 opt-in dynamic navigation recipe", () => {
  it("lists and materializes four movement presets without assigning enemy types", () => {
    const before = structuredClone(context);
    const listed = listMechanicsRecipes();
    expect(listed.map((recipe) => recipe.id)).toContain("basic_dynamic_navigation");
    expect(listed.find((recipe) => recipe.id === "basic_dynamic_navigation")).not.toHaveProperty("enabled");

    const recipe = materializeMechanicsRecipe("basic_dynamic_navigation", context);
    expect(recipe.entity).toMatchObject({
      moduleId: "navigation",
      moduleSchemaVersion: 1,
      missionId: "mission_b",
      profileId: "basic_dynamic_navigation",
      profile: {
        mode: "dynamic_flow",
        defaultMovementProfileId: "ground",
        movementProfiles: {
          ground: {
            terrainMode: "respect_walkable",
            towerOccupancy: "blocked",
            defaultTerrainCost: expect.any(Number)
          },
          floating: {
            terrainMode: "respect_walkable",
            towerOccupancy: "ignored",
            defaultTerrainCost: expect.any(Number)
          },
          burrowing: {
            terrainMode: "ignore_walkable",
            towerOccupancy: "ignored",
            defaultTerrainCost: expect.any(Number)
          },
          flying: {
            terrainMode: "ignore_walkable",
            towerOccupancy: "ignored",
            defaultTerrainCost: expect.any(Number)
          }
        }
      }
    });
    expect(Object.keys(recipe.entity.profile.movementProfiles).sort()).toEqual([
      "burrowing", "floating", "flying", "ground"
    ]);
    expect(recipe.entity.profile).not.toHaveProperty("enemyMovementProfiles");
    expect(context).toEqual(before);
  });

  it("keeps listing and materialization pure so a recipe cannot write or auto-enable a project", () => {
    expect(mechanicsRecipesSource).not.toMatch(/node:fs|writeFile|applyMechanics|apply_mechanics_module/);
    const before = structuredClone(context);
    const firstList = listMechanicsRecipes();
    const firstRecipe = materializeMechanicsRecipe("basic_dynamic_navigation", context);
    const secondList = listMechanicsRecipes();
    const secondRecipe = materializeMechanicsRecipe("basic_dynamic_navigation", context);
    expect(secondList).toEqual(firstList);
    expect(secondRecipe).toEqual(firstRecipe);
    expect(context).toEqual(before);
  });
});
