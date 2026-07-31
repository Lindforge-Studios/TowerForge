import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { createGameContentRegistry, type GameContentInput } from "./registry.js";
import { validateGameContentRegistry } from "./validate.js";

const LIMITS = Object.freeze({
  definitionsPerProfile: 256,
  placementsPerMap: 4_096,
  idUtf8Bytes: 128,
  maxHp: 1_000_000_000,
  maximumBlockerHeight: 1_000_000,
  objectsPerCell: 1
});

function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    maxHp: 200,
    hitRegion: { kind: "tile", blockerHeight: 3, blocksLineOfSight: true },
    armorTypeId: "stone",
    onDestroyed: { terrainTransitionId: "destroy_gate" },
    ...overrides
  };
}

function profile(definitions: Record<string, unknown> = { gate: definition() }): Record<string, unknown> {
  return {
    projectiles: {
      towers: { cannon: { trajectory: "direct", travelTimeUnits: 0.4 } },
      destructibles: { definitions }
    }
  };
}

type Activation = "active" | "disabled" | "unselected";

function input(options: {
  activation?: Activation;
  definitions?: Record<string, unknown>;
  placementDefinitionId?: string;
} = {}): GameContentInput {
  const activation = options.activation ?? "active";
  return {
    balance: {
      defaultMissionId: "destructible_lab",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 20, startingCoins: 100,
        startingResources: { coins: 100 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 1, pathWaterDurationUnits: 1,
        pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        floor: {
          id: "floor", label: "Floor", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: ["ground"]
        }
      },
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt", label: "Grunt", maxHp: 10, speed: 1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {
        cannon: {
          id: "cannon", label: "Cannon", cost: { coins: 1 }, footprintRadius: 0, range: 8,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 10,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1, damageType: "physical"
          }
        }
      },
      waveSets: {
        wave: [{
          id: "wave", label: "Wave",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        destructible_lab: {
          id: "destructible_lab", label: "Destructible Lab", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "wave", buildTowerIds: ["cannon"], abilityIds: [],
          mechanics: {
            profiles: {
              combat: "armored", terraforming: "terrain",
              ...(activation === "unselected" ? {} : { ballistics: "destructibles" })
            }
          }
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 5, height: 2,
        grid: { kind: "square", adjacency: "cardinal" }, defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 4, r: 0 },
        pathCenterline: Array.from({ length: 5 }, (_, q) => ({ q, r: 0 })),
        pathRoutes: [], terrainOverrides: [],
        destructibleObjects: [{
          id: "gate_1", definitionId: options.placementDefinitionId ?? "gate", coord: { q: 2, r: 1 }
        }]
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        ballistics: {
          schemaVersion: 1, enabled: activation !== "disabled",
          profiles: { destructibles: profile(options.definitions) }
        },
        combat: {
          schemaVersion: 2, enabled: true,
          profiles: {
            armored: {
              damageTypes: { physical: { label: "Physical" } },
              armorTypes: {
                stone: { label: "Stone", defaultMultiplier: 1, multipliers: { physical: 0.5 } }
              },
              armorAssignments: { enemies: {} }
            }
          }
        },
        terraforming: {
          schemaVersion: 1, enabled: true,
          profiles: {
            terrain: {
              terrainTransitions: {
                destroy_gate: { fromTerrainTags: ["ground"], toTerrainId: "floor" }
              }
            }
          }
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
        missionId: "destructible_lab", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function normalize(value: unknown): any {
  const fn = (Engine as unknown as { normalizeBallisticsProfileV1?: (input: unknown) => unknown })
    .normalizeBallisticsProfileV1;
  expect(fn).toBeTypeOf("function");
  return fn!(value);
}

function result(options: Parameters<typeof input>[0]) {
  return validateGameContentRegistry(createGameContentRegistry(input(options)));
}

function issue(
  validation: ReturnType<typeof validateGameContentRegistry>,
  severity: "error" | "warning",
  expression: RegExp
): boolean {
  return validation.issues.some((entry) => entry.severity === severity
    && expression.test(`${entry.fieldPath} ${entry.message}`));
}

describe("R13.4a destructible environment content contract (RED)", () => {
  it("publishes the closed Ballistics v1 descriptor and exact authoring budgets", () => {
    expect((Engine as unknown as Record<string, unknown>).DESTRUCTIBLE_ENVIRONMENT_LIMITS).toEqual(LIMITS);
    expect((Engine as unknown as Record<string, any>).BALLISTICS_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 1,
      projectiles: {
        requiredFields: ["towers"],
        optionalFields: ["clearance", "ricochet", "destructibles"],
        additionalProperties: false
      },
      destructibles: {
        requiredFields: ["definitions"], optionalFields: [], additionalProperties: false,
        definition: {
          requiredFields: ["maxHp", "hitRegion"],
          optionalFields: ["armorTypeId", "onDestroyed"], additionalProperties: false
        },
        hitRegion: {
          requiredFields: ["kind", "blockerHeight", "blocksLineOfSight"],
          optionalFields: [], additionalProperties: false, kinds: ["tile"]
        },
        onDestroyed: {
          requiredFields: ["terrainTransitionId"], optionalFields: [], additionalProperties: false
        },
        limits: LIMITS
      }
    });
  });

  it("normalizes definitions as detached deeply frozen binary-ordered own data", () => {
    const authored = profile({
      z_gate: definition({ maxHp: 300 }),
      a_gate: definition({ maxHp: 100 })
    }) as any;
    const normalized = normalize(authored);
    const definitions = normalized.projectiles.destructibles.definitions;
    expect(Object.keys(definitions)).toEqual(["a_gate", "z_gate"]);
    expect(definitions.a_gate).toEqual({
      maxHp: 100,
      hitRegion: { kind: "tile", blockerHeight: 3, blocksLineOfSight: true },
      armorTypeId: "stone",
      onDestroyed: { terrainTransitionId: "destroy_gate" }
    });
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.projectiles)).toBe(true);
    expect(Object.isFrozen(normalized.projectiles.destructibles)).toBe(true);
    expect(Object.isFrozen(definitions)).toBe(true);
    expect(Object.isFrozen(definitions.a_gate)).toBe(true);
    expect(Object.isFrozen(definitions.a_gate.hitRegion)).toBe(true);
    authored.projectiles.destructibles.definitions.a_gate.hitRegion.blockerHeight = 99;
    expect(definitions.a_gate.hitRegion.blockerHeight).toBe(3);
  });

  it("rejects closed-shape, bounds, accessor, proxy, cyclic, and definition-budget violations safely", () => {
    for (const malformed of [
      definition({ extra: true }),
      definition({ maxHp: 0 }),
      definition({ maxHp: 1_000_000_001 }),
      definition({ hitRegion: { kind: "circle", blockerHeight: 1, blocksLineOfSight: true } }),
      definition({ hitRegion: { kind: "tile", blockerHeight: 1_000_001, blocksLineOfSight: true } }),
      definition({ hitRegion: { kind: "tile", blockerHeight: 1, blocksLineOfSight: "yes" } }),
      definition({ onDestroyed: { terrainTransitionId: "destroy_gate", extra: true } })
    ]) expect(() => normalize(profile({ gate: malformed }))).toThrow(/destruct|definition|field|closed|maxHp|hitRegion|blocker|transition/i);

    let reads = 0;
    const hostile = definition();
    Object.defineProperty(hostile.hitRegion as object, "blockerHeight", {
      enumerable: true, get() { reads += 1; throw new Error("must not execute"); }
    });
    expect(() => normalize(profile({ gate: hostile }))).toThrow(/accessor|data|inspect|blocker|hitRegion/i);
    expect(reads).toBe(0);
    const throwing = new Proxy({}, { ownKeys() { throw new Error("hostile definitions"); } });
    expect(() => normalize(profile(throwing))).toThrow(/inspect|definitions|object/i);
    const cycle = definition() as any;
    cycle.hitRegion = cycle;
    expect(() => normalize(profile({ gate: cycle }))).toThrow(/hitRegion|field|closed|kind/i);

    const exact = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [
      `gate_${String(index).padStart(3, "0")}`, definition({ armorTypeId: undefined, onDestroyed: undefined })
    ]));
    expect(Object.keys(normalize(profile(exact)).projectiles.destructibles.definitions)).toHaveLength(256);
    const overflow = { ...exact, gate_256: definition({ armorTypeId: undefined, onDestroyed: undefined }) };
    expect(() => normalize(profile(overflow))).toThrow(/256|limit|definitions/i);
    expect(() => normalize(profile({ ["x".repeat(129)]: definition() }))).toThrow(/128|identifier|UTF-8/i);
  });

  it.each(["active", "disabled", "unselected"] as const)(
    "reports definition, Combat armor, and Terraforming transition references with %s severity",
    (activation) => {
      const invalidDefinitions = {
        gate: definition({
          armorTypeId: "missing_armor",
          onDestroyed: { terrainTransitionId: "missing_transition" }
        })
      };
      const validation = result({
        activation, definitions: invalidDefinitions, placementDefinitionId: "missing_definition"
      });
      const severity = activation === "active" ? "error" : "warning";
      expect(issue(validation, severity, /missing_definition|unknown.*definition/i)).toBe(true);
      expect(issue(validation, severity, /missing_armor|unknown.*armor/i)).toBe(true);
      expect(issue(validation, severity, /missing_transition|unknown.*transition/i)).toBe(true);
      expect(validation.ok).toBe(activation !== "active");
    }
  );

  it("preserves the exact pre-R13.4 Ballistics shape when destructibles are absent", () => {
    const legacy = normalize({
      projectiles: { towers: { cannon: { trajectory: "direct", travelTimeUnits: 0.4 } } }
    });
    expect(legacy).toEqual({
      projectiles: { towers: { cannon: { trajectory: "direct", travelTimeUnits: 0.4 } } }
    });
    expect(legacy.projectiles).not.toHaveProperty("destructibles");
  });

  it("accepts a selected placement-inert profile with no tower bindings and non-empty destructible definitions", () => {
    const inertProfile = {
      projectiles: {
        towers: {},
        destructibles: { definitions: { gate: definition() } }
      }
    };
    expect(normalize(inertProfile)).toEqual(inertProfile);

    const candidate = input() as any;
    candidate.mechanics.modules.ballistics.profiles.destructibles = inertProfile;
    const validation = validateGameContentRegistry(createGameContentRegistry(candidate));
    expect(validation.ok).toBe(true);
    expect(validation.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldPath: expect.stringMatching(/ballistics.*towers/i) })
    ]));
  });

  it("continues to reject a Ballistics profile with neither tower bindings nor destructible definitions", () => {
    expect(() => normalize({ projectiles: { towers: {} } }))
      .toThrow(/towers.*empty|at least one.*tower|tower.*required/i);
  });
});
