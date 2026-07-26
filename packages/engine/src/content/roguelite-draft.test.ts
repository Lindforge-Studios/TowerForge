import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { createGameContentRegistry, type GameContentInput } from "./registry.js";
import { validateGameContentRegistry } from "./validate.js";

function card(label: string, value: number): Record<string, unknown> {
  return {
    label,
    effects: [{
      kind: "modifier",
      scope: { kind: "all_towers" },
      modifier: { target: "damage", operation: "additive_ratio", value }
    }]
  };
}

function validDraft(): Record<string, unknown> {
  return {
    definitions: {
      ember: card("Ember", 0.1),
      frost: card("Frost", 0.2),
      storm: card("Storm", 0.3),
      bloom: card("Bloom", 0.4)
    },
    pools: {
      default: {
        entries: [
          { cardId: "ember", weight: 1 },
          { cardId: "frost", weight: 2 },
          { cardId: "storm", weight: 3 },
          { cardId: "bloom", weight: 4 }
        ]
      }
    },
    defaultPoolId: "default"
  };
}

function profile(draft: Record<string, unknown> | undefined = validDraft()): Record<string, unknown> {
  return {
    synergies: {},
    ...(draft === undefined ? {} : { draft })
  };
}

function input(options: {
  enabled?: boolean;
  selected?: boolean;
  schemaVersion?: number;
  profile?: Record<string, unknown>;
} = {}): GameContentInput {
  const selected = options.selected ?? true;
  return {
    balance: {
      defaultMissionId: "draft",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 2,
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
      enemies: {
        grunt: {
          id: "grunt", label: "Grunt", maxHp: 1, speed: 0.1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {
        cannon: {
          id: "cannon", label: "Cannon", tags: ["tech"], cost: { coins: 1 },
          footprintRadius: 0, range: 4,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 1,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        run: [{
          id: "wave_1", label: "Wave 1",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        draft: {
          id: "draft", label: "Draft", description: "", startingCoreHp: 20,
          startingResources: { coins: 100 }, prepTimeUnits: 2,
          mapId: "lane", waveSetId: "run", buildTowerIds: ["cannon"], abilityIds: [],
          ...(selected ? { mechanics: { profiles: { roguelite: "run" } } } : {})
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 6, height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 5, r: 1 },
        pathCenterline: Array.from({ length: 6 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        roguelite: {
          schemaVersion: options.schemaVersion ?? 3,
          enabled: options.enabled ?? true,
          profiles: { run: options.profile ?? profile() }
        }
      }
    },
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "draft", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function validate(options: Parameters<typeof input>[0] = {}) {
  return validateGameContentRegistry(createGameContentRegistry(input(options)));
}

function issueText(result: ReturnType<typeof validate>): string {
  return result.issues.map((issue) => `${issue.severity}:${issue.fieldPath}:${issue.message}`).join("\n");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("R4.3A roguelite v3 wave-draft authoring contract", () => {
  it("publishes the closed v3 profile and draft schema without changing v1/v2 exactness", () => {
    const descriptor = (Engine as unknown as Record<string, unknown>).ROGUELITE_MECHANICS_SCHEMA as {
      schemaVersion?: number;
      supportedModuleSchemaVersions?: readonly number[];
      profileVersions?: Record<number, unknown>;
      draft?: Record<string, unknown>;
      runtimeSnapshot?: Record<string, unknown>;
    } | undefined;

    expect(descriptor).toMatchObject({
      schemaVersion: 3,
      supportedModuleSchemaVersions: [1, 2, 3],
      profileVersions: {
        1: { requiredFields: ["synergies"], optionalFields: [], additionalProperties: false },
        2: { requiredFields: ["synergies", "artifacts"], optionalFields: [], additionalProperties: false },
        3: { requiredFields: ["synergies"], optionalFields: ["artifacts", "draft"], additionalProperties: false }
      },
      draft: {
        requiredFields: ["definitions", "pools", "defaultPoolId"],
        optionalFields: [],
        additionalProperties: false,
        definition: {
          requiredFields: ["label", "effects"], optionalFields: [], additionalProperties: false
        },
        effect: {
          requiredFields: ["kind", "scope", "modifier"],
          optionalFields: [],
          additionalProperties: false,
          kinds: ["modifier"]
        },
        scope: {
          kinds: ["all_towers", "tower_type", "tower_tag"]
        },
        pool: {
          requiredFields: ["entries"], optionalFields: [], additionalProperties: false
        },
        poolEntry: {
          requiredFields: ["cardId", "weight"], optionalFields: [], additionalProperties: false
        },
        offerSize: 3,
        sampling: "weighted_without_replacement"
      },
      runtimeSnapshot: {
        supportedSchemaVersions: [1, 2, 3, 4]
      }
    });
    expect(Object.isFrozen(descriptor)).toBe(true);
  });

  it("accepts draft-only, artifact-only, combined, and synergy-only exact v3 profiles", () => {
    expect(validate()).toEqual({ ok: true, issues: [] });
    expect(validate({ profile: profile(undefined) })).toEqual({ ok: true, issues: [] });

    const artifacts = {
      definitions: {},
      towerSlots: {},
      bossLootTables: {}
    };
    expect(validate({ profile: { synergies: {}, artifacts } })).toEqual({ ok: true, issues: [] });
    expect(validate({ profile: { synergies: {}, artifacts, draft: validDraft() } }))
      .toEqual({ ok: true, issues: [] });
  });

  it("keeps reserved v3 closed and rejects malformed card, effect, scope, pool, and profile shapes", () => {
    const cases: Array<readonly [string, Record<string, unknown>]> = [
      ["extra profile field", { ...profile(), deck: [] }],
      ["missing synergies", { draft: validDraft() }],
      ["extra draft field", (() => {
        const draft = validDraft();
        draft.future = true;
        return profile(draft);
      })()],
      ["extra card field", (() => {
        const draft = clone(validDraft());
        ((draft.definitions as Record<string, Record<string, unknown>>).ember!).future = true;
        return profile(draft);
      })()],
      ["zero effects", (() => {
        const draft = clone(validDraft());
        ((draft.definitions as Record<string, Record<string, unknown>>).ember!).effects = [];
        return profile(draft);
      })()],
      ["unknown effect", (() => {
        const draft = clone(validDraft());
        const effect = ((draft.definitions as Record<string, { effects: Record<string, unknown>[] }>).ember!).effects[0]!;
        effect.kind = "script";
        return profile(draft);
      })()],
      ["ambiguous all-towers scope", (() => {
        const draft = clone(validDraft());
        const effect = ((draft.definitions as Record<string, { effects: Array<{ scope: Record<string, unknown> }> }>).ember!).effects[0]!;
        effect.scope.towerTypeId = "cannon";
        return profile(draft);
      })()],
      ["missing tower-type id", (() => {
        const draft = clone(validDraft());
        const effect = ((draft.definitions as Record<string, { effects: Array<{ scope: Record<string, unknown> }> }>).ember!).effects[0]!;
        effect.scope = { kind: "tower_type" };
        return profile(draft);
      })()],
      ["extra pool field", (() => {
        const draft = clone(validDraft());
        ((draft.pools as Record<string, Record<string, unknown>>).default!).future = true;
        return profile(draft);
      })()],
      ["extra pool entry field", (() => {
        const draft = clone(validDraft());
        const entry = ((draft.pools as Record<string, { entries: Record<string, unknown>[] }>).default!).entries[0]!;
        entry.future = true;
        return profile(draft);
      })()],
      ["fewer than three unique cards", (() => {
        const draft = clone(validDraft());
        ((draft.pools as Record<string, { entries: unknown[] }>).default!).entries = [
          { cardId: "ember", weight: 1 },
          { cardId: "frost", weight: 1 },
          { cardId: "ember", weight: 1 }
        ];
        return profile(draft);
      })()]
    ];

    for (const [label, candidate] of cases) {
      const result = validate({ profile: candidate });
      expect(result.ok, label).toBe(false);
      expect(
        result.issues.some((issue) => /modules\.roguelite\.profiles\.run/i.test(issue.fieldPath)),
        `${label}\n${issueText(result)}`
      ).toBe(true);
    }
  });

  it("downgrades disabled broken references to warnings but requires active cross-references", () => {
    const draft = clone(validDraft());
    draft.defaultPoolId = "missing_pool";
    const entry = ((draft.pools as Record<string, { entries: Array<{ cardId: string }> }>).default!).entries[0]!;
    entry.cardId = "missing_card";
    const effect = ((draft.definitions as Record<string, { effects: Array<{ scope: Record<string, unknown> }> }>).ember!).effects[0]!;
    effect.scope = { kind: "tower_type", towerTypeId: "missing_tower" };

    const active = validate({ profile: profile(draft) });
    expect(active.ok).toBe(false);
    expect(issueText(active)).toMatch(/missing_pool/i);
    expect(issueText(active)).toMatch(/missing_card/i);
    expect(issueText(active)).toMatch(/missing_tower/i);

    const disabled = validate({ enabled: false, profile: profile(draft) });
    expect(disabled.ok).toBe(true);
    expect(disabled.issues.some((issue) => issue.severity === "error")).toBe(false);
    const disabledWarnings = disabled.issues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => `${issue.fieldPath}:${issue.message}`)
      .join("\n");
    expect(disabledWarnings).toMatch(/missing_pool/i);
    expect(disabledWarnings).toMatch(/missing_card/i);
    expect(disabledWarnings).toMatch(/missing_tower/i);
  });

  it("rejects active draft missions whose possible interwave selections exceed the checkpoint bound", () => {
    const candidate = input();
    candidate.balance.towers.unused_anchor = {
      ...clone(candidate.balance.towers.cannon!),
      id: "unused_anchor",
      label: "Unused tag anchor",
      tags: ["unused"]
    };
    const mechanics = candidate.mechanics as unknown as {
      modules: { roguelite: { profiles: { run: { draft: {
        definitions: Record<string, { effects: Array<{ scope: Record<string, unknown> }> }>;
      } } } } };
    };
    for (const definition of Object.values(mechanics.modules.roguelite.profiles.run.draft.definitions)) {
      for (const effect of definition.effects) effect.scope = { kind: "tower_tag", tag: "unused" };
    }
    const wave = candidate.balance.waveSets.run![0]!;
    candidate.balance.waveSets.run = Array.from({ length: 10_002 }, (_, index) => ({
      ...clone(wave),
      id: `wave_${index + 1}`,
      label: `Wave ${index + 1}`
    }));

    const result = validateGameContentRegistry(createGameContentRegistry(candidate));
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => (
      /mission.*draft|draft.*mission/i.test(issue.fieldPath)
      && /10.?000|selection|wave/i.test(issue.message)
    )), issueText(result)).toBe(true);
  });

  it("treats future v4 profiles as opaque while keeping malformed reserved v3 semantic", () => {
    const futureProfile = {
      future: Object.defineProperty({}, "trap", {
        enumerable: true,
        get() {
          throw new Error("FUTURE_ROGUELITE_PROFILE_MUST_STAY_OPAQUE");
        }
      })
    };
    const futureRegistry = createGameContentRegistry(input({ schemaVersion: 4, profile: futureProfile }));
    const future = validateGameContentRegistry(futureRegistry);
    expect(futureRegistry.missions.draft?.capabilities.roguelite).toMatchObject({
      active: false,
      reason: "module_version_unsupported"
    });
    expect(future.ok).toBe(false);
    expect(issueText(future)).toMatch(/schemaVersion.*future|schemaVersion.*unsupported/i);
    expect(future.issues.some((issue) => /profiles\.run/i.test(issue.fieldPath))).toBe(false);
    expect(issueText(future)).not.toContain("FUTURE_ROGUELITE_PROFILE_MUST_STAY_OPAQUE");

    const malformedV3 = validate({ profile: { synergies: {}, draft: { definitions: {}, pools: {} } } });
    expect(malformedV3.ok).toBe(false);
    expect(issueText(malformedV3)).toMatch(/defaultPoolId|required|missing/i);
  });
});
