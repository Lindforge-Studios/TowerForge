import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import type { DamagePacket, DamageSourceRef } from "./damage.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

const COMPONENT_EVENT_TYPES = new Set(["bossComponentDamaged", "bossComponentDestroyed"]);

function fixture(options: { scripts?: boolean; immuneComponent?: boolean } = {}): GameContentInput {
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
          color: 0x884444
        }
      },
      towers: {
        pelter: {
          id: "pelter",
          label: "Pelter",
          cost: { coins: 5 },
          footprintRadius: 0,
          range: 10,
          attack: {
            kind: "single",
            fireRate: 1,
            damagePerStack: 20,
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
          mechanics: { profiles: { combat: "component_combat", enemyBehaviors: "bosses" } }
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
          schemaVersion: 2,
          enabled: true,
          profiles: {
            component_combat: {
              damageTypes: { physical: { label: "Physical" } },
              armorTypes: { immune: { label: "Immune", multipliers: { physical: 0 } } },
              armorAssignments: { enemies: {} },
              shields: { enemies: { citadel_boss: { capacity: 5 } } }
            }
          }
        },
        enemyBehaviors: {
          schemaVersion: 1,
          enabled: true,
          profiles: {
            bosses: {
              bosses: {
                citadel_boss: {
                  components: {
                    core: {
                      maxHp: 20,
                      hitRegion: { kind: "circle", offsetX: 0, offsetY: 0, radius: 0.25 },
                      tags: ["weapon"],
                      shield: { capacity: 7 },
                      ...(options.immuneComponent ? { armorTypeId: "immune" } : {})
                    }
                  }
                }
              },
              targeting: { towers: { pelter: { priorityTags: ["weapon"] } } }
            }
          }
        }
      }
    },
    ...(options.scripts ? {
      scripts: {
        component_probe: {
          schemaVersion: 7,
          id: "component_probe",
          bindings: [{ scope: "global" }],
          handlers: {
            bossComponentDamaged: [{ actions: [{ action: "incrementState", key: "damaged" }] }],
            bossComponentDestroyed: [{ actions: [{ action: "incrementState", key: "destroyed" }] }]
          }
        }
      }
    } : {}),
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        biome: "test",
        accent: "#884444",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        connections: []
      }],
      missionNodes: [{
        missionId: "boss_lab",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function start(options: { scripts?: boolean; immuneComponent?: boolean } = {}) {
  const content = createGameContentRegistry(fixture(options));
  const game = new TowerDefenseGame({ missionId: "boss_lab", content, seed: "r12-component-events" });
  expect(game.startNextWave()).toEqual({ ok: true });
  game.tick(0.01);
  expect(game.placeTower("pelter", { q: 1, r: 0 })).toEqual({ ok: true });
  const enemy = game.enemies[0]!;
  const tower = game.towers[0]!;
  return { game, enemy, tower };
}

function directComponentDamage(game: TowerDefenseGame, source: DamageSourceRef, amount: number): void {
  const enemy = game.enemies[0]!;
  const packet: DamagePacket = {
    amount,
    source,
    target: {
      kind: "enemy",
      enemyId: enemy.id,
      enemyTypeId: enemy.typeId,
      componentId: "core"
    }
  };
  (game as unknown as {
    resolveAndApplyDamage(packet: DamagePacket, context: undefined, mutableTarget: unknown): unknown;
  }).resolveAndApplyDamage(packet, undefined, { kind: "enemy", enemy });
}

function towerComponentDamage(
  game: TowerDefenseGame,
  tower: TowerDefenseGame["towers"][number],
  enemy: TowerDefenseGame["enemies"][number],
  amount: number
): void {
  (game as unknown as {
    applyTowerDamage(
      tower: TowerDefenseGame["towers"][number],
      enemy: TowerDefenseGame["enemies"][number],
      rawDamage: number,
      options: Record<string, never>
    ): number;
  }).applyTowerDamage(tower, enemy, amount, {});
}

function componentEvents(game: TowerDefenseGame, from: number) {
  return game.lastEvents.slice(from).filter((event) => COMPONENT_EVENT_TYPES.has(event.type));
}

describe("R12.2 boss-component runtime events (RED)", () => {
  it("emits root shield, component damage, and legacy enemyHit in stable order with exact deltas", () => {
    const { game, enemy, tower } = start();
    const before = game.lastEvents.length;

    towerComponentDamage(game, tower, enemy, 20);

    const events = game.lastEvents.slice(before);
    expect(events.map((event) => event.type)).toEqual([
      "enemyShieldChanged",
      "bossComponentDamaged",
      "enemyHit"
    ]);
    expect(events[1]).toEqual({
      type: "bossComponentDamaged",
      enemyId: enemy.id,
      enemyTypeId: "citadel_boss",
      componentId: "core",
      sourceKind: "tower",
      previousHp: 20,
      currentHp: 12,
      maxHp: 20,
      hpDamage: 8,
      previousShield: 7,
      currentShield: 0,
      shieldCapacity: 7,
      shieldAbsorbed: 7
    });
    expect(events[2]).not.toHaveProperty("componentId");
  });

  it("emits damage then exactly-once destruction before legacy enemyHit and never repeats for a dead component", () => {
    const { game, enemy, tower } = start();
    towerComponentDamage(game, tower, enemy, 20);
    const before = game.lastEvents.length;

    towerComponentDamage(game, tower, enemy, 20);

    const events = game.lastEvents.slice(before);
    expect(events.map((event) => event.type)).toEqual([
      "bossComponentDamaged",
      "bossComponentDestroyed",
      "enemyHit"
    ]);
    expect(events[0]).toEqual({
      type: "bossComponentDamaged",
      enemyId: enemy.id,
      enemyTypeId: "citadel_boss",
      componentId: "core",
      sourceKind: "tower",
      previousHp: 12,
      currentHp: 0,
      maxHp: 20,
      hpDamage: 12,
      previousShield: 0,
      currentShield: 0,
      shieldCapacity: 7,
      shieldAbsorbed: 0
    });
    expect(events[1]).toEqual({ ...events[0], type: "bossComponentDestroyed" });
    expect(events[2]).not.toHaveProperty("componentId");

    const afterDeath = game.lastEvents.length;
    directComponentDamage(game, { kind: "ability", abilityId: "repeat_probe" }, 10);
    expect(componentEvents(game, afterDeath)).toEqual([]);
  });

  it.each([
    ["tower", { kind: "tower", towerId: "tower_probe", towerTypeId: "pelter" }],
    ["ability", { kind: "ability", abilityId: "ability_probe" }],
    ["tower_script", { kind: "tower_script", scriptId: "script_probe" }],
    ["status", { kind: "status", statusId: "status_probe" }],
    ["reaction", { kind: "reaction", reactionId: "reaction_probe" }],
    ["enemy", { kind: "enemy", enemyId: "source_enemy", enemyTypeId: "citadel_boss" }],
    ["leak", { kind: "leak", enemyId: "source_enemy", enemyTypeId: "citadel_boss" }]
  ] as const)("maps the %s DamagePacket source without exposing source ids", (expectedKind, source) => {
    const { game } = start();
    const before = game.lastEvents.length;

    directComponentDamage(game, source, 20);

    expect(componentEvents(game, before)).toEqual([
      expect.objectContaining({
        type: "bossComponentDamaged",
        sourceKind: expectedKind,
        previousHp: 20,
        currentHp: 12,
        hpDamage: 8,
        shieldAbsorbed: 7
      })
    ]);
    expect(componentEvents(game, before)[0]).not.toHaveProperty("sourceId");
  });

  it("emits no component event for root-shield-only or zero-after-armor damage", () => {
    const shielded = start();
    const beforeShield = shielded.game.lastEvents.length;
    directComponentDamage(shielded.game, { kind: "ability", abilityId: "chip" }, 4);
    expect(shielded.game.lastEvents.slice(beforeShield).map((event) => event.type)).toEqual([
      "enemyShieldChanged"
    ]);
    expect(componentEvents(shielded.game, beforeShield)).toEqual([]);

    const immune = start({ immuneComponent: true });
    const beforeArmor = immune.game.lastEvents.length;
    directComponentDamage(immune.game, { kind: "ability", abilityId: "blocked" }, 20);
    expect(immune.game.lastEvents.slice(beforeArmor)).toEqual([]);
  });

  it("dispatches both component events through v7 TowerScript handlers", () => {
    const { game, enemy, tower } = start({ scripts: true });
    towerComponentDamage(game, tower, enemy, 20);
    towerComponentDamage(game, tower, enemy, 20);
    (game as unknown as { finishScriptedAction(): void }).finishScriptedAction();

    expect(game.getSnapshot().scriptState.values.component_probe?.["global:global"]).toEqual({
      damaged: 2,
      destroyed: 1
    });
  });
});
