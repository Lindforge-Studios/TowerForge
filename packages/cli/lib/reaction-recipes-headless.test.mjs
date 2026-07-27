import { describe, expect, it } from "vitest";
import { loadEngine } from "./project-loader.mjs";
import { materializeMechanicsRecipe } from "./mechanics-recipes.mjs";

const ORIGIN = { q: 2, r: 3 };
const CORE = { q: 9, r: 3 };

describe("R1.5 bundled reaction recipes in the headless engine", () => {
  it("runs Fire/Ice Shatter as directional consumed exposure plus 2x secondary damage", async () => {
    const { game } = await recipeGame("elemental_shatter", {
      starts: [ORIGIN],
      towers: {
        fire_tower: tower("fire_tower", "fire", 10),
        ice_tower: tower("ice_tower", "ice", 10)
      },
      buildTowerIds: ["fire_tower", "ice_tower"]
    });
    spawn(game, 1);

    expect(game.placeTower("fire_tower", { q: 0, r: 0 }).ok).toBe(true);
    game.tick(0.01);
    expect(enemy(game, "enemy_1").hp).toBe(90);
    expect(game.getSnapshot().reactions.exposures.enemies.enemy_1.fire).toMatchObject({ stacks: 1 });
    expect(game.sellTower("tower_1").ok).toBe(true);
    expect(game.placeTower("ice_tower", { q: 0, r: 0 }).ok).toBe(true);
    game.tick(0.01);

    expect(enemy(game, "enemy_1").hp).toBe(60);
    expect(game.getSnapshot()).not.toHaveProperty("reactions");
    expect(game.lastEvents).toContainEqual(expect.objectContaining({
      type: "enemyReactionTriggered",
      reactionId: "shatter_ice_into_fire",
      scheduledTargetIds: ["enemy_1"]
    }));
  }, 15_000);

  it("runs wet Chain Shock against every other wet target with deterministic bounded damage", async () => {
    const { game } = await recipeGame("wet_chain_shock", {
      starts: [ORIGIN, { q: 3, r: 3 }, { q: 4, r: 3 }],
      wet: true,
      towers: { lightning_tower: tower("lightning_tower", "lightning", 10) },
      buildTowerIds: ["lightning_tower"]
    });
    spawn(game, 3);
    expect(game.placeTower("lightning_tower", { q: 0, r: 0 }).ok).toBe(true);
    expect(game.setTowerTargetMode("tower_1", "closest").ok).toBe(true);
    game.tick(0.01);

    expect(game.lastEvents).toContainEqual(expect.objectContaining({
      type: "enemyReactionTriggered",
      reactionId: "chain_shock",
      scheduledTargetIds: ["enemy_2", "enemy_3"]
    }));
    expect(enemy(game, "enemy_1").hp).toBe(90);
    expect(enemy(game, "enemy_2").hp).toBe(95);
    expect(enemy(game, "enemy_3").hp).toBe(95);
  }, 15_000);

  it("runs poison Combustion once, clears poison, and applies bounded radius damage", async () => {
    const poison = {
      id: "poison",
      label: "Poison",
      cooldown: 0.01,
      duration: 0,
      radius: 0.1,
      effects: [{ kind: "status", status: { poison: { dps: 0.1, duration: 10 } } }]
    };
    const { game } = await recipeGame("poison_combustion", {
      starts: [ORIGIN, { q: 3, r: 3 }, { q: 7, r: 3 }],
      abilities: { poison },
      towers: { fire_tower: tower("fire_tower", "fire", 10) },
      buildTowerIds: ["fire_tower"]
    });
    spawn(game, 3);
    expect(game.useAbility("poison", ORIGIN).ok).toBe(true);
    expect(enemy(game, "enemy_1").statuses.poison).toBeDefined();
    expect(game.placeTower("fire_tower", { q: 0, r: 0 }).ok).toBe(true);
    expect(game.setTowerTargetMode("tower_1", "closest").ok).toBe(true);
    game.tick(0.01);

    expect(enemy(game, "enemy_1").hp).toBeCloseTo(89.999, 6);
    expect(enemy(game, "enemy_1").statuses?.poison).toBeUndefined();
    expect(enemy(game, "enemy_2").hp).toBe(90);
    expect(enemy(game, "enemy_3").hp).toBe(100);
    expect(game.lastEvents.filter((event) => (
      event.type === "enemyReactionTriggered" && event.reactionId === "combustion"
    ))).toHaveLength(1);
  }, 15_000);
});

async function recipeGame(recipeId, options) {
  const engine = await loadEngine();
  const context = {
    defaultMissionId: "recipe",
    missionIds: ["recipe"],
    enemyIds: ["grunt"],
    towerIds: Object.keys(options.towers),
    destructibleTowerIds: [],
    activeCombatModuleSchemaVersion: 3,
    activeCombatDamageTypeIds: ["physical", "fire", "ice", "lightning"],
    terrainTags: options.wet ? ["path", "wet"] : ["path"]
  };
  const recipe = materializeMechanicsRecipe(recipeId, context);
  expect(recipe.unmetPrerequisites).toEqual([]);
  const content = engine.createGameContentRegistry(contentInput(recipe.entity.profile, options));
  expect(engine.validateGameContentRegistry(content).issues).toEqual([]);
  return {
    engine,
    game: new engine.TowerDefenseGame({ missionId: "recipe", content, seed: `recipe-${recipeId}` })
  };
}

function contentInput(reactionProfile, options) {
  const starts = options.starts;
  const pathRoutes = starts.map((start, index) => ({
    id: `route_${index + 1}`,
    pathCenterline: Array.from({ length: CORE.q - start.q + 1 }, (_, offset) => ({ q: start.q + offset, r: start.r }))
  }));
  return {
    balance: {
      defaultMissionId: "recipe",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 0,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        buildable: {
          id: "buildable", label: "Buildable", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: ["buildable"]
        },
        path: {
          id: "path", label: "Path", buildable: false, walkable: true,
          groundSpeedMultiplier: 1, tags: options.wet ? ["path", "wet"] : ["path"]
        }
      },
      abilities: options.abilities ?? {},
      enemies: {
        grunt: {
          id: "grunt", label: "Grunt", maxHp: 100, speed: 0.000001,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: options.towers,
      waveSets: {
        one: [{
          id: "one",
          label: "One",
          groups: starts.map((_start, index) => ({
            enemyId: "grunt", count: 1, spawnInterval: 0, startDelay: 0, routeId: pathRoutes[index].id
          }))
        }]
      },
      missions: {
        recipe: {
          id: "recipe", label: "Recipe", description: "", startingCoreHp: 20,
          startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one",
          buildTowerIds: options.buildTowerIds,
          abilityIds: Object.keys(options.abilities ?? {}),
          mechanics: { profiles: { combat: "base", reactions: "recipe" } }
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 10, height: 7,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "path",
        spawnCoord: { q: 0, r: 3 }, coreCoord: CORE,
        pathCenterline: pathRoutes[0].pathCenterline,
        pathRoutes,
        terrainOverrides: [{ q: 0, r: 0, terrain: "buildable" }]
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 3,
          enabled: true,
          profiles: {
            base: {
              damageTypes: {
                physical: { label: "Physical" }, fire: { label: "Fire" },
                ice: { label: "Ice" }, lightning: { label: "Lightning" }
              },
              armorTypes: {}, armorAssignments: {}, marks: { definitions: {} }
            }
          }
        },
        reactions: { schemaVersion: 1, enabled: true, profiles: { recipe: reactionProfile } }
      }
    },
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, accent: "#fff", biome: "test", connections: []
      }],
      missionNodes: [{
        missionId: "recipe", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
}

function tower(id, damageType, damage) {
  return {
    id,
    label: id,
    cost: { coins: 1 },
    footprintRadius: 0,
    range: 100,
    attack: {
      kind: "single",
      fireRate: 1,
      damagePerStack: damage,
      damageType,
      startingStacks: 1,
      maxStacks: 1,
      upgradeCost: 1
    }
  };
}

function spawn(game, expected) {
  expect(game.startNextWave().ok).toBe(true);
  game.tick(0.01);
  expect(game.getSnapshot().enemies).toHaveLength(expected);
}

function enemy(game, id) {
  return game.getSnapshot().enemies.find((candidate) => candidate.id === id);
}
