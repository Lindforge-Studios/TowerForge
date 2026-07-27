import { describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { TOWER_SCRIPT_LIMITS } from "../scripting/schema-descriptor.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { GameSnapshot, GridCoord, GridDefinition, GridPathRoute } from "./types.js";

type Activation = "active" | "absent" | "disabled" | "unselected" | "future";
type NavigationMode = "absent" | "authored_routes" | "dynamic_flow";
type ScriptAction = Record<string, unknown>;

interface FixtureOptions {
  readonly activation?: Activation;
  readonly navigationMode?: NavigationMode;
  readonly grid?: GridDefinition;
  readonly width?: number;
  readonly height?: number;
  readonly routes?: readonly GridPathRoute[];
  readonly terrainOverrides?: readonly { q: number; r: number; terrain: string }[];
  readonly handlers?: Readonly<Record<string, readonly ScriptAction[]>>;
  readonly observeTerrainEvents?: boolean;
}

const SQUARE: GridDefinition = Object.freeze({ kind: "square", adjacency: "cardinal" });
const HEX: GridDefinition = Object.freeze({ kind: "hex", layout: "odd-r" });
const MAIN_ROUTE: GridPathRoute = {
  id: "main",
  pathCenterline: Array.from({ length: 5 }, (_, q) => ({ q, r: 1 }))
};
const DETOUR_ROUTE: GridPathRoute = {
  id: "detour",
  pathCenterline: [
    { q: 0, r: 1 }, { q: 0, r: 2 }, { q: 1, r: 2 }, { q: 2, r: 2 },
    { q: 3, r: 2 }, { q: 4, r: 2 }, { q: 4, r: 1 }
  ]
};

function terraformTiles(
  operations: readonly Record<string, unknown>[],
  extras: Readonly<Record<string, unknown>> = {}
): ScriptAction {
  return { action: "terraformTiles", operations, ...extras };
}

function setTerrain(transitionId: string, target: unknown): Record<string, unknown> {
  return { kind: "set_terrain", target, transitionId };
}

function restoreTerrain(target: unknown): Record<string, unknown> {
  return { kind: "restore_terrain", target };
}

function runtimeContent(options: FixtureOptions = {}) {
  const activation = options.activation ?? "active";
  const navigationMode = options.navigationMode ?? "authored_routes";
  const width = options.width ?? 5;
  const height = options.height ?? 3;
  const routes = (options.routes ?? [{
    id: "main",
    pathCenterline: Array.from({ length: width }, (_, q) => ({ q, r: 1 }))
  }]).map((route) => ({
    id: route.id,
    pathCenterline: route.pathCenterline.map((coord) => ({ ...coord }))
  }));
  const selectedProfiles = {
    ...(activation === "absent" || activation === "unselected" ? {} : { terraforming: "mutable" }),
    ...(navigationMode === "absent"
      ? {}
      : { navigation: navigationMode === "dynamic_flow" ? "flow" : "authored" })
  };
  const signalHandlers = Object.entries(options.handlers ?? {}).map(([signal, actions]) => ({
    when: { $op: "eq", args: [{ $get: "event.signal" }, signal] },
    actions: [...actions]
  }));
  const scripts = {
    terraform_runtime: {
      schemaVersion: 6,
      id: "terraform_runtime",
      bindings: [{ scope: "global" }],
      handlers: {
        signal: signalHandlers,
        ...(options.observeTerrainEvents ? {
          terrainChanged: [{ actions: [{ action: "spawnEnemy", enemyTypeId: "walker", count: 1 }] }]
        } : {})
      }
    }
  };
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "terraform_runtime",
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
          groundSpeedMultiplier: 1, tags: ["mutable", "dry"]
        },
        water: {
          id: "water", label: "Water", buildable: false, walkable: true,
          groundSpeedMultiplier: 0.5, tags: ["wet"]
        },
        wall: {
          id: "wall", label: "Wall", buildable: false, walkable: false,
          groundSpeedMultiplier: 1, tags: ["blocked"]
        },
        stone: {
          id: "stone", label: "Stone", buildable: false, walkable: true,
          groundSpeedMultiplier: 1, tags: ["stone"]
        }
      },
      abilities: {},
      enemies: {
        walker: {
          id: "walker", label: "Walker", maxHp: 20, speed: 0.1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {},
      waveSets: {
        one: [{
          id: "one", label: "One",
          groups: [{ enemyId: "walker", count: 1, spawnInterval: 0, startDelay: 0, routeId: "main" }]
        }]
      },
      missions: {
        terraform_runtime: {
          id: "terraform_runtime", label: "Terraform runtime", description: "",
          startingCoreHp: 20, startingResources: { coins: 20 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: [], abilityIds: [],
          ...(Object.keys(selectedProfiles).length === 0 ? {} : { mechanics: { profiles: selectedProfiles } })
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width, height, grid: options.grid ?? SQUARE,
        defaultTerrain: "floor", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: width - 1, r: 1 },
        pathCenterline: routes[0]!.pathCenterline.map((coord) => ({ ...coord })),
        pathRoutes: routes,
        terrainOverrides: [...(options.terrainOverrides ?? [])]
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        ...(activation === "absent" ? {} : {
          terraforming: {
            schemaVersion: activation === "future" ? 2 : 1,
            enabled: activation !== "disabled",
            profiles: {
              mutable: {
                terrainTransitions: {
                  flood: { fromTerrainTags: ["mutable", "dry"], toTerrainId: "water" },
                  block: { fromTerrainTags: ["mutable"], toTerrainId: "wall" },
                  repair: { fromTerrainTags: ["blocked"], toTerrainId: "water" },
                  stay_floor: { fromTerrainTags: ["mutable"], toTerrainId: "floor" },
                  dry_out: { fromTerrainTags: ["wet"], toTerrainId: "stone" }
                }
              }
            }
          }
        }),
        ...(navigationMode === "absent" ? {} : {
          navigation: {
            schemaVersion: 1,
            enabled: true,
            profiles: navigationMode === "dynamic_flow"
              ? {
                  flow: {
                    mode: "dynamic_flow",
                    defaultMovementProfileId: "ground",
                    movementProfiles: {
                      ground: {
                        label: "Ground", terrainMode: "respect_walkable",
                        towerOccupancy: "ignored", defaultTerrainCost: 1_000
                      }
                    }
                  }
                }
              : { authored: { mode: "authored_routes" } }
          }
        })
      }
    },
    scripts: scripts as never,
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "terraform_runtime", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
  return createGameContentRegistry(input);
}

function game(options: FixtureOptions = {}): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "terraform_runtime",
    content: runtimeContent(options),
    seed: "terraform-runtime-c1"
  });
}

function terrainAt(snapshot: GameSnapshot, coord: GridCoord): string | undefined {
  return snapshot.tiles.find((tile) => tile.q === coord.q && tile.r === coord.r)?.terrain;
}

function gameplayProjection(snapshot: GameSnapshot) {
  return {
    tiles: snapshot.tiles,
    terrainOverrides: snapshot.terrainOverrides,
    temporaryWaterTiles: snapshot.temporaryWaterTiles,
    enemies: snapshot.enemies,
    navigation: snapshot.navigation
  };
}

function expectOneDiagnostic(
  before: GameSnapshot,
  after: GameSnapshot,
  code: "budget_exceeded" | "invalid_action",
  reasonKey: string
): void {
  expect(after.scriptState.diagnostics.slice(before.scriptState.diagnostics.length)).toEqual([
    expect.objectContaining({
      scriptId: "terraform_runtime",
      event: "signal",
      code,
      reasonKey
    })
  ]);
  expect(after.lastEvents.slice(before.lastEvents.length).filter((event) => event.type === "terrainChanged"))
    .toEqual([]);
  expect(after.lastEvents.slice(before.lastEvents.length).filter((event) => event.type === "scriptDiagnostic"))
    .toHaveLength(1);
}

function spawnOne(subject: TowerDefenseGame): void {
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0.01);
  expect(subject.getSnapshot().enemies).toHaveLength(1);
}

function scriptBudgets(subject: TowerDefenseGame): {
  readonly actions: number;
  readonly terrainChanges: number;
} {
  const internal = subject as unknown as {
    scriptActionsRemaining: number;
    scriptTerrainChangesRemaining: number;
  };
  return {
    actions: internal.scriptActionsRemaining,
    terrainChanges: internal.scriptTerrainChangesRemaining
  };
}

describe("R3.4b C1 persistent terrain terraforming runtime", () => {
  it.each(["absent", "disabled", "unselected", "future"] as const)(
    "keeps inactive %s terraforming an exact no-eval terrain-budget no-op",
    (activation) => {
      let getterCalls = 0;
      const hostileTarget = Object.defineProperties({}, {
        q: {
          enumerable: true,
          get() {
            getterCalls += 1;
            throw new Error("SECRET_INACTIVE_TERRAFORM_TARGET");
          }
        },
        r: { value: 0, enumerable: true }
      });
      const subject = game({
        activation,
        handlers: {
          terraform: [terraformTiles([setTerrain("flood", hostileTarget)])]
        }
      });
      const before = subject.getSnapshot();

      expect(subject.emitScriptSignal("terraform")).toEqual({ ok: true });
      const after = subject.getSnapshot();

      expect(getterCalls).toBe(0);
      expect(gameplayProjection(after)).toEqual(gameplayProjection(before));
      expect(after.scriptState.diagnostics).toEqual([]);
      expect(after.scriptState.values.terraform_runtime?.["global:global"]).toEqual({});
      expect(after.lastEvents.slice(before.lastEvents.length).filter((event) => event.type !== "scriptSignal"))
        .toEqual([]);
      expect(scriptBudgets(subject)).toEqual({
        actions: TOWER_SCRIPT_LIMITS.actionsPerTransaction - 1,
        terrainChanges: TOWER_SCRIPT_LIMITS.terrainChangesPerTransaction
      });
      expect(Object.prototype.hasOwnProperty.call(after, "terraforming")).toBe(false);
    }
  );

  it("rejects an oversized proxied operation array before inspecting any numeric element", () => {
    const originalAction = terraformTiles([setTerrain("flood", { q: 1, r: 0 })]);
    const subject = game({ handlers: { terraform: [originalAction] } });
    const runtimeAction = (subject as unknown as {
      content: {
        scripts: Record<string, {
          handlers: { signal: Array<{ actions: ScriptAction[] }> };
        }>;
      };
    }).content.scripts.terraform_runtime!.handlers.signal[0]!.actions[0]!;
    let numericDescriptorReads = 0;
    let numericValueReads = 0;
    const oversized = Array.from(
      { length: TOWER_SCRIPT_LIMITS.terrainChangesPerTransaction + 1 },
      (_, q) => setTerrain("flood", { q, r: 0 })
    );
    const guardedOperations = new Proxy(oversized, {
      getOwnPropertyDescriptor(target, key) {
        if (typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key)) numericDescriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      get(target, key, receiver) {
        if (typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key)) numericValueReads += 1;
        return Reflect.get(target, key, receiver);
      }
    });
    Object.defineProperty(runtimeAction, "operations", {
      value: guardedOperations,
      enumerable: true,
      configurable: true,
      writable: true
    });
    const before = subject.getSnapshot();

    expect(subject.emitScriptSignal("terraform")).toEqual({ ok: true });
    const after = subject.getSnapshot();

    expect(gameplayProjection(after)).toEqual(gameplayProjection(before));
    expectOneDiagnostic(before, after, "budget_exceeded", "terraform.operation_budget_exceeded");
    expect(scriptBudgets(subject).terrainChanges).toBe(0);
    expect(numericDescriptorReads).toBe(0);
    expect(numericValueReads).toBe(0);
  });

  it.each([
    ["an extra string field", () => ({
      ...terraformTiles([setTerrain("flood", { q: 1, r: 0 })]),
      unexpected: true
    })],
    ["a symbol field", () => {
      const action = terraformTiles([setTerrain("flood", { q: 1, r: 0 })]);
      Object.defineProperty(action, Symbol("unexpected"), { value: true, enumerable: true });
      return action;
    }],
    ["a non-Object prototype", () => {
      class TerraformAction {
        readonly action = "terraformTiles";
        readonly operations = [setTerrain("flood", { q: 1, r: 0 })];
      }
      return new TerraformAction() as unknown as ScriptAction;
    }]
  ] as const)("rejects terraformTiles action with %s as an atomic invalid operation", (_label, actionFactory) => {
    const subject = game({ handlers: { terraform: [actionFactory()] } });
    const before = subject.getSnapshot();

    expect(subject.emitScriptSignal("terraform")).toEqual({ ok: true });
    const after = subject.getSnapshot();

    expect(gameplayProjection(after)).toEqual(gameplayProjection(before));
    expectOneDiagnostic(before, after, "invalid_action", "terraform.invalid_operation");
  });

  it.each([
    ["square", SQUARE],
    ["hex", HEX]
  ] as const)("atomically commits and restores persistent two-op batches on %s", (_label, grid) => {
    const subject = game({
      grid,
      handlers: {
        set: [terraformTiles([
          setTerrain("flood", { q: 1, r: 0 }),
          setTerrain("flood", { q: 3, r: 0 })
        ])],
        restore: [terraformTiles([
          restoreTerrain({ q: 3, r: 0 }),
          restoreTerrain({ q: 1, r: 0 })
        ])]
      }
    });
    const beforeSet = subject.getSnapshot();
    expect(subject.emitScriptSignal("set")).toEqual({ ok: true });
    const set = subject.getSnapshot();

    expect(set.scriptState.diagnostics).toEqual([]);
    expect(set.terrainOverrides).toEqual([
      { q: 1, r: 0, terrain: "water", source: "script" },
      { q: 3, r: 0, terrain: "water", source: "script" }
    ]);
    expect(set.temporaryWaterTiles).toEqual([]);
    expect(set.lastEvents.slice(beforeSet.lastEvents.length).filter((event) => event.type === "terrainChanged"))
      .toEqual([
        expect.objectContaining({ type: "terrainChanged", coord: { q: 1, r: 0 }, fromTerrain: "floor", toTerrain: "water" }),
        expect.objectContaining({ type: "terrainChanged", coord: { q: 3, r: 0 }, fromTerrain: "floor", toTerrain: "water" })
      ]);
    expect(scriptBudgets(subject).terrainChanges).toBe(62);

    const eventCursor = set.lastEvents.length;
    expect(subject.emitScriptSignal("restore")).toEqual({ ok: true });
    const restored = subject.getSnapshot();
    expect(restored.terrainOverrides).toEqual([]);
    expect(terrainAt(restored, { q: 1, r: 0 })).toBe("floor");
    expect(terrainAt(restored, { q: 3, r: 0 })).toBe("floor");
    expect(restored.lastEvents.slice(eventCursor).filter((event) => event.type === "terrainChanged"))
      .toEqual([
        expect.objectContaining({ type: "terrainChanged", coord: { q: 3, r: 0 }, fromTerrain: "water", toTerrain: "floor" }),
        expect.objectContaining({ type: "terrainChanged", coord: { q: 1, r: 0 }, fromTerrain: "water", toTerrain: "floor" })
      ]);
  });

  it("accepts exactly 512 persistent overrides and rejects the 513th atomically", () => {
    const handlers: Record<string, readonly ScriptAction[]> = {};
    for (let batch = 0; batch < 8; batch += 1) {
      handlers[`batch_${batch}`] = [terraformTiles(Array.from({ length: 64 }, (_, offset) => (
        setTerrain("flood", { q: batch * 64 + offset, r: 0 })
      )))];
    }
    handlers.overflow = [terraformTiles([setTerrain("flood", { q: 512, r: 0 })])];
    const subject = game({ width: 514, handlers });

    for (let batch = 0; batch < 8; batch += 1) {
      expect(subject.emitScriptSignal(`batch_${batch}`)).toEqual({ ok: true });
      expect(subject.getSnapshot().scriptState.diagnostics).toEqual([]);
    }
    const atLimit = subject.getSnapshot();
    expect(atLimit.terrainOverrides).toHaveLength(TOWER_SCRIPT_LIMITS.activeTerrainOverrides);
    expect(atLimit.terrainOverrides.every((override) => override.terrain === "water")).toBe(true);
    const beforeOverflow = gameplayProjection(atLimit);

    expect(subject.emitScriptSignal("overflow")).toEqual({ ok: true });
    const afterOverflow = subject.getSnapshot();

    expect(gameplayProjection(afterOverflow)).toEqual(beforeOverflow);
    expectOneDiagnostic(atLimit, afterOverflow, "invalid_action", "terraform.override_budget_exceeded");
    expect(scriptBudgets(subject).terrainChanges).toBe(63);
  });

  it("treats authored-base transitions and restoring a tile without an override as event-free no-ops", () => {
    const subject = game({
      handlers: {
        noop: [terraformTiles([
          setTerrain("stay_floor", { q: 1, r: 0 }),
          restoreTerrain({ q: 2, r: 0 })
        ])]
      }
    });
    const before = subject.getSnapshot();

    expect(subject.emitScriptSignal("noop")).toEqual({ ok: true });
    const after = subject.getSnapshot();

    expect(after.terrainOverrides).toEqual([]);
    expect(terrainAt(after, { q: 1, r: 0 })).toBe("floor");
    expect(terrainAt(after, { q: 2, r: 0 })).toBe("floor");
    expect(after.lastEvents.slice(before.lastEvents.length).filter((event) => event.type === "terrainChanged"))
      .toEqual([]);
    expect(after.scriptState.diagnostics).toEqual([]);
    expect(scriptBudgets(subject).terrainChanges).toBe(62);
  });

  it("uses the current persistent override as the source of a later transaction", () => {
    const subject = game({
      handlers: {
        flood: [terraformTiles([setTerrain("flood", { q: 1, r: 0 })])],
        dry: [terraformTiles([setTerrain("dry_out", { q: 1, r: 0 })])]
      }
    });
    expect(subject.emitScriptSignal("flood")).toEqual({ ok: true });
    expect(terrainAt(subject.getSnapshot(), { q: 1, r: 0 })).toBe("water");
    const eventCursor = subject.getSnapshot().lastEvents.length;

    expect(subject.emitScriptSignal("dry")).toEqual({ ok: true });
    const after = subject.getSnapshot();

    expect(after.scriptState.diagnostics).toEqual([]);
    expect(after.terrainOverrides).toEqual([
      { q: 1, r: 0, terrain: "stone", source: "script" }
    ]);
    expect(after.lastEvents.slice(eventCursor).filter((event) => event.type === "terrainChanged"))
      .toEqual([
        expect.objectContaining({
          coord: { q: 1, r: 0 },
          fromTerrain: "water",
          toTerrain: "stone"
        })
      ]);
  });

  it("dispatches terrainChanged only after every write in a successful batch is committed", () => {
    const subject = game({
      handlers: {
        terraform: [terraformTiles([
          setTerrain("flood", { q: 1, r: 0 }),
          setTerrain("flood", { q: 3, r: 0 })
        ])]
      }
    });
    const internal = subject as unknown as {
      runScriptEvent(eventName: string, event: Record<string, unknown>): void;
    };
    const originalRunScriptEvent = internal.runScriptEvent.bind(subject);
    const observedAtDispatch: Array<readonly [string | undefined, string | undefined]> = [];
    const dispatchSpy = vi.spyOn(internal, "runScriptEvent").mockImplementation((eventName, event) => {
      if (eventName === "terrainChanged") {
        const snapshot = subject.getSnapshot();
        observedAtDispatch.push([
          terrainAt(snapshot, { q: 1, r: 0 }),
          terrainAt(snapshot, { q: 3, r: 0 })
        ]);
      }
      originalRunScriptEvent(eventName, event);
    });

    try {
      expect(subject.emitScriptSignal("terraform")).toEqual({ ok: true });
    } finally {
      dispatchSpy.mockRestore();
    }

    expect(observedAtDispatch).toEqual([
      ["water", "water"],
      ["water", "water"]
    ]);
  });

  it.each([
    [
      "missing transition",
      [setTerrain("flood", { q: 1, r: 0 }), setTerrain("missing", { q: 2, r: 0 })],
      [],
      "terraform.transition_missing"
    ],
    [
      "source tag mismatch",
      [setTerrain("flood", { q: 1, r: 0 }), setTerrain("flood", { q: 2, r: 0 })],
      [{ q: 2, r: 0, terrain: "stone" }],
      "terraform.transition_source_tag_mismatch"
    ],
    [
      "duplicate same-layer target",
      [setTerrain("flood", { q: 1, r: 0 }), restoreTerrain({ q: 1, r: 0 })],
      [],
      "terraform.duplicate_target"
    ],
    [
      "out-of-map target",
      [setTerrain("flood", { q: 1, r: 0 }), setTerrain("flood", { q: 99, r: 99 })],
      [],
      "terraform.target_outside_map"
    ]
  ] as const)("rejects a %s atomically with a stable reason", (_label, operations, terrainOverrides, reasonKey) => {
    const subject = game({
      terrainOverrides,
      handlers: { terraform: [terraformTiles(operations)] },
      observeTerrainEvents: true
    });
    spawnOne(subject);
    const before = subject.getSnapshot();

    expect(subject.emitScriptSignal("terraform")).toEqual({ ok: true });
    const after = subject.getSnapshot();

    expect(gameplayProjection(after)).toEqual(gameplayProjection(before));
    expectOneDiagnostic(before, after, "invalid_action", reasonKey);
    expect(scriptBudgets(subject).terrainChanges).toBe(62);
  });

  it("applies and expires a minimal C3B timed terrain batch", () => {
    const subject = game({
      handlers: {
        terraform: [terraformTiles([
          setTerrain("flood", { q: 1, r: 0 })
        ], { duration: 0.2 })]
      }
    });
    const before = subject.getSnapshot();

    expect(subject.emitScriptSignal("terraform")).toEqual({ ok: true });
    const applied = subject.getSnapshot();
    expect(terrainAt(applied, { q: 1, r: 0 })).toBe("water");
    expect(applied.scriptState.diagnostics).toEqual(before.scriptState.diagnostics);
    expect(applied.lastEvents.slice(before.lastEvents.length).filter((event) => event.type === "terrainChanged"))
      .toEqual([expect.objectContaining({
        coord: { q: 1, r: 0 }, fromTerrain: "floor", toTerrain: "water", source: "script"
      })]);

    subject.tick(0.2);
    const expired = subject.getSnapshot();
    expect(terrainAt(expired, { q: 1, r: 0 })).toBe("floor");
    expect(expired.terrainOverrides).toEqual([]);
    expect(expired.lastEvents.filter((event) => event.type === "terrainChanged"))
      .toEqual([expect.objectContaining({
        coord: { q: 1, r: 0 }, fromTerrain: "water", toTerrain: "floor", source: "restore"
      })]);
  });

  it("rejects an elevation operation without the active dependency", () => {
    const subject = game({
      handlers: {
        terraform: [terraformTiles([
          { kind: "set_elevation", target: { q: 1, r: 0 }, elevation: 1 }
        ])]
      }
    });
    const before = subject.getSnapshot();

    expect(subject.emitScriptSignal("terraform")).toEqual({ ok: true });
    const after = subject.getSnapshot();

    expect(gameplayProjection(after)).toEqual(gameplayProjection(before));
    expectOneDiagnostic(before, after, "invalid_action", "terraform.elevation_dependency_missing");
    expect(scriptBudgets(subject).terrainChanges).toBe(63);
  });

  it("reserves the complete batch before evaluating any target when terrain budget is insufficient", () => {
    let getterCalls = 0;
    const hostileTarget = Object.defineProperties({}, {
      q: {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error("SECRET_OVER_BUDGET_TERRAFORM_TARGET");
        }
      },
      r: { value: 0, enumerable: true }
    });
    const budgetConsumers = Array.from({ length: 63 }, () => ({
      action: "restoreTileTerrain", target: { q: 4, r: 0 }
    }));
    const subject = game({
      handlers: {
        terraform: [
          ...budgetConsumers,
          terraformTiles([
            setTerrain("flood", hostileTarget),
            setTerrain("flood", { q: 2, r: 0 })
          ])
        ]
      }
    });
    const before = subject.getSnapshot();

    expect(subject.emitScriptSignal("terraform")).toEqual({ ok: true });
    const after = subject.getSnapshot();

    expect(getterCalls).toBe(0);
    expect(gameplayProjection(after)).toEqual(gameplayProjection(before));
    expectOneDiagnostic(before, after, "budget_exceeded", "terraform.operation_budget_exceeded");
    expect(scriptBudgets(subject).terrainChanges).toBe(0);
  });

  it("rolls back all operations when one of multiple authored routes becomes invalid", () => {
    const subject = game({
      routes: [MAIN_ROUTE, DETOUR_ROUTE],
      handlers: {
        terraform: [terraformTiles([
          setTerrain("flood", { q: 2, r: 1 }),
          setTerrain("block", { q: 2, r: 2 })
        ])]
      },
      observeTerrainEvents: true
    });
    spawnOne(subject);
    const before = subject.getSnapshot();

    expect(subject.emitScriptSignal("terraform")).toEqual({ ok: true });
    const after = subject.getSnapshot();

    expect(gameplayProjection(after)).toEqual(gameplayProjection(before));
    expectOneDiagnostic(before, after, "invalid_action", "terraform.last_authored_route_blocked");
    expect(scriptBudgets(subject).terrainChanges).toBe(62);
  });

  it("distinguishes an invalid authored baseline from a candidate block and accepts a repair", () => {
    const invalidBaseline = game({
      routes: [MAIN_ROUTE, DETOUR_ROUTE],
      terrainOverrides: [{ q: 2, r: 2, terrain: "wall" }],
      handlers: {
        terraform: [terraformTiles([setTerrain("flood", { q: 2, r: 1 })])]
      }
    });
    const beforeInvalid = invalidBaseline.getSnapshot();
    expect(invalidBaseline.emitScriptSignal("terraform")).toEqual({ ok: true });
    const afterInvalid = invalidBaseline.getSnapshot();
    expect(gameplayProjection(afterInvalid)).toEqual(gameplayProjection(beforeInvalid));
    expectOneDiagnostic(
      beforeInvalid,
      afterInvalid,
      "invalid_action",
      "terraform.authored_route_unavailable"
    );

    const repair = game({
      routes: [MAIN_ROUTE, DETOUR_ROUTE],
      terrainOverrides: [{ q: 2, r: 2, terrain: "wall" }],
      handlers: {
        terraform: [terraformTiles([setTerrain("repair", { q: 2, r: 2 })])]
      }
    });
    expect(repair.emitScriptSignal("terraform")).toEqual({ ok: true });
    const repaired = repair.getSnapshot();
    expect(repaired.scriptState.diagnostics).toEqual([]);
    expect(terrainAt(repaired, { q: 2, r: 2 })).toBe("water");
    expect(repaired.terrainOverrides).toEqual([
      { q: 2, r: 2, terrain: "water", source: "script" }
    ]);
  });

  it("rejects a transactional batch that targets a live legacy timed override without altering its expiry", () => {
    const legacyTarget = { q: 1, r: 0 };
    const subject = game({
      handlers: {
        terraform: [terraformTiles([restoreTerrain(legacyTarget)])]
      }
    });
    const internal = subject as unknown as {
      runtimeTerrainOverrides: Map<string, {
        q: number;
        r: number;
        terrain: string;
        source: "script";
        expiresIn: number;
      }>;
    };
    internal.runtimeTerrainOverrides.set("1,0", {
      ...legacyTarget, terrain: "water", source: "script", expiresIn: 10
    });
    subject.map.setTerrain(legacyTarget, "water");
    const before = subject.getSnapshot();
    expect(before.terrainOverrides).toEqual([
      { ...legacyTarget, terrain: "water", source: "script", expiresIn: 10 }
    ]);

    expect(subject.emitScriptSignal("terraform")).toEqual({ ok: true });
    const after = subject.getSnapshot();

    expect(gameplayProjection(after)).toEqual(gameplayProjection(before));
    expectOneDiagnostic(before, after, "invalid_action", "terraform.target_owned");
    expect(scriptBudgets(subject).terrainChanges).toBe(63);
  });
});
