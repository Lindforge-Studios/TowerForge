import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "./registry.js";
import { validateGameContentRegistry } from "./validate.js";

function fixture(): ReturnType<typeof createGameContentRegistry> {
  const tower = {
    id: "base", label: "Base", cost: { coins: 1 }, footprintRadius: 0, range: 4,
    attack: {
      kind: "pipeline" as const, interval: 1, delivery: { kind: "single" as const },
      effects: [{ kind: "damage" as const, amount: 1 }], upgradeCosts: [{ coins: 1 }]
    }
  };
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "m", constants: {
        timeUnitSeconds: 1, startingCoreHp: 10, startingCoins: 10, startingResources: { coins: 10 }, prepTimeUnits: 1,
        moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
      }, abilities: {},
      enemies: {
        e: { id: "e", label: "E", maxHp: 10, speed: 1, reward: { coins: 0 }, coinReward: 0, coreDamage: 1, color: 0 }
      },
      towers: {
        base: tower,
        target: { ...tower, id: "target", label: "Target" }
      },
      waveSets: { w: [{ id: "w1", label: "W", groups: [{ enemyId: "e", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
      missions: {
        m: { id: "m", label: "M", description: "", startingCoreHp: 10, startingResources: { coins: 10 }, prepTimeUnits: 1, mapId: "map", waveSetId: "w", buildTowerIds: ["base"], abilityIds: [] }
      }
    },
    maps: {
      map: { id: "map", width: 3, height: 2, defaultTerrain: "buildable", spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 2, r: 0 }, pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }], pathRoutes: [], terrainOverrides: [] }
    },
    worldMap: { width: 10, height: 10, regions: [{ id: "r", label: "R", description: "", bounds: { x: 0, y: 0, width: 10, height: 10 }, accent: "#fff", biome: "x", connections: [] }], missionNodes: [{ missionId: "m", regionId: "r", x: 1, y: 1, difficulty: 1, unlockRequiresMissionIds: [] }] }
  };
  return createGameContentRegistry(input);
}

describe("Phase 1 content validation", () => {
  it.each([-1, 4])("rejects minRange %s outside 0 <= minRange < range", (minRange) => {
    const content = fixture();
    (content.towers.base!.attack as { minRange?: number }).minRange = minRange;
    expect(validateGameContentRegistry(content).issues)
      .toContainEqual(expect.objectContaining({ entityId: "base", fieldPath: "attack.minRange" }));
  });

  it.each([0, 361])("rejects cone angleDegrees %s outside (0, 360]", (angleDegrees) => {
    const content = fixture();
    content.towers.base!.attack = {
      kind: "pipeline", interval: 1, delivery: { kind: "cone", angleDegrees },
      effects: [{ kind: "damage", amount: 1 }]
    };
    expect(validateGameContentRegistry(content).issues)
      .toContainEqual(expect.objectContaining({ entityId: "base", fieldPath: "attack.delivery.angleDegrees" }));
  });

  it("validates branch ids, target references, and costs", () => {
    const content = fixture();
    content.towers.base!.upgradeBranches = [
      { id: "same", label: "A", targetTowerId: "missing", cost: { coins: -1 } },
      { id: "same", label: "B", targetTowerId: "target", cost: { coins: 1 } }
    ];
    const issues = validateGameContentRegistry(content).issues;
    expect(issues).toContainEqual(expect.objectContaining({ entityId: "base", fieldPath: "upgradeBranches[0].targetTowerId" }));
    expect(issues).toContainEqual(expect.objectContaining({ entityId: "base", fieldPath: "upgradeBranches[1].id" }));
    expect(issues).toContainEqual(expect.objectContaining({ entityId: "base", fieldPath: "upgradeBranches[0].cost.coins" }));
  });

  it("validates disruption telegraph options", () => {
    const content = fixture();
    content.enemies.e!.towerDisrupt = {
      interval: 2, radius: 1, duration: 1, telegraphLead: 3,
      telegraphKind: "unknown" as "cossack_channel", maxTargets: 0
    };
    const issues = validateGameContentRegistry(content).issues;
    expect(issues).toContainEqual(expect.objectContaining({ entityId: "e", fieldPath: "towerDisrupt.telegraphLead" }));
    expect(issues).toContainEqual(expect.objectContaining({ entityId: "e", fieldPath: "towerDisrupt.telegraphKind" }));
    expect(issues).toContainEqual(expect.objectContaining({ entityId: "e", fieldPath: "towerDisrupt.maxTargets" }));
  });
});
