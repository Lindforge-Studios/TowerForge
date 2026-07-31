import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import { computeCheckpointStateDigest, type GameCheckpointV1 } from "./checkpoint.js";
import { JournaledGameSession } from "./journal.js";
import { replayGameCommandJournal } from "./replay.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { GridDefinition } from "./types.js";

type Trajectory = "direct" | "arc";
type Activation = "active" | "disabled" | "unselected" | "absent";

interface Options {
  readonly trajectory?: Trajectory;
  readonly maxAltitude?: number;
  readonly blockerElevation?: number;
  readonly blockerHeights?: Readonly<Record<string, number>>;
  readonly blockerTags?: readonly string[];
  readonly clearance?: boolean;
  readonly activation?: Activation;
  readonly grid?: GridDefinition;
  readonly reverseRecords?: boolean;
  readonly width?: number;
  readonly targetQ?: number;
}

interface ClearanceCollisionV1Contract {
  readonly blockerCoord: { readonly q: number; readonly r: number };
  readonly terrainId: string;
  readonly blockerTag: string;
  readonly blockerElevation: number;
  readonly elapsedUnits: number;
}

function ballisticsProfile(options: Options): unknown {
  const trajectory = options.trajectory ?? "arc";
  const binding = trajectory === "arc"
    ? { trajectory, travelTimeUnits: 0.4, maxAltitude: options.maxAltitude ?? 5 }
    : { trajectory, travelTimeUnits: 0.4 };
  const terrainBlockerHeights = options.blockerHeights ?? { wall: 0 };
  const orderedHeights = options.reverseRecords
    ? Object.fromEntries(Object.entries(terrainBlockerHeights).reverse())
    : terrainBlockerHeights;
  return {
    projectiles: {
      towers: { subject: binding },
      ...(options.clearance === false ? {} : {
        clearance: { terrainBlockerHeights: orderedHeights }
      })
    }
  };
}

function input(options: Options = {}): GameContentInput {
  const activation = options.activation ?? "active";
  const selected = activation !== "unselected" && activation !== "absent";
  const width = options.width ?? 10;
  const targetQ = options.targetQ ?? 4;
  const coreQ = width - 1;
  const blockerTags = [...(options.blockerTags ?? ["wall"])];
  const terrainTypes = options.reverseRecords
    ? {
        spare_ground: {
          id: "spare_ground", label: "Spare", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: ["spare"]
        },
        cliff: {
          id: "cliff", label: "Cliff", buildable: false, walkable: false,
          groundSpeedMultiplier: 1, tags: blockerTags
        }
      }
    : {
        cliff: {
          id: "cliff", label: "Cliff", buildable: false, walkable: false,
          groundSpeedMultiplier: 1, tags: blockerTags
        },
        spare_ground: {
          id: "spare_ground", label: "Spare", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: ["spare"]
        }
      };
  const pathCenterline = Array.from({ length: coreQ - targetQ + 1 }, (_, index) => ({
    q: targetQ + index,
    r: 1
  }));
  return {
    balance: {
      defaultMissionId: "clearance_lab",
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
      terrainTypes,
      abilities: {},
      enemies: {
        target: {
          id: "target", label: "Target", maxHp: 100, speed: 0.001,
          reward: { coins: 7 }, coinReward: 7, coreDamage: 1, color: 1
        }
      },
      towers: {
        subject: {
          id: "subject", label: "Subject", cost: { coins: 1 }, footprintRadius: 0,
          range: Math.max(8, targetQ + 1),
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
        clearance_lab: {
          id: "clearance_lab", label: "Clearance Lab", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "wave", buildTowerIds: ["subject"], abilityIds: [],
          ...(selected ? { mechanics: { profiles: { ballistics: "field" } } } : {})
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width, height: 3,
        grid: options.grid ?? { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable", spawnCoord: { q: targetQ, r: 1 }, coreCoord: { q: coreQ, r: 1 },
        pathCenterline, pathRoutes: [],
        terrainOverrides: targetQ > 2 ? [{ q: 2, r: 1, terrain: "cliff" }] : [],
        elevationOverrides: options.blockerElevation === undefined
          ? []
          : [{ q: 2, r: 1, elevation: options.blockerElevation }]
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: activation === "absent" ? {} : {
        ballistics: {
          schemaVersion: 1,
          enabled: activation !== "disabled",
          profiles: { field: ballisticsProfile(options) }
        }
      }
    },
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "clearance_lab", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function content(options: Options = {}): GameContentRegistry {
  return createGameContentRegistry(input(options));
}

function game(options: Options = {}, seed = "r13.2-clearance"): TowerDefenseGame {
  return new TowerDefenseGame({ content: content(options), missionId: "clearance_lab", seed });
}

function launch(options: Options = {}, seed?: string): TowerDefenseGame {
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

function blockedEvents(subject: TowerDefenseGame): unknown[] {
  return subject.lastEvents.filter((event) => String(event.type) === "projectileBlocked");
}

describe("R13.2 deterministic projectile arc clearance (RED)", () => {
  it("blocks a direct shot on equality, emits one stable event, and deals no hidden damage or reward", () => {
    const subject = launch({ trajectory: "direct", blockerHeights: { wall: 0 } });
    expect(subject.resources.coins).toBe(99);
    subject.tick(0.2);

    expect(subject.enemies[0]?.hp).toBe(100);
    expect(subject.resources.coins).toBe(99);
    expect((subject.getSnapshot() as any).ballistics.projectiles).toEqual([]);
    expect(blockedEvents(subject)).toEqual([{
      type: "projectileBlocked",
      projectileId: "projectile_1",
      targetCoord: { q: 4, r: 1 },
      blockerCoord: { q: 2, r: 1 },
      terrainId: "cliff",
      blockerTag: "wall",
      projectileAltitude: 0,
      obstacleTop: 0
    }]);

    subject.tick(0);
    expect(subject.enemies[0]?.hp).toBe(100);
    expect(blockedEvents(subject)).toEqual([]);
  });

  it("lets an arc strictly above an obstacle pass and blocks the equal-height arc", () => {
    const clear = launch({ trajectory: "arc", maxAltitude: 5, blockerHeights: { wall: 4 } }, "clear");
    clear.tick(0.2);
    expect(blockedEvents(clear)).toEqual([]);
    expect((clear.getSnapshot() as any).ballistics.projectiles).toHaveLength(1);
    clear.tick(0.2);
    expect(clear.enemies[0]?.hp).toBe(80);

    const equal = launch({ trajectory: "arc", maxAltitude: 5, blockerHeights: { wall: 5 } }, "equal");
    equal.tick(0.2);
    expect(equal.enemies[0]?.hp).toBe(100);
    expect(blockedEvents(equal)).toEqual([expect.objectContaining({
      blockerCoord: { q: 2, r: 1 }, projectileAltitude: 5, obstacleTop: 5
    })]);
  });

  it("adds tile elevation to authored blocker height and chooses highest then binary-min matching tag", () => {
    const highest = launch({
      trajectory: "arc", maxAltitude: 5, blockerElevation: 2,
      blockerTags: ["a_wall", "z_wall"], blockerHeights: { a_wall: 2, z_wall: 3 }
    }, "highest");
    highest.tick(0.2);
    expect(blockedEvents(highest)).toEqual([expect.objectContaining({
      blockerTag: "z_wall", projectileAltitude: 5, obstacleTop: 5
    })]);

    const tie = launch({
      trajectory: "arc", maxAltitude: 5, blockerElevation: 2,
      blockerTags: ["z_wall", "a_wall"], blockerHeights: { z_wall: 3, a_wall: 3 }
    }, "tie");
    tie.tick(0.2);
    expect(blockedEvents(tie)).toEqual([expect.objectContaining({ blockerTag: "a_wall" })]);
  });

  it.each([
    ["square", { kind: "square", adjacency: "cardinal" } as const],
    ["hex", { kind: "hex", layout: "odd-r" } as const]
  ])("uses the canonical %s topology line and is invariant to authored record order", (_label, grid) => {
    const canonical = launch({
      grid, trajectory: "direct", blockerTags: ["z_wall", "a_wall"],
      blockerHeights: { z_wall: 0, a_wall: 0 }
    }, `topology-${_label}`);
    const permuted = launch({
      grid, trajectory: "direct", blockerTags: ["z_wall", "a_wall"],
      blockerHeights: { z_wall: 0, a_wall: 0 }, reverseRecords: true
    }, `topology-${_label}`);
    canonical.tick(0.2);
    permuted.tick(0.2);
    expect(permuted.getSnapshot()).toEqual(canonical.getSnapshot());
    expect(permuted.getStateDigest()).toBe(canonical.getStateDigest());
    expect(blockedEvents(permuted)).toEqual(blockedEvents(canonical));
    expect(blockedEvents(canonical)).toEqual([expect.objectContaining({ blockerTag: "a_wall" })]);
  });

  it("freezes the launch-time trace so a later terrain mutation cannot change this flight", () => {
    const subject = launch({ trajectory: "direct", blockerHeights: { wall: 0 } });
    expect(subject.map.setTerrain({ q: 2, r: 1 }, "buildable")).toBe(true);
    subject.tick(0.2);
    expect(blockedEvents(subject)).toEqual([expect.objectContaining({
      blockerCoord: { q: 2, r: 1 }, terrainId: "cliff", blockerTag: "wall"
    })]);
    expect(subject.enemies[0]?.hp).toBe(100);
  });

  it("fails closed beyond the ray budget before cooldown, towerFired, or projectile allocation", () => {
    const subject = game({ trajectory: "direct", width: 260, targetQ: 257 });
    expect(subject.placeTower("subject", { q: 0, r: 1 })).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    expect(subject.towers[0]?.cooldown).toBe(0);
    expect(subject.lastEvents.some((event) => event.type === "towerFired")).toBe(false);
    expect((subject.getSnapshot() as any).ballistics.projectiles).toEqual([]);
    expect(subject.enemies[0]?.hp).toBe(100);
  });

  it("uses checkpoint inner v2 only for active clearance and restores the captured collision trace", () => {
    const subjectContent = content({ trajectory: "arc", maxAltitude: 5, blockerElevation: 2, blockerHeights: { wall: 3 } });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "clearance_lab", seed: "checkpoint" });
    expect(subject.placeTower("subject", { q: 0, r: 1 })).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);

    const checkpoint = subject.createCheckpoint();
    expect((checkpoint.state as any).ballistics).toMatchObject({
      schemaVersion: 2,
      nextProjectileSequence: 2,
      projectiles: [{
        id: "projectile_1",
        clearanceCollision: {
          blockerCoord: { q: 2, r: 1 },
          terrainId: "cliff",
          blockerTag: "wall",
          blockerElevation: 2,
          elapsedUnits: 0.2
        }
      }]
    });
    const restored = TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: clone(checkpoint) });
    subject.tick(0.2);
    restored.tick(0.2);
    expect(restored.getStateDigest()).toBe(subject.getStateDigest());
    expect(blockedEvents(restored)).toEqual(blockedEvents(subject));

    const noClearance = launch({ clearance: false }).createCheckpoint();
    expect((noClearance.state as any).ballistics.schemaVersion).toBe(1);
    expect((noClearance.state as any).ballistics.projectiles[0]).not.toHaveProperty("clearanceCollision");
  });

  it("rejects forged v2 collision provenance and matches journal replay after a blocked impact", () => {
    const subjectContent = content({ trajectory: "direct", blockerHeights: { wall: 0 } });
    const live = new TowerDefenseGame({ content: subjectContent, missionId: "clearance_lab", seed: "journal" });
    const session = new JournaledGameSession(live);
    expect(session.dispatch({
      schemaVersion: 1, type: "placeTower", towerTypeId: "subject", coord: { q: 0, r: 1 }
    })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "startWave" })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0 })).toEqual({ ok: true });
    const checkpoint = live.createCheckpoint();
    const forged = clone(checkpoint) as any;
    expect(forged.state.ballistics.schemaVersion).toBe(2);
    forged.state.ballistics.projectiles[0].clearanceCollision.elapsedUnits = 0.1;
    resign(forged);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: forged }))
      .toThrow(/ballistics|clearance|collision|elapsed|provenance/i);

    const skippedFirstBlocker = clone(checkpoint) as any;
    skippedFirstBlocker.state.ballistics.projectiles[0].clearanceCollision.blockerCoord = { q: 3, r: 1 };
    skippedFirstBlocker.state.ballistics.projectiles[0].clearanceCollision.elapsedUnits = 0.3;
    resign(skippedFirstBlocker);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: skippedFirstBlocker }))
      .toThrow(/ballistics|clearance|collision|first|provenance/i);

    const future = clone(checkpoint) as any;
    future.state.ballistics.schemaVersion = 3;
    resign(future);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: future }))
      .toThrow(/ballistics|schema|version|unsupported/i);

    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.2 })).toEqual({ ok: true });
    const replay = replayGameCommandJournal({ content: subjectContent, journal: session.exportJournal() });
    expect(replay.stateDigest).toBe(live.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(live.getSnapshot());
  });

  it.each(["absent", "disabled", "unselected"] as const)(
    "keeps %s clearance on the exact instant legacy path with no optional state",
    (activation) => {
      const subject = launch({ activation, trajectory: "direct", blockerHeights: { wall: 0 } });
      expect(subject.enemies[0]?.hp).toBe(80);
      expect(subject.getSnapshot()).not.toHaveProperty("ballistics");
      expect(subject.createCheckpoint().state).not.toHaveProperty("ballistics");
      expect(blockedEvents(subject)).toEqual([]);
    }
  );
});
