import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { getSimulationContentDigest } from "./stable-digest.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

const CONSTANTS = {
  timeUnitSeconds: 1,
  startingCoreHp: 10,
  startingCoins: 20,
  startingResources: { coins: 20 },
  prepTimeUnits: 0,
  moveTowerCost: { coins: 1 },
  waterGroundSpeedFactor: 0.5,
  pathWaterCooldownUnits: 5,
  pathWaterDurationUnits: 3,
  pathWaterRadius: 1,
  pathWaterGroundSpeedFactor: 0.5
};

function input(visuals: unknown): GameContentInput {
  return {
    balance: {
      defaultMissionId: "juice_legacy",
      constants: CONSTANTS,
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt",
          label: "Grunt",
          maxHp: 10,
          speed: 1,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 0x778899
        }
      },
      towers: {},
      waveSets: {
        one: [{
          id: "wave_1",
          label: "Wave 1",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        juice_legacy: {
          id: "juice_legacy",
          label: "Juice legacy",
          description: "",
          startingCoreHp: 10,
          startingResources: { coins: 20 },
          prepTimeUnits: 0,
          mapId: "lane",
          waveSetId: "one",
          buildTowerIds: [],
          abilityIds: []
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 5,
        height: 3,
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 4, r: 1 },
        pathCenterline: Array.from({ length: 5 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [],
        terrainOverrides: Array.from({ length: 3 }, (_, index) => ({
          q: index + 1,
          r: 1,
          terrain: "path" as const
        }))
      }
    },
    worldMap: {
      width: 100,
      height: 100,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        accent: "#778899",
        biome: "test",
        connections: []
      }],
      missionNodes: [{
        missionId: "juice_legacy",
        regionId: "region",
        x: 50,
        y: 50,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    },
    visuals
  };
}

function proceduralVisuals() {
  return {
    schemaVersion: 3,
    assetsRoot: "assets",
    atlases: {},
    sprites: {},
    tileSets: {},
    bindings: { towers: {}, enemies: {}, tiles: {}, tileSets: { grids: {}, maps: {} }, ui: {} },
    audio: { sounds: {}, events: {}, musicTracks: {}, musicByMission: {} },
    proceduralJuice: {
      schemaVersion: 1,
      particleEmitters: {},
      audioCues: {},
      cameraCues: {},
      eventBindings: {}
    }
  };
}

describe("R11 presentation-only simulation boundary", () => {
  it("does not add visuals data to snapshots, checkpoints, or simulation/content digests", () => {
    const legacyContent = createGameContentRegistry(input({ schemaVersion: 2 }));
    const juiceContent = createGameContentRegistry(input(proceduralVisuals()));
    expect(getSimulationContentDigest(juiceContent)).toBe(getSimulationContentDigest(legacyContent));

    const legacy = new TowerDefenseGame({ content: legacyContent, missionId: "juice_legacy", seed: "same" });
    const juice = new TowerDefenseGame({ content: juiceContent, missionId: "juice_legacy", seed: "same" });
    expect(legacy.startNextWave()).toEqual(juice.startNextWave());
    legacy.tick(2.5);
    juice.tick(2.5);

    expect(juice.getSnapshot()).toEqual(legacy.getSnapshot());
    expect(juice.getSnapshot()).not.toHaveProperty("proceduralJuice");
    expect(juice.getStateDigest()).toBe(legacy.getStateDigest());
    expect(juice.createCheckpoint()).toEqual(legacy.createCheckpoint());
  });
});
