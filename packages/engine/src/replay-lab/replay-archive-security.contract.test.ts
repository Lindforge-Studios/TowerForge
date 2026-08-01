import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { JournaledGameSession, TowerDefenseGame, type GameCommandJournal } from "../index.js";
import {
  decodeReplayArchiveV1,
  encodeReplayArchiveV1,
  REPLAY_ARCHIVE_LIMITS
} from "./index.js";

function fixture(): GameContentInput {
  return {
    balance: {
      defaultMissionId: "security",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 10,
        startingCoins: 0,
        startingResources: { coins: 0 },
        prepTimeUnits: 1,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 5,
        pathWaterDurationUnits: 3,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {},
      enemies: {},
      towers: {},
      waveSets: { empty: [{ id: "wave", label: "Wave", groups: [] }] },
      missions: {
        security: {
          id: "security",
          label: "Security",
          description: "",
          startingCoreHp: 10,
          startingResources: { coins: 0 },
          prepTimeUnits: 1,
          mapId: "lane",
          waveSetId: "empty",
          buildTowerIds: [],
          abilityIds: []
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 2,
        height: 1,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "path",
        spawnCoord: { q: 0, r: 0 },
        coreCoord: { q: 1, r: 0 },
        pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "r",
        label: "R",
        description: "",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        accent: "#fff",
        biome: "test",
        connections: []
      }],
      missionNodes: [{
        missionId: "security",
        regionId: "r",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
}

function setup() {
  const content = createGameContentRegistry(fixture());
  const game = new TowerDefenseGame({ content, missionId: "security", seed: "r16-security" });
  const journal = new JournaledGameSession(game).exportJournal();
  const bytes = encodeReplayArchiveV1({ content, journal });
  return { content, journal, bytes };
}

describe("R16.1 ReplayArchiveV1 hostile input contract (RED)", () => {
  it("rejects non-Uint8Array, proxy and foreign binary views without invoking hostile traps", () => {
    const { content, bytes } = setup();
    const hostile = new Proxy(bytes, {
      getPrototypeOf() {
        throw new Error("hostile binary prototype trap");
      },
      get() {
        throw new Error("hostile binary get trap");
      }
    });
    const candidates: unknown[] = [null, {}, [], bytes.buffer, new DataView(bytes.buffer), hostile];
    for (const candidate of candidates) {
      let caught: unknown;
      try {
        decodeReplayArchiveV1({ content, bytes: candidate as Uint8Array });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeDefined();
      expect(String(caught)).not.toContain("hostile binary");
    }
  });

  it("rejects a binary allocation above the exact 72 MiB archive ceiling", () => {
    const { content } = setup();
    const oversized = new Uint8Array(REPLAY_ARCHIVE_LIMITS.maximumBytes + 1);
    expect(() => decodeReplayArchiveV1({ content, bytes: oversized }))
      .toThrow(/archive|byte|budget|large|limit/i);
  });

  it("rejects sparse, accessor, cyclic and symbol-bearing journals before encoding", () => {
    const { content, journal } = setup();
    const accessor = { ...journal } as unknown as Record<string, unknown>;
    let reads = 0;
    Object.defineProperty(accessor, "entries", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("journal accessor must not run");
      }
    });
    const sparse = { ...journal, entries: new Array(1) } as unknown as GameCommandJournal;
    const cyclic = { ...journal } as unknown as Record<string, unknown>;
    cyclic.self = cyclic;
    const symbol = { ...journal, [Symbol("hidden")]: true } as unknown as GameCommandJournal;

    expect(() => encodeReplayArchiveV1({ content, journal: accessor as unknown as GameCommandJournal }))
      .toThrow(/accessor|data property|journal/i);
    expect(reads).toBe(0);
    expect(() => encodeReplayArchiveV1({ content, journal: sparse })).toThrow(/sparse|entries|journal/i);
    expect(() => encodeReplayArchiveV1({ content, journal: cyclic as unknown as GameCommandJournal }))
      .toThrow(/cyclic|unsupported|field|journal/i);
    expect(() => encodeReplayArchiveV1({ content, journal: symbol })).toThrow(/symbol|field|journal/i);
  });

  it("does not mutate hostile or ordinary journal input on failed encode", () => {
    const { content, journal } = setup();
    const malformed = structuredClone(journal) as unknown as Record<string, unknown>;
    const before = structuredClone(malformed);
    malformed.engineVersion = "towerforge-sim-v999";
    expect(() => encodeReplayArchiveV1({ content, journal: malformed as unknown as GameCommandJournal }))
      .toThrow(/engine|version|journal/i);
    expect({ ...malformed, engineVersion: before.engineVersion }).toEqual(before);
  });

  it("rejects SharedArrayBuffer-backed input when the runtime exposes it", () => {
    if (typeof SharedArrayBuffer === "undefined") return;
    const { content, bytes } = setup();
    const shared = new SharedArrayBuffer(bytes.byteLength);
    const view = new Uint8Array(shared);
    view.set(bytes);
    expect(() => decodeReplayArchiveV1({ content, bytes: view })).toThrow(/shared|archive|buffer/i);
  });
});
