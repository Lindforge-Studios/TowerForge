import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { computeCheckpointStateDigest, type GameCheckpointV1 } from "./checkpoint.js";
import { DamageResolver } from "./damage.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

interface ShieldDefinitionFixture {
  capacity: number;
  regeneration?: { ratePerUnit: number; delayAfterDamage?: number };
}

interface ShieldStateFixture {
  current: number;
  capacity: number;
  regenerationDelayRemaining: number;
}

interface CombatSnapshotFixture {
  schemaVersion: 1;
  shields: {
    enemies: Record<string, ShieldStateFixture>;
    towers: Record<string, ShieldStateFixture>;
  };
}

interface RuntimeFixtureOptions {
  enemyShield?: ShieldDefinitionFixture;
  towerShield?: ShieldDefinitionFixture;
  enabled?: boolean;
  selected?: boolean;
  authorMechanics?: boolean;
  enemyHp?: number;
  towerDamage?: number;
  enemyTowerAttack?: { interval: number; damage: number; range: number };
  abilityDamage?: number;
  scripts?: GameContentInput["scripts"];
}

function runtimeInput(options: RuntimeFixtureOptions = {}): GameContentInput {
  const profile = {
    ...((options.enemyShield === undefined && options.towerShield === undefined) ? {} : {
      shields: {
        ...(options.enemyShield === undefined ? {} : { enemies: { grunt: options.enemyShield } }),
        ...(options.towerShield === undefined ? {} : { towers: { pelter: options.towerShield } })
      }
    })
  };
  const abilityIds = options.abilityDamage === undefined ? [] : ["strike" as const];
  return {
    balance: {
      defaultMissionId: "shield",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 20, startingCoins: 100,
        startingResources: { coins: 100 }, prepTimeUnits: 0,
        moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1, pathWaterDurationUnits: 1, pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: options.abilityDamage === undefined ? {} : {
        strike: {
          id: "strike", label: "Strike", cooldown: 1, duration: 0,
          radius: 3, damage: options.abilityDamage
        }
      },
      enemies: {
        grunt: {
          id: "grunt", label: "Grunt", maxHp: options.enemyHp ?? 20, speed: 0.1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1,
          ...(options.enemyTowerAttack === undefined ? {} : { towerAttack: options.enemyTowerAttack })
        }
      },
      towers: {
        pelter: {
          id: "pelter", label: "Pelter", cost: { coins: 1 }, footprintRadius: 0,
          range: 5, maxHp: 20,
          attack: {
            kind: "single", fireRate: 0.1, damagePerStack: options.towerDamage ?? 4,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        one: [{
          id: "one", label: "One",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        shield: {
          id: "shield", label: "Shield", description: "", startingCoreHp: 20,
          startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: ["pelter"], abilityIds,
          ...((options.selected ?? true) ? { mechanics: { profiles: { combat: "shielded" } } } : {})
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 6, height: 3, defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 5, r: 1 },
        pathCenterline: Array.from({ length: 6 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    ...((options.authorMechanics ?? true) ? {
      mechanics: {
        schemaVersion: 1 as const,
        modules: {
          combat: {
            schemaVersion: 1 as const,
            enabled: options.enabled ?? true,
            profiles: { shielded: profile }
          }
        }
      }
    } : {}),
    ...(options.scripts === undefined ? {} : { scripts: options.scripts }),
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, accent: "#fff",
        biome: "test", connections: []
      }],
      missionNodes: [{
        missionId: "shield", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
}

function createGame(options: RuntimeFixtureOptions = {}): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "shield",
    content: createGameContentRegistry(runtimeInput(options)),
    seed: "shield-contract"
  });
}

function combat(game: TowerDefenseGame): CombatSnapshotFixture | undefined {
  return (game.getSnapshot() as unknown as { combat?: CombatSnapshotFixture }).combat;
}

function startWithTower(game: TowerDefenseGame): void {
  expect(game.placeTower("pelter", { q: 1, r: 0 }).ok).toBe(true);
  expect(game.startNextWave().ok).toBe(true);
}

afterEach(() => vi.restoreAllMocks());

describe("active combat shields", () => {
  it.each([
    ["full absorption", 10, 4, 20, 6, 4, undefined],
    ["overflow", 5, 8, 17, 0, 5, 3]
  ] as const)("applies enemy shield %s after exactly one resolution", (
    _label, capacity, damage, expectedHp, expectedShield, absorbed, overflowDamage
  ) => {
    const resolveSpy = vi.spyOn(DamageResolver, "resolve");
    const game = createGame({ enemyShield: { capacity }, towerDamage: damage });
    startWithTower(game);
    resolveSpy.mockClear();
    game.tick(0.05);

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(game.getSnapshot().enemies[0]!.hp).toBe(expectedHp);
    expect(combat(game)?.shields.enemies.enemy_1).toEqual({
      current: expectedShield,
      capacity,
      regenerationDelayRemaining: 0
    });
    expect(game.lastEvents).toContainEqual(expect.objectContaining({
      type: "enemyShieldChanged", enemyId: "enemy_1", enemyTypeId: "grunt",
      previous: capacity, current: expectedShield, capacity, cause: "damage", amount: absorbed,
      ...(overflowDamage === undefined ? {} : { overflowDamage })
    }));
    expect(game.lastEvents).toContainEqual(expect.objectContaining({
      type: "enemyHit", enemyId: "enemy_1", damage
    }));
  });

  it("absorbs enemy tower attacks with the tower shield and preserves towerAttacked", () => {
    const resolveSpy = vi.spyOn(DamageResolver, "resolve");
    const game = createGame({
      towerShield: { capacity: 10 },
      towerDamage: 0,
      enemyTowerAttack: { interval: 0.05, damage: 7, range: 5 }
    });
    startWithTower(game);
    resolveSpy.mockClear();
    game.tick(0.05);

    expect(game.getSnapshot().towers[0]!.hp).toBe(20);
    expect(combat(game)?.shields.towers.tower_1).toEqual({
      current: 3, capacity: 10, regenerationDelayRemaining: 0
    });
    expect(resolveSpy.mock.calls.filter(([packet]) => (
      packet.source.kind === "enemy" && packet.target.kind === "tower"
    ))).toHaveLength(1);
    expect(game.lastEvents).toContainEqual(expect.objectContaining({
      type: "towerShieldChanged", towerId: "tower_1", previous: 10,
      current: 3, cause: "damage", amount: 7
    }));
    expect(game.lastEvents).toContainEqual(expect.objectContaining({
      type: "towerAttacked", towerId: "tower_1", damage: 7
    }));
  });

  it("consumes regeneration delay, uses leftover tick time, and emits only transition-to-full", () => {
    const game = createGame({
      enemyShield: {
        capacity: 10,
        regeneration: { ratePerUnit: 2, delayAfterDamage: 0.1 }
      },
      towerDamage: 4
    });
    startWithTower(game);
    game.tick(0.05);
    expect(combat(game)?.shields.enemies.enemy_1?.current).toBe(6);
    expect(combat(game)?.shields.enemies.enemy_1?.regenerationDelayRemaining).toBe(0.1);
    expect(game.sellTower("tower_1").ok).toBe(true);

    game.tick(0.2);
    expect(combat(game)?.shields.enemies.enemy_1?.current).toBeCloseTo(6.2, 8);
    expect((game.lastEvents as readonly { type: string }[]).some((event) => event.type === "enemyShieldChanged")).toBe(false);

    const regenerationEvents: unknown[] = [];
    for (let index = 0; index < 10; index += 1) {
      game.tick(0.2);
      regenerationEvents.push(...(game.lastEvents as readonly { type: string }[]).filter((event) => event.type === "enemyShieldChanged"));
    }
    expect(combat(game)?.shields.enemies.enemy_1?.current).toBe(10);
    expect(regenerationEvents).toEqual([expect.objectContaining({
      type: "enemyShieldChanged", enemyId: "enemy_1", previous: expect.any(Number),
      current: 10, capacity: 10, cause: "regeneration", amount: expect.any(Number)
    })]);
  });

  it("routes tower and ability sources through one resolver then the same shield", () => {
    const resolveSpy = vi.spyOn(DamageResolver, "resolve");
    const game = createGame({
      enemyShield: { capacity: 20 }, towerDamage: 4, abilityDamage: 6
    });
    startWithTower(game);
    resolveSpy.mockClear();
    game.tick(0.05);
    expect(game.useAbility("strike", { q: 0, r: 1 }).ok).toBe(true);

    expect(resolveSpy.mock.calls.map(([packet]) => packet.source.kind)).toEqual(["tower", "ability"]);
    expect(combat(game)?.shields.enemies.enemy_1?.current).toBe(10);
    expect(game.getSnapshot().enemies[0]!.hp).toBe(20);
  });

  it("settles one overflow kill and reward exactly once", () => {
    const resolveSpy = vi.spyOn(DamageResolver, "resolve");
    const game = createGame({ enemyShield: { capacity: 5 }, enemyHp: 6, towerDamage: 15 });
    startWithTower(game);
    resolveSpy.mockClear();
    game.tick(0.05);

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(game.getSnapshot().enemies).toEqual([]);
    expect(game.lastEvents.filter((event) => event.type === "enemyKilled")).toHaveLength(1);
    expect(game.coins).toBe(100); // 100 - 1 placement + 1 reward
  });
});

describe("shield opt-in snapshots and checkpoints", () => {
  it("omits combat for absent, disabled, unselected, and active-empty profiles", () => {
    const variants = [
      createGame({ authorMechanics: false, selected: false }),
      createGame({ enemyShield: { capacity: 10 }, enabled: false }),
      createGame({ enemyShield: { capacity: 10 }, selected: false }),
      createGame({})
    ];
    for (const game of variants) expect(combat(game)).toBeUndefined();

    const absentCheckpointState = variants[0]!.createCheckpoint().state as unknown as Record<string, unknown>;
    const emptyCheckpointState = variants[3]!.createCheckpoint().state as unknown as Record<string, unknown>;
    expect(absentCheckpointState).not.toHaveProperty("combat");
    expect(emptyCheckpointState).not.toHaveProperty("combat");
    expect(emptyCheckpointState).toEqual(absentCheckpointState);
  });

  it("round-trips active shield state and deterministic continuation through sim-v2", () => {
    const content = createGameContentRegistry(runtimeInput({ enemyShield: { capacity: 10 }, towerDamage: 4 }));
    const game = new TowerDefenseGame({ missionId: "shield", content, seed: "shield-contract" });
    startWithTower(game);
    game.tick(0.05);
    const checkpoint = game.createCheckpoint() as unknown as Omit<GameCheckpointV1, "engineVersion" | "state"> & {
      engineVersion: string;
      state: GameCheckpointV1["state"] & { combat: CombatSnapshotFixture };
    };

    expect(checkpoint.engineVersion).toBe("towerforge-sim-v2");
    expect(checkpoint.state.combat.shields.enemies.enemy_1?.current).toBe(6);
    const restored = TowerDefenseGame.fromCheckpoint({
      content,
      checkpoint: JSON.parse(JSON.stringify(checkpoint)) as GameCheckpointV1
    });
    expect(restored.getSnapshot()).toEqual(game.getSnapshot());
    game.tick(0.2);
    restored.tick(0.2);
    expect(restored.getStateDigest()).toBe(game.getStateDigest());
  });

  it("rejects a digest-valid checkpoint whose shield current exceeds capacity", () => {
    const content = createGameContentRegistry(runtimeInput({ enemyShield: { capacity: 10 } }));
    const game = new TowerDefenseGame({ missionId: "shield", content, seed: "shield-contract" });
    expect(game.startNextWave().ok).toBe(true);
    game.tick(0.05);
    const checkpoint = JSON.parse(JSON.stringify(game.createCheckpoint())) as Omit<GameCheckpointV1, "state"> & {
      state: GameCheckpointV1["state"] & { combat: CombatSnapshotFixture };
    };
    (checkpoint.state as unknown as { combat: CombatSnapshotFixture }).combat = {
      schemaVersion: 1,
      shields: {
        enemies: {
          enemy_1: { current: 11, capacity: 10, regenerationDelayRemaining: 0 }
        },
        towers: {}
      }
    };
    (checkpoint as { stateDigest: string }).stateDigest = computeCheckpointStateDigest(
      checkpoint.contentDigest,
      checkpoint.identity,
      checkpoint.rng,
      checkpoint.state
    );

    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint: checkpoint as GameCheckpointV1 })).toThrow(/shield/i);
  });
});

describe("TowerScript v3 shield actions", () => {
  const restoreEnemyOnDamage = {
    restore_enemy_shield: {
      schemaVersion: 3,
      id: "restore_enemy_shield",
      bindings: [{ scope: "global" }],
      handlers: {
        enemyShieldChanged: [{
          when: { $op: "eq", args: [{ $get: "event.cause" }, "damage"] },
          actions: [{ action: "restoreEnemyShield", target: "eventEnemy", amount: 3 }]
        }]
      }
    }
  } as unknown as GameContentInput["scripts"];

  it("restores only the event enemy shield, clamps it, emits cause script, and checkpoints the result", () => {
    const content = createGameContentRegistry(runtimeInput({
      enemyShield: { capacity: 10 }, towerDamage: 4, scripts: restoreEnemyOnDamage
    }));
    const game = new TowerDefenseGame({ missionId: "shield", content, seed: "shield-contract" });
    startWithTower(game);
    game.tick(0.05);

    expect(combat(game)?.shields.enemies.enemy_1?.current).toBe(9);
    expect(game.lastEvents).toContainEqual(expect.objectContaining({
      type: "enemyShieldChanged", enemyId: "enemy_1", previous: 6, current: 9,
      capacity: 10, cause: "script", amount: 3
    }));

    const checkpoint = JSON.parse(JSON.stringify(game.createCheckpoint())) as GameCheckpointV1;
    const restored = TowerDefenseGame.fromCheckpoint({ content, checkpoint });
    expect(restored.getStateDigest()).toBe(game.getStateDigest());
    expect(restored.getSnapshot()).toEqual(game.getSnapshot());
  });

  it("restores only the event tower shield after an enemy attack without changing tower HP", () => {
    const game = createGame({
      towerShield: { capacity: 10 }, towerDamage: 0,
      enemyTowerAttack: { interval: 0.05, damage: 7, range: 5 },
      scripts: {
        restore_tower_shield: {
          schemaVersion: 3,
          id: "restore_tower_shield",
          bindings: [{ scope: "global" }],
          handlers: {
            towerShieldChanged: [{
              when: { $op: "eq", args: [{ $get: "event.cause" }, "damage"] },
              actions: [{ action: "restoreTowerShield", target: "eventTower", amount: 4 }]
            }]
          }
        }
      } as unknown as GameContentInput["scripts"]
    });
    startWithTower(game);
    game.tick(0.05);

    expect(game.getSnapshot().towers[0]?.hp).toBe(20);
    expect(combat(game)?.shields.towers.tower_1?.current).toBe(7);
    expect(game.lastEvents).toContainEqual(expect.objectContaining({
      type: "towerShieldChanged", towerId: "tower_1", previous: 3, current: 7,
      capacity: 10, cause: "script", amount: 4
    }));
  });

  it("does not create shields when combat is inactive and records deterministic invalid_action", () => {
    const game = createGame({
      enemyShield: { capacity: 10 }, enabled: false, towerDamage: 0,
      scripts: {
        no_create: {
          schemaVersion: 3,
          id: "no_create",
          bindings: [{ scope: "global" }],
          handlers: {
            tick: [{ actions: [{ action: "restoreEnemyShield", target: "allEnemies", amount: 100 }] }]
          }
        }
      } as unknown as GameContentInput["scripts"]
    });
    expect(game.startNextWave().ok).toBe(true);
    game.tick(0.05);

    expect(combat(game)).toBeUndefined();
    expect(game.getSnapshot().scriptState.diagnostics).toContainEqual(expect.objectContaining({
      scriptId: "no_create", event: "tick", code: "invalid_action"
    }));
    expect(game.lastEvents.some((event) => (
      event.type === "enemyShieldChanged" || event.type === "towerShieldChanged"
    ))).toBe(false);
  });
});
