import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { GridDefinition } from "./types.js";

type Activation = "absent" | "disabled" | "unselected" | "future" | "active";

function input(
  activation: Activation = "active",
  grid: GridDefinition = { kind: "square", adjacency: "cardinal" },
  reverseDefinitions = false
): GameContentInput {
  const definitionEntries = [
    ["commander", { label: "Commander", spawn: "core" }],
    ["warden", { label: "Warden", spawn: "core" }]
  ] as const;
  const definitions = Object.fromEntries(reverseDefinitions ? [...definitionEntries].reverse() : definitionEntries);
  return {
    balance: {
      defaultMissionId: "hero_foundation",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 30,
        startingResources: { coins: 30 },
        prepTimeUnits: 0,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt", label: "Grunt", maxHp: 10, speed: 0.1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {
        pelter: {
          id: "pelter", label: "Pelter", cost: { coins: 1 }, footprintRadius: 0,
          range: 5,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 2,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        one: [{
          id: "wave", label: "Wave",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        hero_foundation: {
          id: "hero_foundation", label: "Hero foundation", description: "",
          startingCoreHp: 20, startingResources: { coins: 30 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: ["pelter"], abilityIds: [],
          ...(activation === "absent" || activation === "unselected"
            ? {}
            : { mechanics: { profiles: { heroes: "commanders" } } })
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 5, height: 3, grid,
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 4, r: 1 },
        pathCenterline: Array.from({ length: 5 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    ...(activation === "absent" ? {} : {
      mechanics: {
        schemaVersion: 1,
        modules: {
          heroes: {
            schemaVersion: (activation === "future" ? 5 : 1) as 1,
            enabled: activation !== "disabled",
            profiles: {
              commanders: { selectedHeroId: "commander", definitions }
            }
          }
        }
      }
    }),
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#ffffff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "hero_foundation", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
}

function game(
  activation: Activation = "active",
  grid: GridDefinition = { kind: "square", adjacency: "cardinal" },
  reverseDefinitions = false
): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "hero_foundation",
    content: createGameContentRegistry(input(activation, grid, reverseDefinitions)),
    seed: "hero-foundation-seed"
  });
}

function exerciseLegacy(subject: TowerDefenseGame): void {
  expect(subject.placeTower("pelter", { q: 1, r: 0 }).ok).toBe(true);
  expect(subject.startNextWave().ok).toBe(true);
  subject.tick(0.2);
}

describe("R5.1A static hero runtime foundation", () => {
  it.each([
    ["square", { kind: "square", adjacency: "cardinal" } as const],
    ["hex", { kind: "hex", layout: "odd-r" } as const]
  ])("publishes exactly one frozen selected unit at the %s map core", (_label, grid) => {
    const subject = game("active", grid);
    expect(subject.getSnapshot().heroes).toEqual({
      schemaVersion: 1,
      units: [{
        id: "commander",
        definitionId: "commander",
        label: "Commander",
        coord: { q: 4, r: 1 }
      }]
    });
    const heroes = subject.getSnapshot().heroes!;
    expect(Object.isFrozen(heroes)).toBe(true);
    expect(Object.isFrozen(heroes.units)).toBe(true);
    expect(Object.isFrozen(heroes.units[0])).toBe(true);
    expect(Object.isFrozen(heroes.units[0]!.coord)).toBe(true);
  });

  it("strips foreign coreCoord fields from the closed renderer-facing hero coordinate", () => {
    const authored = input("active");
    const coreCoordWithForeignField = { q: 4, r: 1, extra: "must-not-reach-renderers" };
    authored.maps.lane!.coreCoord = coreCoordWithForeignField;
    const subject = new TowerDefenseGame({
      missionId: "hero_foundation",
      content: createGameContentRegistry(authored),
      seed: "hero-foundation-extra-core-field"
    });

    const coord = subject.getSnapshot().heroes!.units[0]!.coord;
    const descriptors = Object.getOwnPropertyDescriptors(coord);
    expect(Reflect.ownKeys(coord)).toEqual(["q", "r"]);
    expect(Object.getPrototypeOf(coord)).toBe(Object.prototype);
    expect(Object.getOwnPropertySymbols(coord)).toEqual([]);
    expect(descriptors.q).toMatchObject({ enumerable: true, value: 4 });
    expect(descriptors.r).toMatchObject({ enumerable: true, value: 1 });
    expect(coord).toEqual({ q: 4, r: 1 });
    expect(Object.isFrozen(coord)).toBe(true);
  });

  it("is canonical under definition insertion order and does not publish unselected definitions", () => {
    const first = game("active", { kind: "square", adjacency: "cardinal" }, false);
    const reordered = game("active", { kind: "square", adjacency: "cardinal" }, true);
    expect(reordered.getSnapshot().heroes).toEqual(first.getSnapshot().heroes);
    expect(reordered.getSnapshot().heroes?.units.map((unit) => unit.id)).toEqual(["commander"]);
    expect(reordered.createCheckpoint().contentDigest).toBe(first.createCheckpoint().contentDigest);
  });

  it("keeps the unit derived: checkpoint v1 has no heroes state and restore rebuilds the same snapshot", () => {
    const content = createGameContentRegistry(input("active"));
    const source = new TowerDefenseGame({
      missionId: "hero_foundation", content, seed: "hero-foundation-seed"
    });
    exerciseLegacy(source);
    const checkpoint = source.createCheckpoint();
    expect(checkpoint.schemaVersion).toBe(1);
    expect(checkpoint.engineVersion).toBe("towerforge-sim-v2");
    expect(checkpoint.state).not.toHaveProperty("heroes");

    const restored = TowerDefenseGame.fromCheckpoint({
      content,
      checkpoint: JSON.parse(JSON.stringify(checkpoint))
    });
    expect(restored.getSnapshot()).toEqual(source.getSnapshot());
    expect(restored.getStateDigest()).toBe(source.getStateDigest());
    expect(restored.createCheckpoint().state).not.toHaveProperty("heroes");
  });

  it.each(["disabled", "unselected", "future"] as const)(
    "keeps %s heroes byte-equivalent to the absent legacy gameplay state",
    (activation) => {
      const absent = game("absent");
      const inactive = game(activation);
      exerciseLegacy(absent);
      exerciseLegacy(inactive);
      expect(Object.prototype.hasOwnProperty.call(absent.getSnapshot(), "heroes")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(inactive.getSnapshot(), "heroes")).toBe(false);
      expect(inactive.getSnapshot()).toEqual(absent.getSnapshot());
      expect(inactive.createCheckpoint().state).toEqual(absent.createCheckpoint().state);
      expect(inactive.createCheckpoint().state).not.toHaveProperty("heroes");
    }
  );

  it("keeps checkpoint, events, TowerScript, and RNG stable while hero abilities own command v5", () => {
    expect(Engine.GAME_COMMAND_SCHEMA_VERSION).toBe(5);
    expect(Engine.GAME_COMMAND_SUPPORTED_SCHEMA_VERSIONS).toEqual([1, 2, 3, 4, 5]);
    expect(Engine.GAME_CHECKPOINT_SCHEMA_VERSION).toBe(1);
    expect(Engine.SIMULATION_ENGINE_VERSION).toBe("towerforge-sim-v2");
    expect(Engine.TOWER_SCRIPT_SCHEMA.actions).not.toHaveProperty("moveHero");
    expect(Engine.TOWER_SCRIPT_SCHEMA.events).not.toContain("heroSpawned");
    expect(Engine.TOWER_SCRIPT_SCHEMA.events).not.toContain("heroMoved");
    expect((Engine as unknown as Record<string, unknown>)).not.toHaveProperty("moveHero");

    const subject = game("active");
    const before = subject.createCheckpoint();
    subject.tick(0.2);
    expect(subject.getSnapshot().lastEvents.some((event) => event.type.toLowerCase().includes("hero"))).toBe(false);
    expect(before.rng).toEqual(subject.createCheckpoint().rng);
  });
});
