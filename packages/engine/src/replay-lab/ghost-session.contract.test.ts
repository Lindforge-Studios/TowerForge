import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import {
  JournaledGameSession,
  replayGameCommandJournal,
  TowerDefenseGame,
  type GameCommandJournal
} from "../index.js";
import {
  createGhostReplaySessionV1,
  decodeReplayArchiveV1,
  encodeReplayArchiveV1,
  GHOST_REPLAY_LIMITS
} from "./index.js";

function input(): GameContentInput {
  return {
    balance: {
      defaultMissionId: "ghost",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 10, startingCoins: 0, startingResources: { coins: 0 },
        prepTimeUnits: 1, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 5, pathWaterDurationUnits: 3, pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {}, enemies: {}, towers: {},
      waveSets: { empty: [{ id: "wave", label: "Wave", groups: [] }] },
      missions: {
        ghost: {
          id: "ghost", label: "Ghost", description: "", startingCoreHp: 10,
          startingResources: { coins: 0 }, prepTimeUnits: 1, mapId: "lane",
          waveSetId: "empty", buildTowerIds: [], abilityIds: []
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 2, height: 1, grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "path", spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 1, r: 0 },
        pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }], pathRoutes: [], terrainOverrides: []
      }
    },
    worldMap: {
      width: 10, height: 10,
      regions: [{ id: "r", label: "R", description: "", biome: "test", accent: "#fff", bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: [] }],
      missionNodes: [{ missionId: "ghost", regionId: "r", x: 5, y: 5, difficulty: 1, unlockRequiresMissionIds: [] }]
    }
  };
}

function recorded(entryCount = 3) {
  const content = createGameContentRegistry(input());
  const sourceGame = new TowerDefenseGame({ content, missionId: "ghost", seed: "r16-ghost" });
  const session = new JournaledGameSession(sourceGame);
  for (let index = 0; index < entryCount; index += 1) {
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.01 }).ok).toBe(true);
  }
  const journal = session.exportJournal();
  const bytes = encodeReplayArchiveV1({ content, journal });
  return { content, sourceGame, journal, archive: decodeReplayArchiveV1({ content, bytes }) };
}

function partial(journal: GameCommandJournal, count: number): GameCommandJournal {
  return { ...journal, entries: journal.entries.slice(0, count) } as GameCommandJournal;
}

describe("R16.2 detached Ghost Replay Session contract (RED)", () => {
  it("constructs only from a decoded archive and exposes no mutable game command surface", () => {
    const { archive, content } = recorded();
    const ghost = createGhostReplaySessionV1({ archive });
    expect(ghost).not.toHaveProperty("game");
    expect(ghost).not.toHaveProperty("dispatch");
    expect(ghost).not.toHaveProperty("tick");
    expect(() => createGhostReplaySessionV1({ archive: structuredClone(archive) }))
      .toThrow(/decoded|archive|brand/i);
    expect(() => createGhostReplaySessionV1({ archive: encodeReplayArchiveV1({ content, journal: archive.journal }) as never }))
      .toThrow(/decoded|archive/i);
  });

  it("seeks 0..N, advances and returns the deterministic final immutable envelope", () => {
    const { archive, content, journal } = recorded();
    const ghost = createGhostReplaySessionV1({ archive });
    const zero = ghost.seek(0);
    const one = ghost.advance();
    const expectedOne = replayGameCommandJournal({ content, journal: partial(journal, 1) });
    const end = ghost.final();
    const expectedEnd = replayGameCommandJournal({ content, journal });

    expect(zero).toMatchObject({ schemaVersion: 1, ghost: true, sequence: 0, stateDigest: journal.initialCheckpoint.stateDigest });
    expect(one).toMatchObject({ schemaVersion: 1, ghost: true, sequence: 1, stateDigest: expectedOne.stateDigest });
    expect(one.snapshot).toEqual(expectedOne.game.getSnapshot());
    expect(end).toMatchObject({ schemaVersion: 1, ghost: true, sequence: journal.entries.length, stateDigest: expectedEnd.stateDigest });
    expect(end.snapshot).toEqual(expectedEnd.game.getSnapshot());
    expect(Object.keys(end)).toEqual(["schemaVersion", "ghost", "sequence", "stateDigest", "snapshot"]);
    expect(Object.isFrozen(end)).toBe(true);
    expect(Object.isFrozen(end.snapshot)).toBe(true);
    expect(Object.isFrozen(end.snapshot.towers)).toBe(true);
    expect(Object.isFrozen(end.snapshot.enemies)).toBe(true);
    expect(ghost.advance()).toEqual(end);
    expect(() => ghost.seek(-1)).toThrow(/sequence|range/i);
    expect(() => ghost.seek(journal.entries.length + 1)).toThrow(/sequence|range/i);
  });

  it("keeps source journal and an unrelated active game isolated from seek and re-seek", () => {
    const { archive, content, journal } = recorded();
    const active = new TowerDefenseGame({ content, missionId: "ghost", seed: "active" });
    const activeDigest = active.getStateDigest();
    const activeSnapshot = active.getSnapshot();
    const sourceBefore = structuredClone(journal);
    const ghost = createGhostReplaySessionV1({ archive });
    const first = ghost.final();
    const firstSnapshot = structuredClone(first.snapshot);

    expect(ghost.seek(0)).toMatchObject({ ghost: true, sequence: 0 });
    expect(ghost.final()).toEqual(first);
    expect(first.snapshot).toEqual(firstSnapshot);
    expect(active.getStateDigest()).toBe(activeDigest);
    expect(active.getSnapshot()).toEqual(activeSnapshot);
    expect(journal).toEqual(sourceBefore);
  });

  it("bounds cached frames at 256 while deterministic re-seek survives eviction", () => {
    expect(GHOST_REPLAY_LIMITS).toEqual(expect.objectContaining({ maximumCachedFrames: 256 }));
    const { archive } = recorded(GHOST_REPLAY_LIMITS.maximumCachedFrames + 2);
    const ghost = createGhostReplaySessionV1({ archive });
    const zero = ghost.seek(0);
    const middle = ghost.seek(128);
    const end = ghost.final();
    for (let sequence = 0; sequence <= GHOST_REPLAY_LIMITS.maximumCachedFrames + 2; sequence += 1) {
      ghost.seek(sequence);
    }
    expect(ghost.seek(0)).toEqual(zero);
    expect(ghost.seek(128)).toEqual(middle);
    expect(ghost.final()).toEqual(end);
  });
});
