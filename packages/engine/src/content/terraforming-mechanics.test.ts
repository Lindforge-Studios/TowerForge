import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "./registry.js";
import { validateGameContentRegistry } from "./validate.js";
import type { TowerScriptDiagnostic } from "../scripting/types.js";

const TERRAFORMING_LIMITS_V1 = Object.freeze({
  transitionDefinitions: 64,
  sourceTagsPerTransition: 8,
  sourceTagsAcrossProfile: 512,
  idOrTagUtf8Bytes: 128,
  operationsPerBatch: 64,
  operationsPerScriptTransaction: 64,
  distinctCellsPerBatch: 64,
  activeTerrainOverrides: 512,
  activeElevationOverrides: 512,
  activeOverridesCombined: 1_024,
  elevationMinimum: -1_000_000,
  elevationMaximum: 1_000_000,
  maximumElevationDeltaPerOperation: 64,
  duration: 1_000_000_000,
  safetySourcesPerTransaction: 16_384,
  profileGoalFieldsPerTransaction: 256,
  fieldCellsBaselineAndCandidate: 8_388_608,
  pendingExpiryGroups: 512
});

type FixtureOptions = {
  enabled?: boolean;
  selected?: boolean;
  includeElevationSelection?: boolean;
  moduleSchemaVersion?: number;
  profile?: Record<string, unknown>;
  additionalProfiles?: Record<string, Record<string, unknown>>;
  scriptTransitionId?: string;
};

function input(options: FixtureOptions = {}): GameContentInput {
  const mechanics = {
    schemaVersion: 1,
    modules: {
      terraforming: {
        schemaVersion: options.moduleSchemaVersion ?? 1,
        enabled: options.enabled ?? true,
        profiles: {
          mutable: options.profile ?? {
            terrainTransitions: {
              flood: { fromTerrainTags: ["floodable"], toTerrainId: "water" }
            }
          },
          ...(options.additionalProfiles ?? {})
        }
      },
      elevation: {
        schemaVersion: 1,
        enabled: true,
        profiles: { authored: {} }
      }
    }
  } as never;
  return {
    balance: {
      defaultMissionId: "terraform",
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
          groundSpeedMultiplier: 1, tags: ["floodable"]
        },
        water: {
          id: "water", label: "Water", buildable: false, walkable: true,
          groundSpeedMultiplier: 0.5, tags: ["wet"]
        }
      },
      abilities: {},
      enemies: {
        walker: {
          id: "walker", label: "Walker", maxHp: 10, speed: 1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 0
        }
      },
      towers: {},
      waveSets: {
        one: [{
          id: "one", label: "One",
          groups: [{ enemyId: "walker", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        terraform: {
          id: "terraform",
          label: "Terraform",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 20 },
          prepTimeUnits: 0,
          mapId: "lane",
          waveSetId: "one",
          buildTowerIds: [],
          abilityIds: [],
          ...(options.selected === false ? {} : {
            mechanics: {
              profiles: {
                terraforming: "mutable",
                ...(options.includeElevationSelection ? { elevation: "authored" } : {})
              }
            } as never
          })
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 3,
        height: 2,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 0 },
        coreCoord: { q: 2, r: 0 },
        pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }],
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    mechanics,
    ...(options.scriptTransitionId === undefined ? {} : {
      scripts: {
        terraform_script: {
          schemaVersion: 6,
          id: "terraform_script",
          bindings: [{ scope: "mission", ids: ["terraform"] }],
          handlers: {
            signal: [{
              actions: [{
                action: "terraformTiles",
                operations: [{
                  kind: "set_terrain",
                  target: { q: 1, r: 1 },
                  transitionId: options.scriptTransitionId
                }]
              }]
            }]
          }
        }
      } as never
    }),
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "terraform", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
}

function content(options: FixtureOptions = {}): GameContentRegistry {
  return createGameContentRegistry(input(options));
}

describe("R3.4b terraforming mechanics v1 foundation", () => {
  it("publishes an independent implemented module with the exact closed profile and limits", () => {
    const exported = Engine as unknown as Record<string, unknown>;
    expect(Engine.MECHANICS_MODULE_IDS).toContain("terraforming");
    expect(Engine.IMPLEMENTED_MECHANICS_MODULE_IDS).toContain("terraforming");
    expect(exported.TERRAFORMING_LIMITS).toEqual(TERRAFORMING_LIMITS_V1);
    expect(exported.TERRAFORMING_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 1,
      moduleId: "terraforming",
      supportedModuleSchemaVersions: [1],
      profile: {
        requiredFields: [],
        optionalFields: ["terrainTransitions", "elevation"],
        additionalProperties: false,
        terrainTransition: {
          requiredFields: ["fromTerrainTags", "toTerrainId"],
          optionalFields: [],
          additionalProperties: false,
          sourceTagSemantics: "any"
        },
        elevation: {
          requiredFields: ["minimum", "maximum", "maximumDeltaPerOperation"],
          optionalFields: [],
          additionalProperties: false
        }
      },
      limits: TERRAFORMING_LIMITS_V1,
      dependencies: {
        terrain: "independent",
        elevation: {
          moduleId: "elevation",
          supportedModuleSchemaVersions: [1, 2, 3],
          requiresProfilePolicy: "elevation"
        }
      },
      towerScript: {
        minimumSchemaVersion: 6,
        action: "terraformTiles",
        event: "elevationChanged"
      },
      failureReasons: [
        "terraform.invalid_operation",
        "terraform.operation_budget_exceeded",
        "terraform.duplicate_target",
        "terraform.target_outside_map",
        "terraform.transition_missing",
        "terraform.transition_source_tag_mismatch",
        "terraform.elevation_dependency_missing",
        "terraform.elevation_policy_missing",
        "terraform.elevation_out_of_range",
        "terraform.elevation_delta_exceeded",
        "terraform.override_budget_exceeded",
        "terraform.duration_out_of_range",
        "terraform.expiry_group_budget_exceeded",
        "terraform.target_owned",
        "terraform.authored_route_unavailable",
        "terraform.last_authored_route_blocked",
        "terraform.navigation_unavailable",
        "terraform.last_path_blocked",
        "terraform.solver_budget_exceeded"
      ],
      runtimeSnapshot: {
        path: "snapshot.terraforming",
        schemaVersion: 1,
        optionalUnlessActive: true
      }
    });
  });

  it("resolves all capability gates without coupling terraforming to physics", () => {
    const catalog = input().mechanics!;
    const available = [...Engine.IMPLEMENTED_MECHANICS_MODULE_IDS, "terraforming"] as never;
    expect(Engine.resolveCapabilitySet({ schemaVersion: 1, modules: {} }, {}, available).terraforming)
      .toMatchObject({ available: true, active: false, reason: "module_missing" });
    expect(Engine.resolveCapabilitySet(catalog, {}, available).terraforming)
      .toMatchObject({ available: true, active: false, reason: "not_selected" });
    expect(Engine.resolveCapabilitySet(
      input({ enabled: false }).mechanics!,
      { profiles: { terraforming: "mutable" } } as never,
      available
    ).terraforming).toMatchObject({ active: false, reason: "module_disabled" });
    expect(Engine.resolveCapabilitySet(
      input({ moduleSchemaVersion: 2 }).mechanics!,
      { profiles: { terraforming: "mutable" } } as never,
      available
    ).terraforming).toMatchObject({ active: false, reason: "module_version_unsupported" });
    expect(Engine.resolveCapabilitySet(
      catalog,
      { profiles: { terraforming: "mutable" } } as never,
      available
    ).terraforming).toEqual({
      moduleId: "terraforming",
      available: true,
      moduleEnabled: true,
      active: true,
      profileId: "mutable",
      reason: "active"
    });
  });

  it("keeps profile transition ids byte-bounded while accepting authored UTF-8 names verbatim", () => {
    const transition = { fromTerrainTags: ["floodable"], toTerrainId: "water" };
    for (const transitionId of ["flood stage", "я".repeat(64)]) {
      expect(() => Engine.normalizeTerraformingProfileV1({
        terrainTransitions: { [transitionId]: transition }
      })).not.toThrow();
    }
    for (const transitionId of ["", "x".repeat(129)]) {
      expect(() => Engine.normalizeTerraformingProfileV1({
        terrainTransitions: { [transitionId]: transition }
      })).toThrow(/1\.\.128 UTF-8 bytes/i);
    }

    const integrated = validateGameContentRegistry(content({
      profile: { terrainTransitions: { "flood stage": transition } },
      scriptTransitionId: "flood stage"
    }));
    expect(integrated.issues.filter((issue) => (
      issue.severity === "error"
      && /transitionId|transition.*flood stage/i.test(`${issue.fieldPath} ${issue.message}`)
    ))).toEqual([]);
  });

  it("enforces closed profile cardinality and elevation limits at their exact boundaries", () => {
    const transition = (fromTerrainTags: string[]) => ({ fromTerrainTags, toTerrainId: "water" });
    const transitions = (count: number, tagsPerTransition: number) => Object.fromEntries(
      Array.from({ length: count }, (_, transitionIndex) => [
        `transition_${transitionIndex}`,
        transition(Array.from({ length: tagsPerTransition }, (_, tagIndex) => `tag_${transitionIndex}_${tagIndex}`))
      ])
    );
    const normalize = (profile: Record<string, unknown>) => Engine.normalizeTerraformingProfileV1(profile);

    expect(() => normalize({ terrainTransitions: transitions(64, 1) })).not.toThrow();
    expect(() => normalize({ terrainTransitions: transitions(65, 1) })).toThrow(/64.*transition/i);
    expect(() => normalize({ terrainTransitions: transitions(1, 8) })).not.toThrow();
    expect(() => normalize({ terrainTransitions: transitions(1, 9) })).toThrow(/1\.\.8|8.*tag/i);
    expect(() => normalize({ terrainTransitions: transitions(64, 8) })).not.toThrow();
    expect(() => normalize({
      terrainTransitions: {
        ...transitions(63, 8),
        transition_63: transition(Array.from({ length: 9 }, (_, index) => `aggregate_63_${index}`))
      }
    })).toThrow(/8|512|tag|limit/i);

    expect(() => normalize({
      elevation: { minimum: -1_000_000, maximum: 1_000_000, maximumDeltaPerOperation: 64 }
    })).not.toThrow();
    for (const [field, elevation] of [
      ["minimum", { minimum: -1_000_001, maximum: 1_000_000, maximumDeltaPerOperation: 64 }],
      ["maximum", { minimum: -1_000_000, maximum: 1_000_001, maximumDeltaPerOperation: 64 }],
      ["maximumDeltaPerOperation", { minimum: -1_000_000, maximum: 1_000_000, maximumDeltaPerOperation: 65 }]
    ] as const) {
      expect(() => normalize({ elevation })).toThrow(new RegExp(field, "i"));
    }
  });

  it("keeps shapes structural but downgrades inactive cross-references to warnings", () => {
    const broken = {
      terrainTransitions: {
        flood: { fromTerrainTags: ["missing_tag"], toTerrainId: "missing_terrain" }
      }
    };
    const active = validateGameContentRegistry(content({ profile: broken }));
    expect(active.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        fieldPath: expect.stringMatching(/terraforming.*terrainTransitions.*flood/i),
        message: expect.stringMatching(/missing_tag|missing_terrain|unknown/i)
      })
    ]));

    const inactive = validateGameContentRegistry(content({ enabled: false, profile: broken }));
    expect(inactive.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "warning",
        fieldPath: expect.stringMatching(/terraforming.*terrainTransitions.*flood/i),
        message: expect.stringMatching(/missing_tag|missing_terrain|unknown|inactive/i)
      })
    ]));
    expect(inactive.issues.some((issue) => (
      issue.severity === "error" && /missing_tag|missing_terrain/i.test(issue.message)
    ))).toBe(false);
  });

  it("requires active elevation only when the active profile authors elevation operations", () => {
    const elevationPolicy = {
      terrainTransitions: {},
      elevation: { minimum: -4, maximum: 4, maximumDeltaPerOperation: 2 }
    };
    const missingDependency = validateGameContentRegistry(content({ profile: elevationPolicy }));
    expect(missingDependency.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/terraforming.*elevation|mechanics.*elevation/i),
      message: expect.stringMatching(/active.*elevation|dependency/i)
    }));

    const selectedDependency = validateGameContentRegistry(content({
      profile: elevationPolicy,
      includeElevationSelection: true
    }));
    expect(selectedDependency.issues.some((issue) => (
      issue.severity === "error" && /dependency|active.*elevation/i.test(issue.message)
    ))).toBe(false);

    const disabled = validateGameContentRegistry(content({
      enabled: false,
      profile: elevationPolicy
    }));
    const disabledDependencyIssues = disabled.issues.filter((issue) => (
      /terraforming.*elevation|active.*elevation|dependency/i.test(`${issue.fieldPath} ${issue.message}`)
    ));
    expect(disabledDependencyIssues.some((issue) => issue.severity === "error")).toBe(false);
    expect(disabledDependencyIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "warning" })
    ]));

    const unselected = validateGameContentRegistry(content({
      selected: false,
      profile: elevationPolicy
    }));
    expect(unselected.issues.some((issue) => (
      issue.severity === "error"
      && /terraforming.*elevation|active.*elevation|dependency/i.test(`${issue.fieldPath} ${issue.message}`)
    ))).toBe(false);
  });

  it("rejects unknown profile fields and accessor-backed transition data without executing it", () => {
    let getterCalls = 0;
    const hostileTransition = Object.defineProperties({}, {
      fromTerrainTags: { value: ["floodable"], enumerable: true },
      toTerrainId: {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error("SECRET_TERRAFORM_GETTER");
        }
      }
    });
    const result = validateGameContentRegistry(content({
      enabled: false,
      profile: {
        terrainTransitions: { flood: hostileTransition },
        unexpected: true
      }
    }));
    expect(getterCalls).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringMatching(/closed|unknown field|own data|accessor/i) })
    ]));
    expect(JSON.stringify(result.issues)).not.toContain("SECRET_TERRAFORM_GETTER");
  });

  it("classifies script transition references by applicable mission activation", () => {
    const inactiveCases = [
      content({ enabled: false, scriptTransitionId: "flood" }),
      content({ selected: false, scriptTransitionId: "flood" }),
      content({ selected: false, scriptTransitionId: "never_authored" })
    ];
    for (const candidate of inactiveCases) {
      const result = validateGameContentRegistry(candidate);
      const transitionIssues = result.issues.filter((issue) => (
        issue.entityKind === "script"
        && /transition/i.test(`${issue.fieldPath} ${issue.message}`)
      ));
      expect(transitionIssues.some((issue) => issue.severity === "error")).toBe(false);
      expect(transitionIssues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          message: expect.stringMatching(/inactive|unselected|not active|unknown/i)
        })
      ]));
    }

    const activeUnknown = validateGameContentRegistry(content({ scriptTransitionId: "never_authored" }));
    expect(activeUnknown.issues).toContainEqual(expect.objectContaining({
      entityKind: "script",
      severity: "error",
      fieldPath: expect.stringMatching(/transitionId/i),
      message: expect.stringMatching(/unknown.*transition/i)
    }));
  });

  it("does not borrow a transition from a different unselected profile", () => {
    const result = validateGameContentRegistry(content({
      profile: {
        terrainTransitions: {
          flood: { fromTerrainTags: ["floodable"], toTerrainId: "water" }
        }
      },
      additionalProfiles: {
        alternate: {
          terrainTransitions: {
            collapse: { fromTerrainTags: ["floodable"], toTerrainId: "water" }
          }
        }
      },
      scriptTransitionId: "collapse"
    }));
    expect(result.issues).toContainEqual(expect.objectContaining({
      entityKind: "script",
      severity: "error",
      fieldPath: expect.stringMatching(/transitionId/i),
      message: expect.stringMatching(/unknown.*transition.*active.*profile/i)
    }));
  });

  it("publishes the optional stable reasonKey in TowerScript diagnostic discovery", () => {
    const descriptor = Engine.TOWER_SCRIPT_SCHEMA as unknown as Record<string, unknown>;
    expect(descriptor.diagnostic).toEqual({
      requiredFields: ["scriptId", "event", "code", "message"],
      optionalFields: ["handlerId", "reasonKey"],
      additionalProperties: false
    });
    const diagnostic = {
      scriptId: "terraform_script",
      event: "signal",
      code: "invalid_action",
      message: "Rejected transaction.",
      reasonKey: "terraform.last_path_blocked"
    } satisfies TowerScriptDiagnostic;
    expect(diagnostic.reasonKey).toBe("terraform.last_path_blocked");
  });
});
