import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import {
  canonicalStringify,
  JournaledGameSession,
  TowerDefenseGame,
  type GameCommand,
  type GameCommandJournal
} from "../index.js";
import {
  createReplayBranchV1,
  decodeReplayArchiveV1,
  diagnoseReplayBranchDivergenceV1,
  encodeReplayArchiveV1,
  replayReplayBranchV1
} from "./index.js";

function fixture(): GameContentInput {
  return {
    balance: {
      defaultMissionId: "branch",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 10, startingCoins: 0, startingResources: { coins: 0 },
        prepTimeUnits: 1, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 5, pathWaterDurationUnits: 3, pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {}, enemies: {}, towers: {},
      waveSets: { empty: [{ id: "wave", label: "Wave", groups: [] }] },
      missions: { branch: { id: "branch", label: "Branch", description: "", startingCoreHp: 10, startingResources: { coins: 0 }, prepTimeUnits: 1, mapId: "lane", waveSetId: "empty", buildTowerIds: [], abilityIds: [] } }
    },
    maps: { lane: { id: "lane", width: 2, height: 1, grid: { kind: "square", adjacency: "cardinal" }, defaultTerrain: "path", spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 1, r: 0 }, pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }], pathRoutes: [], terrainOverrides: [] } },
    worldMap: {
      width: 10, height: 10,
      regions: [{ id: "r", label: "R", description: "", biome: "test", accent: "#fff", bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: [] }],
      missionNodes: [{ missionId: "branch", regionId: "r", x: 5, y: 5, difficulty: 1, unlockRequiresMissionIds: [] }]
    }
  };
}

const tick = (units: number): GameCommand => ({ schemaVersion: 1, type: "tick", units });

function recorded() {
  const content = createGameContentRegistry(fixture());
  const game = new TowerDefenseGame({ content, missionId: "branch", seed: "r16-branch" });
  const session = new JournaledGameSession(game);
  for (const command of [tick(0.01), tick(0.01), tick(0.01)]) expect(session.dispatch(command).ok).toBe(true);
  const journal = session.exportJournal();
  const bytes = encodeReplayArchiveV1({ content, journal });
  return { content, journal, bytes, archive: decodeReplayArchiveV1({ content, bytes }) };
}

describe("R16.3 immutable What-If replay branches contract (RED)", () => {
  it.each([0, 1, 3])("forks at sequence %s with exact parent provenance and deterministic final digest", (forkSequence) => {
    const { content, archive, bytes } = recorded();
    const parentBefore = canonicalStringify(archive);
    const bytesBefore = new Uint8Array(bytes);
    const commands = [tick(0.02), tick(0.03)];
    const first = createReplayBranchV1({ content, archive, forkSequence, commands });
    const second = createReplayBranchV1({ content, archive, forkSequence, commands });
    const replay = replayReplayBranchV1({ content, archive, branch: first });

    expect(first).toMatchObject({
      schemaVersion: 1,
      parentArchiveDigest: archive.archiveDigest,
      forkSequence,
      branchDigest: expect.stringMatching(/^tf-replay-branch-v1:[0-9a-f]{16}$/),
      journalSuffix: { entries: expect.any(Array) }
    });
    expect(first.branchDigest).toBe(second.branchDigest);
    expect(replay).toMatchObject({
      branchDigest: first.branchDigest,
      stateDigest: expect.stringMatching(/^tf-state-v1:[0-9a-f]{16}$/),
      entriesReplayed: commands.length
    });
    expect(replayReplayBranchV1({ content, archive, branch: second }).stateDigest).toBe(replay.stateDigest);
    expect(canonicalStringify(archive)).toBe(parentBefore);
    expect(bytes).toEqual(bytesBefore);
  });

  it("rejects invalid fork, parent digest, future branch and malformed suffix before replay", () => {
    const { content, archive, journal } = recorded();
    for (const forkSequence of [-1, journal.entries.length + 1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createReplayBranchV1({ content, archive, forkSequence, commands: [tick(0.01)] }))
        .toThrow(/fork|sequence|range/i);
    }
    const branch = createReplayBranchV1({ content, archive, forkSequence: 1, commands: [tick(0.02)] });
    const wrongParent = { ...structuredClone(branch), parentArchiveDigest: "tf-replay-v1:ffffffffffffffff" };
    expect(() => replayReplayBranchV1({ content, archive, branch: wrongParent })).toThrow(/parent|digest|provenance/i);
    expect(() => replayReplayBranchV1({ content, archive, branch: { ...structuredClone(branch), schemaVersion: 2 } }))
      .toThrow(/branch|version/i);
    const gap = structuredClone(branch) as unknown as { journalSuffix: GameCommandJournal };
    (gap.journalSuffix.entries[0] as { sequence: number }).sequence = 1;
    expect(() => replayReplayBranchV1({ content, archive, branch: gap })).toThrow(/suffix|journal|sequence/i);
  });

  it("reports the first divergent state and recognizes an identical parent replay", () => {
    const { content, archive, journal } = recorded();
    const changed = createReplayBranchV1({ content, archive, forkSequence: 1, commands: [tick(0.02), tick(0.01)] });
    expect(diagnoseReplayBranchDivergenceV1({ content, archive, branch: changed })).toMatchObject({
      schemaVersion: 1,
      divergent: true,
      firstDivergentSequence: 2,
      parentStateDigest: expect.stringMatching(/^tf-state-v1:[0-9a-f]{16}$/),
      branchStateDigest: expect.stringMatching(/^tf-state-v1:[0-9a-f]{16}$/)
    });
    const same = createReplayBranchV1({
      content,
      archive,
      forkSequence: 0,
      commands: journal.entries.map((entry) => entry.command)
    });
    expect(diagnoseReplayBranchDivergenceV1({ content, archive, branch: same }))
      .toEqual({ schemaVersion: 1, divergent: false });
  });
});
