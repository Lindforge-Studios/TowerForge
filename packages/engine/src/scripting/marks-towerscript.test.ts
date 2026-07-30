import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { validateGameContentRegistry } from "../content/validate.js";
import {
  computeCheckpointStateDigest,
  type GameCheckpointV1
} from "../simulation/checkpoint.js";
import { TowerDefenseGame } from "../simulation/TowerDefenseGame.js";
import {
  TOWER_SCRIPT_ACTION_SCHEMA,
  TOWER_SCRIPT_EVENTS,
  TOWER_SCRIPT_LIMITS,
  TOWER_SCRIPT_SCHEMA
} from "./schema-descriptor.js";
import { validateTowerScriptDefinitions } from "./validate.js";

type ScriptRecord = NonNullable<GameContentInput["scripts"]>;

interface MarkFixtureOptions {
  scripts?: ScriptRecord;
  enabled?: boolean;
  selected?: boolean;
  enemyCount?: number;
}

interface MarkEventFixture {
  type: "enemyMarkChanged";
  enemyId: string;
  enemyTypeId: string;
  markId: string;
  previousStacks: number;
  currentStacks: number;
  previousRemaining: number;
  remaining: number;
  cause: "application" | "consume" | "expiration" | "script";
}

interface CombatMarksFixture {
  schemaVersion: 2;
  marks: {
    enemies: Record<string, Record<string, { stacks: number; remaining: number }>>;
  };
}

function scriptDefinition(
  schemaVersion: number,
  handlers: Record<string, Array<{ when?: unknown; actions: Array<Record<string, unknown>> }>>,
  id = "mark_script"
): ScriptRecord {
  return {
    [id]: {
      schemaVersion,
      id,
      bindings: [{ scope: "mission", ids: ["marks"] }],
      handlers
    }
  } as unknown as ScriptRecord;
}

function markInput(options: MarkFixtureOptions = {}): GameContentInput {
  const selected = options.selected ?? true;
  return {
    balance: {
      defaultMissionId: "marks",
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
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt",
          label: "Grunt",
          maxHp: 100,
          speed: 0.01,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 1
        }
      },
      towers: {},
      waveSets: {
        one: [{
          id: "one",
          label: "One",
          groups: [{
            enemyId: "grunt",
            count: options.enemyCount ?? 1,
            spawnInterval: 0,
            startDelay: 0
          }]
        }]
      },
      missions: {
        marks: {
          id: "marks",
          label: "Marks",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 0,
          mapId: "lane",
          waveSetId: "one",
          buildTowerIds: [],
          abilityIds: [],
          ...(selected ? { mechanics: { profiles: { combat: "vulnerability" } } } : {})
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 8,
        height: 3,
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 7, r: 1 },
        pathCenterline: Array.from({ length: 8 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 3,
          enabled: options.enabled ?? true,
          profiles: {
            vulnerability: {
              damageTypes: { physical: { label: "Physical" } },
              armorTypes: {},
              armorAssignments: {},
              marks: {
                definitions: {
                  exposed: {
                    label: "Exposed",
                    duration: 10,
                    maxStacks: 3,
                    multiplier: 1.25,
                    consumePolicy: "retain",
                    damageTypes: ["physical"]
                  }
                }
              }
            }
          }
        }
      }
    } as unknown as GameContentInput["mechanics"],
    ...(options.scripts === undefined ? {} : { scripts: options.scripts }),
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        accent: "#fff",
        biome: "test",
        connections: []
      }],
      missionNodes: [{
        missionId: "marks",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
}

function createMarkGame(options: MarkFixtureOptions = {}): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "marks",
    seed: "marks-towerscript-contract",
    content: createGameContentRegistry(markInput(options))
  });
}

function startAndSpawn(game: TowerDefenseGame): void {
  expect(game.startNextWave().ok).toBe(true);
  game.tick(0.05);
}

function markEvents(game: TowerDefenseGame): MarkEventFixture[] {
  return (game.lastEvents as unknown as Array<{ type: string }>)
    .filter((event) => event.type === "enemyMarkChanged") as unknown as MarkEventFixture[];
}

function markState(game: TowerDefenseGame, enemyId = "enemy_1", markId = "exposed") {
  const combat = (game.getSnapshot() as unknown as { combat?: CombatMarksFixture }).combat;
  return combat?.marks.enemies[enemyId]?.[markId];
}

function mutableCheckpoint(checkpoint: GameCheckpointV1) {
  return checkpoint as unknown as {
    contentDigest: string;
    stateDigest: string;
    identity: GameCheckpointV1["identity"];
    rng: GameCheckpointV1["rng"];
    state: Omit<GameCheckpointV1["state"], "lastEvents" | "scriptEventCursor"> & {
      lastEvents: Array<Record<string, unknown>>;
      scriptEventCursor: number;
    };
  };
}

function resignCheckpoint(checkpoint: ReturnType<typeof mutableCheckpoint>): void {
  checkpoint.stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state as unknown as GameCheckpointV1["state"]
  );
}

describe("TowerScript v4 mark contract", () => {
  it("gates mark actions and enemyMarkChanged to v4 while preserving v1-v3 rejection", () => {
    const definition = (schemaVersion: number) => scriptDefinition(schemaVersion, {
      enemyMarkChanged: [{
        actions: [
          { action: "applyEnemyMark", target: "eventEnemy", markId: "exposed", stacks: 2 },
          { action: "clearEnemyMark", target: "eventEnemy", markId: "exposed" }
        ]
      }]
    });
    const refs = { missionIds: new Set(["marks"]), markIds: new Set(["exposed"]) } as never;

    for (const schemaVersion of [1, 2, 3]) {
      const issues = validateTowerScriptDefinitions(definition(schemaVersion) as never, refs);
      expect(issues.some((issue) => (
        issue.fieldPath.includes("enemyMarkChanged") && /schemaVersion 4|version 4/i.test(issue.message)
      ))).toBe(true);
      expect(issues.filter((issue) => (
        issue.fieldPath.includes("action") && /schemaVersion 4|version 4/i.test(issue.message)
      ))).toHaveLength(2);
    }
    expect(validateTowerScriptDefinitions(definition(4) as never, refs)).toEqual([]);
  });

  it("publishes v4 action/event shapes and the complete typed event context", () => {
    const actions = TOWER_SCRIPT_ACTION_SCHEMA as unknown as Record<string, {
      required: Record<string, string>;
      optional?: Record<string, string>;
    }>;
    const eventFields = TOWER_SCRIPT_SCHEMA.eventFields as unknown as Record<string, readonly string[]>;

    expect(TOWER_SCRIPT_SCHEMA.schemaVersion).toBe(7);
    expect(TOWER_SCRIPT_EVENTS).toContain("enemyMarkChanged");
    expect(actions.applyEnemyMark?.required).toEqual({ target: "enemy target", markId: "existing mark id" });
    expect(actions.applyEnemyMark?.optional?.stacks).toMatch(/expression|default.*1/i);
    expect(actions.clearEnemyMark?.required).toEqual({ target: "enemy target", markId: "existing mark id" });
    expect(eventFields.enemyMarkChanged).toEqual(expect.arrayContaining([
      "type",
      "enemyId",
      "enemyTypeId",
      "markId",
      "previousStacks",
      "currentStacks",
      "previousRemaining",
      "remaining",
      "cause"
    ]));
  });

  it("validates enemy targets, required known mark ids, stacks expressions, and action budgets", () => {
    const refs = { missionIds: new Set(["marks"]), markIds: new Set(["exposed"]) } as never;
    const validateAction = (action: Record<string, unknown>) => validateTowerScriptDefinitions(
      scriptDefinition(4, { tick: [{ actions: [action] }] }) as never,
      refs
    );

    expect(validateAction({ action: "applyEnemyMark", target: "eventTower", markId: "exposed" }))
      .toContainEqual(expect.objectContaining({ fieldPath: expect.stringContaining("target") }));
    expect(validateAction({ action: "clearEnemyMark", target: "allTowers", markId: "exposed" }))
      .toContainEqual(expect.objectContaining({ fieldPath: expect.stringContaining("target") }));
    expect(validateAction({ action: "applyEnemyMark", target: "eventEnemy", markId: "missing" }))
      .toContainEqual(expect.objectContaining({ fieldPath: expect.stringContaining("markId") }));
    expect(validateAction({ action: "clearEnemyMark", target: "eventEnemy" }))
      .toContainEqual(expect.objectContaining({ fieldPath: expect.stringContaining("markId") }));
    expect(validateAction({
      action: "applyEnemyMark",
      target: "eventEnemy",
      markId: "exposed",
      stacks: { $get: "event.delta" }
    })).toEqual([]);

    const tooManyActions = Array.from(
      { length: TOWER_SCRIPT_LIMITS.actionsPerHandler + 1 },
      () => ({ action: "applyEnemyMark", target: "allEnemies", markId: "exposed" })
    );
    expect(validateTowerScriptDefinitions(
      scriptDefinition(4, { tick: [{ actions: tooManyActions }] }) as never,
      refs
    )).toContainEqual(expect.objectContaining({
      fieldPath: expect.stringMatching(/actions$/),
      message: expect.stringContaining(String(TOWER_SCRIPT_LIMITS.actionsPerHandler))
    }));
  });

  it("rejects accessor-backed mark action fields without invoking getters or leaking thrown values", () => {
    let getterCalls = 0;
    const hostileAction = Object.defineProperties({}, {
      action: { value: "applyEnemyMark", enumerable: true },
      target: { value: "allEnemies", enumerable: true },
      markId: {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error("SECRET_MARK_GETTER_VALUE");
        }
      },
      stacks: { value: 1, enumerable: true }
    }) as Record<string, unknown>;

    const issues = validateTowerScriptDefinitions(scriptDefinition(4, {
      tick: [{ actions: [hostileAction] }]
    }) as never, { missionIds: new Set(["marks"]), markIds: new Set(["exposed"]) } as never);

    expect(getterCalls).toBe(0);
    expect(issues).toContainEqual(expect.objectContaining({
      fieldPath: expect.stringContaining("markId"),
      message: expect.stringMatching(/own data|accessor|field/i)
    }));
    expect(JSON.stringify(issues)).not.toContain("SECRET_MARK_GETTER_VALUE");
  });

  it("reports an unknown mark reference as an active error but an inactive warning", () => {
    const scripts = scriptDefinition(4, {
      tick: [{ actions: [{ action: "applyEnemyMark", target: "allEnemies", markId: "missing" }] }]
    });
    const active = validateGameContentRegistry(createGameContentRegistry(markInput({ scripts })));
    expect(active.ok).toBe(false);
    expect(active.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "script",
      fieldPath: expect.stringContaining("markId"),
      message: expect.stringMatching(/unknown.*mark|mark.*missing/i)
    }));

    for (const state of [{ enabled: false, selected: true }, { enabled: true, selected: false }]) {
      const inactive = validateGameContentRegistry(createGameContentRegistry(markInput({ scripts, ...state })));
      expect(inactive.ok).toBe(true);
      expect(inactive.issues).toContainEqual(expect.objectContaining({
        severity: "warning",
        entityKind: "script",
        fieldPath: expect.stringContaining("markId"),
        message: expect.stringMatching(/unknown.*mark|mark.*missing/i)
      }));
      expect(inactive.issues.some((issue) => issue.severity === "error")).toBe(false);
    }
  });

  it("keeps a mark declared only by a separate unselected profile non-blocking when another profile is active", () => {
    const scripts = scriptDefinition(4, {
      tick: [{ actions: [{ action: "applyEnemyMark", target: "allEnemies", markId: "dormant" }] }]
    });
    const input = markInput({ scripts });
    const combat = input.mechanics!.modules.combat as unknown as {
      profiles: Record<string, unknown>;
    };
    combat.profiles.dormant_profile = {
      damageTypes: { physical: { label: "Physical" } },
      armorTypes: {},
      armorAssignments: {},
      marks: {
        definitions: {
          dormant: {
            label: "Dormant",
            duration: 5,
            maxStacks: 1,
            multiplier: 1.5,
            consumePolicy: "retain",
            damageTypes: ["physical"]
          }
        }
      }
    };

    const result = validateGameContentRegistry(createGameContentRegistry(input));
    expect(result.ok).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "warning",
      entityKind: "script",
      fieldPath: expect.stringContaining("markId"),
      message: expect.stringMatching(/inactive|unselected|not active/i)
    }));
    expect(result.issues.some((issue) => issue.severity === "error")).toBe(false);
  });

  it("rejects a mission-bound reference to a mark active only in another mission profile", () => {
    const scripts = scriptDefinition(4, {
      tick: [{ actions: [{ action: "applyEnemyMark", target: "allEnemies", markId: "beta_mark" }] }]
    });
    const input = markInput({ scripts });
    input.balance.missions.beta = {
      ...input.balance.missions.marks!,
      id: "beta",
      label: "Beta",
      mechanics: { profiles: { combat: "beta_profile" } }
    };
    const combat = input.mechanics!.modules.combat as unknown as {
      profiles: Record<string, unknown>;
    };
    combat.profiles.beta_profile = {
      damageTypes: { physical: { label: "Physical" } },
      armorTypes: {},
      armorAssignments: {},
      marks: {
        definitions: {
          beta_mark: {
            label: "Beta mark",
            duration: 5,
            maxStacks: 1,
            multiplier: 1.5,
            consumePolicy: "retain",
            damageTypes: ["physical"]
          }
        }
      }
    };

    const result = validateGameContentRegistry(createGameContentRegistry(input));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "script",
      fieldPath: expect.stringContaining("markId"),
      message: expect.stringMatching(/not active|mission|profile/i)
    }));
  });

  it("warns when a global mark action also applies to a legacy mission without combat marks", () => {
    const scripts = scriptDefinition(4, {
      tick: [{ actions: [{ action: "applyEnemyMark", target: "allEnemies", markId: "exposed" }] }]
    });
    scripts.mark_script!.bindings = [{ scope: "global" }];
    const input = markInput({ scripts });
    input.balance.missions.legacy = {
      ...input.balance.missions.marks!,
      id: "legacy",
      label: "Legacy",
      mechanics: undefined
    };

    const result = validateGameContentRegistry(createGameContentRegistry(input));
    expect(result.ok).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "warning",
      entityKind: "script",
      fieldPath: expect.stringContaining("markId"),
      message: expect.stringMatching(/legacy|inactive|not active|without.*combat/i)
    }));
  });
});

describe("TowerScript v4 mark runtime", () => {
  it("defaults stacks to one and exposes script-caused changes through the typed event", () => {
    const scripts = scriptDefinition(4, {
      tick: [{ actions: [{ action: "applyEnemyMark", target: "allEnemies", markId: "exposed" }] }]
    });
    const game = createMarkGame({ scripts });
    startAndSpawn(game);

    expect(markState(game)).toEqual({ stacks: 1, remaining: 10 });
    expect(markEvents(game)).toEqual([{
      type: "enemyMarkChanged",
      enemyId: "enemy_1",
      enemyTypeId: "grunt",
      markId: "exposed",
      previousStacks: 0,
      currentStacks: 1,
      previousRemaining: 0,
      remaining: 10,
      cause: "script"
    }]);
  });

  it("resolves eventEnemy for clearEnemyMark without event recursion or stale state", () => {
    const scripts = {
      ...scriptDefinition(4, {
        tick: [{ actions: [{ action: "applyEnemyMark", target: "allEnemies", markId: "exposed" }] }]
      }, "apply_mark"),
      ...scriptDefinition(4, {
        enemyMarkChanged: [{
          when: { $op: "gt", args: [{ $get: "event.currentStacks" }, 0] },
          actions: [{ action: "clearEnemyMark", target: "eventEnemy", markId: "exposed" }]
        }]
      }, "clear_mark")
    } as ScriptRecord;
    const game = createMarkGame({ scripts });
    startAndSpawn(game);

    expect(markState(game)).toBeUndefined();
    expect(markEvents(game)).toEqual([
      expect.objectContaining({
        enemyId: "enemy_1", markId: "exposed", previousStacks: 0, currentStacks: 1, cause: "script"
      }),
      expect.objectContaining({
        enemyId: "enemy_1", markId: "exposed", previousStacks: 1, currentStacks: 0, remaining: 0, cause: "script"
      })
    ]);
    expect(game.getSnapshot().scriptState.diagnostics).toEqual([]);
  });

  it("terminates a self-reapplying mark handler at max stacks without no-op events or budget diagnostics", () => {
    const scripts = scriptDefinition(4, {
      tick: [{ actions: [{ action: "applyEnemyMark", target: "allEnemies", markId: "exposed" }] }],
      enemyMarkChanged: [{
        actions: [{ action: "applyEnemyMark", target: "eventEnemy", markId: "exposed" }]
      }]
    });
    const game = createMarkGame({ scripts });
    startAndSpawn(game);

    expect(markState(game)).toEqual({ stacks: 3, remaining: 10 });
    expect(markEvents(game)).toHaveLength(3);
    expect(game.getSnapshot().scriptState.diagnostics).not.toContainEqual(expect.objectContaining({
      code: "budget_exceeded"
    }));
  });

  it.each([
    ["fractional", { $get: "event.delta" }],
    ["zero", { $op: "sub", args: [{ $get: "game.enemyCount" }, { $get: "game.enemyCount" }] }],
    ["above maxStacks", { $op: "add", args: [{ $get: "game.enemyCount" }, 3] }]
  ])("rejects a dynamically %s stacks value as invalid_action without mutation", (_label, stacks) => {
    const scripts = scriptDefinition(4, {
      tick: [{ actions: [{ action: "applyEnemyMark", target: "allEnemies", markId: "exposed", stacks }] }]
    });
    const game = createMarkGame({ scripts });
    startAndSpawn(game);

    expect(markState(game)).toBeUndefined();
    expect(markEvents(game)).toEqual([]);
    expect(game.getSnapshot().scriptState.diagnostics).toContainEqual(expect.objectContaining({
      scriptId: "mark_script",
      event: "tick",
      code: "invalid_action"
    }));
  });

  it("counts mark events against the bounded transaction event budget", () => {
    const scripts = scriptDefinition(4, {
      tick: [{ actions: [{ action: "applyEnemyMark", target: "allEnemies", markId: "exposed" }] }]
    });
    const game = createMarkGame({ scripts, enemyCount: TOWER_SCRIPT_LIMITS.eventsPerTransaction + 8 });
    startAndSpawn(game);

    expect(markEvents(game)).toHaveLength(TOWER_SCRIPT_LIMITS.eventsPerTransaction + 8);
    expect(game.getSnapshot().scriptState.diagnostics).toContainEqual(expect.objectContaining({
      scriptId: "runtime",
      code: "budget_exceeded"
    }));
  });
});

describe("TowerScript mark checkpoint event codec", () => {
  function checkpointWithMarkEvent() {
    const scripts = scriptDefinition(4, {
      tick: [{ actions: [{ action: "applyEnemyMark", target: "allEnemies", markId: "exposed" }] }]
    });
    const content = createGameContentRegistry(markInput({ scripts }));
    const game = new TowerDefenseGame({ missionId: "marks", content, seed: "mark-checkpoint" });
    startAndSpawn(game);
    const checkpoint = mutableCheckpoint(JSON.parse(JSON.stringify(game.createCheckpoint())) as GameCheckpointV1);
    if (!checkpoint.state.lastEvents.some((event) => event.type === "enemyMarkChanged")) {
      checkpoint.state.lastEvents.push({
        type: "enemyMarkChanged",
        enemyId: "enemy_1",
        enemyTypeId: "grunt",
        markId: "exposed",
        previousStacks: 1,
        currentStacks: 0,
        previousRemaining: 10,
        remaining: 0,
        cause: "script"
      });
      checkpoint.state.scriptEventCursor = checkpoint.state.lastEvents.length;
      resignCheckpoint(checkpoint);
    }
    return { content, checkpoint };
  }

  it("round-trips an enemyMarkChanged lastEvent through the strict checkpoint codec", () => {
    const { content, checkpoint } = checkpointWithMarkEvent();
    expect(checkpoint.state.lastEvents).toContainEqual(expect.objectContaining({ type: "enemyMarkChanged" }));

    const restored = TowerDefenseGame.fromCheckpoint({
      content,
      checkpoint: checkpoint as unknown as GameCheckpointV1
    });
    expect(restored.lastEvents).toEqual(checkpoint.state.lastEvents);
    expect(restored.createCheckpoint().state.lastEvents).toEqual(checkpoint.state.lastEvents);
  });

  it.each([
    ["future cause", (event: Record<string, unknown>) => { event.cause = "future"; }],
    ["unknown mark", (event: Record<string, unknown>) => { event.markId = "missing"; }],
    ["stacks over definition", (event: Record<string, unknown>) => { event.currentStacks = 4; }],
    ["extra field", (event: Record<string, unknown>) => { event.hostPayload = "forbidden"; }]
  ])("rejects a digest-valid mark event with %s", (_label, mutate) => {
    const { content, checkpoint } = checkpointWithMarkEvent();
    const event = checkpoint.state.lastEvents.find((item) => item.type === "enemyMarkChanged")!;
    mutate(event);
    resignCheckpoint(checkpoint);

    expect(() => TowerDefenseGame.fromCheckpoint({
      content,
      checkpoint: checkpoint as unknown as GameCheckpointV1
    })).toThrow(/checkpoint|event|mark|cause|stacks|field/i);
  });
});
