import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "../content/registry.js";
import { validateGameContentRegistry } from "../content/validate.js";
import { JournaledGameSession } from "./journal.js";
import { replayGameCommandJournal } from "./replay.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { GridCoord, GridDefinition } from "./types.js";

const LOS_LIMITS_V1 = Object.freeze({
  activeMapCells: 65_536,
  terrainBlockerTags: 64,
  terrainTagUtf8Bytes: 128,
  terrainDefinitions: 256,
  terrainTagsPerDefinition: 64,
  terrainTagsAcrossDefinitions: 8_192,
  maximumRayDistance: 256,
  candidatesPerAcquisition: 4_096,
  analysisTargets: 4_096,
  cellInspectionsPerOperation: 1_048_576
});

type LoSReason = "clear" | "terrain_tag" | "elevation" | "ray_budget_exceeded" | "operation_budget_exceeded";

interface LineOfSightAnalysisV1 {
  schemaVersion: 1;
  profileId: string;
  source: GridCoord;
  rows: Array<{
    target: GridCoord;
    visible: boolean;
    reason: LoSReason;
    blocker?: {
      coord: GridCoord;
      terrainId: string;
      elevation: number;
      tag?: string;
    };
  }>;
  coverage: {
    requestedTargets: number;
    analyzedTargets: number;
    cellInspections: number;
    budgetExceeded: boolean;
  };
}

type InputOptions = {
  grid?: GridDefinition;
  width?: number;
  height?: number;
  moduleVersion?: 1 | 2 | 3 | 4;
  enabled?: boolean;
  selected?: boolean;
  omitMechanics?: boolean;
  profile?: Record<string, unknown>;
  elevationOverrides?: Array<{ q: number; r: number; elevation: number }>;
  terrainOverrides?: Array<{ q: number; r: number; terrain: string }>;
  terrainTypes?: Record<string, Record<string, unknown>>;
  pathRoutes?: Array<{ id: string; pathCenterline: GridCoord[] }>;
  waveGroups?: Array<{ enemyId: string; count: number; spawnInterval: number; startDelay: number; routeId?: string }>;
  chain?: { maxJumps: number; jumpRadius: number; damageFalloff: number };
};

function losInput(options: InputOptions = {}): GameContentInput {
  const width = options.width ?? 8;
  const height = options.height ?? 5;
  const defaultPath = Array.from({ length: width }, (_, q) => ({ q, r: Math.min(2, height - 1) }));
  const pathRoutes = options.pathRoutes ?? [{ id: "main", pathCenterline: defaultPath }];
  const firstRoute = pathRoutes[0]!;
  const profile = options.profile ?? { lineOfSight: { terrainBlockerTags: [] } };
  const missionMechanics = options.selected === false || options.omitMechanics
    ? {}
    : { mechanics: { profiles: { elevation: "los" } } };
  const mechanics = options.omitMechanics
    ? {}
    : {
        mechanics: {
          schemaVersion: 1 as const,
          modules: {
            elevation: {
              schemaVersion: options.moduleVersion ?? 2,
              enabled: options.enabled ?? true,
              profiles: { los: profile }
            }
          }
        }
      };

  return {
    balance: {
      defaultMissionId: "los",
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
        cliff: {
          id: "cliff", label: "Cliff", buildable: false, walkable: true,
          groundSpeedMultiplier: 1, tags: ["wall", "opaque"]
        },
        ...(options.terrainTypes ?? {})
      },
      abilities: {
        strike: {
          id: "strike", label: "Strike", cooldown: 1, duration: 0, radius: 8,
          effects: [{ kind: "damage", amount: 1 }]
        }
      },
      enemies: {
        grunt: {
          id: "grunt", label: "Grunt", maxHp: 50, speed: 0.1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 0x778899
        }
      },
      towers: {
        direct: {
          id: "direct",
          label: "Direct",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 12,
          attack: {
            kind: "single",
            fireRate: 1,
            damagePerStack: 2,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 1,
            ...(options.chain === undefined ? {} : { chain: options.chain })
          }
        }
      },
      waveSets: {
        wave: [{
          id: "wave_1",
          label: "Wave 1",
          groups: options.waveGroups ?? [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        los: {
          id: "los",
          label: "LoS",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 0,
          mapId: "field",
          waveSetId: "wave",
          buildTowerIds: ["direct"],
          abilityIds: ["strike"],
          ...missionMechanics
        }
      }
    },
    maps: {
      field: {
        id: "field",
        width,
        height,
        grid: options.grid ?? { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { ...firstRoute.pathCenterline[0]! },
        coreCoord: { ...firstRoute.pathCenterline.at(-1)! },
        pathCenterline: firstRoute.pathCenterline.map((coord) => ({ ...coord })),
        pathRoutes: pathRoutes.map((route) => ({
          id: route.id,
          pathCenterline: route.pathCenterline.map((coord) => ({ ...coord }))
        })),
        terrainOverrides: options.terrainOverrides ?? [],
        elevationOverrides: options.elevationOverrides ?? []
      }
    },
    ...mechanics,
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "los", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function content(options: InputOptions = {}): GameContentRegistry {
  return createGameContentRegistry(losInput(options));
}

function game(options: InputOptions = {}): TowerDefenseGame {
  return new TowerDefenseGame({ content: content(options), missionId: "los", seed: "r3.2-los" });
}

function analyze(subject: TowerDefenseGame, source: GridCoord, targets: GridCoord[]): LineOfSightAnalysisV1 | undefined {
  const method = (subject as unknown as {
    analyzeLineOfSight?: (request: { source: GridCoord; targets: GridCoord[] }) => LineOfSightAnalysisV1 | undefined;
  }).analyzeLineOfSight;
  expect(method, "R3.2 must expose the bounded compute-only engine analysis method").toBeTypeOf("function");
  return method!.call(subject, { source, targets });
}

function validation(options: InputOptions = {}) {
  return validateGameContentRegistry(content(options));
}

describe("R3.2 elevation line-of-sight schema and capability", () => {
  it("publishes the exact LoS budgets while elevation v3 keeps the v2 LoS contract", () => {
    expect((Engine as unknown as Record<string, unknown>).LINE_OF_SIGHT_LIMITS).toEqual(LOS_LIMITS_V1);
    expect(Engine.ELEVATION_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 3,
      moduleId: "elevation",
      supportedModuleSchemaVersions: [1, 2, 3]
    });
    expect(JSON.stringify(Engine.ELEVATION_MECHANICS_SCHEMA)).toMatch(/lineOfSight.*terrainBlockerTags/i);
  });

  it("keeps v1 closed-empty and resolves v2 empty versus v2 LoS profiles without changing v1", () => {
    expect(validation({ moduleVersion: 1, profile: {} }).ok).toBe(true);
    expect(validation({ moduleVersion: 2, profile: {} }).ok).toBe(true);
    expect(validation({
      moduleVersion: 2,
      profile: { lineOfSight: { terrainBlockerTags: ["opaque", "wall"] } }
    }).ok).toBe(true);

    const v1 = Engine.resolveActiveElevationMechanics(content({ moduleVersion: 1, profile: {} }), "los");
    const v2Empty = Engine.resolveActiveElevationMechanics(content({ moduleVersion: 2, profile: {} }), "los");
    const v2LoS = Engine.resolveActiveElevationMechanics(content({
      moduleVersion: 2,
      profile: { lineOfSight: { terrainBlockerTags: ["opaque", "wall"] } }
    }), "los");
    expect(v1).toEqual({ schemaVersion: 1, profileId: "los" });
    expect(v2Empty).toEqual({ schemaVersion: 2, profileId: "los" });
    expect(v2LoS).toEqual({
      schemaVersion: 2,
      profileId: "los",
      lineOfSight: { terrainBlockerTags: ["opaque", "wall"] }
    });
  });

  it.each([
    ["v1 LoS field", { moduleVersion: 1 as const, profile: { lineOfSight: { terrainBlockerTags: [] } } }],
    ["v2 profile extra", { moduleVersion: 2 as const, profile: { extra: true } }],
    ["LoS missing tags", { moduleVersion: 2 as const, profile: { lineOfSight: {} } }],
    ["LoS extra field", { moduleVersion: 2 as const, profile: { lineOfSight: { terrainBlockerTags: [], extra: true } } }],
    ["duplicate tags", { moduleVersion: 2 as const, profile: { lineOfSight: { terrainBlockerTags: ["opaque", "opaque"] } } }],
    ["empty tag", { moduleVersion: 2 as const, profile: { lineOfSight: { terrainBlockerTags: [""] } } }],
    ["tags array extra own field", {
      moduleVersion: 2 as const,
      profile: { lineOfSight: { terrainBlockerTags: Object.assign(["opaque"], { verifierExtra: true }) } }
    }],
    ["sparse tags", {
      moduleVersion: 2 as const,
      profile: { lineOfSight: { terrainBlockerTags: Object.assign(new Array(2), { 1: "opaque" }) } }
    }]
  ])("rejects the closed/bounded %s shape", (_label, options) => {
    const result = validation(options);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/elevation|lineOfSight|terrainBlockerTags/i)
    }));
  });

  it("accepts authored tag order but resolves one frozen binary-sorted copy", () => {
    const authored = ["wall", "opaque"];
    const subjectContent = content({
      moduleVersion: 2,
      profile: { lineOfSight: { terrainBlockerTags: authored } }
    });
    expect(validateGameContentRegistry(subjectContent).ok).toBe(true);
    const resolved = Engine.resolveActiveElevationMechanics(subjectContent, "los") as unknown as {
      lineOfSight?: { terrainBlockerTags: readonly string[] };
    };
    expect(resolved.lineOfSight?.terrainBlockerTags).toEqual(["opaque", "wall"]);
    expect(resolved.lineOfSight?.terrainBlockerTags).not.toBe(authored);
    expect(Object.isFrozen(resolved.lineOfSight?.terrainBlockerTags)).toBe(true);
  });

  it("enforces the profile tag-count and UTF-8 budgets against known terrain tags", () => {
    const tags = Array.from({ length: 65 }, (_, index) => `tag_${String(index).padStart(2, "0")}`);
    const tagFields = (id: string, values: string[]) => ({
      id, label: id, buildable: false, walkable: true, groundSpeedMultiplier: 1, tags: values
    });
    const countResult = validation({
      moduleVersion: 2,
      profile: { lineOfSight: { terrainBlockerTags: tags } },
      terrainTypes: {
        tag_a: tagFields("tag_a", tags.slice(0, 32)),
        tag_b: tagFields("tag_b", tags.slice(32))
      }
    });
    expect(countResult.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/terrainBlockerTags/i),
      message: expect.stringMatching(/64|budget|limit|maximum/i)
    }));

    const longTag = "x".repeat(129);
    const byteResult = validation({
      moduleVersion: 2,
      profile: { lineOfSight: { terrainBlockerTags: [longTag] } },
      terrainTypes: { long_tag: tagFields("long_tag", [longTag]) }
    });
    expect(byteResult.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/terrainBlockerTags/i),
      message: expect.stringMatching(/128|UTF-?8|byte|budget/i)
    }));
  });

  it("rejects accessor-backed LoS data without invoking either object or array accessors", () => {
    let objectCalls = 0;
    let itemCalls = 0;
    const lineOfSight: Record<string, unknown> = {};
    Object.defineProperty(lineOfSight, "terrainBlockerTags", {
      enumerable: true,
      get() { objectCalls += 1; return ["opaque"]; }
    });
    const objectResult = validation({ moduleVersion: 2, profile: { lineOfSight } });
    expect(objectResult.ok).toBe(false);
    expect(objectCalls).toBe(0);

    const tags = ["opaque"] as unknown[];
    Object.defineProperty(tags, "0", {
      enumerable: true,
      get() { itemCalls += 1; return "opaque"; }
    });
    const itemResult = validation({ moduleVersion: 2, profile: { lineOfSight: { terrainBlockerTags: tags } } });
    expect(itemResult.ok).toBe(false);
    expect(itemCalls).toBe(0);
  });

  it("reports an active unknown terrain tag as an error but only warns when the module is disabled", () => {
    const active = validation({
      moduleVersion: 2,
      profile: { lineOfSight: { terrainBlockerTags: ["missing_tag"] } }
    });
    expect(active.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/terrainBlockerTags/i),
      message: expect.stringMatching(/missing_tag.*(?:unknown|terrain)|(?:unknown|terrain).*missing_tag/i)
    }));

    const disabled = validation({
      moduleVersion: 2,
      enabled: false,
      profile: { lineOfSight: { terrainBlockerTags: ["missing_tag"] } }
    });
    expect(disabled.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(disabled.issues).toContainEqual(expect.objectContaining({
      severity: "warning",
      fieldPath: expect.stringMatching(/terrainBlockerTags/i),
      message: expect.stringMatching(/missing_tag/i)
    }));
  });

  it("enforces the active LoS map-cell budget without making elevation-only v2 maps invalid", () => {
    const oversized = validation({
      width: LOS_LIMITS_V1.activeMapCells + 1,
      height: 1,
      moduleVersion: 2,
      profile: { lineOfSight: { terrainBlockerTags: [] } },
      pathRoutes: [{ id: "main", pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }] }]
    });
    expect(oversized.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityId: expect.stringMatching(/field|los/i),
      message: expect.stringMatching(/65.?536|map.*cell|active.*cell/i)
    }));

    const elevationOnly = validation({
      width: LOS_LIMITS_V1.activeMapCells + 1,
      height: 1,
      moduleVersion: 2,
      profile: {},
      pathRoutes: [{ id: "main", pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }] }]
    });
    expect(elevationOnly.issues).not.toContainEqual(expect.objectContaining({
      message: expect.stringMatching(/LoS|line.of.sight|active.*cell/i)
    }));
  });

  it("enforces active terrain definition, per-definition tag, and aggregate tag budgets", () => {
    const terrain = (id: string, tags: string[]) => ({
      id, label: id, buildable: false, walkable: true, groundSpeedMultiplier: 1, tags
    });
    const definitions = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => {
        const id = `terrain_${String(index).padStart(3, "0")}`;
        return [id, terrain(id, [])];
      })
    );
    const definitionsResult = validation({ terrainTypes: definitions });
    expect(definitionsResult.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/terrain/i),
      message: expect.stringMatching(/256|definition.*budget|terrain.*limit/i)
    }));

    const perDefinitionResult = validation({
      terrainTypes: {
        overloaded: terrain("overloaded", Array.from({ length: 65 }, (_, index) => `tag_${index}`))
      }
    });
    expect(perDefinitionResult.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/terrain.*tags|tags/i),
      message: expect.stringMatching(/64|tag.*budget|tag.*limit/i)
    }));

    const aggregateDefinitions = Object.fromEntries(
      Array.from({ length: 129 }, (_, terrainIndex) => {
        const id = `dense_${String(terrainIndex).padStart(3, "0")}`;
        return [id, terrain(id, Array.from({ length: 64 }, (_, tagIndex) => `${id}_${tagIndex}`))];
      })
    );
    const aggregateResult = validation({ terrainTypes: aggregateDefinitions });
    expect(aggregateResult.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/terrain.*tags|tags/i),
      message: expect.stringMatching(/8.?192|total.*tag|aggregate.*tag|tag.*budget/i)
    }));
  });
});

describe("R3.2 deterministic elevation line-of-sight analysis", () => {
  it("uses the integer eye-height equation and treats equality as blocked on square grids", () => {
    const subject = game({ elevationOverrides: [{ q: 2, r: 1, elevation: 1 }] });
    expect(analyze(subject, { q: 0, r: 1 }, [{ q: 4, r: 1 }])).toEqual({
      schemaVersion: 1,
      profileId: "los",
      source: { q: 0, r: 1 },
      rows: [{
        target: { q: 4, r: 1 },
        visible: false,
        reason: "elevation",
        blocker: {
          coord: { q: 2, r: 1 },
          terrainId: "floor",
          elevation: 1
        }
      }],
      coverage: {
        requestedTargets: 1,
        analyzedTargets: 1,
        cellInspections: 2,
        budgetExceeded: false
      }
    });
  });

  it("uses the topology line on odd-r hex maps and reports the first interior blocker", () => {
    const subject = game({
      grid: { kind: "hex", layout: "odd-r" },
      elevationOverrides: [
        { q: 0, r: 1, elevation: 1 },
        { q: 1, r: 1, elevation: 8 }
      ]
    });
    const result = analyze(subject, { q: 0, r: 0 }, [{ q: 2, r: 2 }]);
    expect(result?.rows).toEqual([{
      target: { q: 2, r: 2 },
      visible: false,
      reason: "elevation",
      blocker: {
        coord: { q: 0, r: 1 },
        terrainId: "floor",
        elevation: 1
      }
    }]);
    expect(result?.coverage.cellInspections).toBe(1);
  });

  it("gives terrain tags precedence at a blocker and selects the binary-min matching tag", () => {
    const subject = game({
      profile: { lineOfSight: { terrainBlockerTags: ["wall", "opaque"] } },
      terrainOverrides: [{ q: 1, r: 1, terrain: "cliff" }],
      elevationOverrides: [{ q: 1, r: 1, elevation: 9 }]
    });
    expect(analyze(subject, { q: 0, r: 1 }, [{ q: 4, r: 1 }])?.rows).toEqual([{
      target: { q: 4, r: 1 },
      visible: false,
      reason: "terrain_tag",
      blocker: {
        coord: { q: 1, r: 1 },
        terrainId: "cliff",
        elevation: 9,
        tag: "opaque"
      }
    }]);
  });

  it("ignores source and target terrain tags as blockers and canonicalizes result rows by numeric r,q", () => {
    const subject = game({
      profile: { lineOfSight: { terrainBlockerTags: ["opaque"] } },
      terrainOverrides: [
        { q: 0, r: 1, terrain: "cliff" },
        { q: 4, r: 1, terrain: "cliff" }
      ],
      elevationOverrides: [
        { q: 0, r: 1, elevation: 1_000 },
        { q: 4, r: 1, elevation: 1_000 }
      ]
    });
    const result = analyze(subject, { q: 0, r: 1 }, [
      { q: 4, r: 3 },
      { q: 3, r: 1 },
      { q: 2, r: 1 },
      { q: 4, r: 1 }
    ]);
    expect(result?.rows.map((row) => row.target)).toEqual([
      { q: 2, r: 1 },
      { q: 3, r: 1 },
      { q: 4, r: 1 },
      { q: 4, r: 3 }
    ]);
    expect(result?.rows.find((row) => row.target.q === 4 && row.target.r === 1)).toMatchObject({
      visible: true,
      reason: "clear"
    });
  });

  it("fails a ray beyond 256 without constructing or inspecting its topology line", () => {
    const subject = game({ width: 300 });
    expect(analyze(subject, { q: 0, r: 0 }, [{ q: 257, r: 0 }])).toEqual({
      schemaVersion: 1,
      profileId: "los",
      source: { q: 0, r: 0 },
      rows: [{
        target: { q: 257, r: 0 },
        visible: false,
        reason: "ray_budget_exceeded"
      }],
      coverage: {
        requestedTargets: 1,
        analyzedTargets: 1,
        cellInspections: 0,
        budgetExceeded: true
      }
    });
  });

  it("is compute-only and leaves snapshot, events, checkpoint, RNG, and state digest unchanged", () => {
    const subject = game({ elevationOverrides: [{ q: 2, r: 1, elevation: 1 }] });
    const beforeSnapshot = subject.getSnapshot();
    const beforeCheckpoint = subject.createCheckpoint();
    const beforeDigest = subject.getStateDigest();

    expect(analyze(subject, { q: 0, r: 1 }, [{ q: 4, r: 1 }])?.rows[0]?.reason).toBe("elevation");

    expect(subject.getSnapshot()).toEqual(beforeSnapshot);
    expect(subject.createCheckpoint()).toEqual(beforeCheckpoint);
    expect(subject.getStateDigest()).toBe(beforeDigest);
  });

  it("returns undefined for absent, disabled, v1, v2-empty, unselected, and future profiles", () => {
    const cases = [
      game({ omitMechanics: true }),
      game({ enabled: false }),
      game({ moduleVersion: 1, profile: {} }),
      game({ moduleVersion: 2, profile: {} }),
      game({ selected: false }),
      game({ moduleVersion: 4 })
    ];
    for (const subject of cases) {
      expect(analyze(subject, { q: 0, r: 0 }, [{ q: 1, r: 0 }])).toBeUndefined();
    }
  });

  it("rejects malformed, duplicate, out-of-bounds, accessor, and over-budget target requests before work", () => {
    const subject = game({ width: 4_098 });
    const method = (subject as unknown as {
      analyzeLineOfSight?: (request: unknown) => unknown;
    }).analyzeLineOfSight;
    expect(method).toBeTypeOf("function");

    expect(() => method!.call(subject, {
      source: { q: 0, r: 0 },
      targets: [{ q: 1, r: 0 }, { q: 1, r: 0 }]
    })).toThrow(/duplicate|unique/i);
    expect(() => method!.call(subject, {
      source: { q: 0, r: 0 },
      targets: [{ q: 4_098, r: 0 }]
    })).toThrow(/bound|outside|coordinate/i);
    expect(() => method!.call(subject, {
      source: { q: 0, r: 0 },
      targets: Array.from({ length: 4_097 }, (_, index) => ({ q: index + 1, r: 0 }))
    })).toThrow(/4.?096|target.*budget|target.*limit/i);

    let calls = 0;
    const target: Record<string, unknown> = { r: 0 };
    Object.defineProperty(target, "q", {
      enumerable: true,
      get() { calls += 1; return 1; }
    });
    expect(() => method!.call(subject, { source: { q: 0, r: 0 }, targets: [target] }))
      .toThrow(/accessor|data|own|coordinate/i);
    expect(calls).toBe(0);
  });

  it("fail-closes hostile request Proxy reflection traps without leaking their messages", () => {
    const subject = game();
    const method = (subject as unknown as {
      analyzeLineOfSight?: (request: unknown) => unknown;
    }).analyzeLineOfSight;
    expect(method).toBeTypeOf("function");
    const beforeCheckpoint = subject.createCheckpoint();
    const beforeDigest = subject.getStateDigest();
    const baseRequest = { source: { q: 0, r: 0 }, targets: [{ q: 1, r: 0 }] };
    const hostileRequests = [
      {
        secret: "verifier-ownKeys-secret",
        value: new Proxy(baseRequest, {
          ownKeys() { throw new Error("verifier-ownKeys-secret"); }
        })
      },
      {
        secret: "verifier-getPrototypeOf-secret",
        value: new Proxy(baseRequest, {
          getPrototypeOf() { throw new Error("verifier-getPrototypeOf-secret"); }
        })
      }
    ];

    for (const hostile of hostileRequests) {
      let thrown: unknown;
      try { method!.call(subject, hostile.value); }
      catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toMatch(/could not be inspected safely|invalid/i);
      expect((thrown as Error).message).not.toContain(hostile.secret);
      expect(subject.createCheckpoint()).toEqual(beforeCheckpoint);
      expect(subject.getStateDigest()).toBe(beforeDigest);
    }
  });
});

function twoRouteOptions(blockedFirst: boolean, chain = false): InputOptions {
  const blocked = { id: "blocked", pathCenterline: [{ q: 4, r: 2 }, { q: 5, r: 2 }, { q: 6, r: 2 }] };
  const visible = { id: "visible", pathCenterline: [{ q: 4, r: 4 }, { q: 5, r: 4 }, { q: 6, r: 4 }] };
  const routeOrder = blockedFirst ? [blocked, visible] : [visible, blocked];
  return {
    pathRoutes: [blocked, visible],
    waveGroups: routeOrder.map((route) => ({
      enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0, routeId: route.id
    })),
    elevationOverrides: [{ q: 2, r: 2, elevation: 1 }],
    ...(chain ? { chain: { maxJumps: 1, jumpRadius: 2, damageFalloff: 1 } } : {})
  };
}

function firstTickFiredIds(options: InputOptions): { game: TowerDefenseGame; enemyIds: string[] } {
  const subject = game(options);
  expect(subject.placeTower("direct", { q: 0, r: 2 })).toEqual({ ok: true });
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
  return {
    game: subject,
    enemyIds: subject.lastEvents
      .filter((event): event is Extract<(typeof subject.lastEvents)[number], { type: "towerFired" }> => event.type === "towerFired")
      .map((event) => event.enemyId)
  };
}

describe("R3.2 direct tower acquisition integration", () => {
  it("skips the comparator-first blocked enemy and acquires the next visible target", () => {
    const result = firstTickFiredIds(twoRouteOptions(true));
    expect(result.game.enemies.map((enemy) => ({ id: enemy.id, routeId: enemy.routeId }))).toEqual([
      { id: "enemy_1", routeId: "blocked" },
      { id: "enemy_2", routeId: "visible" }
    ]);
    expect(result.enemyIds).toEqual(["enemy_2"]);
  });

  it("does not apply LoS again to a chain secondary after a visible primary is acquired", () => {
    const result = firstTickFiredIds(twoRouteOptions(false, true));
    expect(result.game.enemies.map((enemy) => ({ id: enemy.id, routeId: enemy.routeId }))).toEqual([
      { id: "enemy_1", routeId: "visible" },
      { id: "enemy_2", routeId: "blocked" }
    ]);
    expect(result.enemyIds).toEqual(["enemy_1", "enemy_2"]);
  });

  it("keeps direct acquisition legacy for absent, disabled, v1, v2-empty, unselected, and future profiles", () => {
    const base = twoRouteOptions(true);
    const cases: InputOptions[] = [
      { ...base, omitMechanics: true },
      { ...base, enabled: false },
      { ...base, moduleVersion: 1, profile: {} },
      { ...base, moduleVersion: 2, profile: {} },
      { ...base, selected: false },
      { ...base, moduleVersion: 4 }
    ];
    for (const options of cases) {
      expect(firstTickFiredIds(options).enemyIds).toEqual(["enemy_1"]);
    }
  });

  it("keeps elevation snapshot v1 and checkpoint/replay schemas unchanged for active LoS", () => {
    const subject = game({ elevationOverrides: [{ q: 2, r: 1, elevation: 1 }] });
    expect(subject.getSnapshot().elevation).toMatchObject({ schemaVersion: 1 });
    expect(subject.getSnapshot()).not.toHaveProperty("lineOfSight");
    const checkpoint = subject.createCheckpoint();
    expect(checkpoint.schemaVersion).toBe(1);
    expect(checkpoint.engineVersion).toBe("towerforge-sim-v2");
    expect(checkpoint.state).not.toHaveProperty("lineOfSight");
    expect(checkpoint.state).not.toHaveProperty("los");

    const restored = TowerDefenseGame.fromCheckpoint({ content: subject.content, checkpoint });
    expect(restored.getSnapshot()).toEqual(subject.getSnapshot());
    expect(restored.getStateDigest()).toBe(subject.getStateDigest());
    expect(analyze(restored, { q: 0, r: 1 }, [{ q: 4, r: 1 }])).toEqual(
      analyze(subject, { q: 0, r: 1 }, [{ q: 4, r: 1 }])
    );

    const replay = replayGameCommandJournal({
      content: subject.content,
      journal: new JournaledGameSession(restored).exportJournal()
    });
    expect(replay.entriesReplayed).toBe(0);
    expect(replay.game.getSnapshot()).toEqual(restored.getSnapshot());
    expect(replay.stateDigest).toBe(restored.getStateDigest());
  });
});
