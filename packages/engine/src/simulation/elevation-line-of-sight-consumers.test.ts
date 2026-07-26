import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import type { TowerScriptDefinition } from "../scripting/types.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { EnemyState, GameEvent, TowerType } from "./types.js";

const BLOCKED_ROUTE = {
  id: "blocked",
  pathCenterline: [{ q: 4, r: 2 }, { q: 5, r: 2 }, { q: 6, r: 2 }]
};
const VISIBLE_ROUTE = {
  id: "visible",
  pathCenterline: [{ q: 4, r: 4 }, { q: 5, r: 4 }, { q: 6, r: 4 }]
};

type Delivery = Extract<TowerType["attack"], { kind: "pipeline" }>["delivery"];

interface ConsumerOptions {
  groups?: Array<{ enemyId: "grunt" | "flyer" | "raider"; routeId: "blocked" | "visible" }>;
  scripts?: Record<string, TowerScriptDefinition>;
  pipelineDelivery?: Delivery;
  pipelineMaxTargets?: number;
  reactions?: boolean;
}

function consumerInput(options: ConsumerOptions = {}): GameContentInput {
  const groups = options.groups ?? [
    { enemyId: "grunt" as const, routeId: "blocked" as const },
    { enemyId: "grunt" as const, routeId: "visible" as const }
  ];
  return {
    balance: {
      defaultMissionId: "los_consumers",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 1_000,
        startingResources: { coins: 1_000 },
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
          id: "floor", label: "Floor", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: ["wet"]
        }
      },
      abilities: {
        strike: {
          id: "strike", label: "Strike", cooldown: 1, duration: 0, radius: 1,
          effects: [{ kind: "damage", amount: 3 }]
        }
      },
      enemies: {
        grunt: {
          id: "grunt", label: "Grunt", maxHp: 100, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        },
        flyer: {
          id: "flyer", label: "Flyer", maxHp: 100, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 2,
          targetClass: "flying"
        },
        raider: {
          id: "raider", label: "Raider", maxHp: 100, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 3,
          towerAttack: { interval: 0.05, damage: 3, range: 12 }
        }
      },
      towers: {
        single: {
          id: "single", label: "Single", cost: { coins: 1 }, footprintRadius: 0, range: 12,
          attack: {
            kind: "single", damageType: "physical", fireRate: 1, damagePerStack: 5,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        },
        sniper: {
          id: "sniper", label: "Sniper", cost: { coins: 1 }, footprintRadius: 0, range: 12,
          attack: { kind: "sniper", interval: 1, damage: 5, targetPriority: "first" }
        },
        antiair: {
          id: "antiair", label: "Anti-air", cost: { coins: 1 }, footprintRadius: 0, range: 12,
          attack: {
            kind: "antiair", fireRate: 1, damage: 5,
            maxTargetsByLevel: [1, 1, 1, 1], upgradeCosts: []
          }
        },
        splash: {
          id: "splash", label: "Splash", cost: { coins: 1 }, footprintRadius: 0, range: 12,
          attack: {
            kind: "splash", interval: 1, damage: 5, splashDamage: 2,
            armoredChipDamage: 0, splashRadius: 2, slowFactor: 0.5, slowDuration: 1
          }
        },
        pulse: {
          id: "pulse", label: "Pulse", cost: { coins: 1 }, footprintRadius: 0, range: 12,
          attack: {
            kind: "pulse", pulseRate: 1, pulseDamage: 5,
            dotDamagePerUnit: 1, dotDuration: 2
          }
        },
        pipeline: {
          id: "pipeline", label: "Pipeline", cost: { coins: 1 }, footprintRadius: 0, range: 12,
          attack: {
            kind: "pipeline", interval: 1,
            targeting: {
              classes: ["ground"], mode: "first",
              maxTargets: options.pipelineMaxTargets ?? 2
            },
            delivery: options.pipelineDelivery ?? { kind: "single" },
            effects: [{ kind: "damage", amount: 5 }]
          }
        },
        beacon: {
          id: "beacon", label: "Beacon", cost: { coins: 1 }, footprintRadius: 0, range: 1,
          attack: { kind: "support", auraRadius: 3, unlocksTowerIds: ["dependent"] }
        },
        dependent: {
          id: "dependent", label: "Dependent", cost: { coins: 1 }, footprintRadius: 0,
          range: 12, maxHp: 20, requiresAuraFrom: "beacon",
          attack: {
            kind: "single", fireRate: 0.01, damagePerStack: 0,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        },
        amplifier: {
          id: "amplifier", label: "Amplifier", cost: { coins: 1 }, footprintRadius: 0, range: 1,
          attack: {
            kind: "support_buff", auraRadius: 3,
            fireRateMultiplierByLevel: [3, 3, 3], affectsTowerIds: ["single"]
          }
        }
      },
      waveSets: {
        wave: [{
          id: "wave_1", label: "Wave 1",
          groups: groups.map((group) => ({
            ...group, count: 1, spawnInterval: 1, startDelay: 0
          }))
        }]
      },
      missions: {
        los_consumers: {
          id: "los_consumers", label: "LoS consumers", description: "",
          startingCoreHp: 20, startingResources: { coins: 1_000 }, prepTimeUnits: 0,
          mapId: "field", waveSetId: "wave",
          buildTowerIds: [
            "single", "sniper", "antiair", "splash", "pulse", "pipeline",
            "beacon", "dependent", "amplifier"
          ],
          abilityIds: ["strike"],
          mechanics: {
            profiles: {
              elevation: "los",
              ...(options.reactions ? { combat: "base", reactions: "fanout" } : {})
            }
          }
        }
      }
    },
    maps: {
      field: {
        id: "field", width: 7, height: 5,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { ...BLOCKED_ROUTE.pathCenterline[0]! },
        coreCoord: { ...BLOCKED_ROUTE.pathCenterline.at(-1)! },
        pathCenterline: BLOCKED_ROUTE.pathCenterline.map((coord) => ({ ...coord })),
        pathRoutes: [BLOCKED_ROUTE, VISIBLE_ROUTE].map((route) => ({
          id: route.id,
          pathCenterline: route.pathCenterline.map((coord) => ({ ...coord }))
        })),
        terrainOverrides: [],
        elevationOverrides: [{ q: 2, r: 2, elevation: 1 }]
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        elevation: {
          schemaVersion: 2,
          enabled: true,
          profiles: { los: { lineOfSight: { terrainBlockerTags: [] } } }
        },
        ...(options.reactions ? {
          combat: {
            schemaVersion: 3,
            enabled: true,
            profiles: {
              base: {
                damageTypes: { physical: { label: "Physical" } },
                armorTypes: {},
                armorAssignments: {},
                marks: { definitions: {} }
              }
            }
          },
          reactions: {
            schemaVersion: 1,
            enabled: true,
            profiles: {
              fanout: {
                exposures: { definitions: {}, applications: { damageTypes: {} } },
                reactions: {
                  wet_fanout: {
                    label: "Wet fanout",
                    trigger: { damageTypes: ["physical"] },
                    requirements: [{ kind: "terrain_tag", tag: "wet" }],
                    effects: {
                      radius: {
                        kind: "damage",
                        amount: { kind: "flat", value: 5 },
                        damageType: "physical",
                        target: { kind: "radius", radius: 2, maxTargets: 8 },
                        allowReactions: false
                      }
                    }
                  }
                }
              }
            }
          }
        } : {})
      }
    } as unknown as GameContentInput["mechanics"],
    ...(options.scripts === undefined ? {} : { scripts: options.scripts }),
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "los_consumers", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
}

function game(options: ConsumerOptions = {}): TowerDefenseGame {
  return new TowerDefenseGame({
    content: createGameContentRegistry(consumerInput(options)),
    missionId: "los_consumers",
    seed: "r3.2-los-consumers"
  });
}

function towerFiredIds(subject: TowerDefenseGame): string[] {
  return subject.lastEvents
    .filter((event): event is Extract<GameEvent, { type: "towerFired" }> => event.type === "towerFired")
    .map((event) => event.enemyId);
}

function spawnAndFire(towerTypeId: string, options: ConsumerOptions = {}): TowerDefenseGame {
  const subject = game(options);
  expect(subject.placeTower(towerTypeId, { q: 0, r: 2 })).toEqual({ ok: true });
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
  return subject;
}

describe("R3.2 LoS direct-acquisition consumers", () => {
  it.each([
    ["sniper", "grunt"],
    ["splash", "grunt"]
  ] as const)("filters the blocked comparator-first target for %s", (towerTypeId, enemyId) => {
    const subject = spawnAndFire(towerTypeId, {
      groups: [
        { enemyId, routeId: "blocked" },
        { enemyId, routeId: "visible" }
      ]
    });
    expect(subject.enemies.map((enemy) => [enemy.id, enemy.routeId])).toEqual([
      ["enemy_1", "blocked"],
      ["enemy_2", "visible"]
    ]);
    expect(towerFiredIds(subject)).toEqual(["enemy_2"]);
  });

  it("filters the blocked comparator-first flying target for antiair", () => {
    const subject = game({
      groups: [
        { enemyId: "flyer", routeId: "blocked" },
        { enemyId: "flyer", routeId: "visible" }
      ]
    });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    // Authored-route mode intentionally omits routeId from flying state. Give these two
    // in-memory contract candidates explicit tracks so acquisition sees one blocked and one clear ray.
    subject.enemies[0]!.routeId = "blocked";
    subject.enemies[1]!.routeId = "visible";
    expect(subject.placeTower("antiair", { q: 0, r: 2 })).toEqual({ ok: true });
    subject.tick(0);
    expect(towerFiredIds(subject)).toEqual(["enemy_2"]);
  });

  it("filters every pulse target as a direct target", () => {
    const subject = spawnAndFire("pulse");
    expect(subject.lastEvents).toContainEqual({
      type: "areaPulse", towerId: "tower_1", enemyIds: ["enemy_2"]
    });
    expect(subject.enemies.find((enemy) => enemy.id === "enemy_1")?.hp).toBe(100);
    expect(subject.enemies.find((enemy) => enemy.id === "enemy_2")?.hp).toBe(95);
  });

  it.each([
    ["single", { kind: "single" }],
    ["multi", { kind: "multi" }],
    ["aura", { kind: "aura" }]
  ] as const)("filters pipeline %s direct targets", (_label, delivery) => {
    const subject = spawnAndFire("pipeline", { pipelineDelivery: delivery });
    expect(towerFiredIds(subject)).toEqual(["enemy_2"]);
  });
});

describe("R3.2 LoS delivery boundary", () => {
  it("filters only the splash primary and preserves a blocked splash secondary", () => {
    const subject = spawnAndFire("splash", {
      groups: [
        { enemyId: "grunt", routeId: "visible" },
        { enemyId: "grunt", routeId: "blocked" }
      ]
    });
    expect(towerFiredIds(subject)).toEqual(["enemy_1"]);
    expect(subject.enemies.map((enemy) => [enemy.id, enemy.hp])).toEqual([
      ["enemy_1", 95],
      ["enemy_2", 98]
    ]);
  });

  it.each([
    ["area", { kind: "area", radius: 2, secondaryMultiplier: 0.5 }],
    ["chain", { kind: "chain", maxJumps: 1, jumpRadius: 2, damageFalloff: 0.5 }]
  ] as const)("filters the pipeline %s primary but not its blocked secondary", (_label, delivery) => {
    const subject = spawnAndFire("pipeline", {
      groups: [
        { enemyId: "grunt", routeId: "visible" },
        { enemyId: "grunt", routeId: "blocked" }
      ],
      pipelineDelivery: delivery,
      pipelineMaxTargets: 1
    });
    expect(towerFiredIds(subject)).toEqual(["enemy_1", "enemy_2"]);
    expect(subject.enemies.map((enemy) => [enemy.id, enemy.hp])).toEqual([
      ["enemy_1", 95],
      ["enemy_2", 97.5]
    ]);
  });
});

function acquisitionAtCount(candidateCount: number): string[] {
  const subject = game({
    groups: [{ enemyId: "grunt", routeId: "blocked" }]
  });
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
  const template = subject.enemies[0]!;
  const candidates: EnemyState[] = Array.from({ length: candidateCount }, (_, index) => ({
    ...template,
    id: `enemy_${String(index).padStart(4, "0")}`,
    hp: 100,
    maxHp: 100,
    pathProgress: 0,
    pathOffset: 0,
    dotRemaining: 0,
    routeId: index === candidateCount - 1 ? "visible" : "blocked",
    statuses: {}
  }));
  // Reverse source order to prove that the bounded prefix is selected after canonical sorting.
  subject.enemies.splice(0, subject.enemies.length, ...candidates.reverse());
  expect(subject.placeTower("single", { q: 0, r: 2 })).toEqual({ ok: true });
  subject.tick(0);
  return towerFiredIds(subject);
}

describe("R3.2 LoS acquisition candidate budget", () => {
  it("includes canonical candidate 4096 but never scans candidate 4097 after 4096 blocked candidates", () => {
    expect(acquisitionAtCount(4_096)).toEqual(["enemy_4095"]);
    expect(acquisitionAtCount(4_097)).toEqual([]);
  });
});

describe("R3.2 LoS non-targeting compatibility boundary", () => {
  it("does not turn support placement or support_buff distance into LoS queries", () => {
    const support = game();
    expect(support.placeTower("beacon", { q: 0, r: 2 })).toEqual({ ok: true });
    // The elevation ridge at {2,2} sits between these towers; support remains radius-only.
    expect(support.placeTower("dependent", { q: 3, r: 2 })).toEqual({ ok: true });

    const buff = game({
      groups: [{ enemyId: "grunt", routeId: "visible" }]
    });
    expect(buff.placeTower("single", { q: 0, r: 2 })).toEqual({ ok: true });
    expect(buff.placeTower("amplifier", { q: 3, r: 2 })).toEqual({ ok: true });
    expect(buff.startNextWave()).toEqual({ ok: true });
    buff.tick(0);
    expect(towerFiredIds(buff)).toEqual(["enemy_1"]);
    expect(buff.towers.find((tower) => tower.typeId === "single")?.cooldown).toBeCloseTo(1 / 3, 8);
  });

  it("does not filter ability damage or enemy tower attacks through LoS", () => {
    const ability = game({
      groups: [{ enemyId: "grunt", routeId: "blocked" }]
    });
    expect(ability.startNextWave()).toEqual({ ok: true });
    ability.tick(0);
    expect(ability.useAbility("strike", { q: 4, r: 2 })).toEqual({ ok: true });
    expect(ability.enemies[0]?.hp).toBe(97);

    const attack = game({
      groups: [{ enemyId: "raider", routeId: "blocked" }]
    });
    expect(attack.placeTower("beacon", { q: 0, r: 1 })).toEqual({ ok: true });
    expect(attack.placeTower("dependent", { q: 0, r: 2 })).toEqual({ ok: true });
    expect(attack.startNextWave()).toEqual({ ok: true });
    attack.tick(0.05);
    expect(attack.towers.find((tower) => tower.typeId === "dependent")?.hp).toBe(17);
    expect(attack.lastEvents).toContainEqual(expect.objectContaining({
      type: "towerAttacked", enemyId: "enemy_1", towerId: "tower_2", damage: 3
    }));
  });

  it("does not filter poison DoT or TowerScript damage through LoS", () => {
    const poison = game({
      groups: [{ enemyId: "grunt", routeId: "blocked" }]
    });
    expect(poison.startNextWave()).toEqual({ ok: true });
    poison.tick(0);
    poison.enemies[0]!.statuses = { poison: { dps: 4, remaining: 2 } };
    poison.tick(0.5);
    expect(poison.enemies[0]?.hp).toBeCloseTo(99.2, 8);

    const scripted = game({
      scripts: {
        los_agnostic_damage: {
          schemaVersion: 5,
          id: "los_agnostic_damage",
          bindings: [{ scope: "global" }],
          handlers: {
            signal: [{ actions: [{ action: "damageEnemy", target: "allEnemies", amount: 6 }] }]
          }
        }
      }
    });
    expect(scripted.startNextWave()).toEqual({ ok: true });
    scripted.tick(0);
    expect(scripted.emitScriptSignal("damage.all")).toEqual({ ok: true });
    expect(scripted.enemies.map((enemy) => enemy.hp)).toEqual([94, 94]);
  });

  it("does not apply LoS to a reaction radius secondary", () => {
    const subject = spawnAndFire("single", {
      reactions: true,
      groups: [
        { enemyId: "grunt", routeId: "visible" },
        { enemyId: "grunt", routeId: "blocked" }
      ]
    });
    expect(towerFiredIds(subject)).toEqual(["enemy_1"]);
    expect(subject.lastEvents).toContainEqual(expect.objectContaining({
      type: "enemyReactionTriggered",
      reactionId: "wet_fanout",
      scheduledTargetIds: ["enemy_2"]
    }));
    expect(subject.enemies.map((enemy) => [enemy.id, enemy.hp])).toEqual([
      ["enemy_1", 95],
      ["enemy_2", 95]
    ]);
  });
});
