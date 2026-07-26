import { describe, expect, it } from "vitest";
import {
  computeCheckpointStateDigest,
  decodeGameCommandJournal,
  JournaledGameSession,
  replayGameCommandJournal,
  type GameCheckpointV1,
  type GameCommandJournalV4
} from "../index.js";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import { dispatchGameCommand, type GameCommandV4 } from "./commands.js";
import { applySimulationAction } from "./headless.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { GridCoord, GridDefinition } from "./types.js";

type Activation = "absent" | "v1" | "v2";

function movementInput(
  activation: Activation = "v2",
  grid: GridDefinition = { kind: "square", adjacency: "cardinal" },
  walls: readonly GridCoord[] = []
): GameContentInput {
  const profile = activation === "v1"
    ? {
        selectedHeroId: "commander",
        definitions: { commander: { label: "Commander", spawn: "core" } }
      }
    : {
        selectedHeroId: "commander",
        definitions: {
          commander: {
            label: "Commander",
            spawn: "core",
            movement: { movementProfileId: "ground", speed: 2 }
          }
        },
        movementProfiles: {
          ground: {
            label: "Ground",
            terrainMode: "respect_walkable",
            towerOccupancy: "blocked",
            defaultTerrainCost: 1_000
          }
        }
      };
  return {
    balance: {
      defaultMissionId: "hero_move",
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
      terrainTypes: {
        floor: {
          id: "floor", label: "Floor", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: []
        },
        wall: {
          id: "wall", label: "Wall", buildable: false, walkable: false,
          groundSpeedMultiplier: 0, tags: []
        }
      },
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt", label: "Grunt", maxHp: 10, speed: 0.1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {
        blocker: {
          id: "blocker", label: "Blocker", cost: { coins: 1 }, footprintRadius: 0,
          range: 1,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 1,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        one: [{
          id: "wave", label: "Wave",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        hero_move: {
          id: "hero_move", label: "Hero move", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "arena", waveSetId: "one", buildTowerIds: ["blocker"], abilityIds: [],
          ...(activation === "absent" ? {} : { mechanics: { profiles: { heroes: "commanders" } } })
        }
      }
    },
    maps: {
      arena: {
        id: "arena", width: 5, height: 3, grid,
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 4, r: 1 },
        pathCenterline: Array.from({ length: 5 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [],
        terrainOverrides: walls.map(({ q, r }) => ({ q, r, terrain: "wall" }))
      }
    },
    ...(activation === "absent" ? {} : {
      mechanics: {
        schemaVersion: 1,
        modules: {
          heroes: {
            schemaVersion: (activation === "v1" ? 1 : 2) as 1,
            enabled: true,
            profiles: { commanders: profile }
          }
        }
      }
    }),
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "hero_move", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
}

function content(
  activation: Activation = "v2",
  grid: GridDefinition = { kind: "square", adjacency: "cardinal" },
  walls: readonly GridCoord[] = []
): GameContentRegistry {
  return createGameContentRegistry(movementInput(activation, grid, walls));
}

function game(
  activation: Activation = "v2",
  grid: GridDefinition = { kind: "square", adjacency: "cardinal" },
  walls: readonly GridCoord[] = []
): TowerDefenseGame {
  return new TowerDefenseGame({
    content: content(activation, grid, walls),
    missionId: "hero_move",
    seed: "hero-movement"
  });
}

function move(target: GridCoord): GameCommandV4 {
  return { schemaVersion: 4, type: "moveHero", heroId: "commander", target };
}

function hero(subject: TowerDefenseGame): {
  coord: GridCoord;
  movement: { targetCoord: GridCoord | null; nextCoord: GridCoord | null; edgeProgress: number };
} {
  const snapshot = subject.getSnapshot().heroes as unknown as {
    schemaVersion: number;
    units: Array<{
      coord: GridCoord;
      movement: { targetCoord: GridCoord | null; nextCoord: GridCoord | null; edgeProgress: number };
    }>;
  };
  expect(snapshot.schemaVersion).toBe(2);
  const unit = snapshot.units[0]!;
  return { coord: unit.coord, movement: unit.movement };
}

function clone<T>(value: T): T {
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

describe("R5.1B deterministic opt-in hero movement (RED)", () => {
  it.each([
    ["square", { kind: "square", adjacency: "cardinal" } as const],
    ["hex", { kind: "hex", layout: "odd-r" } as const]
  ])("moves one v2 hero on the shared %s topology without activating navigation", (_label, grid) => {
    const subject = game("v2", grid);
    expect(subject.content.missions.hero_move?.capabilities.navigation.active).toBe(false);
    expect(hero(subject)).toEqual({
      coord: { q: 4, r: 1 },
      movement: { targetCoord: null, nextCoord: null, edgeProgress: 0 }
    });
    expect(dispatchGameCommand(subject, move({ q: 3, r: 1 }))).toEqual({ ok: true });
    subject.tick(0.2);
    expect(hero(subject).movement).toMatchObject({
      targetCoord: { q: 3, r: 1 },
      nextCoord: { q: 3, r: 1 }
    });
    expect(hero(subject).movement.edgeProgress).toBeCloseTo(0.4);
    subject.tick(0.2);
    subject.tick(0.2);
    expect(hero(subject)).toEqual({
      coord: { q: 3, r: 1 },
      movement: { targetCoord: null, nextCoord: null, edgeProgress: 0 }
    });
  });

  it("rejects inactive, wrong-id, outside, and unreachable commands without mutation", () => {
    for (const inactive of [game("absent"), game("v1")]) {
      const before = inactive.getStateDigest();
      expect(dispatchGameCommand(inactive, move({ q: 3, r: 1 }))).toMatchObject({ ok: false });
      expect(inactive.getStateDigest()).toBe(before);
    }
    const subject = game();
    for (const command of [
      { ...move({ q: 3, r: 1 }), heroId: "missing" },
      move({ q: -1, r: 1 })
    ]) {
      const before = subject.getStateDigest();
      expect(dispatchGameCommand(subject, command)).toMatchObject({ ok: false });
      expect(subject.getStateDigest()).toBe(before);
    }
    const sealed = game("v2", { kind: "square", adjacency: "cardinal" }, [
      { q: 3, r: 0 }, { q: 3, r: 1 }, { q: 3, r: 2 }
    ]);
    const before = sealed.getStateDigest();
    expect(dispatchGameCommand(sealed, move({ q: 0, r: 1 }))).toMatchObject({ ok: false });
    expect(sealed.getStateDigest()).toBe(before);
  });

  it("preserves partial progress only while the canonical next cell is unchanged, and idles at current", () => {
    const subject = game();
    expect(dispatchGameCommand(subject, move({ q: 0, r: 1 }))).toEqual({ ok: true });
    subject.tick(0.2);
    expect(hero(subject).movement).toMatchObject({ nextCoord: { q: 3, r: 1 } });
    expect(hero(subject).movement.edgeProgress).toBeCloseTo(0.4);

    expect(dispatchGameCommand(subject, move({ q: 2, r: 1 }))).toEqual({ ok: true });
    expect(hero(subject).movement.edgeProgress).toBeCloseTo(0.4);
    expect(dispatchGameCommand(subject, move({ q: 4, r: 0 }))).toEqual({ ok: true });
    expect(hero(subject).movement).toEqual({
      targetCoord: { q: 4, r: 0 }, nextCoord: { q: 4, r: 0 }, edgeProgress: 0
    });
    expect(dispatchGameCommand(subject, move({ q: 4, r: 1 }))).toEqual({ ok: true });
    expect(hero(subject).movement).toEqual({ targetCoord: null, nextCoord: null, edgeProgress: 0 });
  });

  it("stalls a retained target on occupancy dirty and resumes after the path reopens", () => {
    const subject = game();
    expect(dispatchGameCommand(subject, move({ q: 0, r: 1 }))).toEqual({ ok: true });
    subject.tick(0.2);
    for (const coord of [{ q: 3, r: 0 }, { q: 3, r: 1 }, { q: 3, r: 2 }]) {
      expect(subject.placeTower("blocker", coord)).toEqual({ ok: true });
    }
    subject.tick(0);
    expect(hero(subject).movement).toEqual({
      targetCoord: { q: 0, r: 1 }, nextCoord: null, edgeProgress: 0
    });
    expect(subject.sellTower("tower_2").ok).toBe(true);
    subject.tick(0);
    expect(hero(subject).movement).toEqual({
      targetCoord: { q: 0, r: 1 }, nextCoord: { q: 3, r: 1 }, edgeProgress: 0
    });
  });

  it("canonicalizes dirty hero movement before checkpoint, digest, and snapshot reads", () => {
    const subjectContent = content();
    const subject = new TowerDefenseGame({
      content: subjectContent,
      missionId: "hero_move",
      seed: "hero-dirty-checkpoint"
    });
    expect(dispatchGameCommand(subject, move({ q: 0, r: 1 }))).toEqual({ ok: true });
    subject.tick(0.2);
    expect(hero(subject).movement).toMatchObject({
      nextCoord: { q: 3, r: 1 },
      edgeProgress: 0.4
    });

    expect(subject.placeTower("blocker", { q: 3, r: 1 })).toEqual({ ok: true });
    const checkpoint = subject.createCheckpoint();
    expect(subject.getStateDigest()).toBe(checkpoint.stateDigest);
    expect(subject.getSnapshot().heroes).toMatchObject({
      schemaVersion: 2,
      units: [{ movement: { nextCoord: expect.any(Object), edgeProgress: 0 } }]
    });
    const restored = TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint });
    expect(restored.getStateDigest()).toBe(subject.getStateDigest());
    expect(restored.getSnapshot()).toEqual(subject.getSnapshot());
  });

  it("keeps read-only snapshot, digest, and checkpoint queries observationally pure", () => {
    const observed = game();
    const silent = game();
    for (const subject of [observed, silent]) {
      expect(dispatchGameCommand(subject, move({ q: 0, r: 1 }))).toEqual({ ok: true });
      subject.tick(0.2);
      expect(subject.placeTower("blocker", { q: 3, r: 1 })).toEqual({ ok: true });
    }

    observed.getSnapshot();
    observed.getStateDigest();
    observed.createCheckpoint();

    expect(observed.sellTower("tower_1")).toEqual({ ok: true });
    expect(silent.sellTower("tower_1")).toEqual({ ok: true });
    expect(observed.getStateDigest()).toBe(silent.getStateDigest());
    expect(observed.getSnapshot()).toEqual(silent.getSnapshot());
  });

  it("keeps checkpoint v1, promotes exact command/journal v4, and replays the same digest", () => {
    const subjectContent = content();
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "hero_move", seed: "hero-journal" });
    expect(dispatchGameCommand(subject, move({ q: 0, r: 1 }))).toEqual({ ok: true });
    subject.tick(0.2);
    const checkpoint = clone(subject.createCheckpoint()) as GameCheckpointV1 & {
      state: GameCheckpointV1["state"] & { heroes?: unknown };
    };
    expect(checkpoint.schemaVersion).toBe(1);
    expect(checkpoint.engineVersion).toBe("towerforge-sim-v2");
    expect(checkpoint.state.heroes).toEqual({
      schemaVersion: 1,
      unit: {
        definitionId: "commander",
        currentCoord: { q: 4, r: 1 },
        targetCoord: { q: 0, r: 1 },
        nextCoord: { q: 3, r: 1 },
        edgeProgress: 0.4
      }
    });
    const restored = TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint });
    expect(restored.getSnapshot()).toEqual(subject.getSnapshot());
    expect(restored.getStateDigest()).toBe(subject.getStateDigest());

    const missing = clone(checkpoint);
    delete missing.state.heroes;
    resign(missing);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: missing }))
      .toThrow(/hero|checkpoint|required/i);

    const session = new JournaledGameSession(new TowerDefenseGame({
      content: subjectContent, missionId: "hero_move", seed: "hero-replay"
    }));
    expect(session.dispatch(move({ q: 0, r: 1 }))).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.2 })).toEqual({ ok: true });
    const journal = session.exportJournal() as GameCommandJournalV4;
    expect(journal.schemaVersion).toBe(4);
    expect(journal.entries[0]?.command).toEqual(move({ q: 0, r: 1 }));
    expect(decodeGameCommandJournal({ content: subjectContent, journal: clone(journal) })).toEqual(journal);
    const replay = replayGameCommandJournal({ content: subjectContent, journal: clone(journal) });
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
  });

  it("keeps v1-v3 command envelopes exact and exposes movement through the headless adapter", () => {
    const subject = game();
    const before = subject.getStateDigest();
    expect(dispatchGameCommand(subject, {
      schemaVersion: 3, type: "moveHero", heroId: "commander", target: { q: 3, r: 1 }
    })).toMatchObject({ ok: false, reasonKey: "reason.invalidGameCommand" });
    expect(dispatchGameCommand(subject, {
      ...move({ q: 3, r: 1 }), extra: true
    })).toMatchObject({ ok: false, reasonKey: "reason.invalidGameCommand" });
    expect(subject.getStateDigest()).toBe(before);
    expect(applySimulationAction(subject, {
      type: "moveHero", heroId: "commander", target: { q: 3, r: 1 }
    } as never)).toEqual({ ok: true });
  });
});
