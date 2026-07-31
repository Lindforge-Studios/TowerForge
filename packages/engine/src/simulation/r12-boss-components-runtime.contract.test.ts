import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { computeCheckpointStateDigest, type GameCheckpointV1 } from "./checkpoint.js";
import type { DamagePacket } from "./damage.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type Activation = "active" | "disabled" | "unselected" | "absent";

interface ComponentStateFixture {
  readonly hp: number;
  readonly maxHp: number;
  readonly shield?: {
    readonly current: number;
    readonly capacity: number;
    readonly regenerationDelayRemaining: number;
  };
}

interface EnemyBehaviorsStateFixture {
  readonly schemaVersion: 1;
  readonly components: Readonly<Record<string, Readonly<Record<string, ComponentStateFixture>>>>;
}

function input(activation: Activation = "active"): GameContentInput {
  const selected = activation === "active" || activation === "disabled";
  return {
    balance: {
      defaultMissionId: "boss_lab",
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
      abilities: {},
      enemies: {
        citadel_boss: {
          id: "citadel_boss",
          label: "Citadel Boss",
          maxHp: 100,
          speed: 0.01,
          reward: { coins: 10 },
          coinReward: 10,
          coreDamage: 5,
          color: 0x884444,
          towerAttack: { interval: 0.5, damage: 3, range: 4 }
        }
      },
      towers: {
        pelter: {
          id: "pelter", label: "Pelter", cost: { coins: 5 }, footprintRadius: 0, range: 6, maxHp: 30,
          attack: { kind: "single", fireRate: 1, damagePerStack: 1, startingStacks: 1, maxStacks: 1, upgradeCost: 1 }
        }
      },
      waveSets: {
        boss_wave: [{
          id: "boss_wave_1",
          label: "Boss",
          groups: [{ enemyId: "citadel_boss", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        boss_lab: {
          id: "boss_lab",
          label: "Boss Lab",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 0,
          mapId: "lane",
          waveSetId: "boss_wave",
          buildTowerIds: ["pelter"],
          abilityIds: [],
          ...(selected ? { mechanics: { profiles: { combat: "shielded", enemyBehaviors: "bosses" } } } : {
            mechanics: { profiles: { combat: "shielded" } }
          })
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 8,
        height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 7, r: 1 },
        pathCenterline: Array.from({ length: 8 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 1,
          enabled: true,
          profiles: { shielded: { shields: { enemies: { citadel_boss: { capacity: 5 } } } } }
        },
        ...(activation === "absent" ? {} : {
          enemyBehaviors: {
            schemaVersion: 1,
            enabled: activation !== "disabled",
            profiles: {
              bosses: {
                bosses: {
                  citadel_boss: {
                    components: {
                      alpha_core: {
                        maxHp: 10,
                        hitRegion: { kind: "circle", offsetX: 0.25, offsetY: 0, radius: 0.2 },
                        tags: ["weapon"],
                        disablesAbilities: ["towerAttack"]
                      },
                      left_cannon: {
                        maxHp: 20,
                        hitRegion: { kind: "circle", offsetX: -0.25, offsetY: 0, radius: 0.2 },
                        tags: ["weapon"],
                        shield: { capacity: 7 }
                      }
                    }
                  }
                },
                targeting: { towers: { pelter: { priorityTags: ["weapon"] } } }
              }
            }
          }
        })
      }
    },
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#884444",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "boss_lab", regionId: "region", x: 5, y: 5, difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function spawn(activation: Activation = "active"): { content: ReturnType<typeof createGameContentRegistry>; game: TowerDefenseGame } {
  const content = createGameContentRegistry(input(activation));
  const game = new TowerDefenseGame({ missionId: "boss_lab", content, seed: "r12-components-runtime" });
  expect(game.startNextWave()).toEqual({ ok: true });
  game.tick(0.01);
  expect(game.enemies).toHaveLength(1);
  return { content, game };
}

function componentState(game: TowerDefenseGame): ComponentStateFixture | undefined {
  const section = (game.getSnapshot() as unknown as { enemyBehaviors?: EnemyBehaviorsStateFixture }).enemyBehaviors;
  return section?.components.enemy_1?.left_cannon;
}

function applyComponentDamage(game: TowerDefenseGame, amount: number): void {
  const enemy = game.enemies[0]!;
  const packet = {
    amount,
    source: { kind: "tower", towerId: "tower_1", towerTypeId: "pelter" },
    target: {
      kind: "enemy",
      enemyId: enemy.id,
      enemyTypeId: enemy.typeId,
      componentId: "left_cannon"
    }
  } as unknown as DamagePacket;
  const boundary = game as unknown as {
    resolveAndApplyDamage(packet: DamagePacket, context: undefined, mutableTarget: unknown): unknown;
  };
  boundary.resolveAndApplyDamage(packet, undefined, { kind: "enemy", enemy });
}

describe("R12.1b boss-component runtime contract (RED)", () => {
  it("publishes active component state only in the optional enemyBehaviors snapshot", () => {
    const { game } = spawn();

    expect((game.getSnapshot() as unknown as { enemyBehaviors?: EnemyBehaviorsStateFixture }).enemyBehaviors)
      .toEqual({
        schemaVersion: 1,
        components: {
          enemy_1: {
            alpha_core: { hp: 10, maxHp: 10 },
            left_cannon: {
              hp: 20,
              maxHp: 20,
              shield: { current: 7, capacity: 7, regenerationDelayRemaining: 0 }
            }
          }
        }
      });
  });

  it("applies root shield, then component shield and HP without overflowing into root HP", () => {
    const { game } = spawn();
    const root = game.enemies[0]!;

    applyComponentDamage(game, 20);

    expect(root.hp).toBe(100);
    expect((game.getSnapshot().combat as any).shields.enemies.enemy_1.current).toBe(0);
    expect(componentState(game)).toEqual({
      hp: 12,
      maxHp: 20,
      shield: { current: 0, capacity: 7, regenerationDelayRemaining: 0 }
    });
  });

  it("round-trips active component state through GameCheckpointV1 with identical digest", () => {
    const { content, game } = spawn();
    applyComponentDamage(game, 9);
    const checkpoint = JSON.parse(JSON.stringify(game.createCheckpoint())) as GameCheckpointV1;
    const checkpointEnemyBehaviors = (
      checkpoint.state as unknown as { enemyBehaviors?: EnemyBehaviorsStateFixture }
    ).enemyBehaviors;

    expect(checkpointEnemyBehaviors).toBeDefined();
    expect(checkpointEnemyBehaviors)
      .toEqual((game.getSnapshot() as unknown as { enemyBehaviors?: EnemyBehaviorsStateFixture }).enemyBehaviors);
    expect(checkpoint.stateDigest).toBe(computeCheckpointStateDigest(
      checkpoint.contentDigest,
      checkpoint.identity,
      checkpoint.rng,
      checkpoint.state
    ));

    const restored = TowerDefenseGame.fromCheckpoint({ content, checkpoint });
    expect(restored.getSnapshot()).toEqual(game.getSnapshot());
    expect(restored.getStateDigest()).toBe(game.getStateDigest());
  });

  it("rejects an unknown component target before mutating root or component state", () => {
    const { game } = spawn();
    const enemy = game.enemies[0]!;
    const beforeRootHp = enemy.hp;
    const before = componentState(game);
    const packet = {
      amount: 20,
      source: { kind: "ability", abilityId: "strike" },
      target: { kind: "enemy", enemyId: enemy.id, enemyTypeId: enemy.typeId, componentId: "missing" }
    } as unknown as DamagePacket;
    const boundary = game as unknown as {
      resolveAndApplyDamage(packet: DamagePacket, context: undefined, mutableTarget: unknown): unknown;
    };

    expect(() => boundary.resolveAndApplyDamage(packet, undefined, { kind: "enemy", enemy }))
      .toThrow(/target does not match/i);
    expect(enemy.hp).toBe(beforeRootHp);
    expect(componentState(game)).toEqual(before);
  });

  it("rejects malformed active checkpoint component records", () => {
    const { content, game } = spawn();
    const checkpoint = JSON.parse(JSON.stringify(game.createCheckpoint())) as GameCheckpointV1;
    delete (checkpoint.state as any).enemyBehaviors.components.enemy_1.left_cannon;
    (checkpoint as any).stateDigest = computeCheckpointStateDigest(
      checkpoint.contentDigest, checkpoint.identity, checkpoint.rng, checkpoint.state
    );
    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint })).toThrow(/enemyBehaviors/i);
  });

  it("rejects injected component state when the capability is absent", () => {
    const { content, game } = spawn("absent");
    const checkpoint = JSON.parse(JSON.stringify(game.createCheckpoint())) as GameCheckpointV1;
    (checkpoint.state as any).enemyBehaviors = { schemaVersion: 1, components: {} };
    (checkpoint as any).stateDigest = computeCheckpointStateDigest(
      checkpoint.contentDigest, checkpoint.identity, checkpoint.rng, checkpoint.state
    );
    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint })).toThrow(/enemyBehaviors.*inactive/i);
  });

  it("routes tower damage by authored tag and binary component id, then skips destroyed components", () => {
    const { game } = spawn();
    const enemy = game.enemies[0]!;
    const boundary = game as unknown as {
      applyResolvedTowerDamage(towerTypeId: string, enemy: TowerDefenseGame["enemies"][number], amount: number): unknown;
    };
    const coinsBefore = game.coins;

    boundary.applyResolvedTowerDamage("pelter", enemy, 20);
    let section = (game.getSnapshot() as any).enemyBehaviors.components.enemy_1;
    expect(section.alpha_core.hp).toBe(0);
    expect(section.left_cannon.hp).toBe(20);
    expect(enemy.hp).toBe(100);
    expect(game.coins).toBe(coinsBefore);
    expect(game.getSnapshot().killCount).toBe(0);

    boundary.applyResolvedTowerDamage("pelter", enemy, 8);
    section = (game.getSnapshot() as any).enemyBehaviors.components.enemy_1;
    expect(section.left_cannon.shield.current).toBe(0);
    expect(section.left_cannon.hp).toBe(19);
  });

  it("falls back to root targeting after all matching components are destroyed", () => {
    const { game } = spawn();
    const enemy = game.enemies[0]!;
    const boundary = game as unknown as {
      applyResolvedTowerDamage(towerTypeId: string, enemy: TowerDefenseGame["enemies"][number], amount: number): unknown;
    };
    boundary.applyResolvedTowerDamage("pelter", enemy, 20);
    boundary.applyResolvedTowerDamage("pelter", enemy, 100);
    expect(enemy.hp).toBe(100);
    boundary.applyResolvedTowerDamage("pelter", enemy, 5);
    expect(enemy.hp).toBe(95);
  });

  it("suppresses an authored boss ability after its owning component is destroyed", () => {
    const { game } = spawn();
    const enemy = game.enemies[0]!;
    const boundary = game as unknown as {
      applyResolvedTowerDamage(towerTypeId: string, enemy: TowerDefenseGame["enemies"][number], amount: number): unknown;
    };
    boundary.applyResolvedTowerDamage("pelter", enemy, 20);
    expect(game.placeTower("pelter", { q: 1, r: 0 })).toEqual({ ok: true });
    game.tick(1);
    expect(game.lastEvents.some((event) => event.type === "towerAttacked")).toBe(false);
    expect(game.towers[0]?.hp).toBe(30);
  });

  it.each(["absent", "disabled", "unselected"] as const)(
    "keeps the %s capability snapshot and checkpoint byte shape free of enemyBehaviors",
    (activation) => {
      const { game } = spawn(activation);
      expect(Object.prototype.hasOwnProperty.call(game.getSnapshot(), "enemyBehaviors")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(game.createCheckpoint().state, "enemyBehaviors")).toBe(false);
    }
  );
});
