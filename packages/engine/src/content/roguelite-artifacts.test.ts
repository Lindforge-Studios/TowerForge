import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "./registry.js";
import { validateGameContentRegistry, type ValidationResult } from "./validate.js";

const EXPECTED_ARTIFACT_LIMITS = Object.freeze({
  definitions: 256,
  slotsPerTower: 8,
  totalSlots: 4_096,
  modifiersPerArtifact: 8,
  totalArtifactModifiers: 1_024,
  lootTables: 64,
  rollsPerTable: 8,
  entriesPerTable: 128,
  weight: 1_000_000,
  totalTableWeight: 0xffff_ffff,
  idUtf8Bytes: 128,
  labelUtf8Bytes: 256
});

type RogueliteMode = "absent" | "v1" | "active" | "disabled" | "unselected" | "future";

function validArtifacts(): Record<string, unknown> {
  return {
    definitions: {
      crystal: {
        label: "Vampiric crystal",
        slotType: "crystal",
        modifiers: []
      },
      scope: {
        label: "Calibrated scope",
        slotType: "scope",
        modifiers: [{ target: "damage", operation: "additive_ratio", value: 0.3 }]
      }
    },
    towerSlots: {
      cannon: [{ slotId: "optic", slotType: "scope" }],
      pulse: [{ slotId: "core", slotType: "crystal" }]
    },
    bossLootTables: {
      boss: {
        rolls: 1,
        noDropWeight: 0,
        entries: [
          { artifactId: "scope", weight: 3 },
          { artifactId: "crystal", weight: 1 }
        ]
      }
    }
  };
}

function profile(artifacts: Record<string, unknown> = validArtifacts()): Record<string, unknown> {
  return { synergies: {}, artifacts };
}

function rogueliteInput(options: {
  mode?: RogueliteMode;
  profile?: Record<string, unknown>;
} = {}): GameContentInput {
  const mode = options.mode ?? "active";
  const selectedProfile = options.profile ?? profile();
  return {
    balance: {
      defaultMissionId: "artifacts",
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
          id: "floor",
          label: "Floor",
          buildable: true,
          walkable: true,
          groundSpeedMultiplier: 1,
          tags: []
        }
      },
      abilities: {},
      enemies: {
        boss: {
          id: "boss",
          label: "Boss",
          maxHp: 10,
          speed: 0.1,
          reward: { coins: 5 },
          coinReward: 5,
          coreDamage: 1,
          color: 1
        },
        grunt: {
          id: "grunt",
          label: "Grunt",
          maxHp: 10,
          speed: 0.1,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 2
        }
      },
      towers: {
        cannon: {
          id: "cannon",
          label: "Cannon",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 4,
          attack: {
            kind: "single",
            fireRate: 1,
            damagePerStack: 1,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 1
          }
        },
        pulse: {
          id: "pulse",
          label: "Pulse",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 4,
          attack: {
            kind: "pulse",
            pulseRate: 1,
            pulseDamage: 1,
            dotDamagePerUnit: 0,
            dotDuration: 0
          }
        }
      },
      waveSets: {
        one: [{
          id: "one",
          label: "One",
          groups: [{ enemyId: "boss", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        artifacts: {
          id: "artifacts",
          label: "Artifacts",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 0,
          mapId: "lane",
          waveSetId: "one",
          buildTowerIds: ["cannon", "pulse"],
          abilityIds: [],
          ...((mode === "unselected" || mode === "absent" || mode === "v1")
            ? {}
            : { mechanics: { profiles: { roguelite: "run" } } })
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 6,
        height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 5, r: 1 },
        pathCenterline: Array.from({ length: 6 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    ...(mode === "absent" ? {} : {
      mechanics: {
        schemaVersion: 1,
        modules: {
          roguelite: {
            schemaVersion: mode === "v1" ? 1 : mode === "future" ? 5 : 2,
            enabled: mode !== "disabled",
            profiles: { run: mode === "v1" ? { synergies: {} } : selectedProfile }
          }
        }
      }
    }),
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        biome: "test",
        accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        connections: []
      }],
      missionNodes: [{
        missionId: "artifacts",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function registry(options: Parameters<typeof rogueliteInput>[0] = {}): GameContentRegistry {
  return createGameContentRegistry(rogueliteInput(options));
}

function validate(options: Parameters<typeof rogueliteInput>[0] = {}): ValidationResult {
  return validateGameContentRegistry(registry(options));
}

function hasIssue(
  result: ValidationResult,
  severity: "error" | "warning",
  path: RegExp,
  message: RegExp = /./
): boolean {
  return result.issues.some((issue) => (
    issue.severity === severity && path.test(issue.fieldPath) && message.test(issue.message)
  ));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("R4.2A roguelite v2 artifact authoring contract", () => {
  it("publishes frozen v2 capability descriptors and the exact artifact budgets", () => {
    const exports = Engine as unknown as Record<string, unknown>;
    expect(exports.ROGUELITE_ARTIFACT_LIMITS).toEqual(EXPECTED_ARTIFACT_LIMITS);
    expect(Object.isFrozen(exports.ROGUELITE_ARTIFACT_LIMITS)).toBe(true);

    const descriptor = exports.ROGUELITE_MECHANICS_SCHEMA as {
      supportedModuleSchemaVersions?: readonly number[];
      profileVersions?: Record<string, unknown>;
      artifacts?: Record<string, unknown>;
      limits?: Record<string, unknown>;
    } | undefined;
    expect(descriptor?.supportedModuleSchemaVersions).toEqual([1, 2, 3, 4]);
    expect(descriptor?.profileVersions).toMatchObject({
      1: { requiredFields: ["synergies"], optionalFields: [], additionalProperties: false },
      2: { requiredFields: ["synergies", "artifacts"], optionalFields: [], additionalProperties: false },
      3: { requiredFields: ["synergies"], optionalFields: ["artifacts", "draft"], additionalProperties: false },
      4: { requiredFields: ["synergies"], optionalFields: ["artifacts", "draft", "campaign"], additionalProperties: false }
    });
    expect(descriptor?.artifacts).toMatchObject({
      requiredFields: ["definitions", "towerSlots", "bossLootTables"],
      optionalFields: [],
      additionalProperties: false,
      definition: {
        requiredFields: ["label", "slotType", "modifiers"],
        optionalFields: [],
        additionalProperties: false
      },
      towerSlot: {
        requiredFields: ["slotId", "slotType"],
        optionalFields: [],
        additionalProperties: false
      },
      lootTable: {
        requiredFields: ["rolls", "entries"],
        optionalFields: ["noDropWeight"],
        additionalProperties: false
      },
      lootEntry: {
        requiredFields: ["artifactId", "weight"],
        optionalFields: [],
        additionalProperties: false
      }
    });
    expect(descriptor?.limits).toMatchObject({ artifacts: EXPECTED_ARTIFACT_LIMITS });
  });

  it("accepts an exact active v2 profile while keeping v1 synergy-only content valid", () => {
    const v2 = registry();
    expect(validateGameContentRegistry(v2)).toEqual({ ok: true, issues: [] });
    expect(v2.missions.artifacts?.capabilities.roguelite).toMatchObject({
      available: true,
      active: true,
      reason: "active",
      profileId: "run"
    });

    expect(validate({ mode: "v1" })).toEqual({ ok: true, issues: [] });
  });

  it("rejects every closed v2 shape violation", () => {
    const cases = [
    ["missing artifacts", { synergies: {} }],
    ["extra profile field", { ...profile(), inventory: [] }],
    ["missing definitions", { synergies: {}, artifacts: { towerSlots: {}, bossLootTables: {} } }],
    ["missing towerSlots", { synergies: {}, artifacts: { definitions: {}, bossLootTables: {} } }],
    ["missing bossLootTables", { synergies: {}, artifacts: { definitions: {}, towerSlots: {} } }],
    ["extra artifacts field", { synergies: {}, artifacts: { ...validArtifacts(), future: true } }],
    ["extra definition field", (() => {
      const artifacts = validArtifacts();
      (artifacts.definitions as Record<string, Record<string, unknown>>).scope!.future = true;
      return profile(artifacts);
    })()],
    ["extra slot field", (() => {
      const artifacts = validArtifacts();
      (artifacts.towerSlots as Record<string, Record<string, unknown>[]>).cannon![0]!.future = true;
      return profile(artifacts);
    })()],
    ["extra loot table field", (() => {
      const artifacts = validArtifacts();
      (artifacts.bossLootTables as Record<string, Record<string, unknown>>).boss!.future = true;
      return profile(artifacts);
    })()],
    ["extra loot entry field", (() => {
      const artifacts = validArtifacts();
      const table = (artifacts.bossLootTables as Record<string, { entries: Record<string, unknown>[] }>).boss!;
      table.entries[0]!.future = true;
      return profile(artifacts);
    })()]
    ] as const;
    for (const [label, candidate] of cases) {
      const result = validate({ profile: candidate });
      expect(result.ok, label).toBe(false);
      expect(
        hasIssue(result, "error", /roguelite|artifact|definition|slot|loot|profile/i, /required|missing|unknown|closed|field/i),
        label
      ).toBe(true);
    }
  });

  it("keeps structural defects as errors but downgrades inactive broken references to warnings", () => {
    const semanticallyBroken = validArtifacts();
    semanticallyBroken.towerSlots = { ghost_tower: [{ slotId: "optic", slotType: "scope" }] };
    semanticallyBroken.bossLootTables = {
      ghost_boss: { rolls: 1, entries: [{ artifactId: "ghost_artifact", weight: 1 }] }
    };

    for (const mode of ["disabled", "unselected"] as const) {
      const result = validate({ mode, profile: profile(semanticallyBroken) });
      expect(result.ok, mode).toBe(true);
      expect(hasIssue(result, "error", /ghost_tower|ghost_boss|ghost_artifact/), mode).toBe(false);
      expect(hasIssue(result, "warning", /towerSlots\.ghost_tower|ghost_tower/i), mode).toBe(true);
      expect(hasIssue(result, "warning", /bossLootTables\.ghost_boss|ghost_boss/i), mode).toBe(true);
      expect(hasIssue(result, "warning", /ghost_artifact/i), mode).toBe(true);
    }

    const active = validate({ profile: profile(semanticallyBroken) });
    expect(active.ok).toBe(false);
    expect(hasIssue(active, "error", /towerSlots\.ghost_tower|ghost_tower/i)).toBe(true);
    expect(hasIssue(active, "error", /bossLootTables\.ghost_boss|ghost_boss/i)).toBe(true);
    expect(hasIssue(active, "error", /ghost_artifact/i)).toBe(true);

    const structurallyBroken = profile(validArtifacts());
    const definitions = (structurallyBroken.artifacts as Record<string, unknown>).definitions as Record<string, unknown>;
    definitions.scope = { label: "Scope", slotType: "scope", modifiers: [], extra: true };
    const inactive = validate({ mode: "disabled", profile: structurallyBroken });
    expect(inactive.ok).toBe(false);
    expect(hasIssue(inactive, "error", /definitions\.scope/i, /unknown|closed|field/i)).toBe(true);
  });

  it("rejects future v5 but treats its profile as opaque instead of applying v2 semantics", () => {
    const futureProfile = {
      futureOnlyPayload: {
        deliberatelyNotV2: true,
        artifacts: Object.defineProperty({}, "secret", {
          enumerable: true,
          get() {
            throw new Error("FUTURE_PROFILE_MUST_NOT_BE_TRAVERSED");
          }
        })
      }
    };
    const subject = registry({ mode: "future", profile: futureProfile });
    const result = validateGameContentRegistry(subject);
    expect(subject.missions.artifacts?.capabilities.roguelite).toMatchObject({
      active: false,
      reason: "module_version_unsupported"
    });
    expect(result.ok).toBe(false);
    expect(hasIssue(result, "error", /modules\.roguelite\.schemaVersion/i, /future|unsupported|version/i)).toBe(true);
    expect(result.issues.filter((issue) => /profiles\.run/i.test(issue.fieldPath))).toEqual([]);
    expect(result.issues.some((issue) => issue.message.includes("FUTURE_PROFILE_MUST_NOT_BE_TRAVERSED"))).toBe(false);
  });

  it("enforces every collection budget even while inactive", () => {
    const cases: readonly (readonly [string, () => Record<string, unknown>])[] = [
    ["definition count", () => {
      const artifacts = validArtifacts();
      artifacts.definitions = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [
        `artifact_${index}`,
        { label: `Artifact ${index}`, slotType: "scope", modifiers: [] }
      ]));
      return artifacts;
    }],
    ["slots per tower", () => {
      const artifacts = validArtifacts();
      artifacts.towerSlots = {
        cannon: Array.from({ length: 9 }, (_, index) => ({ slotId: `slot_${index}`, slotType: "scope" }))
      };
      return artifacts;
    }],
    ["total slots", () => {
      const artifacts = validArtifacts();
      artifacts.towerSlots = Object.fromEntries(Array.from({ length: 513 }, (_, towerIndex) => [
        `tower_${towerIndex}`,
        Array.from({ length: towerIndex === 512 ? 1 : 8 }, (_, slotIndex) => ({
          slotId: `slot_${slotIndex}`,
          slotType: "scope"
        }))
      ]));
      return artifacts;
    }],
    ["modifiers per artifact", () => {
      const artifacts = validArtifacts();
      (artifacts.definitions as Record<string, Record<string, unknown>>).scope!.modifiers = Array.from(
        { length: 9 },
        () => ({ target: "damage", operation: "flat", value: 1 })
      );
      return artifacts;
    }],
    ["total artifact modifiers", () => {
      const artifacts = validArtifacts();
      artifacts.definitions = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [
        `artifact_${index}`,
        {
          label: `Artifact ${index}`,
          slotType: "scope",
          modifiers: Array.from({ length: 8 }, () => ({ target: "damage", operation: "flat", value: 1 }))
        }
      ]));
      return artifacts;
    }],
    ["loot table count", () => {
      const artifacts = validArtifacts();
      artifacts.bossLootTables = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [
        `boss_${index}`,
        { rolls: 1, entries: [{ artifactId: "scope", weight: 1 }] }
      ]));
      return artifacts;
    }],
    ["roll count", () => {
      const artifacts = validArtifacts();
      (artifacts.bossLootTables as Record<string, Record<string, unknown>>).boss!.rolls = 9;
      return artifacts;
    }],
    ["entry count", () => {
      const artifacts = validArtifacts();
      (artifacts.bossLootTables as Record<string, Record<string, unknown>>).boss!.entries = Array.from(
        { length: 129 },
        () => ({ artifactId: "scope", weight: 1 })
      );
      return artifacts;
    }]
    ];
    for (const [label, build] of cases) {
      const result = validate({ mode: "disabled", profile: profile(build()) });
      expect(result.ok, label).toBe(false);
      expect(
        hasIssue(result, "error", /roguelite|artifact|definition|slot|modifier|loot|roll|entr/i, /limit|budget|exceed|many|maximum/i),
        label
      ).toBe(true);
    }
  });

  it("rejects invalid bounded scalars, identifiers, labels, and the closed damage-only modifier shape", () => {
    const cases: readonly (readonly [string, (artifacts: Record<string, unknown>) => void, RegExp])[] = [
    ["zero entry weight", (artifacts: Record<string, unknown>) => {
      const table = (artifacts.bossLootTables as Record<string, { entries: Record<string, unknown>[] }>).boss!;
      table.entries[0]!.weight = 0;
    }, /weight/i],
    ["fractional entry weight", (artifacts: Record<string, unknown>) => {
      const table = (artifacts.bossLootTables as Record<string, { entries: Record<string, unknown>[] }>).boss!;
      table.entries[0]!.weight = 1.5;
    }, /weight/i],
    ["entry weight above cap", (artifacts: Record<string, unknown>) => {
      const table = (artifacts.bossLootTables as Record<string, { entries: Record<string, unknown>[] }>).boss!;
      table.entries[0]!.weight = 1_000_001;
    }, /weight/i],
    ["negative no-drop weight", (artifacts: Record<string, unknown>) => {
      (artifacts.bossLootTables as Record<string, Record<string, unknown>>).boss!.noDropWeight = -1;
    }, /weight/i],
    ["fractional no-drop weight", (artifacts: Record<string, unknown>) => {
      (artifacts.bossLootTables as Record<string, Record<string, unknown>>).boss!.noDropWeight = 0.5;
    }, /weight/i],
    ["no-drop weight above cap", (artifacts: Record<string, unknown>) => {
      (artifacts.bossLootTables as Record<string, Record<string, unknown>>).boss!.noDropWeight = 1_000_001;
    }, /weight/i],
    ["future modifier target", (artifacts: Record<string, unknown>) => {
      (artifacts.definitions as Record<string, Record<string, unknown>>).scope!.modifiers = [
        { target: "range", operation: "flat", value: 1 }
      ];
    }, /modifier|target/i],
    ["runtime-only modifier fields", (artifacts: Record<string, unknown>) => {
      (artifacts.definitions as Record<string, Record<string, unknown>>).scope!.modifiers = [
        { id: "authored", stage: "run", target: "damage", operation: "flat", value: 1 }
      ];
    }, /modifier|id|stage/i]
    ];
    for (const [label, mutate, path] of cases) {
      const artifacts = clone(validArtifacts());
      mutate(artifacts);
      const result = validate({ mode: "disabled", profile: profile(artifacts) });
      expect(result.ok, label).toBe(false);
      expect(
        hasIssue(result, "error", path, /integer|positive|range|limit|unknown|closed|damage|target|field|1.?000.?000/i),
        label
      ).toBe(true);
    }

    const identifierCases: readonly (readonly [string, (artifacts: Record<string, unknown>) => void])[] = [
    ["artifact id", (artifacts: Record<string, unknown>) => {
      artifacts.definitions = { ["a".repeat(129)]: { label: "Long", slotType: "scope", modifiers: [] } };
    }],
    ["artifact label", (artifacts: Record<string, unknown>) => {
      (artifacts.definitions as Record<string, Record<string, unknown>>).scope!.label = "L".repeat(257);
    }],
    ["slot id", (artifacts: Record<string, unknown>) => {
      (artifacts.towerSlots as Record<string, Record<string, unknown>[]>).cannon![0]!.slotId = "s".repeat(129);
    }],
    ["slot type", (artifacts: Record<string, unknown>) => {
      (artifacts.towerSlots as Record<string, Record<string, unknown>[]>).cannon![0]!.slotType = "🔥".repeat(33);
    }]
    ];
    for (const [label, mutate] of identifierCases) {
      const artifacts = clone(validArtifacts());
      mutate(artifacts);
      const result = validate({ mode: "disabled", profile: profile(artifacts) });
      expect(result.ok, label).toBe(false);
      expect(
        hasIssue(result, "error", /artifact|definition|label|slot/i, /128|256|UTF-8|byte|length|limit/i),
        label
      ).toBe(true);
    }
  });
});
