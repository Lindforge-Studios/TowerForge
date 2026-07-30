import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "./registry.js";
import { validateGameContentRegistry, type ValidationResult } from "./validate.js";

const NAVIGATION_LIMITS_V1 = {
  movementProfiles: 32,
  enemyAssignments: 4_096,
  routeEndpointPairs: 64,
  uniqueGoals: 64,
  cachedProfileGoalPairs: 256,
  activeMapCells: 65_536,
  materializedFieldCells: 4_194_304,
  terrainOverridesPerProfile: 256,
  terrainOverridesAcrossProfiles: 8_192,
  terrainDefinitions: 256,
  terrainTagsPerDefinition: 64,
  terrainTagsAcrossDefinitions: 8_192,
  terrainTagUtf8Bytes: 128,
  terrainCost: 1_000_000,
  idUtf8Bytes: 128,
  labelLength: 128,
  liveEnemyStates: 16_384,
  placementAnalysisCoordinates: 4_096,
  placementAnalysisRelaxations: 8_388_608
} as const;

type NavigationProfileFixture = Readonly<Record<string, unknown>>;

interface NavigationFixtureOptions {
  enabled?: boolean;
  selected?: boolean;
  profileId?: string;
  moduleSchemaVersion?: number;
  profiles?: Record<string, NavigationProfileFixture>;
  terrainTypes?: GameContentInput["balance"]["terrainTypes"];
}

function authoredRoutesProfile(): NavigationProfileFixture {
  return { mode: "authored_routes" };
}

function dynamicFlowProfile(overrides: Record<string, unknown> = {}): NavigationProfileFixture {
  return {
    mode: "dynamic_flow",
    defaultMovementProfileId: "ground",
    movementProfiles: {
      ground: {
        label: "Ground",
        terrainMode: "respect_walkable",
        towerOccupancy: "blocked",
        defaultTerrainCost: 1_000
      }
    },
    ...overrides
  };
}

function navigationInput(options: NavigationFixtureOptions = {}): GameContentInput {
  const profileId = options.profileId ?? "maze";
  return {
    balance: {
      defaultMissionId: "navigation",
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
      terrainTypes: options.terrainTypes,
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt",
          label: "Grunt",
          maxHp: 20,
          speed: 0.2,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 1
        }
      },
      towers: {
        pelter: {
          id: "pelter",
          label: "Pelter",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 5,
          attack: {
            kind: "single",
            fireRate: 1,
            damagePerStack: 2,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 1
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
        navigation: {
          id: "navigation",
          label: "Navigation",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 0,
          mapId: "lane",
          waveSetId: "one",
          buildTowerIds: ["pelter"],
          abilityIds: [],
          ...(options.selected === false ? {} : {
            mechanics: { profiles: { navigation: profileId } }
          })
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 6,
        height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 5, r: 1 },
        pathCenterline: Array.from({ length: 6 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [{
          id: "main",
          pathCenterline: Array.from({ length: 6 }, (_, q) => ({ q, r: 1 }))
        }],
        terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        navigation: {
          schemaVersion: (options.moduleSchemaVersion ?? 1) as 1,
          enabled: options.enabled ?? true,
          profiles: options.profiles ?? { [profileId]: dynamicFlowProfile() }
        }
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
        missionId: "navigation",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
}

function validateNavigation(options: NavigationFixtureOptions = {}): {
  content: GameContentRegistry;
  result: ValidationResult;
} {
  const content = createGameContentRegistry(navigationInput(options));
  return { content, result: validateGameContentRegistry(content) };
}

function validateNavigationInput(input: GameContentInput): ValidationResult {
  return validateGameContentRegistry(createGameContentRegistry(input));
}

function hasIssue(
  result: ValidationResult,
  severity: "error" | "warning",
  path: RegExp,
  message: RegExp
): boolean {
  return result.issues.some((candidate) => (
    candidate.severity === severity
    && path.test(candidate.fieldPath)
    && message.test(candidate.message)
  ));
}

describe("R2.1 navigation module v1 capability contract", () => {
  it("publishes navigation as implemented with one closed bounded v1 descriptor", () => {
    expect(Engine.IMPLEMENTED_MECHANICS_MODULE_IDS).toEqual([
      "combat", "reactions", "navigation", "elevation", "physics", "terraforming", "roguelite", "heroes",
      "logistics", "director", "quests", "enemyBehaviors", "multiplayer"
    ]);

    const exports = Engine as unknown as {
      NAVIGATION_LIMITS?: unknown;
      NAVIGATION_MECHANICS_SCHEMA?: unknown;
    };
    expect(exports.NAVIGATION_LIMITS).toEqual(NAVIGATION_LIMITS_V1);
    expect(exports.NAVIGATION_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 1,
      moduleId: "navigation",
      supportedModuleSchemaVersions: [1],
      profile: {
        additionalProperties: false,
        discriminator: "mode",
        modes: {
          authored_routes: {
            requiredFields: ["mode"],
            optionalFields: []
          },
          dynamic_flow: {
            requiredFields: ["mode", "defaultMovementProfileId", "movementProfiles"],
            optionalFields: ["enemyMovementProfiles"]
          }
        }
      },
      limits: NAVIGATION_LIMITS_V1,
      runtimeSnapshot: {
        path: "snapshot.navigation",
        schemaVersion: 1,
        modes: ["dynamic_flow"],
        optionalUnlessActiveDynamicFlow: true
      }
    });
  });

  it("deep-freezes every public navigation descriptor array", () => {
    const schema = Engine.NAVIGATION_MECHANICS_SCHEMA as unknown as {
      supportedModuleSchemaVersions: number[];
      profile: {
        modes: {
          authored_routes: { requiredFields: string[]; optionalFields: string[] };
          dynamic_flow: { requiredFields: string[]; optionalFields: string[] };
        };
      };
      runtimeSnapshot: { modes: string[] };
    };
    const before = JSON.stringify(schema);
    const arrays = [
      schema.supportedModuleSchemaVersions,
      schema.profile.modes.authored_routes.requiredFields,
      schema.profile.modes.authored_routes.optionalFields,
      schema.profile.modes.dynamic_flow.requiredFields,
      schema.profile.modes.dynamic_flow.optionalFields,
      schema.runtimeSnapshot.modes
    ];

    expect(arrays.every(Object.isFrozen)).toBe(true);
    for (const value of arrays) {
      expect(() => value.push("corrupt" as never)).toThrow(TypeError);
    }
    expect(JSON.stringify(schema)).toBe(before);
  });

  it("resolves absent, disabled, unselected, missing, future, authored, and dynamic states through the normal gates", () => {
    expect(Engine.resolveCapabilitySet({ schemaVersion: 1, modules: {} }).navigation).toMatchObject({
      available: true,
      active: false,
      reason: "module_missing"
    });

    const catalog = navigationInput().mechanics!;
    expect(Engine.resolveCapabilitySet(catalog, {}).navigation).toMatchObject({
      available: true,
      active: false,
      reason: "not_selected"
    });
    expect(Engine.resolveCapabilitySet(catalog, {
      profiles: { navigation: "missing" }
    }).navigation).toMatchObject({ available: true, active: false, reason: "profile_missing" });

    const disabled = navigationInput({ enabled: false }).mechanics!;
    expect(Engine.resolveCapabilitySet(disabled, {
      profiles: { navigation: "maze" }
    }).navigation).toMatchObject({ available: true, active: false, reason: "module_disabled" });

    const future = navigationInput({ moduleSchemaVersion: 2 }).mechanics!;
    expect(Engine.resolveCapabilitySet(future, {
      profiles: { navigation: "maze" }
    }).navigation).toMatchObject({
      available: true,
      active: false,
      profileId: "maze",
      reason: "module_version_unsupported"
    });

    for (const profile of [authoredRoutesProfile(), dynamicFlowProfile()]) {
      const selected = navigationInput({ profiles: { maze: profile } }).mechanics!;
      expect(Engine.resolveCapabilitySet(selected, {
        profiles: { navigation: "maze" }
      }).navigation).toEqual({
        moduleId: "navigation",
        available: true,
        moduleEnabled: true,
        active: true,
        profileId: "maze",
        reason: "active"
      });
    }
  });

  it("accepts only the exact authored_routes and dynamic_flow discriminated shapes", () => {
    expect(validateNavigation({ profiles: { authored: authoredRoutesProfile() }, profileId: "authored" }).result)
      .toMatchObject({ ok: true, issues: [] });
    expect(validateNavigation().result).toMatchObject({ ok: true, issues: [] });

    const missingRequired = validateNavigation({
      profiles: { maze: { mode: "dynamic_flow", movementProfiles: {} } }
    }).result;
    expect(missingRequired.ok).toBe(false);
    expect(hasIssue(
      missingRequired,
      "error",
      /navigation.*defaultMovementProfileId|defaultMovementProfileId/i,
      /required|string|movement profile/i
    )).toBe(true);

    for (const profile of [
      { mode: "authored_routes", movementProfiles: {} },
      { ...dynamicFlowProfile(), unexpected: true },
      { ...dynamicFlowProfile(), mode: "teleport" }
    ]) {
      const result = validateNavigation({ enabled: false, profiles: { maze: profile } }).result;
      expect(result.ok).toBe(false);
      expect(hasIssue(result, "error", /navigation|profiles\.maze|mode|unexpected/i, /unknown|closed|mode|unsupported/i)).toBe(true);
    }
  });

  it("downgrades inactive cross-references to warnings but keeps them blocking when active", () => {
    const broken = dynamicFlowProfile({
      defaultMovementProfileId: "missing_default",
      enemyMovementProfiles: { ghost: "missing_assignment", grunt: "missing_assignment" },
      movementProfiles: {
        ground: {
          label: "Ground",
          terrainMode: "respect_walkable",
          towerOccupancy: "blocked",
          defaultTerrainCost: 1_000,
          terrainCosts: { missing_terrain: 2_000 }
        }
      }
    });

    const active = validateNavigation({ profiles: { maze: broken } }).result;
    expect(active.ok).toBe(false);
    expect(hasIssue(active, "error", /defaultMovementProfileId/i, /missing_default|unknown/i)).toBe(true);
    expect(hasIssue(active, "error", /enemyMovementProfiles/i, /ghost|unknown enemy/i)).toBe(true);
    expect(hasIssue(active, "error", /terrainCosts/i, /missing_terrain|unknown terrain/i)).toBe(true);

    for (const inactive of [
      validateNavigation({ enabled: false, profiles: { maze: broken } }).result,
      validateNavigation({ selected: false, profiles: { maze: broken } }).result
    ]) {
      expect(inactive.ok).toBe(true);
      expect(inactive.issues.some((candidate) => candidate.severity === "error")).toBe(false);
      expect(hasIssue(inactive, "warning", /navigation|defaultMovementProfileId|enemyMovementProfiles|terrainCosts/i, /missing|unknown|inactive|unselected/i)).toBe(true);
    }
  });

  it("rejects future versions, unsafe fields, numeric limits, and budgets even while disabled", () => {
    const future = validateNavigation({ enabled: false, moduleSchemaVersion: 2 }).result;
    expect(future.ok).toBe(false);
    expect(hasIssue(future, "error", /navigation.*schemaVersion|schemaVersion/i, /future|supported|version|1/i)).toBe(true);

    let getterCalls = 0;
    const hostileProfile = Object.defineProperty({}, "mode", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("SECRET_NAVIGATION_ACCESSOR_PAYLOAD");
      }
    });
    const hostile = validateNavigation({
      enabled: false,
      profiles: { maze: hostileProfile }
    }).result;
    expect(getterCalls).toBe(0);
    expect(hostile.ok).toBe(false);
    expect(JSON.stringify(hostile)).not.toContain("SECRET_NAVIGATION_ACCESSOR_PAYLOAD");
    expect(hasIssue(hostile, "error", /navigation|profiles\.maze|mode/i, /own data|accessor|inspect|plain object/i)).toBe(true);

    const tooManyProfiles = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [
      `profile_${index}`,
      authoredRoutesProfile()
    ]));
    const profileBudget = validateNavigation({ enabled: false, profiles: tooManyProfiles }).result;
    expect(profileBudget.ok).toBe(false);
    expect(hasIssue(profileBudget, "error", /navigation.*profiles|profiles/i, /32|budget|limit|maximum/i)).toBe(true);

    for (const cost of [0, -1, 1.5, Number.POSITIVE_INFINITY, 1_000_001]) {
      const result = validateNavigation({
        enabled: false,
        profiles: {
          maze: dynamicFlowProfile({
            movementProfiles: {
              ground: {
                label: "Ground",
                terrainMode: "respect_walkable",
                towerOccupancy: "blocked",
                defaultTerrainCost: cost
              }
            }
          })
        }
      }).result;
      expect(result.ok).toBe(false);
      expect(hasIssue(result, "error", /defaultTerrainCost/i, /integer|1,?000,?000|cost|finite|range/i)).toBe(true);
    }
  });

  it("enforces active dynamic map, endpoint, goal, and profile-goal budgets during content validation", () => {
    const overCellBudget = navigationInput();
    overCellBudget.maps.lane!.width = NAVIGATION_LIMITS_V1.activeMapCells + 1;
    const cellsResult = validateNavigationInput(overCellBudget);
    expect.soft(cellsResult.ok).toBe(false);
    expect.soft(hasIssue(
      cellsResult,
      "error",
      /navigation|map|dimensions|cells/i,
      /65,?536|cell|budget|limit|maximum/i
    )).toBe(true);

    const overRouteBudget = navigationInput();
    const routeMap = overRouteBudget.maps.lane!;
    routeMap.pathRoutes = Array.from(
      { length: NAVIGATION_LIMITS_V1.routeEndpointPairs + 1 },
      (_, index) => ({
        id: index === 0 ? "main" : `route_${index}`,
        pathCenterline: routeMap.pathCenterline.map((coord) => ({ ...coord }))
      })
    );
    const routesResult = validateNavigationInput(overRouteBudget);
    expect.soft(routesResult.ok).toBe(false);
    expect.soft(hasIssue(
      routesResult,
      "error",
      /navigation|pathRoutes|routes/i,
      /64|endpoint|route|budget|limit|maximum/i
    )).toBe(true);

    const overGoalBudget = navigationInput();
    const goalMap = overGoalBudget.maps.lane!;
    goalMap.width = NAVIGATION_LIMITS_V1.uniqueGoals + 1;
    goalMap.height = 2;
    goalMap.spawnCoord = { q: 0, r: 0 };
    goalMap.coreCoord = { q: 0, r: 1 };
    goalMap.pathCenterline = [{ q: 0, r: 0 }, { q: 0, r: 1 }];
    goalMap.pathRoutes = Array.from(
      { length: NAVIGATION_LIMITS_V1.uniqueGoals + 1 },
      (_, q) => ({ id: q === 0 ? "main" : `goal_${q}`, pathCenterline: [{ q, r: 0 }, { q, r: 1 }] })
    );
    const goalsResult = validateNavigationInput(overGoalBudget);
    expect.soft(goalsResult.ok).toBe(false);
    expect.soft(hasIssue(
      goalsResult,
      "error",
      /navigation|pathRoutes|goals/i,
      /64|goal|budget|limit|maximum/i
    )).toBe(true);

    const overPairBudget = navigationInput();
    const pairMap = overPairBudget.maps.lane!;
    pairMap.width = 16;
    pairMap.height = 2;
    pairMap.spawnCoord = { q: 0, r: 0 };
    pairMap.coreCoord = { q: 0, r: 1 };
    pairMap.pathCenterline = [{ q: 0, r: 0 }, { q: 0, r: 1 }];
    pairMap.pathRoutes = Array.from(
      { length: 16 },
      (_, q) => ({ id: q === 0 ? "main" : `goal_${q}`, pathCenterline: [{ q, r: 0 }, { q, r: 1 }] })
    );
    const profiles = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [
      index === 0 ? "ground" : `profile_${index}`,
      {
        label: `Profile ${index}`,
        terrainMode: "respect_walkable",
        towerOccupancy: "blocked",
        defaultTerrainCost: 1_000
      }
    ]));
    const module = overPairBudget.mechanics!.modules.navigation! as unknown as {
      profiles: Record<string, Record<string, unknown>>;
    };
    module.profiles.maze!.movementProfiles = profiles;
    const pairsResult = validateNavigationInput(overPairBudget);
    expect.soft(pairsResult.ok).toBe(false);
    expect.soft(hasIssue(
      pairsResult,
      "error",
      /navigation|movementProfiles|pathRoutes|goals/i,
      /256|profile.goal|pair|product|field|budget|limit|maximum/i
    )).toBe(true);
  });

  it("enforces the solver terrain budgets while dynamic navigation is active", () => {
    const defaultTerrainTypes = createGameContentRegistry(navigationInput()).terrainTypes;
    const validateTerrainTypes = (
      terrainTypes: NonNullable<GameContentInput["balance"]["terrainTypes"]>
    ): ValidationResult => validateNavigationInput(navigationInput({ terrainTypes }));

    const extraDefinitionCount = NAVIGATION_LIMITS_V1.terrainDefinitions
      - Object.keys(defaultTerrainTypes).length
      + 1;
    const tooManyDefinitions = {
      ...defaultTerrainTypes,
      ...Object.fromEntries(Array.from({ length: extraDefinitionCount }, (_, index) => [
        `extra_${index}`,
        {
          id: `extra_${index}`,
          label: `Extra ${index}`,
          buildable: true,
          walkable: true,
          groundSpeedMultiplier: 1,
          tags: []
        }
      ]))
    };
    const definitionsResult = validateTerrainTypes(tooManyDefinitions);
    expect.soft(definitionsResult.ok).toBe(false);
    expect.soft(hasIssue(
      definitionsResult,
      "error",
      /navigation|terrainTypes|terrain/i,
      /256|definition|budget|limit|maximum/i
    )).toBe(true);

    for (const legacyOrInactive of [
      navigationInput({ terrainTypes: tooManyDefinitions, selected: false }),
      navigationInput({ terrainTypes: tooManyDefinitions, enabled: false }),
      navigationInput({
        terrainTypes: tooManyDefinitions,
        profiles: { maze: authoredRoutesProfile() }
      })
    ]) {
      expect.soft(validateNavigationInput(legacyOrInactive)).toMatchObject({ ok: true, issues: [] });
    }

    const tooManyTags = Array.from(
      { length: NAVIGATION_LIMITS_V1.terrainTagsPerDefinition + 1 },
      (_, index) => `tag_${index}`
    );
    const tagsResult = validateTerrainTypes({
      ...defaultTerrainTypes,
      buildable: { ...defaultTerrainTypes.buildable!, tags: tooManyTags }
    });
    expect.soft(tagsResult.ok).toBe(false);
    expect.soft(hasIssue(
      tagsResult,
      "error",
      /navigation|terrainTypes|terrain|tags/i,
      /64|tag|budget|limit|maximum/i
    )).toBe(true);

    const totalTagsTerrainTypes = {
      ...defaultTerrainTypes,
      ...Object.fromEntries(Array.from({ length: 129 }, (_, terrainIndex) => {
        const terrainId = `tagged_${terrainIndex}`;
        return [terrainId, {
          id: terrainId,
          label: `Tagged ${terrainIndex}`,
          buildable: true,
          walkable: true,
          groundSpeedMultiplier: 1,
          tags: Array.from(
            { length: NAVIGATION_LIMITS_V1.terrainTagsPerDefinition },
            (_, tagIndex) => `t${terrainIndex}_${tagIndex}`
          )
        }];
      }))
    };
    const totalTagsResult = validateTerrainTypes(totalTagsTerrainTypes);
    expect.soft(totalTagsResult.ok).toBe(false);
    expect.soft(hasIssue(
      totalTagsResult,
      "error",
      /navigation|terrainTypes|terrain|tags/i,
      /8,?192|total.tag|budget|limit|maximum/i
    )).toBe(true);

    const overlongTag = "é".repeat(Math.floor(NAVIGATION_LIMITS_V1.terrainTagUtf8Bytes / 2) + 1);
    const tagBytesResult = validateTerrainTypes({
      ...defaultTerrainTypes,
      buildable: { ...defaultTerrainTypes.buildable!, tags: [overlongTag] }
    });
    expect.soft(tagBytesResult.ok).toBe(false);
    expect.soft(hasIssue(
      tagBytesResult,
      "error",
      /navigation|terrainTypes|terrain|tags/i,
      /128|UTF-?8|byte|budget|limit|maximum/i
    )).toBe(true);

    const overlongTerrainId = "t".repeat(NAVIGATION_LIMITS_V1.idUtf8Bytes + 1);
    const terrainIdResult = validateTerrainTypes({
      ...defaultTerrainTypes,
      [overlongTerrainId]: {
        id: overlongTerrainId,
        label: "Long terrain id",
        buildable: true,
        walkable: true,
        groundSpeedMultiplier: 1,
        tags: []
      }
    });
    expect.soft(terrainIdResult.ok).toBe(false);
    expect.soft(hasIssue(
      terrainIdResult,
      "error",
      /navigation|terrainTypes|terrain|id/i,
      /128|terrain.+id|UTF-?8|byte|budget|limit|maximum/i
    )).toBe(true);

    const longLabelResult = validateTerrainTypes({
      ...defaultTerrainTypes,
      buildable: {
        ...defaultTerrainTypes.buildable!,
        label: "L".repeat(NAVIGATION_LIMITS_V1.labelLength + 1)
      }
    });
    expect.soft(longLabelResult.ok).toBe(false);
    expect.soft(hasIssue(
      longLabelResult,
      "error",
      /navigation|terrainTypes|terrain|label/i,
      /128|label|character|budget|limit|maximum/i
    )).toBe(true);
  });
});
