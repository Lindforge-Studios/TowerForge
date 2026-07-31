import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import type { DamageSourceRef } from "./damage.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type Activation = "active" | "disabled" | "unselected" | "absent";

function content(activation: Activation = "active"): GameContentRegistry {
  const selected = activation === "active" || activation === "disabled";
  const registry = createGameContentRegistry({
    balance: {
      defaultMissionId: "boss_lab",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 20, startingCoins: 100, startingResources: { coins: 100 },
        prepTimeUnits: 0, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1, pathWaterDurationUnits: 1, pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {},
      enemies: {
        boss: {
          id: "boss", label: "Boss", maxHp: 100, speed: 0.01, reward: { coins: 10 },
          coinReward: 10, coreDamage: 5, color: 0x884444,
          towerAttack: { interval: 1, damage: 1, range: 1 }
        }
      },
      towers: {
        pelter: {
          id: "pelter", label: "Pelter", cost: { coins: 1 }, footprintRadius: 0, range: 20,
          attack: { kind: "single", fireRate: 10, damagePerStack: 20, startingStacks: 1, maxStacks: 1, upgradeCost: 1 }
        }
      },
      waveSets: { boss_wave: [{ id: "w1", label: "Boss", groups: [{ enemyId: "boss", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
      missions: {
        boss_lab: {
          id: "boss_lab", label: "Boss lab", description: "", startingCoreHp: 20,
          startingResources: { coins: 100 }, prepTimeUnits: 0, mapId: "lane", waveSetId: "boss_wave",
          buildTowerIds: ["pelter"], abilityIds: [],
          ...(selected ? { mechanics: { profiles: { enemyBehaviors: "bosses" } } } : {})
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 8, height: 3, grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 7, r: 1 },
        pathCenterline: Array.from({ length: 8 }, (_, q) => ({ q, r: 1 })), pathRoutes: [], terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        ...(activation === "absent" ? {} : {
          enemyBehaviors: {
            schemaVersion: 1, enabled: activation !== "disabled",
            profiles: {
              bosses: {
                bosses: {
                  boss: {
                    components: {
                      weapon: {
                        maxHp: 10,
                        label: "Main weapon",
                        hitRegion: { kind: "circle", offsetX: 0, offsetY: 0, radius: 0.25 },
                        tags: ["weapon", "phase_trigger"],
                        shield: { capacity: 3 },
                        disablesAbilities: ["towerAttack"]
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
    scripts: {
      boss_phases: {
        schemaVersion: 7,
        id: "boss_phases",
        bindings: [],
        handlers: {},
        stateMachines: [
          phaseMachine("enemy_phase", { scope: "enemy", ids: ["boss"] }),
          phaseMachine("map_phase", { scope: "map", ids: ["lane"] }),
          phaseMachine("global_phase", { scope: "global" })
        ]
      } as never
    },
    worldMap: {
      width: 10, height: 10,
      regions: [{ id: "r", label: "R", description: "", biome: "test", accent: "#884444", bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: [] }],
      missionNodes: [{ missionId: "boss_lab", regionId: "r", x: 5, y: 5, difficulty: 1, unlockRequiresMissionIds: [] }]
    }
  } as unknown as GameContentInput);
  return registry;
}

function phaseMachine(id: string, binding: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id,
    bindings: [binding],
    initial: "intact",
    states: [
      {
        id: "intact",
        transitions: [{
          id: "component_wounded",
          event: "bossComponentDamaged",
          target: "/wounded",
          when: {
            $op: "and",
            args: [
              { $op: "eq", args: [{ $get: "component.id" }, "weapon"] },
              { $op: "lt", args: [{ $get: "component.hpRatio" }, 1] }
            ]
          },
          actions: [
            { action: "setState", key: "targetBeforeAction", value: { $get: "machine.activeStatePath" } },
            { action: "setState", key: "capturedHp", value: { $get: "component.hp" } },
            { action: "setState", key: "capturedShield", value: { $get: "component.shield.current" } }
          ]
        }]
      },
      {
        id: "wounded",
        transitions: [{
          id: "component_destroyed",
          event: "bossComponentDestroyed",
          target: "/destroyed",
          when: { $get: "component.destroyed" },
          actions: [{ action: "emitSignal", signal: "phase.changed", payload: { componentId: { $get: "component.id" } } }]
        }]
      },
      { id: "destroyed", entryActions: [{ action: "setState", key: "destroyed", value: true }] }
    ]
  };
}

function spawn(registry = content()): TowerDefenseGame {
  const game = new TowerDefenseGame({ missionId: "boss_lab", content: registry, seed: "r12-hfsm" });
  expect(game.startNextWave()).toEqual({ ok: true });
  game.tick(0.01);
  expect(game.enemies).toHaveLength(1);
  return game;
}

function strike(game: TowerDefenseGame, amount: number, source: DamageSourceRef = { kind: "ability", abilityId: "test" }): void {
  const enemy = game.enemies[0]!;
  const runtime = game as unknown as {
    applyResolvedEnemyDamage(enemy: unknown, amount: number, source: DamageSourceRef, options: { componentId: string }): unknown;
    finishScriptedAction(): void;
  };
  runtime.applyResolvedEnemyDamage(enemy, amount, source, { componentId: "weapon" });
  runtime.finishScriptedAction();
}

function machineState(game: TowerDefenseGame, machineId: string, contextId: string): Record<string, unknown> {
  return (game.getSnapshot().scriptState.machines as any).boss_phases[machineId][contextId];
}

describe("R12.2 boss-component HFSM runtime contract (RED)", () => {
  it("provides the captured post-hit component root to enemy, map, and global machines", () => {
    const game = spawn();
    game.lastEvents.length = 0;

    strike(game, 4, { kind: "ability", abilityId: "test" });

    expect(game.lastEvents).toContainEqual({
      type: "bossComponentDamaged",
      enemyId: "enemy_1",
      enemyTypeId: "boss",
      componentId: "weapon",
      sourceKind: "ability",
      previousHp: 10,
      currentHp: 9,
      maxHp: 10,
      hpDamage: 1,
      previousShield: 3,
      currentShield: 0,
      shieldCapacity: 3,
      shieldAbsorbed: 3
    });
    expect(machineState(game, "enemy_phase", "enemy:enemy_1")).toMatchObject({ activeStatePath: "/wounded", transitionCount: 1 });
    expect(machineState(game, "map_phase", "map:lane")).toMatchObject({ activeStatePath: "/wounded", transitionCount: 1 });
    expect(machineState(game, "global_phase", "global:global")).toMatchObject({ activeStatePath: "/wounded", transitionCount: 1 });
    for (const key of ["enemy:enemy_1", "map:lane", "global:global"]) {
      expect((game.getSnapshot().scriptState.values as any).boss_phases[key]).toMatchObject({
        targetBeforeAction: "/wounded",
        capturedHp: 9,
        capturedShield: 0
      });
    }
  });

  it("processes damaged then destroyed as distinct events and never repeats destruction", () => {
    const game = spawn();
    strike(game, 4);
    const beforeDestroy = game.lastEvents.length;

    strike(game, 50, { kind: "tower_script", scriptId: "test" });

    expect(game.lastEvents.slice(beforeDestroy).filter((event) => String(event.type) === "bossComponentDamaged" || String(event.type) === "bossComponentDestroyed"))
      .toEqual([
        expect.objectContaining({ type: "bossComponentDamaged", previousHp: 9, currentHp: 0, hpDamage: 9, sourceKind: "tower_script" }),
        expect.objectContaining({ type: "bossComponentDestroyed", previousHp: 9, currentHp: 0, hpDamage: 9, sourceKind: "tower_script" })
      ]);
    expect(machineState(game, "enemy_phase", "enemy:enemy_1")).toMatchObject({ activeStatePath: "/destroyed", transitionCount: 2 });
    expect((game.getSnapshot().scriptState.values as any).boss_phases["enemy:enemy_1"]).toMatchObject({ destroyed: true });

    const beforeDeadHit = game.lastEvents.length;
    strike(game, 5);
    expect(game.lastEvents.slice(beforeDeadHit).filter((event) => String(event.type) === "bossComponentDamaged" || String(event.type) === "bossComponentDestroyed")).toEqual([]);
  });

  it("keeps the new target state active when a transition action fails", () => {
    const registry = content();
    const script = registry.scripts.boss_phases as any;
    script.stateMachines = [{
      schemaVersion: 1,
      id: "failure_phase",
      bindings: [{ scope: "enemy", ids: ["boss"] }],
      initial: "intact",
      states: [{
        id: "intact",
        transitions: [{
          id: "fail_after_commit", event: "bossComponentDamaged", target: "/committed",
          actions: [{ action: "restoreEnemyShield", target: "self", amount: 1 }]
        }]
      }, { id: "committed" }]
    }];
    const game = spawn(registry);

    strike(game, 4);

    expect(machineState(game, "failure_phase", "enemy:enemy_1")).toMatchObject({ activeStatePath: "/committed", transitionCount: 1 });
    expect(game.getSnapshot().scriptState.diagnostics).toContainEqual(expect.objectContaining({
      scriptId: "boss_phases",
      handlerId: "failure_phase:fail_after_commit:transition"
    }));
  });

  it.each(["disabled", "unselected", "absent"] as const)("keeps %s enemyBehaviors free of component events", (activation) => {
    const game = spawn(content(activation));
    expect(game.getSnapshot()).not.toHaveProperty("enemyBehaviors");
    expect(game.lastEvents.some((event) => String(event.type) === "bossComponentDamaged" || String(event.type) === "bossComponentDestroyed")).toBe(false);
  });
});
