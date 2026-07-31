import { describe, expect, it } from "vitest";
import {
  GAME_COMMAND_JOURNAL_SCHEMA_VERSION,
  GAME_COMMAND_SCHEMA_VERSION,
  JournaledGameSession,
  TowerDefenseGame,
  createGameContentRegistry,
  dispatchGameCommand,
  replayGameCommandJournal,
  validateGameContentRegistry,
  type GameContentInput,
  type GameCommandV7
} from "../index.js";

const INPUT: GameContentInput = {
  balance: {
    defaultMissionId: "arsenal",
    constants: {
      timeUnitSeconds: 1, startingCoreHp: 20, startingCoins: 100, startingResources: { coins: 100 },
      prepTimeUnits: 5, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5,
      pathWaterCooldownUnits: 10, pathWaterDurationUnits: 5, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
    },
    abilities: {},
    enemies: {
      grunt: { id: "grunt", label: "Grunt", maxHp: 100, speed: 0.1, reward: { coins: 0 }, coinReward: 0, coreDamage: 1, color: 0x889966 }
    },
    towers: {
      cannon: {
        id: "cannon", label: "Cannon", cost: { coins: 5 }, footprintRadius: 0, range: 10, maxHp: 100,
        attack: { kind: "single", fireRate: 1, damagePerStack: 200, startingStacks: 1, maxStacks: 1, upgradeCost: 1 }
      }
    },
    waveSets: {
      one: [
        { id: "wave_1", label: "Wave 1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] },
        { id: "wave_2", label: "Wave 2", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }
      ]
    },
    missions: {
      arsenal: {
        id: "arsenal", label: "Arsenal", description: "", startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 5,
        mapId: "lane", waveSetId: "one", buildTowerIds: ["cannon"], abilityIds: [], mechanics: { profiles: { arsenal: "basic", roguelite: "gems" } }
      }
    }
  },
  mechanics: {
    schemaVersion: 1,
    modules: {
      arsenal: {
        schemaVersion: 1, enabled: true,
        profiles: {
          basic: {
            modules: {
              base_a: { label: "Base A", category: "base", compatibilityTags: ["cannon"], modifiers: { damageMultiplier: 1, rangeMultiplier: 1, durabilityMultiplier: 1 } },
              base_b: { label: "Base B", category: "base", compatibilityTags: ["cannon"], modifiers: { damageMultiplier: 1, rangeMultiplier: 1, durabilityMultiplier: 2 } },
              barrel_a: { label: "Barrel A", category: "barrel", compatibilityTags: ["cannon"], modifiers: { damageMultiplier: 1, rangeMultiplier: 1, durabilityMultiplier: 1 } },
              barrel_b: { label: "Barrel B", category: "barrel", compatibilityTags: ["cannon"], modifiers: { damageMultiplier: 2, rangeMultiplier: 2, durabilityMultiplier: 1 } },
              core_a: { label: "Core A", category: "core", compatibilityTags: ["cannon"], modifiers: { damageMultiplier: 1, rangeMultiplier: 1, durabilityMultiplier: 1 } }
            },
            blueprints: {
              cannon: { compatibilityTags: ["cannon"], footprint: [{ q: 0, r: 0 }], defaultModules: { base: "base_a", barrel: "barrel_a", core: "core_a" } }
            },
            craftingRecipes: {
              gem_t2: {
                outputArtifactId: "gem_t2", allowRotations: true,
                pattern: [{ x: 0, y: 0, artifactId: "gem_t1" }, { x: 1, y: 0, artifactId: "gem_t1" }]
              }
            }
          }
        }
      },
      roguelite: {
        schemaVersion: 2, enabled: true,
        profiles: {
          gems: {
            synergies: {},
            artifacts: {
              definitions: {
                gem_t1: { label: "Gem I", slotType: "gem", modifiers: [] },
                gem_t2: { label: "Gem II", slotType: "gem", modifiers: [] }
              },
              towerSlots: { cannon: [{ slotId: "gem", slotType: "gem" }] },
              bossLootTables: {
                grunt: { rolls: 2, noDropWeight: 0, entries: [{ artifactId: "gem_t1", weight: 1 }] }
              }
            }
          }
        }
      }
    }
  },
  maps: {
    lane: {
      id: "lane", width: 7, height: 3, defaultTerrain: "buildable", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 6, r: 1 },
      pathCenterline: Array.from({ length: 7 }, (_, q) => ({ q, r: 1 })), pathRoutes: [], terrainOverrides: []
    }
  },
  worldMap: {
    width: 100, height: 100,
    regions: [{ id: "region", label: "Region", description: "", bounds: { x: 0, y: 0, width: 100, height: 100 }, accent: "#889966", biome: "test", connections: [] }],
    missionNodes: [{ missionId: "arsenal", regionId: "region", x: 50, y: 50, difficulty: 1, unlockRequiresMissionIds: [] }]
  }
};

const content = createGameContentRegistry(INPUT);
const configure: GameCommandV7 = {
  schemaVersion: 7,
  type: "configureTowerModules",
  towerId: "tower_1",
  modules: { base: "base_b", barrel: "barrel_b", core: "core_a" }
};

describe("R14.2 modular arsenal runtime contract (RED)", () => {
  it("validates active recipe artifact references and keeps disabled references as warnings", () => {
    expect(validateGameContentRegistry(content).ok).toBe(true);
    const invalid = structuredClone(INPUT);
    (invalid.mechanics!.modules.arsenal!.profiles.basic as any).craftingRecipes.gem_t2.outputArtifactId = "missing";
    const active = validateGameContentRegistry(createGameContentRegistry(invalid));
    expect(active.ok).toBe(false);
    expect(active.issues.some((issue) => issue.severity === "error" && /missing/.test(issue.message))).toBe(true);
    invalid.mechanics!.modules.arsenal!.enabled = false;
    const disabled = validateGameContentRegistry(createGameContentRegistry(invalid));
    expect(disabled.ok).toBe(true);
    expect(disabled.issues.some((issue) => issue.severity === "warning" && /missing/.test(issue.message))).toBe(true);
  });

  it("publishes GameCommandV7 and configures an active tower only in management phases", () => {
    expect(GAME_COMMAND_SCHEMA_VERSION).toBe(7);
    expect(GAME_COMMAND_JOURNAL_SCHEMA_VERSION).toBe(7);
    const game = new TowerDefenseGame({ content, missionId: "arsenal", seed: "arsenal" });
    expect(game.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(game.getSnapshot().arsenal?.towers[0]).toMatchObject({
      modules: { base: "base_a", barrel: "barrel_a", core: "core_a" }, damageMultiplier: 1, rangeMultiplier: 1, durabilityMultiplier: 1
    });
    expect(dispatchGameCommand(game, configure)).toEqual({ ok: true });
    expect(game.getSnapshot().arsenal?.towers[0]).toMatchObject({ damageMultiplier: 2, rangeMultiplier: 2, durabilityMultiplier: 2 });
    expect(game.getSnapshot().towers[0]?.hp).toBe(200);
    expect(game.startNextWave()).toEqual({ ok: true });
    expect(dispatchGameCommand(game, { ...configure, modules: { base: "base_a", barrel: "barrel_a", core: "core_a" } })).toMatchObject({
      ok: false, reasonKey: "reason.arsenalManagementUnavailable"
    });
  });

  it("keeps active snapshot, checkpoint and command journal replay deterministic", () => {
    const session = new JournaledGameSession(new TowerDefenseGame({ content, missionId: "arsenal", seed: "journal" }));
    expect(session.dispatch({ schemaVersion: 7, type: "placeTower", towerTypeId: "cannon", coord: { q: 1, r: 0 } })).toEqual({ ok: true });
    expect(session.dispatch(configure)).toEqual({ ok: true });
    const checkpoint = session.game.createCheckpoint();
    const restored = TowerDefenseGame.fromCheckpoint({ content, checkpoint });
    expect(restored.getStateDigest()).toBe(session.game.getStateDigest());
    const replayed = replayGameCommandJournal({ content, journal: session.exportJournal() });
    expect(replayed.game.getStateDigest()).toBe(session.game.getStateDigest());
  });

  it("keeps the absent module path byte-for-byte free of arsenal state", () => {
    const legacyInput = structuredClone(INPUT);
    legacyInput.mechanics = { schemaVersion: 1, modules: {} };
    delete legacyInput.balance.missions.arsenal!.mechanics;
    const legacy = new TowerDefenseGame({ content: createGameContentRegistry(legacyInput), missionId: "arsenal" });
    expect(legacy.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(legacy.getSnapshot().arsenal).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(legacy.getSnapshot().towers[0]!, "arsenalModules")).toBe(false);
    expect(dispatchGameCommand(legacy, configure)).toMatchObject({ ok: false, reasonKey: "reason.arsenalUnavailable" });
  });

  it("rejects malformed nested command data without mutation", () => {
    const game = new TowerDefenseGame({ content, missionId: "arsenal" });
    expect(game.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    const before = game.getStateDigest();
    expect(dispatchGameCommand(game, { ...configure, modules: { ...configure.modules, hidden: true } })).toMatchObject({
      ok: false, reasonKey: "reason.invalidGameCommand"
    });
    expect(game.getStateDigest()).toBe(before);
  });

  it("crafts exact artifact instances through GameCommandV7 between waves", () => {
    const game = new TowerDefenseGame({ content, missionId: "arsenal", seed: "craft" });
    expect(game.placeTower("cannon", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(game.startNextWave()).toEqual({ ok: true });
    for (let index = 0; index < 30 && game.getSnapshot().waveState !== "between"; index += 1) game.tick(1);
    const roguelite = game.getSnapshot().roguelite;
    expect(roguelite?.schemaVersion).toBe(3);
    if (!roguelite || roguelite.schemaVersion !== 3) throw new Error("artifact snapshot missing");
    const inventory = roguelite.artifacts.inventory;
    expect(inventory.map((entry) => entry.artifactId)).toEqual(["gem_t1", "gem_t1"]);
    const command: GameCommandV7 = {
      schemaVersion: 7,
      type: "craftGem",
      recipeId: "gem_t2",
      cells: inventory.map((entry, index) => ({ x: index, y: 0, artifactInstanceId: entry.instanceId }))
    };
    expect(dispatchGameCommand(game, command)).toEqual({ ok: true });
    const crafted = game.getSnapshot().roguelite;
    if (!crafted || crafted.schemaVersion !== 3) throw new Error("crafted artifact snapshot missing");
    expect(crafted.artifacts.inventory.map((entry) => entry.artifactId)).toEqual(["gem_t2"]);
  });
});
