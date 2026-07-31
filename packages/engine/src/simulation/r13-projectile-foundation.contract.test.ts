import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import { computeCheckpointStateDigest, type GameCheckpointV1 } from "./checkpoint.js";
import { DamageResolver, type DamagePacket } from "./damage.js";
import { JournaledGameSession } from "./journal.js";
import { replayGameCommandJournal } from "./replay.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type Activation = "active" | "disabled" | "unselected" | "absent";
type Trajectory = "direct" | "arc";

interface ProjectileSnapshotV1Contract {
  readonly id: string;
  readonly sourceCoord: { readonly q: number; readonly r: number };
  readonly targetCoord: { readonly q: number; readonly r: number };
  readonly trajectory: Trajectory;
  readonly elapsedUnits: number;
  readonly travelTimeUnits: number;
  readonly altitude: number;
  readonly maxAltitude?: number;
}

interface BallisticsStateV1Contract {
  readonly schemaVersion: 1;
  readonly projectiles: readonly ProjectileSnapshotV1Contract[];
}

interface ProjectileCheckpointV1Contract extends Omit<ProjectileSnapshotV1Contract, "targetCoord"> {
  readonly impact: {
    readonly targetCoord: { readonly q: number; readonly r: number };
    readonly damagePacket: DamagePacket;
  };
}

interface BallisticsCheckpointStateV1Contract {
  readonly schemaVersion: 1;
  readonly nextProjectileSequence: number;
  readonly projectiles: readonly ProjectileCheckpointV1Contract[];
}

interface FixtureOptions {
  readonly activation?: Activation;
  readonly trajectory?: Trajectory;
  readonly profile?: unknown;
  readonly reverseContentRecords?: boolean;
  readonly enemySpeed?: number;
  readonly sourceElevation?: number;
  readonly targetElevation?: number;
}

function profile(trajectory: Trajectory): unknown {
  return {
    projectiles: {
      towers: {
        subject: trajectory === "arc"
          ? { trajectory, travelTimeUnits: 0.4, maxAltitude: 6 }
          : { trajectory, travelTimeUnits: 0.4 }
      }
    }
  };
}

function input(options: FixtureOptions = {}): GameContentInput {
  const activation = options.activation ?? "active";
  const trajectory = options.trajectory ?? "arc";
  const selected = activation !== "unselected" && activation !== "absent";
  const withElevation = options.sourceElevation !== undefined || options.targetElevation !== undefined;
  const ballistics = activation === "absent"
    ? {}
    : {
        ballistics: {
          schemaVersion: 1,
          enabled: activation !== "disabled",
          profiles: { field: options.profile ?? profile(trajectory) }
        }
      };
  const enemies = options.reverseContentRecords
    ? {
        spare: {
          id: "spare", label: "Spare", maxHp: 100, speed: 0.1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 2
        },
        target: {
          id: "target", label: "Target", maxHp: 100, speed: options.enemySpeed ?? 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      }
    : {
        target: {
          id: "target", label: "Target", maxHp: 100, speed: options.enemySpeed ?? 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        },
        spare: {
          id: "spare", label: "Spare", maxHp: 100, speed: 0.1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 2
        }
      };
  return {
    balance: {
      defaultMissionId: "projectile_lab",
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
      enemies,
      towers: {
        subject: {
          id: "subject", label: "Subject", cost: { coins: 1 }, footprintRadius: 0, range: 8,
          attack: {
            kind: "single", fireRate: 0.1, damagePerStack: 20,
            startingStacks: 1, maxStacks: 3, upgradeCost: 1
          }
        },
        legacy: {
          id: "legacy", label: "Legacy", cost: { coins: 1 }, footprintRadius: 0, range: 8,
          attack: {
            kind: "single", fireRate: 0.1, damagePerStack: 20,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        wave: [{
          id: "wave_1", label: "Wave",
          groups: [{ enemyId: "target", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        projectile_lab: {
          id: "projectile_lab", label: "Projectile Lab", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "wave", buildTowerIds: ["subject", "legacy"], abilityIds: [],
          ...(selected ? {
            mechanics: {
              profiles: {
                ballistics: "field",
                ...(withElevation ? { elevation: "authored" } : {})
              }
            }
          } : {})
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 10, height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable", spawnCoord: { q: 4, r: 1 }, coreCoord: { q: 9, r: 1 },
        pathCenterline: Array.from({ length: 6 }, (_, index) => ({ q: index + 4, r: 1 })),
        pathRoutes: [], terrainOverrides: [],
        elevationOverrides: [
          ...(options.sourceElevation === undefined
            ? []
            : [{ q: 0, r: 1, elevation: options.sourceElevation }]),
          ...(options.targetElevation === undefined
            ? []
            : [{ q: 4, r: 1, elevation: options.targetElevation }])
        ]
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        ...ballistics,
        ...(withElevation ? {
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
        missionId: "projectile_lab", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function content(options: FixtureOptions = {}): GameContentRegistry {
  return createGameContentRegistry(input(options));
}

function game(options: FixtureOptions = {}, seed = "r13.1-projectile"): TowerDefenseGame {
  return new TowerDefenseGame({ content: content(options), missionId: "projectile_lab", seed });
}

function ballistics(subject: TowerDefenseGame): BallisticsStateV1Contract | undefined {
  return (subject.getSnapshot() as unknown as { ballistics?: BallisticsStateV1Contract }).ballistics;
}

function launch(options: FixtureOptions = {}, seed?: string): TowerDefenseGame {
  const subject = game(options, seed);
  expect(subject.placeTower("subject", { q: 0, r: 1 })).toEqual({ ok: true });
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
  return subject;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resign(checkpoint: GameCheckpointV1): void {
  (checkpoint as unknown as { stateDigest: string }).stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("R13.1 authoritative projectile runtime (RED)", () => {
  it.each([
    ["direct", 0, undefined],
    ["arc", 6, 6]
  ] as const)("publishes deterministic %s flight progress and scalar altitude", (trajectory, middleAltitude, maximumAltitude) => {
    const subject = launch({ trajectory });
    const initial = ballistics(subject);
    expect(initial).toEqual({
      schemaVersion: 1,
      projectiles: [{
        id: "projectile_1",
        sourceCoord: { q: 0, r: 1 },
        targetCoord: { q: 4, r: 1 },
        trajectory,
        elapsedUnits: 0,
        travelTimeUnits: 0.4,
        altitude: 0,
        ...(maximumAltitude === undefined ? {} : { maxAltitude: maximumAltitude })
      }]
    });

    subject.tick(0.2);
    expect(ballistics(subject)?.projectiles[0]).toMatchObject({
      id: "projectile_1", elapsedUnits: 0.2, travelTimeUnits: 0.4, altitude: middleAltitude
    });
  });

  it("treats maxAltitude as height above the linear endpoint-elevation baseline", () => {
    const subject = launch({ trajectory: "arc", sourceElevation: 2, targetElevation: 4 });
    expect(ballistics(subject)?.projectiles[0]).toMatchObject({ altitude: 2, maxAltitude: 6 });
    subject.tick(0.2);
    expect(ballistics(subject)?.projectiles[0]).toMatchObject({
      elapsedUnits: 0.2,
      altitude: 9,
      maxAltitude: 6
    });
  });

  it("does not resolve damage before arrival, resolves exactly once on impact, and cleans up the projectile", () => {
    const resolve = vi.spyOn(DamageResolver, "resolve");
    const subject = launch({ trajectory: "arc" });
    expect(subject.enemies[0]?.hp).toBe(100);
    expect(resolve).not.toHaveBeenCalled();

    subject.tick(0.2);
    expect(subject.enemies[0]?.hp).toBe(100);
    expect(resolve).not.toHaveBeenCalled();

    subject.tick(0.2);
    expect(subject.enemies[0]?.hp).toBe(80);
    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve.mock.calls[0]?.[0]).toMatchObject({
      amount: 20,
      source: { kind: "tower", towerId: "tower_1", towerTypeId: "subject" },
      target: { kind: "enemy", enemyId: "enemy_1", enemyTypeId: "target" }
    });
    expect(ballistics(subject)).toEqual({ schemaVersion: 1, projectiles: [] });

    subject.tick(0);
    expect(resolve).toHaveBeenCalledOnce();
    expect(subject.enemies[0]?.hp).toBe(80);
  });

  it("captures an immutable launch-time DamagePacket before later tower upgrades", () => {
    const resolve = vi.spyOn(DamageResolver, "resolve");
    const subject = launch({ trajectory: "direct" });
    expect(subject.upgradeTower("tower_1")).toEqual({ ok: true });
    const persistedSection = (subject.createCheckpoint().state as unknown as {
      ballistics: BallisticsCheckpointStateV1Contract;
    }).ballistics;
    expect(persistedSection, "active ballistics must persist its launch-time DamagePacket").toBeDefined();
    const persisted = persistedSection.projectiles[0];
    expect(persisted?.impact.damagePacket).toMatchObject({ amount: 20 });

    subject.tick(0.2);
    subject.tick(0.2);

    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve.mock.calls[0]?.[0]).toMatchObject({ amount: 20 });
    expect(subject.enemies[0]?.hp).toBe(80);
  });

  it("locks the impact point at launch and never rewrites it to follow a moving target", () => {
    const subject = launch({ trajectory: "arc" });
    const launchedProjectile = ballistics(subject)?.projectiles[0];
    expect(launchedProjectile, "active ballistics must publish an in-flight projectile").toBeDefined();
    const launchedAt = clone(launchedProjectile!.targetCoord);
    const initialProgress = subject.enemies[0]!.pathProgress;

    subject.tick(0.2);

    expect(subject.enemies[0]!.pathProgress).toBeGreaterThan(initialProgress);
    expect(ballistics(subject)?.projectiles[0]?.targetCoord).toEqual(launchedAt);
    const checkpoint = subject.createCheckpoint();
    const authoritative = (checkpoint.state as unknown as {
      ballistics: BallisticsCheckpointStateV1Contract;
    }).ballistics.projectiles[0];
    expect(authoritative?.impact.targetCoord).toEqual(launchedAt);
    expect(authoritative?.impact.damagePacket.target).toMatchObject({ enemyId: "enemy_1" });
    expect(ballistics(subject)?.projectiles[0]).not.toHaveProperty("damagePacket");
  });

  it("emits one stable miss and never damages a captured target that left the launch coordinate", () => {
    const resolve = vi.spyOn(DamageResolver, "resolve");
    const subject = launch({ trajectory: "arc", enemySpeed: 5 });
    const initialProgress = subject.enemies[0]!.pathProgress;
    subject.tick(0.2);
    expect(subject.enemies[0]!.pathProgress).toBeGreaterThan(initialProgress);

    subject.tick(0.2);

    expect(resolve).not.toHaveBeenCalled();
    expect(subject.enemies[0]?.hp).toBe(100);
    expect(ballistics(subject)).toEqual({ schemaVersion: 1, projectiles: [] });
    expect(subject.lastEvents.filter((event) => String(event.type) === "projectileMissed")).toEqual([{
      type: "projectileMissed",
      projectileId: "projectile_1",
      targetEnemyId: "enemy_1",
      targetCoord: { q: 4, r: 1 },
      reason: "target_moved"
    }]);
    subject.tick(0);
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each(["absent", "disabled", "unselected"] as const)(
    "keeps %s ballistics on the instant legacy path with no optional state",
    (activation) => {
      const subject = launch({ activation });
      expect(subject.enemies[0]?.hp).toBe(80);
      expect(subject.getSnapshot()).not.toHaveProperty("ballistics");
      expect(subject.createCheckpoint().state).not.toHaveProperty("ballistics");
    }
  );

  it("keeps an unbound simple tower instant while another tower is bound by the active profile", () => {
    const subject = game({ trajectory: "arc" });
    expect(subject.placeTower("legacy", { q: 0, r: 1 })).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    expect(subject.enemies[0]?.hp).toBe(80);
    expect(ballistics(subject)).toEqual({ schemaVersion: 1, projectiles: [] });
  });

  it("is invariant to authored record order", () => {
    const canonical = launch({ trajectory: "arc" }, "r13-order");
    const permuted = launch({ trajectory: "arc", reverseContentRecords: true }, "r13-order");
    expect(permuted.getSnapshot()).toEqual(canonical.getSnapshot());
    expect(permuted.getStateDigest()).toBe(canonical.getStateDigest());
  });

  it("restores an in-flight projectile and matches continuous simulation and journal replay digests", () => {
    const subjectContent = content({ trajectory: "arc" });
    const continuous = new TowerDefenseGame({
      content: subjectContent, missionId: "projectile_lab", seed: "r13-checkpoint-journal"
    });
    const session = new JournaledGameSession(continuous);
    expect(session.dispatch({
      schemaVersion: 1, type: "placeTower", towerTypeId: "subject", coord: { q: 0, r: 1 }
    })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "startWave" })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0 })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.2 })).toEqual({ ok: true });

    const checkpoint = continuous.createCheckpoint();
    const persisted = (checkpoint.state as unknown as {
      ballistics?: BallisticsCheckpointStateV1Contract;
    }).ballistics;
    expect(persisted).toMatchObject({
      schemaVersion: 1,
      nextProjectileSequence: 2,
      projectiles: [{
        id: "projectile_1",
        sourceCoord: { q: 0, r: 1 },
        trajectory: "arc",
        elapsedUnits: 0.2,
        travelTimeUnits: 0.4,
        altitude: 6,
        maxAltitude: 6,
        sourceElevation: 0,
        impact: {
          targetCoord: { q: 4, r: 1 },
          targetElevation: 0,
          damagePacket: {
            amount: 20,
            source: { kind: "tower", towerId: "tower_1", towerTypeId: "subject" },
            target: { kind: "enemy", enemyId: "enemy_1", enemyTypeId: "target" }
          }
        }
      }]
    });
    expect(persisted).not.toBe(ballistics(continuous));
    const restored = TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: clone(checkpoint) });
    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());

    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.2 })).toEqual({ ok: true });
    restored.tick(0.2);
    const replay = replayGameCommandJournal({ content: subjectContent, journal: session.exportJournal() });
    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());
    expect(replay.stateDigest).toBe(continuous.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(continuous.getSnapshot());
  });

  it("rejects malformed, future, sparse, accessor, duplicate, and over-budget projectile checkpoints", () => {
    const subjectContent = content({ trajectory: "arc" });
    const checkpoint = launch({ trajectory: "arc" }).createCheckpoint();
    const active = (checkpoint.state as unknown as { ballistics: BallisticsCheckpointStateV1Contract }).ballistics;
    expect(active, "active ballistics must persist its authoritative checkpoint section").toBeDefined();
    expect(active.projectiles).toHaveLength(1);

    const mutations: Array<(candidate: any) => void> = [
      (candidate) => { candidate.state.ballistics.schemaVersion = 2; },
      (candidate) => { candidate.state.ballistics.projectiles[0].elapsedUnits = -1; },
      (candidate) => { candidate.state.ballistics.projectiles[0].extra = true; },
      (candidate) => { candidate.state.ballistics.projectiles.push(clone(candidate.state.ballistics.projectiles[0])); },
      (candidate) => {
        candidate.state.ballistics.projectiles = Array.from(
          { length: 4_097 },
          (_, index) => ({ ...clone(candidate.state.ballistics.projectiles[0]), id: `projectile_${index + 1}` })
        );
      }
    ];
    for (const mutate of mutations) {
      const candidate = clone(checkpoint) as any;
      mutate(candidate);
      resign(candidate);
      expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: candidate }))
        .toThrow(/ballistics|projectile|version|duplicate|limit|field|elapsed/i);
    }

    const sparse = clone(checkpoint) as any;
    sparse.state.ballistics.projectiles = new Array(2);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: sparse }))
      .toThrow(/ballistics|projectile|sparse|array/i);

    const accessor = clone(checkpoint) as any;
    let getterCalls = 0;
    Object.defineProperty(accessor.state.ballistics.projectiles[0], "altitude", {
      enumerable: true,
      get: () => { getterCalls += 1; return 0; }
    });
    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: accessor }))
      .toThrow(/accessor|data property|checkpoint|projectile|digest/i);
    expect(getterCalls).toBe(0);
  });

  it("requires active checkpoint state and rejects forged state on an inactive legacy mission", () => {
    const activeContent = content({ trajectory: "arc" });
    const missing = clone(launch({ trajectory: "arc" }).createCheckpoint()) as any;
    delete missing.state.ballistics;
    resign(missing);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: activeContent, checkpoint: missing }))
      .toThrow(/ballistics|required|active/i);

    const inactiveContent = content({ activation: "absent" });
    const inactive = game({ activation: "absent" }).createCheckpoint() as any;
    inactive.state.ballistics = {
      schemaVersion: 1,
      nextProjectileSequence: 1,
      projectiles: []
    };
    resign(inactive);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: inactiveContent, checkpoint: inactive }))
      .toThrow(/ballistics|unsupported|inactive/i);
  });
});
