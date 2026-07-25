import { afterEach, describe, expect, it, vi } from "vitest";
import * as Engine from "../index.js";
import { resolveActiveCombatMechanics } from "./combat-mechanics.js";
import { createGameContentRegistry, type GameContentInput } from "./registry.js";
import { validateGameContentRegistry } from "./validate.js";
import { TowerDefenseGame } from "../simulation/TowerDefenseGame.js";
import { stableDigest } from "../simulation/stable-digest.js";

interface MarkDefinitionFixture {
  label: string;
  duration: number;
  maxStacks: number;
  multiplier: number;
  consumePolicy: "retain" | "consume_one" | "consume_all" | string;
  damageTypes?: string[];
  [key: string]: unknown;
}

interface MarkApplicationFixture {
  markId: string;
  stacks?: number;
  [key: string]: unknown;
}

interface MarkProfileFixture {
  damageTypes?: Record<string, { label: string }>;
  marks?: {
    definitions?: Record<string, MarkDefinitionFixture>;
    bindings?: {
      towers?: Record<string, MarkApplicationFixture[]>;
      abilities?: Record<string, MarkApplicationFixture[]>;
      towerScripts?: Record<string, MarkApplicationFixture[]>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface MarkInputOptions {
  moduleVersion?: number;
  enabled?: boolean;
  selected?: boolean;
  profile?: MarkProfileFixture;
}

function validMarkProfile(): MarkProfileFixture {
  return {
    damageTypes: {
      physical: { label: "Physical" },
      fire: { label: "Fire" },
      ice: { label: "Ice" }
    },
    marks: {
      definitions: {
        exposed: {
          label: "Exposed",
          duration: 3,
          maxStacks: 4,
          multiplier: 1.5,
          consumePolicy: "retain",
          damageTypes: ["fire", "physical"]
        },
        brittle: {
          label: "Brittle",
          duration: 2,
          maxStacks: 2,
          multiplier: 2,
          consumePolicy: "consume_one"
        }
      },
      bindings: {
        towers: { igniter: [{ markId: "exposed", stacks: 2 }] },
        abilities: { mark_spell: [{ markId: "brittle" }] },
        towerScripts: { marker_script: [{ markId: "exposed" }] }
      }
    }
  };
}

function markInput(options: MarkInputOptions = {}): GameContentInput {
  const profile = options.profile ?? validMarkProfile();
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
      abilities: {
        mark_spell: {
          id: "mark_spell",
          label: "Mark",
          cooldown: 1,
          duration: 0,
          radius: 5,
          effects: [{ kind: "damage", amount: 1 }]
        }
      },
      enemies: {
        grunt: {
          id: "grunt",
          label: "Grunt",
          maxHp: 100,
          speed: 0.1,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 1
        }
      },
      towers: {
        igniter: {
          id: "igniter",
          label: "Igniter",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 5,
          attack: {
            kind: "single",
            fireRate: 0.1,
            damagePerStack: 2,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 1,
            damageType: "fire"
          }
        }
      },
      waveSets: {
        one: [{
          id: "one",
          label: "One",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
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
          buildTowerIds: ["igniter"],
          abilityIds: ["mark_spell"],
          ...((options.selected ?? true) ? { mechanics: { profiles: { combat: "marked" } } } : {})
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 6,
        height: 3,
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 5, r: 1 },
        pathCenterline: Array.from({ length: 6 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: options.moduleVersion ?? 3,
          enabled: options.enabled ?? true,
          profiles: { marked: profile }
        }
      }
    } as unknown as GameContentInput["mechanics"],
    scripts: {
      marker_script: {
        schemaVersion: 1,
        id: "marker_script",
        bindings: [{ scope: "global" }],
        handlers: {}
      }
    },
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

function validate(options: MarkInputOptions = {}) {
  const content = createGameContentRegistry(markInput(options));
  return { content, result: validateGameContentRegistry(content) };
}

function hasIssue(
  result: ReturnType<typeof validateGameContentRegistry>,
  severity: "error" | "warning",
  path: RegExp,
  message: RegExp = /./
): boolean {
  return result.issues.some((issue) => (
    issue.severity === severity && path.test(issue.fieldPath) && message.test(issue.message)
  ));
}

afterEach(() => vi.restoreAllMocks());

describe("combat mechanics v3 mark catalog contract", () => {
  it("keeps v1 shield-only and v2 armor-only, accepts marks only in v3, and rejects future v4", () => {
    const v1Marks = validate({ moduleVersion: 1 });
    expect(v1Marks.result.ok).toBe(false);
    expect(hasIssue(v1Marks.result, "error", /marks/, /unknown|version|unsupported/i)).toBe(true);

    const v2Marks = validate({ moduleVersion: 2 });
    expect(v2Marks.result.ok).toBe(false);
    expect(hasIssue(v2Marks.result, "error", /marks/, /unknown|version|unsupported/i)).toBe(true);

    const v3Marks = validate();
    expect(v3Marks.result).toMatchObject({ ok: true, issues: [] });
    expect(v3Marks.content.missions.marks!.capabilities.combat).toMatchObject({
      active: true,
      reason: "active",
      profileId: "marked"
    });

    const future = validate({ moduleVersion: 4 });
    expect(future.result.ok).toBe(false);
    expect(hasIssue(future.result, "error", /modules\.combat\.schemaVersion/, /supported|future|1|2|3/i)).toBe(true);
  });

  it("publishes the single bounded mark contract", () => {
    expect((Engine as unknown as { MARK_LIMITS?: unknown }).MARK_LIMITS).toEqual({
      definitions: 256,
      sourceBindings: 4096,
      runtimeApplications: 16384,
      applicationsPerSource: 16,
      filterDamageTypes: 256,
      labelLength: 128,
      duration: 1_000_000_000,
      maxStacks: 256,
      multiplier: 1_000_000
    });
  });

  it("requires the definitions catalog whenever a marks section is authored", () => {
    const result = validate({
      profile: { marks: { bindings: {} } }
    }).result;
    expect(hasIssue(result, "error", /marks\.definitions|marks$/, /required|missing|definitions/i)).toBe(true);
  });

  it("requires every definition field instead of supplying gameplay defaults", () => {
    const required = ["label", "duration", "maxStacks", "multiplier", "consumePolicy"] as const;
    for (const field of required) {
      const definition: Record<string, unknown> = {
        label: "Required",
        duration: 1,
        maxStacks: 1,
        multiplier: 2,
        consumePolicy: "retain"
      };
      delete definition[field];
      const result = validate({
        profile: {
          marks: {
            definitions: { tested: definition as unknown as MarkDefinitionFixture }
          }
        }
      }).result;
      expect(hasIssue(
        result,
        "error",
        new RegExp(`marks\\.definitions\\.tested(?:\\.${field})?`),
        new RegExp(`${field}|required|missing`, "i")
      )).toBe(true);
    }
  });

  it.each([
    ["empty label", { label: "", duration: 1, maxStacks: 1, multiplier: 2, consumePolicy: "retain" }],
    ["long label", { label: "x".repeat(129), duration: 1, maxStacks: 1, multiplier: 2, consumePolicy: "retain" }],
    ["zero duration", { label: "x", duration: 0, maxStacks: 1, multiplier: 2, consumePolicy: "retain" }],
    ["duration above cap", { label: "x", duration: 1_000_000_001, maxStacks: 1, multiplier: 2, consumePolicy: "retain" }],
    ["fractional stacks", { label: "x", duration: 1, maxStacks: 1.5, multiplier: 2, consumePolicy: "retain" }],
    ["zero stacks", { label: "x", duration: 1, maxStacks: 0, multiplier: 2, consumePolicy: "retain" }],
    ["stacks above cap", { label: "x", duration: 1, maxStacks: 257, multiplier: 2, consumePolicy: "retain" }],
    ["neutral multiplier", { label: "x", duration: 1, maxStacks: 1, multiplier: 1, consumePolicy: "retain" }],
    ["non-finite multiplier", { label: "x", duration: 1, maxStacks: 1, multiplier: Number.NaN, consumePolicy: "retain" }],
    ["multiplier above cap", { label: "x", duration: 1, maxStacks: 1, multiplier: 1_000_001, consumePolicy: "retain" }],
    ["future policy", { label: "x", duration: 1, maxStacks: 1, multiplier: 2, consumePolicy: "future" }]
  ] as const)("rejects active malformed definition: %s", (_label, definition) => {
    const result = validate({
      profile: {
        damageTypes: { physical: { label: "Physical" } },
        marks: { definitions: { tested: definition } }
      }
    }).result;
    expect(hasIssue(result, "error", /marks\.definitions\.tested/, /label|duration|stack|multiplier|policy|range|limit/i)).toBe(true);
  });

  it("enforces definition, per-source, total-binding, and damage-filter budgets", () => {
    const definitions = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [
      `mark_${index}`,
      { label: `Mark ${index}`, duration: 1, maxStacks: 1, multiplier: 2, consumePolicy: "retain" }
    ]));
    expect(hasIssue(validate({
      profile: { marks: { definitions } }
    }).result, "error", /marks\.definitions/, /256|limit|maximum/i)).toBe(true);

    const tooManyForSource = Array.from({ length: 17 }, () => ({ markId: "exposed" }));
    expect(hasIssue(validate({
      profile: {
        ...validMarkProfile(),
        marks: {
          ...validMarkProfile().marks,
          bindings: { towers: { igniter: tooManyForSource } }
        }
      }
    }).result, "error", /bindings\.towers\.igniter/, /16|limit|maximum/i)).toBe(true);

    const totalBindings = Object.fromEntries(Array.from({ length: 4097 }, (_, index) => [
      `tower_${index}`,
      [{ markId: "exposed" }]
    ]));
    expect(hasIssue(validate({
      profile: {
        ...validMarkProfile(),
        marks: {
          ...validMarkProfile().marks,
          bindings: { towers: totalBindings }
        }
      }
    }).result, "error", /marks\.bindings/, /4096|limit|maximum/i)).toBe(true);

    const result = validate({
      profile: {
        damageTypes: { physical: { label: "Physical" } },
        marks: {
          definitions: {
            filtered: {
              label: "Filtered",
              duration: 1,
              maxStacks: 1,
              multiplier: 2,
              consumePolicy: "retain",
              damageTypes: Array.from({ length: 257 }, () => "physical")
            }
          }
        }
      }
    }).result;
    expect(hasIssue(result, "error", /marks\.definitions\.filtered\.damageTypes/, /256|limit|maximum/i)).toBe(true);
  });

  it("rejects blank authored ids and non-positive or fractional application stacks", () => {
    const blankDefinition = validate({
      profile: {
        marks: {
          definitions: {
            "": { label: "Blank", duration: 1, maxStacks: 1, multiplier: 2, consumePolicy: "retain" }
          }
        }
      }
    }).result;
    expect(hasIssue(blankDefinition, "error", /marks\.definitions/, /id|empty|non-empty/i)).toBe(true);

    for (const stacks of [0, 1.5]) {
      const profile = validMarkProfile();
      profile.marks!.bindings!.abilities!.mark_spell = [{ markId: "brittle", stacks }];
      expect(hasIssue(
        validate({ profile }).result,
        "error",
        /bindings\.abilities\.mark_spell/,
        /stack|integer|positive/i
      )).toBe(true);
    }
  });

  it("rejects duplicate mark applications for one source in validation and the active normalizer", () => {
    const profile = validMarkProfile();
    profile.marks!.bindings!.abilities!.mark_spell = [
      { markId: "brittle", stacks: 1 },
      { markId: "brittle", stacks: 2 }
    ];
    const { content, result } = validate({ profile });

    expect(hasIssue(result, "error", /bindings\.abilities\.mark_spell/, /duplicate|repeated|brittle/i)).toBe(true);
    expect(() => new TowerDefenseGame({
      missionId: "marks",
      content,
      seed: "duplicate-mark-binding"
    })).toThrow(/duplicate|repeated|brittle/i);
  });

  it("canonicalizes unique source applications by binary mark id for runtime events and state", () => {
    const contentForOrder = (markIds: readonly ["exposed" | "brittle", "exposed" | "brittle"]) => {
      const profile = validMarkProfile();
      profile.marks!.bindings!.abilities!.mark_spell = markIds.map((markId) => ({ markId }));
      return validate({ profile }).content;
    };
    const firstContent = contentForOrder(["exposed", "brittle"]);
    const reversedContent = contentForOrder(["brittle", "exposed"]);
    const normalizedMarkIds = (content: ReturnType<typeof contentForOrder>) => (
      resolveActiveCombatMechanics(content, "marks")!.marks.bindings.abilities.mark_spell!.map(({ markId }) => markId)
    );

    expect(normalizedMarkIds(firstContent)).toEqual(["brittle", "exposed"]);
    expect(normalizedMarkIds(reversedContent)).toEqual(["brittle", "exposed"]);

    const run = (content: ReturnType<typeof contentForOrder>) => {
      const game = new TowerDefenseGame({ missionId: "marks", content, seed: "mark-binding-order" });
      expect(game.startNextWave().ok).toBe(true);
      game.tick(0.01);
      expect(game.useAbility("mark_spell", { q: 0, r: 1 }).ok).toBe(true);
      const checkpoint = game.createCheckpoint();
      return {
        markEventIds: checkpoint.state.lastEvents
          .filter((event) => event.type === "enemyMarkChanged")
          .map((event) => event.markId),
        stateDigest: stableDigest(checkpoint.state)
      };
    };
    const first = run(firstContent);
    const reversed = run(reversedContent);

    expect(first.markEventIds).toEqual(["brittle", "exposed"]);
    expect(reversed).toEqual(first);
  });

  it.each([
    ["empty", []],
    ["duplicate", ["fire", "fire"]]
  ] as const)("rejects a %s damageTypes filter in validation and the active normalizer", (_label, damageTypes) => {
    const profile = validMarkProfile();
    profile.marks!.definitions!.exposed!.damageTypes = [...damageTypes];
    const { content, result } = validate({ profile });

    expect(hasIssue(result, "error", /definitions\.exposed\.damageTypes/, /empty|at least|duplicate|unique|repeated/i)).toBe(true);
    expect(() => new TowerDefenseGame({
      missionId: "marks",
      content,
      seed: "invalid-mark-filter"
    })).toThrow(/filter|empty|at least|duplicate|unique|repeated/i);
  });

  it.each([
    ["unknown damage type", (() => {
      const profile = validMarkProfile();
      profile.marks!.definitions!.exposed!.damageTypes = ["void"];
      return profile;
    })(), /definitions\.exposed\.damageTypes/, /damage|unknown|void/i],
    ["unknown mark", (() => {
      const profile = validMarkProfile();
      profile.marks!.bindings!.towers!.igniter = [{ markId: "missing" }];
      return profile;
    })(), /bindings\.towers\.igniter/, /mark|unknown|missing/i],
    ["unknown tower", (() => {
      const profile = validMarkProfile();
      profile.marks!.bindings!.towers = { ghost: [{ markId: "exposed" }] };
      return profile;
    })(), /bindings\.towers\.ghost/, /tower|unknown|ghost/i],
    ["unknown ability", (() => {
      const profile = validMarkProfile();
      profile.marks!.bindings!.abilities = { ghost: [{ markId: "exposed" }] };
      return profile;
    })(), /bindings\.abilities\.ghost/, /ability|unknown|ghost/i],
    ["unknown script", (() => {
      const profile = validMarkProfile();
      profile.marks!.bindings!.towerScripts = { ghost: [{ markId: "exposed" }] };
      return profile;
    })(), /bindings\.towerScripts\.ghost/, /script|unknown|ghost/i],
    ["application above maxStacks", (() => {
      const profile = validMarkProfile();
      profile.marks!.bindings!.abilities!.mark_spell = [{ markId: "brittle", stacks: 3 }];
      return profile;
    })(), /bindings\.abilities\.mark_spell/, /stack|max|brittle/i]
  ] as const)("rejects active cross-reference or application error: %s", (_label, profile, path, message) => {
    expect(hasIssue(validate({ profile }).result, "error", path, message)).toBe(true);
  });

  it.each([
    ["profile", { marks: { definitions: {}, unexpected: true } }],
    ["definition", {
      marks: {
        definitions: {
          exposed: {
            label: "Exposed", duration: 1, maxStacks: 1, multiplier: 2,
            consumePolicy: "retain", excludedTags: ["area"]
          }
        }
      }
    }],
    ["binding group", { marks: { definitions: {}, bindings: { enemies: {} } } }],
    ["application", {
      marks: {
        definitions: {
          exposed: { label: "Exposed", duration: 1, maxStacks: 1, multiplier: 2, consumePolicy: "retain" }
        },
        bindings: { towers: { igniter: [{ markId: "exposed", requiredTags: ["area"] }] } }
      }
    }]
  ] as const)("rejects unknown fields in closed %s shape even while disabled", (_label, profile) => {
    const result = validate({ profile: profile as MarkProfileFixture, enabled: false }).result;
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.severity === "error")).toBe(true);
  });

  it.each([
    ["disabled", { enabled: false, selected: true }],
    ["unselected", { enabled: true, selected: false }]
  ] as const)("downgrades inactive %s semantic mark errors to warnings and leaves runtime legacy", (_label, state) => {
    const profile = validMarkProfile();
    profile.marks!.bindings!.towers = { ghost: [{ markId: "missing", stacks: 999 }] };
    const { content, result } = validate({ profile, ...state });
    expect(result.ok).toBe(true);
    expect(hasIssue(result, "warning", /marks\.bindings\.towers\.ghost/, /tower|mark|stack|unknown|limit/i)).toBe(true);
    expect(result.issues.some((issue) => issue.severity === "error")).toBe(false);

    const game = new TowerDefenseGame({ missionId: "marks", content, seed: "inactive-marks" });
    expect(game.startNextWave().ok).toBe(true);
    game.tick(0.01);
    expect(game.getSnapshot()).not.toHaveProperty("combat");
    expect(game.createCheckpoint().state).not.toHaveProperty("combat");
  });

  it("fails closed on accessor-backed mark definitions without invoking or leaking getters", () => {
    const getter = vi.fn(() => {
      throw new Error("SYNTHETIC_SECRET_MARK_GETTER");
    });
    const definition: Record<string, unknown> = {
      label: "Unsafe",
      duration: 1,
      maxStacks: 1,
      consumePolicy: "retain"
    };
    Object.defineProperty(definition, "multiplier", { enumerable: true, get: getter });
    const profile: MarkProfileFixture = {
      marks: {
        definitions: { unsafe: definition as MarkDefinitionFixture }
      }
    };

    let caught: unknown;
    let result: ReturnType<typeof validateGameContentRegistry> | undefined;
    try {
      result = validate({ profile }).result;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
    expect(result?.ok).toBe(false);
    expect(result?.issues.some((issue) => issue.message.includes("SYNTHETIC_SECRET"))).toBe(false);
  });
});
