import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "./registry.js";
import { validateGameContentRegistry, type ValidationResult } from "./validate.js";

type Activation = "active" | "disabled" | "unselected" | "absent" | "future";

interface ProjectileBindingV1Contract {
  readonly trajectory: "direct" | "arc";
  readonly travelTimeUnits: number;
  readonly maxAltitude?: number;
}

interface BallisticsProfileV1Contract {
  readonly projectiles: {
    readonly towers: Readonly<Record<string, ProjectileBindingV1Contract>>;
  };
}

interface FixtureOptions {
  readonly activation?: Activation;
  readonly profile?: unknown;
}

const LIMITS = Object.freeze({
  towerBindingsPerProfile: 256,
  activeProjectiles: 4_096,
  impactsPerTick: 4_096,
  travelTimeUnits: 1_000_000,
  maxAltitude: 1_000_000,
  idUtf8Bytes: 128
});

function validProfile(): BallisticsProfileV1Contract {
  return {
    projectiles: {
      towers: {
        bolt: { trajectory: "direct", travelTimeUnits: 2 },
        mortar: { trajectory: "arc", travelTimeUnits: 4, maxAltitude: 6 }
      }
    }
  };
}

function fixture(options: FixtureOptions = {}): GameContentInput {
  const activation = options.activation ?? "active";
  const module = activation === "absent"
    ? {}
    : {
        ballistics: {
          schemaVersion: activation === "future" ? 2 : 1,
          enabled: activation !== "disabled",
          profiles: { field: options.profile ?? validProfile() }
        }
      };
  const selectedProfiles = activation === "active" || activation === "disabled" || activation === "future"
    ? { ballistics: "field" }
    : {};
  return {
    balance: {
      defaultMissionId: "ballistics_lab",
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
        target: {
          id: "target", label: "Target", maxHp: 100, speed: 0.1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {
        bolt: {
          id: "bolt", label: "Bolt", cost: { coins: 1 }, footprintRadius: 0, range: 8,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 10,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        },
        mortar: {
          id: "mortar", label: "Mortar", cost: { coins: 1 }, footprintRadius: 0, range: 8,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 20,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        },
        pipeline: {
          id: "pipeline", label: "Pipeline", cost: { coins: 1 }, footprintRadius: 0, range: 8,
          attack: {
            kind: "pipeline", interval: 1,
            targeting: { classes: ["ground"], mode: "first", maxTargets: 1 },
            delivery: { kind: "single" }, effects: [{ kind: "damage", amount: 10 }]
          }
        }
      },
      waveSets: {
        wave: [{
          id: "wave_1", label: "Wave",
          groups: [{ enemyId: "target", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        ballistics_lab: {
          id: "ballistics_lab", label: "Ballistics Lab", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "wave", buildTowerIds: ["bolt", "mortar", "pipeline"], abilityIds: [],
          ...(Object.keys(selectedProfiles).length === 0
            ? {}
            : { mechanics: { profiles: selectedProfiles } })
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 10, height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable", spawnCoord: { q: 4, r: 1 }, coreCoord: { q: 9, r: 1 },
        pathCenterline: Array.from({ length: 6 }, (_, index) => ({ q: index + 4, r: 1 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    mechanics: { schemaVersion: 1, modules: module },
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "ballistics_lab", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function registry(options: FixtureOptions = {}): GameContentRegistry {
  return createGameContentRegistry(fixture(options));
}

function validate(options: FixtureOptions = {}): ValidationResult {
  return validateGameContentRegistry(registry(options));
}

function hasIssue(
  result: ValidationResult,
  severity: "error" | "warning",
  fieldPath: RegExp,
  message: RegExp
): boolean {
  return result.issues.some((entry) => (
    entry.severity === severity
    && fieldPath.test(entry.fieldPath)
    && message.test(entry.message)
  ));
}

function normalizer(): (value: unknown) => BallisticsProfileV1Contract {
  const normalize = (Engine as unknown as {
    normalizeBallisticsProfileV1?: (value: unknown) => BallisticsProfileV1Contract;
  }).normalizeBallisticsProfileV1;
  expect(normalize, "R13.1 must export the closed ballistics v1 normalizer").toBeTypeOf("function");
  return normalize!;
}

describe("R13.1 ballistics v1 content contract (RED)", () => {
  it("publishes ballistics as an implemented opt-in module with a closed descriptor and budgets", () => {
    expect(Engine.MECHANICS_MODULE_IDS).toContain("ballistics");
    expect(Engine.IMPLEMENTED_MECHANICS_MODULE_IDS).toContain("ballistics");
    expect((Engine as unknown as Record<string, unknown>).BALLISTICS_LIMITS).toEqual(LIMITS);
    expect((Engine as unknown as Record<string, any>).BALLISTICS_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 1,
      moduleId: "ballistics",
      supportedModuleSchemaVersions: [1],
      profile: {
        requiredFields: ["projectiles"], optionalFields: [], additionalProperties: false
      },
      projectiles: {
        requiredFields: ["towers"], optionalFields: ["clearance", "ricochet", "destructibles"], additionalProperties: false
      },
      towerBinding: {
        requiredFields: ["trajectory", "travelTimeUnits"],
        optionalFields: ["maxAltitude", "ricochet"], additionalProperties: false
      },
      trajectories: ["direct", "arc"],
      limits: LIMITS
    });
  });

  it("normalizes active definitions into a detached, deeply frozen, binary-stable shape", () => {
    const authored = validProfile() as any;
    authored.projectiles.towers = {
      mortar: authored.projectiles.towers.mortar,
      bolt: authored.projectiles.towers.bolt
    };
    const normalized = normalizer()(authored) as any;
    const permuted = normalizer()({
      projectiles: { towers: { bolt: validProfile().projectiles.towers.bolt, mortar: validProfile().projectiles.towers.mortar } }
    }) as any;
    expect(normalized).toEqual(permuted);
    expect(Object.keys(normalized.projectiles.towers)).toEqual(["bolt", "mortar"]);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.projectiles)).toBe(true);
    expect(Object.isFrozen(normalized.projectiles.towers)).toBe(true);
    expect(Object.isFrozen(normalized.projectiles.towers.mortar)).toBe(true);
    authored.projectiles.towers.mortar.maxAltitude = 99;
    expect(normalized.projectiles.towers.mortar.maxAltitude).toBe(6);
  });

  it("accepts and resolves an active v1 profile but keeps absent content capability-inactive", () => {
    const active = registry();
    expect(validate()).toEqual({ ok: true, issues: [] });
    const resolve = (Engine as unknown as {
      resolveActiveBallisticsMechanics?: (content: GameContentRegistry, missionId: string) => unknown;
    }).resolveActiveBallisticsMechanics;
    expect(resolve).toBeTypeOf("function");
    expect(resolve!(active, "ballistics_lab")).toMatchObject({
      schemaVersion: 1, profileId: "field", projectiles: validProfile().projectiles
    });
    expect(resolve!(registry({ activation: "absent" }), "ballistics_lab")).toBeUndefined();
  });

  it.each(["disabled", "unselected"] as const)(
    "structurally validates a malformed %s profile as a warning without activating it",
    (activation) => {
      const result = validate({ activation, profile: { projectiles: { towers: { bolt: { trajectory: "warp" } } } } });
      expect(result.ok).toBe(true);
      expect(hasIssue(result, "warning", /ballistics|projectiles|bolt/i, /trajectory|travelTime|unsupported|required/i))
        .toBe(true);
      const resolve = (Engine as any).resolveActiveBallisticsMechanics as Function;
      expect(resolve(registry({ activation }), "ballistics_lab")).toBeUndefined();
    }
  );

  it("rejects a selected future module version without invoking its profile getters", () => {
    const profile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(profile, "projectiles", {
      enumerable: true,
      get: () => { throw new Error("future profile getter must not run"); }
    });
    const result = validate({ activation: "future", profile });
    expect(result.ok).toBe(false);
    expect(hasIssue(result, "error", /ballistics|schemaVersion/i, /version|unsupported/i)).toBe(true);
  });

  it("rejects unknown fields, malformed direct/arc definitions, unknown towers, and over-budget bindings", () => {
    const invalidProfiles: unknown[] = [
      { ...validProfile(), extra: true },
      { projectiles: { towers: { bolt: { trajectory: "direct", travelTimeUnits: 2, maxAltitude: 1 } } } },
      { projectiles: { towers: { mortar: { trajectory: "arc", travelTimeUnits: 2 } } } },
      { projectiles: { towers: { bolt: { trajectory: "arc", travelTimeUnits: 0, maxAltitude: 1 } } } },
      { projectiles: { towers: { missing_tower: { trajectory: "direct", travelTimeUnits: 1 } } } },
      { projectiles: { towers: { pipeline: { trajectory: "direct", travelTimeUnits: 1 } } } },
      {
        projectiles: {
          towers: Object.fromEntries(Array.from({ length: LIMITS.towerBindingsPerProfile + 1 }, (_, index) => [
            `tower_${index}`, { trajectory: "direct", travelTimeUnits: 1 }
          ]))
        }
      }
    ];
    for (const profile of invalidProfiles) {
      const result = validate({ profile });
      expect(result.ok, JSON.stringify(profile).slice(0, 160)).toBe(false);
      expect(hasIssue(result, "error", /ballistics|projectiles|tower/i, /closed|unknown|direct|arc|altitude|travel|limit|tower/i))
        .toBe(true);
    }
  });

  it("rejects accessors, hostile proxies, sparse arrays, cycles, symbols, and custom prototypes without executing user code", () => {
    let getterCalls = 0;
    const accessor = validProfile() as any;
    Object.defineProperty(accessor.projectiles.towers.mortar, "trajectory", {
      enumerable: true,
      get: () => { getterCalls += 1; return "arc"; }
    });
    expect(() => normalizer()(accessor)).toThrow(/accessor|data property|inspect|trajectory/i);
    expect(getterCalls).toBe(0);

    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
    expect(() => normalizer()(hostile)).toThrow(/inspect|plain|safe/i);

    const sparse: unknown[] = [];
    sparse.length = 2;
    expect(() => normalizer()(sparse)).toThrow(/array|plain|sparse/i);

    const cyclic: any = validProfile();
    cyclic.projectiles.loop = cyclic;
    expect(() => normalizer()(cyclic)).toThrow(/closed|unknown|cycle/i);

    const symbol = validProfile() as any;
    symbol[Symbol("hidden")] = true;
    expect(() => normalizer()(symbol)).toThrow(/symbol|field/i);

    expect(() => normalizer()(Object.create({ projectiles: validProfile().projectiles })))
      .toThrow(/prototype|plain/i);
  });
});
