import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import type { DamagePacket } from "./damage.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { EnemyState, GridCoord, TowerState } from "./types.js";

interface FixtureOptions {
  readonly initialGuard?: boolean;
  readonly armoredGuard?: boolean;
}

interface ProtectionStatsContract {
  readonly transactionsThisTick: number;
  readonly candidatesInspected: number;
  readonly maximumCandidateCount: number;
}

function enemy(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    label: id,
    maxHp: 100,
    speed: 0.01,
    reward: { coins: 1 },
    coinReward: 1,
    coreDamage: 1,
    color: 1,
    ...extra
  };
}

function input(options: FixtureOptions = {}): GameContentInput {
  return {
    balance: {
      defaultMissionId: "protection_regression",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 100,
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
        floor: {
          id: "floor",
          label: "Floor",
          buildable: true,
          walkable: true,
          groundSpeedMultiplier: 1,
          tags: []
        }
      },
      abilities: {},
      enemies: {
        guard: enemy("guard", options.armoredGuard ? { armor: { kind: "pierce_only" } } : {}),
        body: enemy("body"),
        carrier: enemy("carrier", {
          phaseSpawns: [{ hpRatio: 0.5, enemyId: "guard", count: 1, progressOffset: 0 }]
        })
      },
      towers: {
        probe: {
          id: "probe",
          label: "Probe",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 10,
          attack: {
            kind: "single",
            fireRate: 1,
            damagePerStack: 5,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 1,
            statusOnHit: { stun: 3 }
          }
        }
      },
      waveSets: {
        wave: [{
          id: "wave_1",
          label: "Wave",
          groups: [
            ...(options.initialGuard
              ? [{ enemyId: "guard", count: 1, spawnInterval: 0, startDelay: 0 }]
              : []),
            { enemyId: "body", count: 1, spawnInterval: 0, startDelay: 0 },
            { enemyId: "carrier", count: 1, spawnInterval: 0, startDelay: 0 }
          ]
        }]
      },
      missions: {
        protection_regression: {
          id: "protection_regression",
          label: "Protection regression",
          description: "",
          startingCoreHp: 100,
          startingResources: { coins: 100 },
          prepTimeUnits: 0,
          mapId: "arena",
          waveSetId: "wave",
          buildTowerIds: ["probe"],
          abilityIds: [],
          mechanics: { profiles: {
            navigation: "flow",
            combat: "shielded",
            enemyBehaviors: "protected"
          } }
        }
      }
    },
    maps: {
      arena: {
        id: "arena",
        width: 9,
        height: 5,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 2 },
        coreCoord: { q: 8, r: 2 },
        pathCenterline: Array.from({ length: 9 }, (_, q) => ({ q, r: 2 })),
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        navigation: {
          schemaVersion: 1,
          enabled: true,
          profiles: { flow: {
            mode: "dynamic_flow",
            defaultMovementProfileId: "ground",
            movementProfiles: { ground: {
              label: "Ground",
              terrainMode: "respect_walkable",
              towerOccupancy: "blocked",
              defaultTerrainCost: 1_000
            } }
          } }
        },
        combat: {
          schemaVersion: 1,
          enabled: true,
          profiles: { shielded: {
            shields: { enemies: { guard: { capacity: 100 } } }
          } }
        },
        enemyBehaviors: {
          schemaVersion: 1,
          enabled: true,
          profiles: { protected: {
            formations: { cohorts: { alpha: {
              members: { guard: "vanguard", body: "body", carrier: "support" },
              steering: {
                neighborRadius: 2,
                cohesionWeight: 1,
                separationWeight: 1,
                roleWeight: 1
              },
              protection: {
                radius: 2,
                sourceKinds: ["tower", "ability"]
              }
            } } }
          } }
        }
      }
    },
    scripts: {
      spawn_guard: {
        schemaVersion: 5,
        id: "spawn_guard",
        bindings: [{ scope: "global" }],
        handlers: {
          signal: [{
            actions: [{
              action: "spawnEnemy",
              enemyTypeId: "guard",
              count: 1,
              pathProgress: 2
            }]
          }]
        }
      }
    },
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        biome: "test",
        accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        connections: []
      }],
      missionNodes: [{
        missionId: "protection_regression",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function fixture(options: FixtureOptions = {}) {
  const content = createGameContentRegistry(input(options));
  const game = new TowerDefenseGame({
    content,
    missionId: "protection_regression",
    seed: "r12-protection-verifier"
  });
  expect(game.startNextWave()).toEqual({ ok: true });
  game.tick(0);
  return { content, game };
}

function byType(game: TowerDefenseGame, typeId: string): EnemyState[] {
  return game.enemies.filter((candidate) => candidate.typeId === typeId && candidate.hp > 0);
}

function move(enemyState: EnemyState, coord: GridCoord): void {
  const navigation = (enemyState as unknown as {
    navigation: { currentCoord: GridCoord; nextCoord?: GridCoord; edgeProgress: number };
  }).navigation;
  navigation.currentCoord = { ...coord };
  delete navigation.nextCoord;
  navigation.edgeProgress = 0;
}

function stats(game: TowerDefenseGame): ProtectionStatsContract {
  return (game as unknown as { getVanguardProtectionStats(): ProtectionStatsContract })
    .getVanguardProtectionStats();
}

function applyAbilityPacket(
  game: TowerDefenseGame,
  target: EnemyState,
  packetTarget: DamagePacket["target"] = {
    kind: "enemy",
    enemyId: target.id,
    enemyTypeId: target.typeId
  }
) {
  const packet: DamagePacket = {
    amount: 1,
    source: { kind: "ability", abilityId: "probe" },
    target: packetTarget
  };
  return (game as unknown as {
    resolveAndApplyDamage(packet: DamagePacket, context: undefined, mutableTarget: unknown): unknown;
  }).resolveAndApplyDamage(packet, undefined, { kind: "enemy", enemy: target });
}

function applyTowerPacket(game: TowerDefenseGame, tower: TowerState, target: EnemyState, amount = 5): number {
  return (game as unknown as {
    applyTowerDamage(tower: TowerState, enemy: EnemyState, amount: number): number;
  }).applyTowerDamage(tower, target, amount);
}

describe("R12.4 verifier P1 vanguard protection regressions (RED)", () => {
  it("attributes tower side effects to the actual vanguard while towerFired keeps the acquired target", () => {
    const { game } = fixture({ initialGuard: true });
    const guard = byType(game, "guard")[0]!;
    const body = byType(game, "body")[0]!;
    const carrier = byType(game, "carrier")[0]!;
    move(guard, { q: 2, r: 2 });
    move(body, { q: 3, r: 2 });
    move(carrier, { q: 0, r: 2 });
    body.hp = 50;

    expect(game.placeTower("probe", { q: 3, r: 1 })).toEqual({ ok: true });
    const tower = game.towers[0]!;
    expect(game.setTowerTargetMode(tower.id, "weakest")).toEqual({ ok: true });
    game.tick(0);

    expect(game.getSnapshot().lastEvents).toContainEqual(expect.objectContaining({
      type: "towerFired",
      towerId: tower.id,
      enemyId: body.id
    }));
    expect(game.getSnapshot().lastEvents).toContainEqual(expect.objectContaining({
      type: "enemyHit",
      towerId: tower.id,
      enemyId: guard.id,
      enemyTypeId: "guard"
    }));
    expect(guard.statuses?.stun?.remaining).toBe(3);
    expect(body.statuses?.stun).toBeUndefined();
  });

  it("attributes enemyArmorBlocked to the intercepted vanguard", () => {
    const { game } = fixture({ initialGuard: true, armoredGuard: true });
    const guard = byType(game, "guard")[0]!;
    const body = byType(game, "body")[0]!;
    move(guard, { q: 2, r: 2 });
    move(body, { q: 3, r: 2 });
    expect(game.placeTower("probe", { q: 3, r: 1 })).toEqual({ ok: true });
    const tower = game.towers[0]!;

    expect(applyTowerPacket(game, tower, body)).toBe(0);
    expect(game.getSnapshot().lastEvents).toContainEqual({
      type: "enemyArmorBlocked",
      towerId: tower.id,
      enemyId: guard.id,
      enemyTypeId: "guard",
      rawDamage: 5
    });
    expect(game.getSnapshot().lastEvents).not.toContainEqual(expect.objectContaining({
      type: "enemyArmorBlocked",
      enemyId: body.id
    }));
  });

  it("clears the cached index and all diagnostic counters on reset", () => {
    const { game } = fixture({ initialGuard: true });
    const guard = byType(game, "guard")[0]!;
    const body = byType(game, "body")[0]!;
    move(guard, { q: 2, r: 2 });
    move(body, { q: 3, r: 2 });
    applyAbilityPacket(game, body);
    expect(stats(game)).toMatchObject({
      transactionsThisTick: 1,
      candidatesInspected: 1,
      maximumCandidateCount: 1
    });

    game.reset();
    expect(stats(game)).toEqual({
      transactionsThisTick: 0,
      candidatesInspected: 0,
      maximumCandidateCount: 0
    });
  });

  it("invalidates an empty cache when TowerScript spawns a vanguard before the next public tick", () => {
    const { game } = fixture();
    const body = byType(game, "body")[0]!;
    move(body, { q: 3, r: 2 });
    applyAbilityPacket(game, body);
    expect(game.getSnapshot().lastEvents.some((event) => event.type === "vanguardDamageIntercepted")).toBe(false);

    expect(game.emitScriptSignal("spawn_guard")).toEqual({ ok: true });
    const guard = byType(game, "guard")[0]!;
    expect(guard).toBeTruthy();
    applyAbilityPacket(game, body);
    expect(game.getSnapshot().lastEvents).toContainEqual(expect.objectContaining({
      type: "vanguardDamageIntercepted",
      protectedEnemyId: body.id,
      vanguardEnemyId: guard.id
    }));
  });

  it("invalidates an empty cache when a phase spawn adds a vanguard in the same public tick", () => {
    const { game } = fixture();
    const body = byType(game, "body")[0]!;
    const carrier = byType(game, "carrier")[0]!;
    move(body, { q: 3, r: 2 });
    move(carrier, { q: 2, r: 2 });
    applyAbilityPacket(game, body);
    carrier.hp = 50;
    (game as unknown as { triggerEnemyPhaseSpawns(): void }).triggerEnemyPhaseSpawns();
    const guard = byType(game, "guard")[0]!;
    expect(guard).toBeTruthy();

    applyAbilityPacket(game, body);
    expect(game.getSnapshot().lastEvents).toContainEqual(expect.objectContaining({
      type: "vanguardDamageIntercepted",
      protectedEnemyId: body.id,
      vanguardEnemyId: guard.id
    }));
  });

  it("validates mismatched enemy identity and unauthored components before planning interception", () => {
    const invalidTargets = [
      (body: EnemyState): DamagePacket["target"] => ({
        kind: "enemy",
        enemyId: "enemy_mismatch",
        enemyTypeId: body.typeId
      }),
      (body: EnemyState): DamagePacket["target"] => ({
        kind: "enemy",
        enemyId: body.id,
        enemyTypeId: body.typeId,
        componentId: "unauthored_component"
      })
    ];

    for (const invalidTarget of invalidTargets) {
      const { game } = fixture({ initialGuard: true });
      const guard = byType(game, "guard")[0]!;
      const body = byType(game, "body")[0]!;
      move(guard, { q: 2, r: 2 });
      move(body, { q: 3, r: 2 });
      const guardShieldBefore = (game.getSnapshot().combat as any).shields.enemies[guard.id].current;

      expect(() => applyAbilityPacket(game, body, invalidTarget(body)))
        .toThrow(/damage packet target|component|mutable target/i);
      expect((game.getSnapshot().combat as any).shields.enemies[guard.id].current).toBe(guardShieldBefore);
      expect(game.getSnapshot().lastEvents.some((event) => event.type === "vanguardDamageIntercepted")).toBe(false);
      expect(stats(game)).toEqual({
        transactionsThisTick: 0,
        candidatesInspected: 0,
        maximumCandidateCount: 0
      });
    }
  });
});
