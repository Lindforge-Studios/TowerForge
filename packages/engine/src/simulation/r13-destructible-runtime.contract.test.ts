import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import { computeCheckpointStateDigest, type GameCheckpointV1 } from "./checkpoint.js";
import { JournaledGameSession } from "./journal.js";
import { replayGameCommandJournal } from "./replay.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type Activation = "active" | "disabled" | "unselected" | "absent";
type Transition = "safe" | "blocked" | "none";

interface FixtureOptions {
  readonly activation?: Activation;
  readonly transition?: Transition;
  readonly objectHp?: number;
  readonly enemySpeed?: number;
  readonly secondObject?: boolean;
  readonly withElevation?: boolean;
}

interface RuntimeInternals {
  readonly map: {
    setTerrain(coord: { q: number; r: number }, terrain: string): void;
    useRuntimeElevationOverrides(overrides: ReadonlyMap<string, { q: number; r: number; elevation: number }>): void;
  };
  readonly runtimeTerrainOverrides: Map<string, {
    q: number; r: number; terrain: string; source: "script" | "ability";
  }>;
  readonly runtimeElevationOverrides: Map<string, { q: number; r: number; elevation: number }>;
  pendingTerraformExpiryGroups: Array<{
    sequence: number;
    remaining: number;
    targets: Array<{
      layer: "terrain";
      q: number;
      r: number;
      order: number;
      appliedTerrain: string;
      previousOverride: null;
    }>;
  }>;
  nextTerraformExpirySequence: number;
  terraformingCheckpointForm: 0 | 1 | 2;
}

interface DestructibleStateContract {
  readonly schemaVersion: 1;
  readonly objects: readonly {
    readonly objectId: string;
    readonly definitionId: string;
    readonly coord: { readonly q: number; readonly r: number };
    readonly hp: number;
    readonly maxHp: number;
    readonly destroyed: boolean;
  }[];
}

interface BallisticsSnapshotV2Contract {
  readonly schemaVersion: 2;
  readonly projectiles: readonly unknown[];
  readonly destructibles: DestructibleStateContract;
}

interface BallisticsCheckpointV4Contract {
  readonly schemaVersion: 4;
  readonly nextProjectileSequence: number;
  readonly projectiles: readonly unknown[];
  readonly destructibles: DestructibleStateContract;
}

function input(options: FixtureOptions = {}): GameContentInput {
  const activation = options.activation ?? "active";
  const selected = activation !== "unselected" && activation !== "absent";
  const transition = options.transition ?? "none";
  const onDestroyed = transition === "none"
    ? {}
    : { onDestroyed: { terrainTransitionId: transition === "safe" ? "destroy_safe" : "destroy_blocked" } };
  const ballistics = activation === "absent"
    ? {}
    : {
        ballistics: {
          schemaVersion: 1,
          enabled: activation !== "disabled",
          profiles: {
            destructibles: {
              projectiles: {
                towers: { cannon: { trajectory: "direct", travelTimeUnits: 0.4 } },
                destructibles: {
                  definitions: {
                    gate: {
                      maxHp: options.objectHp ?? 50,
                      hitRegion: { kind: "tile", blockerHeight: 2, blocksLineOfSight: false },
                      ...onDestroyed
                    }
                  }
                }
              }
            }
          }
        }
      };
  return {
    balance: {
      defaultMissionId: "destructible_runtime",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 20, startingCoins: 100,
        startingResources: { coins: 100 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 1, pathWaterDurationUnits: 1,
        pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        floor: { id: "floor", label: "Floor", buildable: true, walkable: true, groundSpeedMultiplier: 1, tags: ["ground"] },
        timed_ground: { id: "timed_ground", label: "Timed ground", buildable: false, walkable: true, groundSpeedMultiplier: 1, tags: ["ground"] },
        spawn: { id: "spawn", label: "Spawn", buildable: false, walkable: true, groundSpeedMultiplier: 1, tags: ["ground"] },
        core: { id: "core", label: "Core", buildable: false, walkable: true, groundSpeedMultiplier: 1, tags: ["ground"] },
        water: { id: "water", label: "Water", buildable: false, walkable: true, groundSpeedMultiplier: 0.5, tags: ["wet"] },
        wall: { id: "wall", label: "Wall", buildable: false, walkable: false, groundSpeedMultiplier: 1, tags: ["blocked"] }
      },
      abilities: {},
      enemies: {
        target: {
          id: "target", label: "Target", maxHp: 100, speed: options.enemySpeed ?? 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {
        cannon: {
          id: "cannon", label: "Cannon", cost: { coins: 1 }, footprintRadius: 0, range: 8,
          attack: { kind: "single", fireRate: 0.1, damagePerStack: 20, startingStacks: 1, maxStacks: 1, upgradeCost: 1 }
        }
      },
      waveSets: {
        wave: [{
          id: "wave_1", label: "Wave",
          groups: [{ enemyId: "target", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        destructible_runtime: {
          id: "destructible_runtime", label: "Destructible Runtime", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "wave", buildTowerIds: ["cannon"], abilityIds: [],
          mechanics: {
            profiles: {
              terraforming: "terrain",
              ...(options.withElevation ? { elevation: "authored" } : {}),
              ...(selected ? { ballistics: "destructibles" } : {})
            }
          }
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 9, height: 3,
        grid: { kind: "square", adjacency: "cardinal" }, defaultTerrain: "floor",
        spawnCoord: { q: 4, r: 1 }, coreCoord: { q: 8, r: 1 },
        pathCenterline: Array.from({ length: 5 }, (_, index) => ({ q: index + 4, r: 1 })),
        pathRoutes: [
          { id: "main", pathCenterline: Array.from({ length: 5 }, (_, index) => ({ q: index + 4, r: 1 })) },
          { id: "guard", pathCenterline: Array.from({ length: 8 }, (_, index) => ({ q: index + 1, r: 1 })) }
        ],
        terrainOverrides: [],
        destructibleObjects: [
          { id: "gate_1", definitionId: "gate", coord: { q: 2, r: 1 } },
          ...(options.secondObject
            ? [{ id: "gate_2", definitionId: "gate", coord: { q: 3, r: 0 } }]
            : [])
        ]
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        ...ballistics,
        terraforming: {
          schemaVersion: 1, enabled: true,
          profiles: {
            terrain: {
              terrainTransitions: {
                destroy_safe: { fromTerrainTags: ["ground"], toTerrainId: "water" },
                destroy_blocked: { fromTerrainTags: ["ground"], toTerrainId: "wall" }
              },
              ...(options.withElevation
                ? { elevation: { minimum: -4, maximum: 4, maximumDeltaPerOperation: 4 } }
                : {})
            }
          }
        },
        ...(options.withElevation ? {
          elevation: { schemaVersion: 1, enabled: true, profiles: { authored: {} } }
        } : {})
      }
    },
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "destructible_runtime", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function content(options: FixtureOptions = {}): GameContentRegistry {
  return createGameContentRegistry(input(options));
}

function game(options: FixtureOptions = {}, fixture = content(options)): TowerDefenseGame {
  return new TowerDefenseGame({ content: fixture, missionId: "destructible_runtime", seed: "r13.4c3" });
}

function snapshotBallistics(subject: TowerDefenseGame): BallisticsSnapshotV2Contract | undefined {
  return (subject.getSnapshot() as unknown as { ballistics?: BallisticsSnapshotV2Contract }).ballistics;
}

function checkpointBallistics(subject: TowerDefenseGame): BallisticsCheckpointV4Contract | undefined {
  return (subject.createCheckpoint().state as unknown as { ballistics?: BallisticsCheckpointV4Contract }).ballistics;
}

function launch(options: FixtureOptions = {}, fixture = content(options)): TowerDefenseGame {
  const subject = game(options, fixture);
  expect(subject.placeTower("cannon", { q: 0, r: 1 })).toEqual({ ok: true });
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
  return subject;
}

function impact(subject: TowerDefenseGame): void {
  subject.tick(0.2);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resign(checkpoint: GameCheckpointV1): void {
  (checkpoint as unknown as { stateDigest: string }).stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest, checkpoint.identity, checkpoint.rng, checkpoint.state
  );
}

function events(subject: TowerDefenseGame): readonly ({ type: string } & Record<string, unknown>)[] {
  return subject.lastEvents as unknown as readonly ({ type: string } & Record<string, unknown>)[];
}

describe("R13.4c3 destructible authoritative runtime (RED)", () => {
  it("publishes active-only snapshot/checkpoint state without changing inactive legacy shapes", () => {
    const active = game();
    expect(snapshotBallistics(active)).toEqual({
      schemaVersion: 2,
      projectiles: [],
      destructibles: {
        schemaVersion: 1,
        objects: [{
          objectId: "gate_1", definitionId: "gate", coord: { q: 2, r: 1 },
          hp: 50, maxHp: 50, destroyed: false
        }]
      }
    });
    expect(checkpointBallistics(active)).toEqual({
      schemaVersion: 4,
      nextProjectileSequence: 1,
      projectiles: [],
      destructibles: snapshotBallistics(active)?.destructibles
    });

    for (const activation of ["disabled", "unselected", "absent"] as const) {
      const inactive = game({ activation });
      expect(snapshotBallistics(inactive)).toBeUndefined();
      expect(checkpointBallistics(inactive)).toBeUndefined();
    }
  });

  it("fixes a map-object collision at launch, damages it through the common packet, and misses the moved enemy", () => {
    const subject = launch({ enemySpeed: 4 });
    impact(subject);
    expect(snapshotBallistics(subject)?.destructibles.objects).toEqual([expect.objectContaining({
      objectId: "gate_1", hp: 30, destroyed: false
    })]);
    expect(subject.getSnapshot().enemies[0]).toMatchObject({ hp: 100 });
    expect(events(subject)).toContainEqual(expect.objectContaining({
      type: "destructibleObjectDamaged", projectileId: "projectile_1",
      objectId: "gate_1", fromHp: 50, toHp: 30, damage: 20
    }));
    expect(events(subject).some((event) => event.type === "enemyHit")).toBe(false);
  });

  it("commits lethal damage and safe terrain transition exactly once, then removes the object from collision", () => {
    const subject = launch({ objectHp: 20, transition: "safe" });
    impact(subject);
    expect(snapshotBallistics(subject)?.destructibles.objects[0]).toMatchObject({ hp: 0, destroyed: true });
    expect(subject.getSnapshot().terrainOverrides).toContainEqual(expect.objectContaining({
      q: 2, r: 1, terrain: "water"
    }));
    expect(events(subject)
      .filter((event) => ["destructibleObjectDamaged", "terrainChanged", "destructibleObjectDestroyed"].includes(event.type))
      .map((event) => event.type))
      .toEqual(["destructibleObjectDamaged", "terrainChanged", "destructibleObjectDestroyed"]);

    expect(subject.placeTower("cannon", { q: 0, r: 0 })).toEqual({ ok: true });
    subject.tick(0);
    impact(subject);
    impact(subject);
    expect(subject.getSnapshot().enemies[0]?.hp).toBe(80);
    expect(events(subject).filter((event) => event.type === "destructibleObjectDestroyed")).toHaveLength(0);
  });

  it("rolls lethal damage and terrain state back together when destruction would break the authored route", () => {
    const subject = launch({ objectHp: 20, transition: "blocked" });
    impact(subject);
    expect(snapshotBallistics(subject)?.destructibles.objects[0]).toMatchObject({ hp: 20, destroyed: false });
    expect(subject.getSnapshot().terrainOverrides).not.toContainEqual(expect.objectContaining({ q: 2, r: 1 }));
    expect(subject.getSnapshot().enemies[0]).toMatchObject({ hp: 100 });
    expect(events(subject).some((event) => [
      "destructibleObjectDamaged", "destructibleObjectDestroyed", "terrainChanged"
    ].includes(event.type))).toBe(false);
    expect(snapshotBallistics(subject)?.projectiles).toEqual([]);
  });

  it("rejects future, duplicate, unknown, missing and incoherent destructible checkpoint rows", () => {
    const fixture = content();
    const original = game({}, fixture).createCheckpoint();
    const active = (original.state as unknown as { ballistics?: BallisticsCheckpointV4Contract }).ballistics;
    expect(active?.destructibles.objects).toHaveLength(1);
    const mutations: Array<(candidate: any) => void> = [
      (candidate) => { candidate.state.ballistics.destructibles.schemaVersion = 2; },
      (candidate) => { candidate.state.ballistics.destructibles.objects.push(clone(candidate.state.ballistics.destructibles.objects[0])); },
      (candidate) => { candidate.state.ballistics.destructibles.objects[0].objectId = "unknown"; },
      (candidate) => { candidate.state.ballistics.destructibles.objects = []; },
      (candidate) => { candidate.state.ballistics.destructibles.objects[0].hp = 51; },
      (candidate) => { candidate.state.ballistics.destructibles.objects[0].hp = 0; candidate.state.ballistics.destructibles.objects[0].destroyed = false; }
    ];
    for (const mutate of mutations) {
      const candidate = clone(original) as GameCheckpointV1;
      mutate(candidate);
      resign(candidate);
      expect(() => TowerDefenseGame.fromCheckpoint({ content: fixture, checkpoint: candidate }))
        .toThrow(/ballistics|destructible|object|version|duplicate|missing|hp|destroyed/i);
    }
  });

  it("keeps continuous, checkpoint restore and journal replay equal, while reset restores object and terrain", () => {
    const fixture = content({ objectHp: 20, transition: "safe" });
    const session = new JournaledGameSession(game({}, fixture));
    expect(session.dispatch({ schemaVersion: 1, type: "placeTower", towerTypeId: "cannon", coord: { q: 0, r: 1 } }))
      .toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "startWave" })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0 })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.2 })).toEqual({ ok: true });
    const restored = TowerDefenseGame.fromCheckpoint({ content: fixture, checkpoint: clone(session.game.createCheckpoint()) });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.2 })).toEqual({ ok: true });
    restored.tick(0.2);
    const replay = replayGameCommandJournal({ content: fixture, journal: clone(session.exportJournal()) });
    expect(restored.getStateDigest()).toBe(session.game.getStateDigest());
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());

    restored.reset();
    expect(snapshotBallistics(restored)?.destructibles.objects[0]).toMatchObject({ hp: 20, destroyed: false });
    expect(restored.getSnapshot().terrainOverrides).toEqual([]);
  });

  it("settles a fixed destructible collision at its stored elapsedUnits instead of full target travel time", () => {
    const subject = launch();
    const inFlight = checkpointBallistics(subject)?.projectiles[0] as {
      readonly destructibleCollision?: { readonly elapsedUnits: number };
    };
    expect(inFlight.destructibleCollision?.elapsedUnits).toBe(0.2);

    subject.tick(0.2);
    expect(snapshotBallistics(subject)?.destructibles.objects[0]).toMatchObject({ hp: 30, destroyed: false });
    expect(snapshotBallistics(subject)?.projectiles).toEqual([]);
  });

  it("rejects valid destructible checkpoint rows when they are not in binary object-id order", () => {
    const fixture = content({ secondObject: true });
    const checkpoint = clone(game({}, fixture).createCheckpoint()) as GameCheckpointV1;
    const objects = (checkpoint.state as unknown as {
      ballistics: { destructibles: { objects: Array<Record<string, unknown>> } };
    }).ballistics.destructibles.objects;
    expect(objects.map((row) => row.objectId)).toEqual(["gate_1", "gate_2"]);
    objects.reverse();
    resign(checkpoint);

    expect(() => TowerDefenseGame.fromCheckpoint({ content: fixture, checkpoint }))
      .toThrow(/destructible.*(?:binary|canonical|order)|(?:binary|canonical|order).*destructible/i);
  });

  it("rejects sparse and accessor-backed nested destructible rows without invoking getters", () => {
    const fixture = content();
    const original = game({}, fixture).createCheckpoint();

    const sparse = clone(original) as any;
    sparse.state.ballistics.destructibles.objects = new Array(1);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: fixture, checkpoint: sparse }))
      .toThrow(/sparse|array|checkpoint|digest|destructible/i);

    let getterCalls = 0;
    const accessorRow = clone(original) as any;
    const row = accessorRow.state.ballistics.destructibles.objects[0];
    Object.defineProperty(accessorRow.state.ballistics.destructibles.objects, "0", {
      enumerable: true,
      get: () => { getterCalls += 1; return row; }
    });
    expect(() => TowerDefenseGame.fromCheckpoint({ content: fixture, checkpoint: accessorRow }))
      .toThrow(/accessor|data property|checkpoint|digest|destructible/i);

    const accessorField = clone(original) as any;
    Object.defineProperty(accessorField.state.ballistics.destructibles.objects[0], "hp", {
      enumerable: true,
      get: () => { getterCalls += 1; return 50; }
    });
    expect(() => TowerDefenseGame.fromCheckpoint({ content: fixture, checkpoint: accessorField }))
      .toThrow(/accessor|data property|checkpoint|digest|destructible/i);
    expect(getterCalls).toBe(0);
  });

  it("consumes a lethal projectile without mutating a destructible cell owned by a native timed terrain group", () => {
    const subject = launch({ objectHp: 20, transition: "safe" });
    const runtime = subject as unknown as RuntimeInternals;
    runtime.runtimeTerrainOverrides.set("2,1", {
      q: 2, r: 1, terrain: "timed_ground", source: "script"
    });
    runtime.map.setTerrain({ q: 2, r: 1 }, "timed_ground");
    runtime.pendingTerraformExpiryGroups = [{
      sequence: 1,
      remaining: 10,
      targets: [{
        layer: "terrain", q: 2, r: 1, order: 0,
        appliedTerrain: "timed_ground", previousOverride: null
      }]
    }];
    runtime.nextTerraformExpirySequence = 2;
    runtime.terraformingCheckpointForm = 2;

    impact(subject);
    expect(snapshotBallistics(subject)?.projectiles).toEqual([]);
    expect(snapshotBallistics(subject)?.destructibles.objects[0]).toMatchObject({ hp: 20, destroyed: false });
    expect(subject.getSnapshot().terrainOverrides).toEqual([{
      q: 2, r: 1, terrain: "timed_ground", source: "script"
    }]);
    expect(events(subject).filter((event) => [
      "destructibleObjectDamaged", "destructibleObjectDestroyed", "terrainChanged"
    ].includes(event.type))).toEqual([]);
  });

  it("round-trips an in-flight collision whose blocker elevation came from an active runtime override", () => {
    const fixture = content({ withElevation: true });
    const subject = game({}, fixture);
    expect(subject.placeTower("cannon", { q: 0, r: 1 })).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    const runtime = subject as unknown as RuntimeInternals;
    runtime.runtimeElevationOverrides.set("2,1", { q: 2, r: 1, elevation: 3 });
    runtime.map.useRuntimeElevationOverrides(runtime.runtimeElevationOverrides);
    subject.tick(0);

    const checkpoint = subject.createCheckpoint();
    const projectile = (checkpoint.state as unknown as {
      ballistics: { projectiles: Array<{ destructibleCollision?: { blockerElevation: number } }> };
    }).ballistics.projectiles[0];
    expect(projectile?.destructibleCollision?.blockerElevation).toBe(3);
    const restored = TowerDefenseGame.fromCheckpoint({ content: fixture, checkpoint: clone(checkpoint) });
    expect(restored.getStateDigest()).toBe(subject.getStateDigest());
    expect(restored.getSnapshot()).toEqual(subject.getSnapshot());
  });
});
