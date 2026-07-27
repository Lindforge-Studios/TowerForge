import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { createGameContentRegistry, type GameContentInput } from "./registry.js";
import { validateGameContentRegistry } from "./validate.js";
import { TowerDefenseGame } from "../simulation/TowerDefenseGame.js";
import { JournaledGameSession, replayGameCommandJournal } from "../index.js";

const ELEVATION_LIMITS_V1 = Object.freeze({
  overridesPerMap: 65_536,
  minimum: -1_000_000,
  maximum: 1_000_000
});

type Activation = "absent" | "disabled" | "unselected" | "active" | "future";

function input(activation: Activation = "active", overrides: unknown[] = [
  { q: 2, r: 0, elevation: -4 },
  { q: 1, r: 0, elevation: 3 },
  { q: 0, r: 1, elevation: 0 }
]): GameContentInput {
  const selected = activation !== "absent" && activation !== "unselected";
  return {
    balance: {
      defaultMissionId: "elevation",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 20,
        startingResources: { coins: 20 },
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
        }
      },
      abilities: {},
      enemies: {},
      towers: {},
      waveSets: { empty: [] },
      missions: {
        elevation: {
          id: "elevation",
          label: "Elevation",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 20 },
          prepTimeUnits: 0,
          mapId: "plateau",
          waveSetId: "empty",
          buildTowerIds: [],
          abilityIds: [],
          ...(selected ? { mechanics: { profiles: { elevation: "authored" } } } : {})
        }
      }
    },
    maps: {
      plateau: {
        id: "plateau",
        width: 3,
        height: 2,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 0 },
        coreCoord: { q: 2, r: 1 },
        pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 2, r: 1 }],
        pathRoutes: [],
        terrainOverrides: [],
        elevationOverrides: overrides
      } as GameContentInput["maps"][string]
    },
    ...(activation === "absent" ? {} : {
      mechanics: {
        schemaVersion: 1,
        modules: {
          elevation: {
            schemaVersion: (activation === "future" ? 4 : 1) as 1,
            enabled: activation !== "disabled",
            profiles: { authored: {} }
          }
        }
      }
    }),
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#ffffff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "elevation", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
}

function content(activation: Activation = "active", overrides?: unknown[]) {
  return createGameContentRegistry(input(activation, overrides));
}

function game(activation: Activation = "active", overrides?: unknown[]) {
  return new TowerDefenseGame({
    content: content(activation, overrides),
    missionId: "elevation",
    seed: "elevation-foundation"
  });
}

describe("R3.1 elevation data foundation", () => {
  it("publishes the closed bounded elevation v1-v3 capability without confusing map height", () => {
    expect(Engine.IMPLEMENTED_MECHANICS_MODULE_IDS).toEqual([
      "combat", "reactions", "navigation", "elevation", "physics", "terraforming", "roguelite", "heroes",
      "logistics"
    ]);
    expect((Engine as unknown as Record<string, unknown>).ELEVATION_LIMITS).toEqual(ELEVATION_LIMITS_V1);
    expect((Engine as unknown as Record<string, unknown>).ELEVATION_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 3,
      moduleId: "elevation",
      supportedModuleSchemaVersions: [1, 2, 3],
      profile: { requiredFields: [], optionalFields: ["lineOfSight", "highGround"], additionalProperties: false },
      map: {
        field: "elevationOverrides",
        coordinateField: "elevation",
        implicitDefault: 0,
        canonicalOrder: ["r", "q"],
        zeroOverridesOmitted: true
      },
      limits: ELEVATION_LIMITS_V1,
      runtimeSnapshot: {
        path: "snapshot.elevation",
        schemaVersion: 1,
        optionalUnlessActive: true,
        fields: ["schemaVersion", "defaultElevation", "overrides"]
      }
    });
  });

  it("activates only an enabled selected v1 empty profile and rejects profile fields", () => {
    expect(content("active").missions.elevation?.capabilities.elevation).toMatchObject({
      available: true,
      active: true,
      profileId: "authored",
      reason: "active"
    });
    for (const [activation, reason] of [
      ["absent", "module_missing"],
      ["disabled", "module_disabled"],
      ["unselected", "not_selected"],
      ["future", "module_version_unsupported"]
    ] as const) {
      expect(content(activation).missions.elevation?.capabilities.elevation).toMatchObject({
        active: false,
        reason
      });
    }

    const malformed = input("active");
    (malformed.mechanics!.modules.elevation!.profiles as Record<string, unknown>).authored = { height: 3 };
    const result = validateGameContentRegistry(createGameContentRegistry(malformed));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/elevation.*profiles.*authored.*height/i)
    }));
  });

  it.each([
    ["fractional elevation", [{ q: 1, r: 0, elevation: 1.5 }]],
    ["too low", [{ q: 1, r: 0, elevation: -1_000_001 }]],
    ["too high", [{ q: 1, r: 0, elevation: 1_000_001 }]],
    ["fractional coordinate", [{ q: 0.5, r: 0, elevation: 1 }]],
    ["outside coordinate", [{ q: 3, r: 0, elevation: 1 }]],
    ["duplicate coordinate", [{ q: 1, r: 0, elevation: 1 }, { q: 1, r: 0, elevation: 2 }]],
    ["extra field", [{ q: 1, r: 0, elevation: 1, height: 99 }]],
    ["sparse array", Object.assign(new Array(2), { 1: { q: 1, r: 0, elevation: 1 } })]
  ])("rejects %s without reading it as map height", (_label, overrides) => {
    const result = validateGameContentRegistry(content("active", overrides));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/elevation/i)
    }));
  });

  it("accepts exactly 65,536 elevation rows and rejects 65,537 before traversing sparse entries", () => {
    const exact = Array.from({ length: 65_536 }, (_, q) => ({ q, r: 0, elevation: 1 }));
    expect(Engine.normalizeGridElevationOverrides(exact, 65_536, 1)).toHaveLength(65_536);
    expect(() => Engine.normalizeGridElevationOverrides(new Array(65_537), 65_537, 1))
      .toThrow(/65.?536|at most|entries/i);
  });

  it("rejects accessor-backed elevation data without invoking accessors", () => {
    let calls = 0;
    const entry = { q: 1, r: 0 } as Record<string, unknown>;
    Object.defineProperty(entry, "elevation", {
      enumerable: true,
      get() { calls += 1; return 2; }
    });
    const result = validateGameContentRegistry(content("active", [entry]));
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });

  it("rejects a top-level elevationOverrides accessor during validation without invoking it", () => {
    let calls = 0;
    const malformed = input("active");
    Object.defineProperty(malformed.maps.plateau!, "elevationOverrides", {
      enumerable: true,
      get() { calls += 1; return [{ q: 1, r: 0, elevation: 2 }]; }
    });
    const result = validateGameContentRegistry(createGameContentRegistry(malformed));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "map",
      entityId: "plateau",
      fieldPath: expect.stringMatching(/elevation/i)
    }));
    expect(calls).toBe(0);
  });

  it("refuses a top-level elevationOverrides accessor in GridMap.fromDefinition without invoking it", () => {
    let calls = 0;
    const definition = input("active").maps.plateau!;
    Object.defineProperty(definition, "elevationOverrides", {
      enumerable: true,
      get() { calls += 1; return [{ q: 1, r: 0, elevation: 2 }]; }
    });
    expect(() => Engine.GridMap.fromDefinition(definition)).toThrow(/elevation|accessor|data property/i);
    expect(calls).toBe(0);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 2.5],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1]
  ])("rejects a %s map dimension before elevation bounds can be bypassed", (_label, width) => {
    const malformed = input("active", [{ q: 999, r: 0, elevation: 1 }]);
    malformed.maps.plateau!.width = width;
    const result = validateGameContentRegistry(createGameContentRegistry(malformed));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "map",
      entityId: "plateau",
      fieldPath: expect.stringMatching(/dimensions|width|elevation/i)
    }));
  });

  it.each([
    [Number.NaN, 2],
    [2.5, 2],
    [3, Number.NaN],
    [3, 1.5]
  ])("refuses to construct a GridMap with malformed dimensions %s×%s", (width, height) => {
    const definition = input("active").maps.plateau!;
    expect(() => Engine.GridMap.fromDefinition({ ...definition, width, height }))
      .toThrow(/map|width|height|dimension|safe integer/i);
  });

  it("exposes deterministic random access and a sparse active snapshot while keeping tile shape legacy", () => {
    const subject = game("active");
    const map = content("active").missions.elevation!.mapFactory();
    const elevationAt = (map as unknown as { elevationAt?: (coord: { q: number; r: number }) => number | undefined }).elevationAt;
    expect(elevationAt).toBeTypeOf("function");
    expect(elevationAt!.call(map, { q: 1, r: 0 })).toBe(3);
    expect(elevationAt!.call(map, { q: 0, r: 0 })).toBe(0);
    expect(elevationAt!.call(map, { q: 3, r: 0 })).toBeUndefined();

    const snapshot = subject.getSnapshot() as ReturnType<TowerDefenseGame["getSnapshot"]> & {
      elevation?: unknown;
    };
    expect(snapshot.elevation).toEqual({
      schemaVersion: 1,
      defaultElevation: 0,
      overrides: [
        { q: 1, r: 0, elevation: 3 },
        { q: 2, r: 0, elevation: -4 }
      ]
    });
    expect(snapshot.tiles.every((tile) => !Object.hasOwn(tile, "elevation"))).toBe(true);
    expect(snapshot.lastEvents.some((event) => /elevation/i.test(event.type))).toBe(false);
  });

  it("retains one deeply-readonly active render section while public snapshots stay detached", () => {
    const subject = game("active");
    const first = subject.getRenderSnapshot();
    const second = subject.getRenderSnapshot();
    expect(first.elevation).toBe(second.elevation);
    expect(Object.isFrozen(first.elevation)).toBe(true);
    expect(Object.isFrozen(first.elevation?.overrides)).toBe(true);
    expect(first.elevation?.overrides.every((entry) => Object.isFrozen(entry))).toBe(true);

    const detached = subject.getSnapshot().elevation as unknown as {
      schemaVersion: 1;
      defaultElevation: 0;
      overrides: Array<{ q: number; r: number; elevation: number }>;
    };
    expect(detached).not.toBe(first.elevation);
    expect(detached.overrides).not.toBe(first.elevation?.overrides);
    detached.overrides[0]!.elevation = 999;
    detached.overrides.push({ q: 0, r: 0, elevation: 999 });
    expect(subject.getRenderSnapshot().elevation).toEqual({
      schemaVersion: 1,
      defaultElevation: 0,
      overrides: [
        { q: 1, r: 0, elevation: 3 },
        { q: 2, r: 0, elevation: -4 }
      ]
    });

    expect(game("absent").getRenderSnapshot()).not.toHaveProperty("elevation");
    expect(game("disabled").getRenderSnapshot()).not.toHaveProperty("elevation");
  });

  it("keeps absent and disabled gameplay/render snapshots exactly legacy and elevation-free", () => {
    const absent = game("absent").getSnapshot() as unknown as Record<string, unknown>;
    const disabled = game("disabled").getSnapshot() as unknown as Record<string, unknown>;
    expect(disabled).toEqual(absent);
    expect(Object.hasOwn(absent, "elevation")).toBe(false);
    expect(Object.hasOwn(disabled, "elevation")).toBe(false);
    expect((absent.tiles as Array<Record<string, unknown>>).some((tile) => Object.hasOwn(tile, "elevation"))).toBe(false);
    expect((disabled.tiles as Array<Record<string, unknown>>).some((tile) => Object.hasOwn(tile, "elevation"))).toBe(false);
  });

  it("round-trips checkpoint and replay deterministically without adding elevation state to the codec", () => {
    const activeContent = content("active");
    const continuous = new TowerDefenseGame({
      content: activeContent,
      missionId: "elevation",
      seed: "elevation-checkpoint"
    });
    continuous.tick(0.25);
    const checkpoint = JSON.parse(JSON.stringify(continuous.createCheckpoint()));
    expect(checkpoint.state).not.toHaveProperty("elevation");
    expect(checkpoint.state).not.toHaveProperty("elevationOverrides");

    const restored = TowerDefenseGame.fromCheckpoint({ content: activeContent, checkpoint });
    expect(restored.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());

    const session = new JournaledGameSession(restored);
    const replay = replayGameCommandJournal({ content: activeContent, journal: session.exportJournal() });
    expect(replay.entriesReplayed).toBe(0);
    expect(replay.game.getSnapshot()).toEqual(restored.getSnapshot());
    expect(replay.stateDigest).toBe(restored.getStateDigest());
  });

  it("treats authored elevation as content for checkpoint mismatch even when the module is disabled", () => {
    const originalContent = content("disabled", [{ q: 1, r: 0, elevation: 2 }]);
    const checkpoint = new TowerDefenseGame({
      content: originalContent,
      missionId: "elevation",
      seed: "disabled-elevation-content"
    }).createCheckpoint();
    const changedContent = content("disabled", [{ q: 1, r: 0, elevation: 3 }]);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: changedContent, checkpoint }))
      .toThrow(/content.*(?:digest|mismatch)|(?:digest|mismatch).*content/i);
  });
});
