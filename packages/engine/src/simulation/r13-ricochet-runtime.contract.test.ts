import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import { computeCheckpointStateDigest, type GameCheckpointV1 } from "./checkpoint.js";
import { DamageResolver } from "./damage.js";
import { JournaledGameSession } from "./journal.js";
import { replayGameCommandJournal } from "./replay.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type Surface = "terrain" | "armor" | "component";

interface Options {
  readonly surface?: Surface;
  readonly maxBounces?: number;
  readonly rangeCells?: number;
  readonly enemyCount?: number;
  readonly shieldCapacity?: number;
  readonly ricochet?: boolean;
  readonly clearance?: boolean;
  readonly activation?: "active" | "disabled" | "unselected" | "absent";
  readonly reverseRecords?: boolean;
  readonly destructibleAtReflectedTarget?: boolean;
}

function route(): Array<{ q: number; r: number }> {
  return [
    ...Array.from({ length: 6 }, (_, q) => ({ q, r: 1 })),
    { q: 5, r: 2 }, { q: 6, r: 2 }, { q: 7, r: 2 }, { q: 8, r: 2 }, { q: 9, r: 2 }
  ];
}

function ballisticsProfile(options: Options): unknown {
  const ricochet = options.ricochet ?? true;
  const surface = options.surface ?? "terrain";
  const projectiles: any = {
    towers: {
      cannon: {
        trajectory: "direct", travelTimeUnits: 0.4,
        ...(ricochet ? {
          ricochet: { maxBounces: options.maxBounces ?? 1, rangeCells: options.rangeCells ?? 12 }
        } : {})
      }
    },
    ...((options.clearance ?? surface === "terrain") ? {
      clearance: { terrainBlockerHeights: { reflective_rock: 0 } }
    } : {})
  };
  if (ricochet) {
    projectiles.ricochet = surface === "terrain"
      ? { terrainTags: { reflective_rock: true } }
      : { armorTypes: { plated: true } };
  }
  if (options.destructibleAtReflectedTarget) {
    projectiles.destructibles = {
      definitions: {
        reflected_gate: {
          maxHp: 50,
          hitRegion: { kind: "tile", blockerHeight: 1, blocksLineOfSight: false }
        }
      }
    };
  }
  return { projectiles };
}

function input(options: Options = {}): GameContentInput {
  const activation = options.activation ?? "active";
  const selected = activation !== "unselected" && activation !== "absent";
  const surface = options.surface ?? "terrain";
  const enemyCount = options.enemyCount ?? 2;
  const groups = Array.from({ length: enemyCount }, () => ({
    enemyId: "target", count: 1, spawnInterval: 0, startDelay: 0
  }));
  const combatProfile: any = {
    ...(options.shieldCapacity === undefined ? {} : {
      shields: { enemies: { target: { capacity: options.shieldCapacity } } }
    }),
    damageTypes: { physical: { label: "Physical" } },
    armorTypes: {
      plated: { label: "Plated", defaultMultiplier: 1, multipliers: { physical: 1 } }
    },
    armorAssignments: {
      enemies: surface === "armor" ? { target: "plated" } : {}
    }
  };
  const ballisticsModule = activation === "absent" ? {} : {
    ballistics: {
      schemaVersion: 1,
      enabled: activation !== "disabled",
      profiles: { reflect: ballisticsProfile(options) }
    }
  };
  const modules: any = options.reverseRecords
    ? {
        ...(surface === "component" ? { enemyBehaviors: enemyBehaviorsModule() } : {}),
        combat: { schemaVersion: 2, enabled: true, profiles: { armored: combatProfile } },
        ...ballisticsModule
      }
    : {
        ...ballisticsModule,
        combat: { schemaVersion: 2, enabled: true, profiles: { armored: combatProfile } },
        ...(surface === "component" ? { enemyBehaviors: enemyBehaviorsModule() } : {})
      };
  return {
    balance: {
      defaultMissionId: "ricochet_lab",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 20, startingCoins: 100,
        startingResources: { coins: 100 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 1, pathWaterDurationUnits: 1,
        pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        mirror: {
          id: "mirror", label: "Mirror", buildable: false, walkable: false,
          groundSpeedMultiplier: 1, tags: ["reflective_rock"]
        }
      },
      abilities: {},
      enemies: {
        target: {
          id: "target", label: "Target", tags: ["boss"], maxHp: 100, speed: 0.001,
          reward: { coins: 7 }, coinReward: 7, coreDamage: 1, color: 1
        }
      },
      towers: {
        cannon: {
          id: "cannon", label: "Cannon", cost: { coins: 1 }, footprintRadius: 0, range: 12,
          attack: {
            kind: "single", fireRate: 0.01, damagePerStack: 20,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1, damageType: "physical"
          }
        }
      },
      waveSets: { wave: [{ id: "wave", label: "Wave", groups }] },
      missions: {
        ricochet_lab: {
          id: "ricochet_lab", label: "Ricochet Lab", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "wave", buildTowerIds: ["cannon"], abilityIds: [],
          mechanics: {
            profiles: {
              combat: "armored",
              ...(selected ? { ballistics: "reflect" } : {}),
              ...(surface === "component" ? { enemyBehaviors: "bosses" } : {})
            }
          }
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 10, height: 3,
        grid: { kind: "square", adjacency: "cardinal" }, defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 9, r: 2 },
        pathCenterline: route(), pathRoutes: [],
        terrainOverrides: surface === "terrain" ? [{ q: 3, r: 1, terrain: "mirror" }] : [],
        ...(options.destructibleAtReflectedTarget ? {
          destructibleObjects: [{
            id: "reflected_gate_1", definitionId: "reflected_gate", coord: { q: 5, r: 1 }
          }]
        } : {})
      }
    },
    mechanics: { schemaVersion: 1, modules },
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "ricochet_lab", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function enemyBehaviorsModule(): unknown {
  return {
    schemaVersion: 1,
    enabled: true,
    profiles: {
      bosses: {
        bosses: {
          target: {
            components: {
              plate: {
                maxHp: 30,
                hitRegion: { kind: "circle", offsetX: 0, offsetY: 0, radius: 0.4 },
                tags: ["reflect"], armorTypeId: "plated"
              }
            }
          }
        },
        targeting: { towers: { cannon: { priorityTags: ["reflect"] } } }
      }
    }
  };
}

function content(options: Options = {}): GameContentRegistry {
  return createGameContentRegistry(input(options));
}

function game(options: Options = {}, seed = "r13.3-ricochet"): TowerDefenseGame {
  return new TowerDefenseGame({ content: content(options), missionId: "ricochet_lab", seed });
}

function prepare(options: Options = {}, seed?: string): TowerDefenseGame {
  const subject = game(options, seed);
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
  expect(subject.enemies.length).toBe(options.enemyCount ?? 2);
  for (let index = 0; index < subject.enemies.length; index += 1) {
    subject.enemies[index]!.pathProgress = index === 0 ? 0 : 5;
  }
  expect(subject.placeTower("cannon", { q: 6, r: 1 })).toEqual({ ok: true });
  expect(subject.setTowerTargetMode("tower_1", "last")).toEqual({ ok: true });
  subject.tick(0);
  return subject;
}

function advance(subject: TowerDefenseGame, units: number): unknown[] {
  const events: unknown[] = [];
  for (let elapsed = 0; elapsed < units - 1e-9; elapsed += 0.2) {
    subject.tick(Math.min(0.2, units - elapsed));
    events.push(...subject.lastEvents);
  }
  return events;
}

function ricochets(events: readonly unknown[]): any[] {
  return events.filter((event: any) => event?.type === "projectileRicocheted") as any[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resign(checkpoint: GameCheckpointV1): void {
  (checkpoint as unknown as { stateDigest: string }).stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest, checkpoint.identity, checkpoint.rng, checkpoint.state
  );
}

afterEach(() => vi.restoreAllMocks());

describe("R13.3 deterministic ricochet runtime (RED)", () => {
  it("reflects from authored terrain before resolver, fixes the next target, then resolves exactly once", () => {
    const subject = prepare({ surface: "terrain", maxBounces: 1 });
    const resolve = vi.spyOn(DamageResolver, "resolve");
    const bounceEvents = advance(subject, 0.2);
    expect(resolve).not.toHaveBeenCalled();
    expect(subject.enemies.map((enemy) => enemy.hp)).toEqual([100, 100]);
    expect(ricochets(bounceEvents)).toEqual([{
      type: "projectileRicocheted", projectileId: "projectile_1", bounceCount: 1,
      surfaceKind: "terrain", surfaceId: "reflective_rock",
      collisionCoord: { q: 3, r: 1 }, nextSourceCoord: { q: 4, r: 1 }, nextTargetCoord: { q: 5, r: 1 }
    }]);
    expect((subject.getSnapshot() as any).ballistics.projectiles[0]).toMatchObject({
      sourceCoord: { q: 4, r: 1 }, targetCoord: { q: 5, r: 1 }, elapsedUnits: 0
    });
    advance(subject, 0.4);
    expect(resolve).toHaveBeenCalledOnce();
    expect(subject.enemies.map((enemy) => enemy.hp)).toEqual([100, 80]);
    expect(subject.resources.coins).toBe(99);
  });

  it.each(["armor", "component"] as const)(
    "reflects from %s armor before shield/HP/resolver and retargets the root only",
    (surface) => {
      const subject = prepare({ surface, maxBounces: 1, shieldCapacity: surface === "armor" ? 5 : undefined });
      const resolve = vi.spyOn(DamageResolver, "resolve");
      const first = advance(subject, 0.4);
      expect(resolve).not.toHaveBeenCalled();
      expect(ricochets(first)).toEqual([expect.objectContaining({
        projectileId: "projectile_1", bounceCount: 1, surfaceKind: "armor", surfaceId: "plated",
        collisionCoord: { q: 0, r: 1 }, nextTargetCoord: { q: 5, r: 1 }
      })]);
      if (surface === "armor") {
        expect((subject.getSnapshot() as any).combat.shields.enemies.enemy_1.current).toBe(5);
      } else {
        expect((subject.getSnapshot() as any).enemyBehaviors.components.enemy_1.plate.hp).toBe(30);
        expect((subject.createCheckpoint().state as any).ballistics.projectiles[0].impact.damagePacket.target)
          .not.toHaveProperty("componentId");
      }
      advance(subject, 0.4);
      expect(resolve).toHaveBeenCalledOnce();
    }
  );

  it("allows four reflections and handles the fifth armor collision through the normal resolver exactly once", () => {
    const subject = prepare({ surface: "armor", maxBounces: 4 });
    const resolve = vi.spyOn(DamageResolver, "resolve");
    const events: unknown[] = [];
    for (let collision = 0; collision < 5; collision += 1) events.push(...advance(subject, 0.4));
    expect(ricochets(events).map((event) => event.bounceCount)).toEqual([1, 2, 3, 4]);
    expect(resolve).toHaveBeenCalledOnce();
    expect(subject.enemies.filter((enemy) => enemy.hp < 100)).toHaveLength(1);
  });

  it("never homes after reflection when the fixed target moves, even if another enemy remains at the impact cell", () => {
    const subject = prepare({ surface: "armor", maxBounces: 1, enemyCount: 3 });
    advance(subject, 0.4);
    const reflectedTarget = (subject.createCheckpoint().state as any).ballistics.projectiles[0]
      .impact.damagePacket.target.enemyId;
    expect(reflectedTarget).toBe("enemy_2");
    subject.enemies.find((enemy) => enemy.id === reflectedTarget)!.pathProgress = 4;
    const events = advance(subject, 0.4) as any[];
    expect(subject.enemies.every((enemy) => enemy.hp === 100)).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({
      type: "projectileMissed", projectileId: "projectile_1",
      targetEnemyId: "enemy_2", reason: "target_moved"
    }));
  });

  it("bounds same-cell candidates to 16 and chooses binary-min ID independently of enemy array order", () => {
    const canonical = prepare({ surface: "armor", maxBounces: 1, enemyCount: 18 }, "candidate-order");
    const permuted = prepare({
      surface: "armor", maxBounces: 1, enemyCount: 18, reverseRecords: true
    }, "candidate-order");
    permuted.enemies.reverse();
    advance(canonical, 0.4);
    advance(permuted, 0.4);
    const target = (subject: TowerDefenseGame) => (subject.createCheckpoint().state as any)
      .ballistics.projectiles[0].impact.damagePacket.target.enemyId;
    expect(target(canonical)).toBe("enemy_2");
    expect(target(permuted)).toBe("enemy_2");
    expect((permuted.getSnapshot() as any).ballistics).toEqual((canonical.getSnapshot() as any).ballistics);
  });

  it("builds one bounded spatial lookup instead of rescanning every enemy for every reflected-ray cell", () => {
    const subject = prepare({ surface: "armor", maxBounces: 1, rangeCells: 12, enemyCount: 1_000 });
    const control = prepare({ surface: "armor", ricochet: false, clearance: false, enemyCount: 1_000 });
    for (const enemy of subject.enemies.slice(1)) enemy.pathProgress = 0;
    for (const enemy of control.enemies.slice(1)) enemy.pathProgress = 0;
    const coord = vi.spyOn(subject, "enemyCoord");
    const controlCoord = vi.spyOn(control, "enemyCoord");
    advance(subject, 0.4);
    advance(control, 0.4);
    expect(ricochets(subject.lastEvents)).toHaveLength(1);
    expect(coord.mock.calls.length - controlCoord.mock.calls.length).toBeLessThanOrEqual(1_100);
  });

  it("uses checkpoint inner v3, rejects forged provenance, and preserves exact v1/v2 legacy shapes", () => {
    const subjectContent = content({ surface: "terrain", maxBounces: 2 });
    const subject = prepare({ surface: "terrain", maxBounces: 2 }, "checkpoint-v3");
    advance(subject, 0.2);
    const checkpoint = subject.createCheckpoint();
    expect((checkpoint.state as any).ballistics).toMatchObject({
      schemaVersion: 3,
      projectiles: [{
        ricochet: {
          schemaVersion: 1, maxBounces: 2, rangeCells: 12, bounceCount: 1, segmentHasTarget: true,
          lastCollision: {
            kind: "terrain", surfaceId: "reflective_rock",
            collisionCoord: { q: 3, r: 1 }, incomingFromCoord: { q: 4, r: 1 }
          }
        }
      }]
    });
    const forged = clone(checkpoint) as any;
    forged.state.ballistics.projectiles[0].ricochet.bounceCount = 3;
    resign(forged);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: forged }))
      .toThrow(/ballistics|ricochet|bounce|provenance|maximum/i);

    const r132 = prepare({ surface: "terrain", ricochet: false, clearance: true }).createCheckpoint();
    expect((r132.state as any).ballistics.schemaVersion).toBe(2);
    expect((r132.state as any).ballistics.projectiles[0]).not.toHaveProperty("ricochet");
    const r131 = prepare({ surface: "armor", ricochet: false, clearance: false }).createCheckpoint();
    expect((r131.state as any).ballistics.schemaVersion).toBe(1);
    expect((r131.state as any).ballistics.projectiles[0]).not.toHaveProperty("ricochet");
  });

  it("matches continuous/checkpoint/journal replay and keeps disabled/unselected/absent paths exact", () => {
    const subjectContent = content({ surface: "armor", maxBounces: 1, enemyCount: 1 });
    const continuous = new TowerDefenseGame({
      content: subjectContent, missionId: "ricochet_lab", seed: "replay"
    });
    const session = new JournaledGameSession(continuous);
    expect(session.dispatch({
      schemaVersion: 1, type: "placeTower", towerTypeId: "cannon", coord: { q: 6, r: 1 }
    })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "startWave" })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0 })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.2 })).toEqual({ ok: true });
    const restored = TowerDefenseGame.fromCheckpoint({
      content: subjectContent, checkpoint: clone(continuous.createCheckpoint())
    });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.2 })).toEqual({ ok: true });
    restored.tick(0.2);
    const replay = replayGameCommandJournal({ content: subjectContent, journal: session.exportJournal() });
    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());
    expect(replay.stateDigest).toBe(continuous.getStateDigest());

    for (const activation of ["disabled", "unselected", "absent"] as const) {
      const legacy = prepare({ surface: "terrain", activation });
      expect(legacy.getSnapshot()).not.toHaveProperty("ballistics");
      expect(legacy.createCheckpoint().state).not.toHaveProperty("ballistics");
      expect(legacy.lastEvents.some((event) => String(event.type) === "projectileRicocheted")).toBe(false);
    }
  });

  it("traces the reflected segment against a newly-live authored destructible before enemy impact", () => {
    const options: Options = {
      surface: "terrain", maxBounces: 1, destructibleAtReflectedTarget: true
    };
    const subject = game(options, "reflected-destructible");
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    expect(subject.enemies).toHaveLength(2);
    subject.enemies[0]!.pathProgress = 0;
    subject.enemies[1]!.pathProgress = 5;
    expect(subject.placeTower("cannon", { q: 6, r: 1 })).toEqual({ ok: true });
    expect(subject.setTowerTargetMode("tower_1", "last")).toEqual({ ok: true });

    type RuntimeInternals = {
      destructibleObjects: Array<{
        objectId: string; definitionId: string; coord: { q: number; r: number };
        hp: number; maxHp: number; destroyed: boolean;
      }>;
      rebuildDestructibleCollisionIndex(): void;
    };
    const runtime = subject as unknown as RuntimeInternals;
    const gate = runtime.destructibleObjects[0]!;
    gate.hp = 0;
    gate.destroyed = true;
    runtime.rebuildDestructibleCollisionIndex();
    subject.tick(0);
    gate.hp = gate.maxHp;
    gate.destroyed = false;
    runtime.rebuildDestructibleCollisionIndex();

    expect(ricochets(advance(subject, 0.2))).toHaveLength(1);
    const reflected = (subject.createCheckpoint().state as any).ballistics.projectiles[0];
    expect(reflected).toMatchObject({
      sourceCoord: { q: 4, r: 1 },
      impact: { targetCoord: { q: 5, r: 1 } },
      destructibleCollision: {
        kind: "map_object", objectId: "reflected_gate_1", definitionId: "reflected_gate",
        collisionCoord: { q: 5, r: 1 }
      }
    });

    const segmentEvents = advance(subject, 0.4) as Array<{ type?: string; objectId?: string }>;
    expect((subject.getSnapshot() as any).ballistics.destructibles.objects[0]).toMatchObject({
      objectId: "reflected_gate_1", hp: 30, destroyed: false
    });
    expect(subject.enemies.map((enemy) => enemy.hp)).toEqual([100, 100]);
    expect(segmentEvents.filter((event) => (
      event.type === "destructibleObjectDamaged" && event.objectId === "reflected_gate_1"
    ))).toHaveLength(1);
  });
});
