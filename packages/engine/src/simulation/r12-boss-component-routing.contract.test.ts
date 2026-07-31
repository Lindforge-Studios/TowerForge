import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import type { DamagePacket } from "./damage.js";
import type { EnemyBehaviorsStateV1 } from "./types.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type ComponentKey = "z_weapon" | "a_weapon" | "shield_core";

function componentRecord(order: readonly ComponentKey[]) {
  const definitions = {
    z_weapon: {
      maxHp: 20,
      hitRegion: { kind: "circle", offsetX: 0.2, offsetY: 0, radius: 0.2 },
      tags: ["weapon"]
    },
    a_weapon: {
      maxHp: 20,
      hitRegion: { kind: "circle", offsetX: -0.2, offsetY: 0, radius: 0.2 },
      tags: ["weapon"]
    },
    shield_core: {
      maxHp: 20,
      hitRegion: { kind: "circle", offsetX: 0, offsetY: 0.2, radius: 0.2 },
      tags: ["shield"],
      disablesAbilities: ["towerAttack", "towerDisrupt", "healAura"]
    }
  } as const;
  return Object.fromEntries(order.map((id) => [id, definitions[id]]));
}

function fixture(order: readonly ComponentKey[] = ["z_weapon", "shield_core", "a_weapon"]): GameContentInput {
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
          speed: 0.001,
          reward: { coins: 25 },
          coinReward: 25,
          coreDamage: 5,
          color: 0x884444,
          towerAttack: { interval: 0.05, damage: 3, range: 10 },
          towerDisrupt: { interval: 0.05, radius: 10, duration: 1 },
          healAura: { radius: 10, healPerUnit: 10, includeSelf: false }
        },
        escort: {
          id: "escort",
          label: "Escort",
          maxHp: 50,
          speed: 0.001,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 0x666666
        }
      },
      towers: {
        pelter: {
          id: "pelter",
          label: "Pelter",
          cost: { coins: 5 },
          footprintRadius: 0,
          range: 10,
          maxHp: 20,
          attack: {
            kind: "single",
            fireRate: 1,
            damagePerStack: 6,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 5
          }
        }
      },
      waveSets: {
        boss_wave: [{
          id: "boss_wave_1",
          label: "Boss",
          groups: [
            { enemyId: "citadel_boss", count: 1, spawnInterval: 1, startDelay: 0 },
            { enemyId: "escort", count: 1, spawnInterval: 1, startDelay: 0 }
          ]
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
          mechanics: { profiles: { enemyBehaviors: "bosses" } }
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
        enemyBehaviors: {
          schemaVersion: 1,
          enabled: true,
          profiles: {
            bosses: {
              bosses: { citadel_boss: { components: componentRecord(order) } },
              targeting: { towers: { pelter: { priorityTags: ["weapon", "shield"] } } }
            }
          }
        }
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

function start(order?: readonly ComponentKey[]) {
  const content = createGameContentRegistry(fixture(order));
  const game = new TowerDefenseGame({ missionId: "boss_lab", content, seed: "r12-routing" });
  expect(game.startNextWave()).toEqual({ ok: true });
  game.tick(0.01);
  expect(game.placeTower("pelter", { q: 1, r: 0 })).toEqual({ ok: true });
  const boss = game.enemies.find((enemy) => enemy.typeId === "citadel_boss")!;
  const escort = game.enemies.find((enemy) => enemy.typeId === "escort")!;
  const tower = game.towers[0]!;
  expect(boss).toBeDefined();
  expect(escort).toBeDefined();
  return { content, game, boss, escort, tower };
}

function componentStates(game: TowerDefenseGame) {
  return (game.getSnapshot().enemyBehaviors as EnemyBehaviorsStateV1).components.enemy_1!;
}

function directDamage(game: TowerDefenseGame, enemy: TowerDefenseGame["enemies"][number], amount: number, componentId?: string) {
  const packet = {
    amount,
    source: { kind: "ability", abilityId: "test_damage" },
    target: {
      kind: "enemy",
      enemyId: enemy.id,
      enemyTypeId: enemy.typeId,
      ...(componentId === undefined ? {} : { componentId })
    }
  } as DamagePacket;
  (game as unknown as {
    resolveAndApplyDamage(packet: DamagePacket, context: undefined, mutableTarget: unknown): unknown;
  }).resolveAndApplyDamage(packet, undefined, { kind: "enemy", enemy });
}

function towerDamage(
  game: TowerDefenseGame,
  tower: TowerDefenseGame["towers"][number],
  enemy: TowerDefenseGame["enemies"][number]
) {
  return (game as unknown as {
    applyResolvedTowerDamage(
      towerTypeId: string,
      enemy: TowerDefenseGame["enemies"][number],
      rawDamage: number,
      options: Record<string, never>,
      towerId: string
    ): unknown;
  }).applyResolvedTowerDamage(tower.typeId, enemy, 6, {}, tower.id);
}

describe("R12.1c authored boss-component routing (RED)", () => {
  it("routes live tower damage by authored priorityTags and binary componentId", () => {
    const { game, boss, tower } = start();

    towerDamage(game, tower, boss);

    expect(componentStates(game).a_weapon?.hp).toBe(14);
    expect(componentStates(game).z_weapon?.hp).toBe(20);
    expect(boss.hp).toBe(100);
  });

  it("skips destroyed components and falls back to root only after every component is destroyed", () => {
    const { game, boss, tower } = start();
    directDamage(game, boss, 20, "a_weapon");

    towerDamage(game, tower, boss);
    expect(componentStates(game).z_weapon?.hp).toBe(14);
    expect(boss.hp).toBe(100);

    directDamage(game, boss, 20, "z_weapon");
    directDamage(game, boss, 20, "shield_core");
    towerDamage(game, tower, boss);
    expect(boss.hp).toBe(94);
  });

  it("settles no root death, reward, loot, or kill for component destruction", () => {
    const { game, boss } = start();
    const before = game.getSnapshot();

    directDamage(game, boss, 100, "a_weapon");
    game.tick(0);
    const after = game.getSnapshot();

    expect(componentStates(game).a_weapon?.hp).toBe(0);
    expect(boss.hp).toBe(100);
    expect(after.killCount).toBe(before.killCount);
    expect(after.resources).toEqual(before.resources);
    expect(game.enemies.some((enemy) => enemy.id === boss.id)).toBe(true);
    expect(game.lastEvents.some((event) => event.type === "enemyKilled")).toBe(false);
  });

  it("suppresses towerAttack, towerDisrupt, and healAura after their controller is destroyed", () => {
    const { game, boss, escort } = start();
    directDamage(game, escort, 10);
    directDamage(game, boss, 100, "shield_core");

    game.tick(0.1);

    expect(escort.hp).toBe(40);
    expect(game.lastEvents.some((event) => event.type === "enemyHealed")).toBe(false);
    expect(game.lastEvents.some((event) => event.type === "towerAttacked")).toBe(false);
    expect(game.lastEvents.some((event) => event.type === "towerDisrupted")).toBe(false);
  });

  it("is invariant to component record insertion order", () => {
    const left = start(["z_weapon", "shield_core", "a_weapon"]);
    const right = start(["a_weapon", "z_weapon", "shield_core"]);

    towerDamage(left.game, left.tower, left.boss);
    towerDamage(right.game, right.tower, right.boss);

    expect(componentStates(left.game)).toEqual(componentStates(right.game));
    expect(componentStates(left.game).a_weapon?.hp).toBe(14);
    expect(left.game.getStateDigest()).toBe(right.game.getStateDigest());
  });
});
