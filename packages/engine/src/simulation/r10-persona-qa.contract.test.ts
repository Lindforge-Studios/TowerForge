import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "../content/registry.js";

const PERSONA_IDS = ["aggressive_rush", "greedy_economy", "turtle_shield"] as const;
type PersonaId = (typeof PERSONA_IDS)[number];

interface PersonaQaRequestV1Contract {
  readonly schemaVersion: 1;
  readonly missionIds: readonly string[];
  readonly seeds: readonly string[];
  readonly personaIds: readonly PersonaId[];
  readonly simSeconds: number;
  readonly tickStep: number;
}

interface PersonaQaReportV1Contract {
  readonly schemaVersion: 1;
  readonly status: "completed";
  readonly missionIds: readonly string[];
  readonly seeds: readonly string[];
  readonly personaIds: readonly PersonaId[];
  readonly runs: readonly {
    readonly missionId: string;
    readonly seed: string;
    readonly personaId: PersonaId;
    readonly outcome: string;
    readonly stateDigest: string;
  }[];
}

interface PersonaQaReplayProofV1Contract {
  readonly run: PersonaQaReportV1Contract["runs"][number];
  readonly journalEntryCount: number;
  readonly continuousStateDigest: string;
  readonly replayStateDigest: string;
  readonly snapshotEquivalent: boolean;
}

function runPersonaQaSuiteV1(
  content: GameContentRegistry,
  request: PersonaQaRequestV1Contract
): PersonaQaReportV1Contract {
  const run = (Engine as unknown as {
    runPersonaQaSuiteV1?: (
      registry: GameContentRegistry,
      input: PersonaQaRequestV1Contract
    ) => PersonaQaReportV1Contract;
  }).runPersonaQaSuiteV1;
  expect(run, "R10 must export the pure deterministic persona QA runner").toBeTypeOf("function");
  return run!(content, request);
}

function provePersonaQaReplayV1(
  content: GameContentRegistry,
  request: PersonaQaRequestV1Contract
): PersonaQaReplayProofV1Contract {
  const prove = (Engine as unknown as {
    provePersonaQaReplayV1?: (
      registry: GameContentRegistry,
      input: PersonaQaRequestV1Contract
    ) => PersonaQaReplayProofV1Contract;
  }).provePersonaQaReplayV1;
  expect(prove, "R10 must export a deterministic journal replay proof").toBeTypeOf("function");
  return prove!(content, request);
}

function tower(id: string, role: "economy" | "rush" | "turtle") {
  if (role === "economy") {
    return {
      id,
      label: id,
      cost: { coins: 12 },
      footprintRadius: 0,
      range: 6,
      attack: {
        kind: "pipeline" as const,
        interval: 0.5,
        delivery: { kind: "single" as const },
        effects: [
          { kind: "damage" as const, amount: 1 },
          { kind: "resource" as const, resources: { coins: 2 } }
        ]
      }
    };
  }
  return {
    id,
    label: id,
    cost: { coins: role === "rush" ? 5 : 10 },
    footprintRadius: 0,
    range: role === "rush" ? 5 : 3,
    ...(role === "turtle" ? { maxHp: 50 } : {}),
    attack: {
      kind: "single" as const,
      fireRate: role === "rush" ? 4 : 1,
      damagePerStack: role === "rush" ? 3 : 6,
      startingStacks: 1,
      maxStacks: 1,
      upgradeCost: 5
    }
  };
}

function input(order: "forward" | "reverse" = "forward"): GameContentInput {
  const towerEntries = [
    ["coin_harvester", tower("coin_harvester", "economy")],
    ["rush_cannon", tower("rush_cannon", "rush")],
    ["bastion", tower("bastion", "turtle")]
  ] as const;
  const ordered = order === "forward" ? towerEntries : [...towerEntries].reverse();
  const towerIds = towerEntries.map(([id]) => id).sort();
  const path = Array.from({ length: 7 }, (_, q) => ({ q, r: 1 }));
  return {
    balance: {
      defaultMissionId: "persona_lab",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 30,
        startingResources: { coins: 30 },
        prepTimeUnits: 3,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 10,
        pathWaterDurationUnits: 5,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt",
          label: "Grunt",
          maxHp: 8,
          speed: 0.5,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 0x668866
        }
      },
      towers: Object.fromEntries(ordered),
      waveSets: {
        lab: [{
          id: "wave_1",
          label: "Wave 1",
          groups: [{ enemyId: "grunt", count: 3, spawnInterval: 0.5, startDelay: 0 }]
        }]
      },
      missions: {
        persona_lab: {
          id: "persona_lab",
          label: "Persona Lab",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 30 },
          prepTimeUnits: 3,
          mapId: "lane",
          waveSetId: "lab",
          buildTowerIds: towerIds,
          abilityIds: []
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 7,
        height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 6, r: 1 },
        pathCenterline: path,
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        biome: "test",
        accent: "#668866",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        connections: []
      }],
      missionNodes: [{
        missionId: "persona_lab",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
}

function request(overrides: Partial<PersonaQaRequestV1Contract> = {}): PersonaQaRequestV1Contract {
  return {
    schemaVersion: 1,
    missionIds: ["persona_lab"],
    seeds: ["seed-b", "seed-a"],
    personaIds: ["turtle_shield", "greedy_economy", "aggressive_rush"],
    simSeconds: 2,
    tickStep: 0.2,
    ...overrides
  };
}

describe("R10 deterministic multi-persona QA contract (RED)", () => {
  it("exports exactly the three fixed personas and reports the canonical binary order", () => {
    expect((Engine as unknown as { PERSONA_QA_PERSONA_IDS?: unknown }).PERSONA_QA_PERSONA_IDS)
      .toEqual(PERSONA_IDS);

    const report = runPersonaQaSuiteV1(createGameContentRegistry(input()), request());
    expect(report).toMatchObject({
      schemaVersion: 1,
      status: "completed",
      missionIds: ["persona_lab"],
      seeds: ["seed-a", "seed-b"],
      personaIds: PERSONA_IDS
    });
    expect(report.runs.map((run) => [run.missionId, run.seed, run.personaId])).toEqual([
      ["persona_lab", "seed-a", "aggressive_rush"],
      ["persona_lab", "seed-a", "greedy_economy"],
      ["persona_lab", "seed-a", "turtle_shield"],
      ["persona_lab", "seed-b", "aggressive_rush"],
      ["persona_lab", "seed-b", "greedy_economy"],
      ["persona_lab", "seed-b", "turtle_shield"]
    ]);
  });

  it("is deterministic and independent of authored record, seed, and request persona order", () => {
    const forward = runPersonaQaSuiteV1(createGameContentRegistry(input("forward")), request());
    const reversed = runPersonaQaSuiteV1(createGameContentRegistry(input("reverse")), request({
      seeds: ["seed-a", "seed-b"],
      personaIds: [...PERSONA_IDS]
    }));
    expect(reversed).toEqual(forward);
    expect(runPersonaQaSuiteV1(createGameContentRegistry(input("forward")), request())).toEqual(forward);

    const originalRandom = Math.random;
    Math.random = () => { throw new Error("persona QA must not call Math.random"); };
    try {
      expect(runPersonaQaSuiteV1(createGameContentRegistry(input("reverse")), request())).toEqual(forward);
    } finally {
      Math.random = originalRandom;
    }
  });

  it("returns detached deeply frozen evidence and never mutates content", () => {
    const content = createGameContentRegistry(input());
    const before = JSON.stringify(content);
    const report = runPersonaQaSuiteV1(content, request());

    expect(JSON.stringify(content)).toBe(before);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.personaIds)).toBe(true);
    expect(Object.isFrozen(report.seeds)).toBe(true);
    expect(Object.isFrozen(report.runs)).toBe(true);
    expect(report.runs.every(Object.isFrozen)).toBe(true);
  });

  it("rejects unknown personas and an excessive matrix before starting a simulation", () => {
    const exported = Engine as unknown as {
      PERSONA_QA_LIMITS?: { readonly seeds: number; readonly totalRuns: number };
    };
    expect(exported.PERSONA_QA_LIMITS).toMatchObject({
      seeds: expect.any(Number),
      totalRuns: expect.any(Number)
    });
    const limits = exported.PERSONA_QA_LIMITS!;
    expect(Number.isSafeInteger(limits.seeds) && limits.seeds > 0).toBe(true);
    expect(Number.isSafeInteger(limits.totalRuns) && limits.totalRuns >= PERSONA_IDS.length).toBe(true);

    const content = createGameContentRegistry(input());
    expect(() => runPersonaQaSuiteV1(content, {
      ...request(),
      personaIds: ["unknown_persona" as PersonaId]
    })).toThrow(/unknown.*persona|persona.*unsupported/i);
    expect(() => runPersonaQaSuiteV1(content, request({
      seeds: Array.from({ length: limits.seeds + 1 }, (_, index) => `seed-${index}`)
    }))).toThrow(/seed|matrix|budget|limit/i);
  });

  it("rejects an oversized selected map before constructing persona simulations", () => {
    const oversized = input();
    const map = oversized.maps.lane as { width: number; height: number };
    map.width = 257;
    map.height = 256;
    const content = createGameContentRegistry(oversized);

    expect(() => runPersonaQaSuiteV1(content, request({
      seeds: ["map-budget"],
      personaIds: ["aggressive_rush"],
      simSeconds: 0.05,
      tickStep: 0.05
    }))).toThrow(/map.*cell|cell.*budget|map.*budget/i);
  });

  it("does not alter the legacy balance report contract", () => {
    const content = createGameContentRegistry(input());
    const before = Engine.runBalanceSweep(content, { missionIds: ["persona_lab"], simSeconds: 2 });
    runPersonaQaSuiteV1(content, request({ seeds: ["seed-a"] }));
    const after = Engine.runBalanceSweep(content, { missionIds: ["persona_lab"], simSeconds: 2 });

    expect(after).toEqual(before);
    expect(after.generatedWith).not.toHaveProperty("personas");
    expect(after.missions[0]).not.toHaveProperty("personaResults");
  });

  it.each(PERSONA_IDS)("proves the %s command stream has the same continuous and journal replay digest", (personaId) => {
    const content = createGameContentRegistry(input());
    const proof = provePersonaQaReplayV1(content, request({
      seeds: ["replay-seed"],
      personaIds: [personaId],
      simSeconds: 1,
      tickStep: 0.2
    }));

    expect(proof.journalEntryCount).toBeGreaterThan(0);
    expect(proof.continuousStateDigest).toBe(proof.run.stateDigest);
    expect(proof.replayStateDigest).toBe(proof.continuousStateDigest);
    expect(proof.snapshotEquivalent).toBe(true);
    expect(Object.isFrozen(proof)).toBe(true);
  });
});
