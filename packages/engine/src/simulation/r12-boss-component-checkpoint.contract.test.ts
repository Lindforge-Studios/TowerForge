import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import { computeCheckpointStateDigest, type GameCheckpointV1 } from "./checkpoint.js";
import type { DamageSourceRef } from "./damage.js";
import { JournaledGameSession } from "./journal.js";
import { replayGameCommandJournal } from "./replay.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

function content(): GameContentRegistry {
  return createGameContentRegistry({
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
        boss: { id: "boss", label: "Boss", maxHp: 100, speed: 0.01, reward: { coins: 10 }, coinReward: 10, coreDamage: 5, color: 0x884444 }
      },
      towers: {
        pelter: {
          id: "pelter", label: "Pelter", cost: { coins: 1 }, footprintRadius: 0, range: 20,
          attack: { kind: "single", fireRate: 100, damagePerStack: 10, startingStacks: 1, maxStacks: 1, upgradeCost: 1 }
        }
      },
      waveSets: { boss_wave: [{ id: "w1", label: "Boss", groups: [{ enemyId: "boss", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
      missions: {
        boss_lab: {
          id: "boss_lab", label: "Boss lab", description: "", startingCoreHp: 20,
          startingResources: { coins: 100 }, prepTimeUnits: 0, mapId: "lane", waveSetId: "boss_wave",
          buildTowerIds: ["pelter"], abilityIds: [], mechanics: { profiles: { enemyBehaviors: "bosses" } }
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 8, height: 3, grid: { kind: "square", adjacency: "cardinal" }, defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 7, r: 1 },
        pathCenterline: Array.from({ length: 8 }, (_, q) => ({ q, r: 1 })), pathRoutes: [], terrainOverrides: []
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
              bosses: {
                boss: {
                  components: {
                    weapon: {
                      maxHp: 5,
                      hitRegion: { kind: "circle", offsetX: 0, offsetY: 0, radius: 0.25 },
                      tags: ["weapon"],
                      disablesAbilities: ["towerAttack"]
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
    scripts: {
      boss_phase: {
        schemaVersion: 7,
        id: "boss_phase",
        bindings: [],
        handlers: {},
        stateMachines: [{
          schemaVersion: 1,
          id: "phase",
          bindings: [{ scope: "enemy", ids: ["boss"] }],
          initial: "intact",
          states: [{
            id: "intact",
            transitions: [{ id: "wound", event: "bossComponentDamaged", target: "/wounded" }]
          }, {
            id: "wounded",
            transitions: [{ id: "destroy", event: "bossComponentDestroyed", target: "/destroyed" }]
          }, { id: "destroyed", entryActions: [{ action: "setState", key: "phase", value: "destroyed" }] }]
        }]
      } as never
    },
    worldMap: {
      width: 10, height: 10,
      regions: [{ id: "r", label: "R", description: "", biome: "test", accent: "#884444", bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: [] }],
      missionNodes: [{ missionId: "boss_lab", regionId: "r", x: 5, y: 5, difficulty: 1, unlockRequiresMissionIds: [] }]
    }
  } as unknown as GameContentInput);
}

function spawn(registry: GameContentRegistry): TowerDefenseGame {
  const game = new TowerDefenseGame({ missionId: "boss_lab", content: registry, seed: "r12-checkpoint" });
  expect(game.startNextWave()).toEqual({ ok: true });
  game.tick(0.01);
  expect(game.enemies).toHaveLength(1);
  return game;
}

function strike(game: TowerDefenseGame, amount: number, source: DamageSourceRef = { kind: "ability", abilityId: "test" }): void {
  const runtime = game as unknown as {
    applyResolvedEnemyDamage(enemy: unknown, amount: number, source: DamageSourceRef, options: { componentId: string }): unknown;
    finishScriptedAction(): void;
  };
  runtime.applyResolvedEnemyDamage(game.enemies[0]!, amount, source, { componentId: "weapon" });
  runtime.finishScriptedAction();
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resign(checkpoint: GameCheckpointV1): void {
  const mutable = checkpoint as unknown as { stateDigest: string };
  mutable.stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state
  );
}

function componentEvent(checkpoint: GameCheckpointV1): Record<string, unknown> {
  const selected = checkpoint.state.lastEvents.find((event) => String(event.type) === "bossComponentDamaged");
  if (!selected) throw new Error("Expected a bossComponentDamaged checkpoint event.");
  return selected as unknown as Record<string, unknown>;
}

describe("R12.2 boss-component checkpoint and journal contract (RED)", () => {
  it("continues from a component-triggered HFSM checkpoint with the same digest", () => {
    const registry = content();
    const continuous = spawn(registry);
    strike(continuous, 2);
    const checkpoint = jsonClone(continuous.createCheckpoint());

    expect(checkpoint.state.scriptMachines).toMatchObject({
      schemaVersion: 1,
      values: { boss_phase: { phase: { "enemy:enemy_1": { activeStatePath: "/wounded", transitionCount: 1 } } } }
    });
    expect(componentEvent(checkpoint)).toMatchObject({ componentId: "weapon", previousHp: 5, currentHp: 3, hpDamage: 2 });
    const restored = TowerDefenseGame.fromCheckpoint({ content: registry, checkpoint });
    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());

    strike(continuous, 10);
    strike(restored, 10);
    expect(restored.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());
  });

  it("replays component events and the resulting machine state through the unchanged journal", () => {
    const registry = content();
    const session = new JournaledGameSession(new TowerDefenseGame({ missionId: "boss_lab", content: registry, seed: "r12-journal" }));
    expect(session.dispatch({ schemaVersion: 1, type: "placeTower", towerTypeId: "pelter", coord: { q: 0, r: 0 } })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "startWave" })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.01 })).toEqual({ ok: true });

    const replay = replayGameCommandJournal({ content: registry, journal: jsonClone(session.exportJournal()) });
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
    expect((replay.game.getSnapshot().scriptState.machines as any).boss_phase.phase["enemy:enemy_1"])
      .toMatchObject({ activeStatePath: "/destroyed", transitionCount: 2 });
  });

  it("accepts an earlier captured component event after a later hit changed authoritative state", () => {
    const registry = content();
    const game = spawn(registry);
    strike(game, 2);
    strike(game, 1);
    const checkpoint = jsonClone(game.createCheckpoint());
    const events = checkpoint.state.lastEvents.filter((event) => String(event.type) === "bossComponentDamaged") as unknown as Record<string, unknown>[];

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ currentHp: 3 });
    expect(events[1]).toMatchObject({ currentHp: 2 });
    expect(() => TowerDefenseGame.fromCheckpoint({ content: registry, checkpoint })).not.toThrow();
  });

  it.each([
    ["extra field", (event: Record<string, unknown>) => { event.hostHook = "forbidden"; }],
    ["unknown source", (event: Record<string, unknown>) => { event.sourceKind = "host"; }],
    ["unknown component", (event: Record<string, unknown>) => { event.componentId = "missing"; }],
    ["invalid hp delta", (event: Record<string, unknown>) => { event.hpDamage = 999; }],
    ["invalid shield range", (event: Record<string, unknown>) => { event.currentShield = -1; }]
  ] as const)("rejects a digest-valid component event with %s", (_label, mutate) => {
    const registry = content();
    const game = spawn(registry);
    strike(game, 2);
    const checkpoint = jsonClone(game.createCheckpoint());
    mutate(componentEvent(checkpoint));
    resign(checkpoint);

    expect(() => TowerDefenseGame.fromCheckpoint({ content: registry, checkpoint }))
      .toThrow(/component|event|checkpoint|field|source|damage|shield|invalid|unknown/i);
  });

  it("rejects component lifecycle events when the required active component state is removed", () => {
    const registry = content();
    const game = spawn(registry);
    strike(game, 2);
    const checkpoint = jsonClone(game.createCheckpoint());
    delete (checkpoint.state as any).enemyBehaviors;
    resign(checkpoint);

    expect(() => TowerDefenseGame.fromCheckpoint({ content: registry, checkpoint }))
      .toThrow(/enemyBehaviors|component|capability/i);
  });
});
