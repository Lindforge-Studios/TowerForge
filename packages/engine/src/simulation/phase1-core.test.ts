import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { computeCheckpointStateDigest, type GameCheckpointV1 } from "./checkpoint.js";
import { dispatchGameCommand } from "./commands.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { EffectPipelineAttackModel, EnemyState, TowerState } from "./types.js";

function pipeline(amount = 1, delivery: EffectPipelineAttackModel["delivery"] = { kind: "single" }): EffectPipelineAttackModel {
  return {
    kind: "pipeline",
    interval: 0.1,
    targeting: { classes: ["ground"], mode: "closest", maxTargets: 3 },
    delivery,
    effects: [{ kind: "damage", amount }]
  };
}

function content() {
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "phase1",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 200,
        startingResources: { coins: 200 },
        prepTimeUnits: 5,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 10,
        pathWaterDurationUnits: 5,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.3
      },
      abilities: {},
      enemies: {
        target: {
          id: "target", label: "Target", maxHp: 100, speed: 0.001,
          reward: { coins: 0 }, coinReward: 0, coreDamage: 1, color: 0xffffff
        },
        disruptor: {
          id: "disruptor", label: "Disruptor", maxHp: 1000, speed: 0.001,
          reward: { coins: 0 }, coinReward: 0, coreDamage: 1, color: 0xff0000,
          towerDisrupt: {
            interval: 2,
            radius: 5,
            duration: 2,
            telegraphLead: 1,
            telegraphKind: "cossack_channel",
            maxTargets: 2
          }
        }
      },
      towers: {
        dead_zone: {
          id: "dead_zone", label: "Dead zone", cost: { coins: 1 }, footprintRadius: 0,
          range: 5, attack: { ...pipeline(10, { kind: "multi" }), minRange: 2 }
        },
        cone: {
          id: "cone", label: "Cone", cost: { coins: 1 }, footprintRadius: 0,
          range: 5, attack: pipeline(10, { kind: "cone", angleDegrees: 60 })
        },
        base: {
          id: "base", label: "Base", cost: { coins: 1 }, footprintRadius: 0, range: 3,
          attack: { ...pipeline(2), upgradeCosts: [{ coins: 10 }] },
          upgradeBranches: [
            { id: "a", label: "A", targetTowerId: "branch_a", cost: { coins: 20 } },
            { id: "b", label: "B", description: "Alternate", targetTowerId: "branch_b", cost: { coins: 25 } }
          ]
        },
        branch_a: {
          id: "branch_a", label: "Branch A", cost: { coins: 1 }, footprintRadius: 0,
          range: 6, attack: { ...pipeline(20, { kind: "area", radius: 1 }), minRange: 1 }
        },
        branch_b: {
          id: "branch_b", label: "Branch B", cost: { coins: 1 }, footprintRadius: 0,
          range: 4, attack: pipeline(8, { kind: "cone", angleDegrees: 90 })
        },
        harmless: {
          id: "harmless", label: "Harmless", cost: { coins: 1 }, footprintRadius: 0,
          range: 1, attack: pipeline(0)
        }
      },
      waveSets: {
        empty: [{ id: "w1", label: "W1", groups: [{ enemyId: "target", count: 1, spawnInterval: 1, startDelay: 100 }] }]
      },
      missions: {
        phase1: {
          id: "phase1", label: "Phase 1", description: "", startingCoreHp: 20,
          startingResources: { coins: 200 }, prepTimeUnits: 5, mapId: "arena", waveSetId: "empty",
          buildTowerIds: ["dead_zone", "cone", "base", "harmless"], abilityIds: []
        }
      }
    },
    maps: {
      arena: {
        id: "arena", width: 9, height: 7, defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 3 }, coreCoord: { q: 8, r: 3 },
        pathCenterline: Array.from({ length: 9 }, (_, q) => ({ q, r: 3 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    worldMap: {
      width: 100, height: 100,
      regions: [{ id: "r", label: "R", description: "", bounds: { x: 0, y: 0, width: 100, height: 100 }, accent: "#fff", biome: "test", connections: [] }],
      missionNodes: [{ missionId: "phase1", regionId: "r", x: 50, y: 50, difficulty: 1, unlockRequiresMissionIds: [] }]
    }
  };
  return createGameContentRegistry(input);
}

function enemy(id: string, pathProgress: number, typeId = "target"): EnemyState {
  return { id, typeId, hp: 100, maxHp: typeId === "disruptor" ? 1000 : 100, pathProgress, dotRemaining: 0, pathOffset: 0 };
}

function resign(checkpoint: GameCheckpointV1): void {
  (checkpoint as unknown as { stateDigest: string }).stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state
  );
}

describe("TowerForge Phase 1 core", () => {
  it("enforces pipeline minRange as an acquisition annulus", () => {
    const game = new TowerDefenseGame({ content: content(), missionId: "phase1" });
    expect(game.placeTower("dead_zone", { q: 4, r: 2 })).toEqual({ ok: true });
    game.enemies.push(enemy("enemy_1", 4), enemy("enemy_2", 1));

    game.tick(0.1);

    expect(game.enemies.find((item) => item.id === "enemy_1")?.hp).toBe(100);
    expect(game.enemies.find((item) => item.id === "enemy_2")?.hp).toBeLessThan(100);
  });

  it("aims a cone at the primary target, filters by angle, and obeys maxTargets", () => {
    const game = new TowerDefenseGame({ content: content(), missionId: "phase1" });
    expect(game.placeTower("cone", { q: 4, r: 3 })).toEqual({ ok: true });
    const makePositioned = (id: string, q: number, r: number): EnemyState => ({
      ...enemy(id, 0),
      navigation: { schemaVersion: 1, movementProfileId: "test", currentCoord: { q, r }, edgeProgress: 0, stepsEntered: 0 }
    });
    game.enemies.push(
      makePositioned("enemy_1", 5, 3),
      makePositioned("enemy_2", 6, 3),
      makePositioned("enemy_3", 4, 1),
      makePositioned("enemy_4", 7, 3)
    );
    const tower = game.towers[0] as TowerState;
    const attack = game.content.towers.cone!.attack as EffectPipelineAttackModel;

    const targets = (game as unknown as {
      pipelineTargets(tower: TowerState, attack: EffectPipelineAttackModel): Array<{ enemy: EnemyState }>;
    }).pipelineTargets(tower, attack);

    expect(targets.map(({ enemy: item }) => item.id)).toEqual(["enemy_1", "enemy_2", "enemy_4"]);
    expect(targets.map(({ enemy: item }) => item.id)).not.toContain("enemy_3");
  });

  it("requires and atomically applies an immutable level-three upgrade branch", () => {
    const game = new TowerDefenseGame({ content: content(), missionId: "phase1" });
    expect(game.placeTower("base", { q: 4, r: 2 })).toEqual({ ok: true });
    expect(game.upgradeTower("tower_1")).toEqual({ ok: true });
    expect(game.towers[0]).toMatchObject({ typeId: "base", level: 2 });
    expect(game.canUpgradeTower("tower_1")).toMatchObject({ ok: false, reasonKey: "reason.upgradeBranchRequired" });

    const coinsBefore = game.coins;
    expect(dispatchGameCommand(game, {
      schemaVersion: 1, type: "upgradeTower", towerId: "tower_1", branchId: "a"
    })).toEqual({ ok: true });
    expect(game.coins).toBe(coinsBefore - 20);
    expect(game.towers[0]).toMatchObject({
      typeId: "branch_a", baseTypeId: "base", upgradeBranchId: "a", level: 3
    });
    expect(game.lastEvents).toContainEqual(expect.objectContaining({
      type: "towerUpgraded", towerId: "tower_1", branchId: "a", baseTypeId: "base", typeId: "branch_a"
    }));
    expect(game.canUpgradeTower("tower_1", "b")).toMatchObject({ ok: false, reasonKey: "reason.upgradeBranchLocked" });

    const checkpoint = game.createCheckpoint();
    const restored = TowerDefenseGame.fromCheckpoint({ content: content(), checkpoint });
    expect(restored.towers[0]).toMatchObject({
      typeId: "branch_a", baseTypeId: "base", upgradeBranchId: "a", level: 3
    });

    const tampered = structuredClone(checkpoint);
    (tampered as unknown as { state: { towers: TowerState[] } }).state.towers[0] = {
      ...tampered.state.towers[0]!, upgradeBranchId: "b"
    };
    resign(tampered);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: content(), checkpoint: tampered }))
      .toThrow(/branch/i);
  });

  it("locks bounded disruption targets on telegraph entry and resolves only those targets", () => {
    const game = new TowerDefenseGame({ content: content(), missionId: "phase1" });
    expect(game.placeTower("harmless", { q: 4, r: 2 })).toEqual({ ok: true });
    expect(game.placeTower("harmless", { q: 3, r: 2 })).toEqual({ ok: true });
    expect(game.placeTower("harmless", { q: 6, r: 2 })).toEqual({ ok: true });
    game.enemies.push({ ...enemy("enemy_1", 4, "disruptor"), disruptCooldown: 1.1 });
    (game as unknown as { enemyCounter: number }).enemyCounter = 1;

    game.tick(0.2);
    expect(game.enemies[0]?.disruptTargetTowerIds).toEqual(["tower_1", "tower_2"]);
    const checkpoint = game.createCheckpoint();
    expect(TowerDefenseGame.fromCheckpoint({ content: content(), checkpoint }).enemies[0]?.disruptTargetTowerIds)
      .toEqual(["tower_1", "tower_2"]);

    for (let index = 0; index < 5; index += 1) game.tick(0.2);
    expect(game.towers.find((tower) => tower.id === "tower_1")?.disabledFor).toBeGreaterThan(0);
    expect(game.towers.find((tower) => tower.id === "tower_2")?.disabledFor).toBeGreaterThan(0);
    expect(game.towers.find((tower) => tower.id === "tower_3")?.disabledFor ?? 0).toBe(0);
    expect(game.enemies[0]?.disruptTargetTowerIds).toBeUndefined();
  });
});
