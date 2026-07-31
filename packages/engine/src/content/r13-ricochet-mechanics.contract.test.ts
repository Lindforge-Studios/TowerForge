import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "./registry.js";
import { validateGameContentRegistry, type ValidationResult } from "./validate.js";

type Activation = "active" | "disabled" | "unselected" | "future";

const LIMITS = Object.freeze({
  terrainSurfaceTags: 64,
  armorTypeSurfaces: 64,
  maxBouncesPerProjectile: 4,
  maximumReflectedRayDistance: 256,
  enemyCandidatesPerCell: 16,
  ricochetsPerTick: 4_096,
  cellInspectionsPerTick: 1_048_576,
  surfaceIdUtf8Bytes: 128
});

function validProfile(): any {
  return {
    projectiles: {
      towers: {
        cannon: {
          trajectory: "direct", travelTimeUnits: 0.4,
          ricochet: { maxBounces: 2, rangeCells: 12 }
        }
      },
      clearance: { terrainBlockerHeights: { reflective_rock: 0 } },
      ricochet: {
        terrainTags: { reflective_rock: true },
        armorTypes: { plated: true }
      }
    }
  };
}

function fixture(
  authoredProfile: unknown = validProfile(),
  activation: Activation = "active",
  combatProfile: unknown = {
    damageTypes: { physical: { label: "Physical" } },
    armorTypes: { plated: { label: "Plated", defaultMultiplier: 1, multipliers: { physical: 1 } } },
    armorAssignments: { enemies: { target: "plated" } }
  }
): GameContentInput {
  const selected = activation !== "unselected";
  const profile = authoredProfile;
  return {
    balance: {
      defaultMissionId: "ricochet_lab",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 20, startingCoins: 100,
        startingResources: { coins: 100 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 1, pathWaterDurationUnits: 1,
        pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        mirror: {
          id: "mirror", label: "Mirror", buildable: false, walkable: false,
          groundSpeedMultiplier: 1, tags: ["reflective_rock"]
        }
      },
      abilities: {},
      enemies: {
        target: {
          id: "target", label: "Target", maxHp: 100, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {
        cannon: {
          id: "cannon", label: "Cannon", cost: { coins: 1 }, footprintRadius: 0, range: 12,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 20,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1, damageType: "physical"
          }
        }
      },
      waveSets: {
        wave: [{
          id: "wave", label: "Wave",
          groups: [{ enemyId: "target", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        ricochet_lab: {
          id: "ricochet_lab", label: "Ricochet Lab", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "wave", buildTowerIds: ["cannon"], abilityIds: [],
          ...(selected ? { mechanics: { profiles: { ballistics: "reflect", combat: "armored" } } } : {
            mechanics: { profiles: { combat: "armored" } }
          })
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 10, height: 3,
        grid: { kind: "square", adjacency: "cardinal" }, defaultTerrain: "buildable",
        spawnCoord: { q: 4, r: 1 }, coreCoord: { q: 9, r: 1 },
        pathCenterline: Array.from({ length: 6 }, (_, index) => ({ q: index + 4, r: 1 })),
        pathRoutes: [], terrainOverrides: [{ q: 2, r: 1, terrain: "mirror" }]
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        ballistics: {
          schemaVersion: activation === "future" ? 2 : 1,
          enabled: activation !== "disabled",
          profiles: { reflect: profile }
        },
        combat: { schemaVersion: 2, enabled: true, profiles: { armored: combatProfile } }
      }
    },
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "ricochet_lab", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function registry(profile: unknown = validProfile(), activation: Activation = "active", combat?: unknown): GameContentRegistry {
  return createGameContentRegistry(fixture(profile, activation, combat));
}

function validation(profile: unknown = validProfile(), activation: Activation = "active", combat?: unknown): ValidationResult {
  return validateGameContentRegistry(registry(profile, activation, combat));
}

function normalize(value: unknown): any {
  return (Engine as any).normalizeBallisticsProfileV1(value);
}

function hasIssue(result: ValidationResult, severity: "error" | "warning", expression: RegExp): boolean {
  return result.issues.some((entry) => entry.severity === severity
    && expression.test(`${entry.fieldPath} ${entry.message}`));
}

describe("R13.3 ricochet authoring contract (RED)", () => {
  it("publishes the closed descriptor and exact independent budgets without changing module v1", () => {
    expect((Engine as any).RICOCHET_LIMITS).toEqual(LIMITS);
    expect((Engine as any).BALLISTICS_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 1,
      projectiles: {
        requiredFields: ["towers"], optionalFields: ["clearance", "ricochet", "destructibles"], additionalProperties: false
      },
      towerBinding: {
        requiredFields: ["trajectory", "travelTimeUnits"],
        optionalFields: ["maxAltitude", "ricochet"], additionalProperties: false
      },
      towerRicochet: {
        requiredFields: ["maxBounces", "rangeCells"], optionalFields: [], additionalProperties: false
      },
      ricochet: {
        requiredFields: [], optionalFields: ["terrainTags", "armorTypes"], additionalProperties: false,
        surfaceRecord: { kind: "record", value: { const: true } },
        limits: LIMITS
      }
    });
  });

  it("normalizes all records in binary order into detached deeply frozen data", () => {
    const authored = validProfile();
    authored.projectiles.ricochet = {
      armorTypes: { z_plate: true, plated: true },
      terrainTags: { z_mirror: true, reflective_rock: true }
    };
    authored.projectiles.clearance.terrainBlockerHeights.z_mirror = 1;
    const normalized = normalize(authored);
    expect(Object.keys(normalized.projectiles.ricochet.terrainTags)).toEqual(["reflective_rock", "z_mirror"]);
    expect(Object.keys(normalized.projectiles.ricochet.armorTypes)).toEqual(["plated", "z_plate"]);
    expect(normalized.projectiles.towers.cannon.ricochet).toEqual({ maxBounces: 2, rangeCells: 12 });
    expect(Object.isFrozen(normalized.projectiles.ricochet)).toBe(true);
    expect(Object.isFrozen(normalized.projectiles.ricochet.terrainTags)).toBe(true);
    expect(Object.isFrozen(normalized.projectiles.towers.cannon.ricochet)).toBe(true);
    authored.projectiles.ricochet.armorTypes.plated = false;
    expect(normalized.projectiles.ricochet.armorTypes.plated).toBe(true);
  });

  it("preserves exact R13.1 and R13.2 normalized shapes when ricochet is absent", () => {
    const r131 = { projectiles: { towers: { cannon: { trajectory: "direct", travelTimeUnits: 1 } } } };
    const r132 = {
      projectiles: {
        towers: { cannon: { trajectory: "arc", travelTimeUnits: 1, maxAltitude: 2 } },
        clearance: { terrainBlockerHeights: { reflective_rock: 1 } }
      }
    };
    expect(normalize(r131)).toEqual(r131);
    expect(normalize(r132)).toEqual(r132);
    expect(normalize(r132).projectiles).not.toHaveProperty("ricochet");
    expect(normalize(r132).projectiles.towers.cannon).not.toHaveProperty("ricochet");
  });

  it("accepts exact tower boundaries and rejects fractional/out-of-range/closed values", () => {
    for (const [maxBounces, rangeCells] of [[1, 1], [4, 256]]) {
      const candidate = validProfile();
      candidate.projectiles.towers.cannon.ricochet = { maxBounces, rangeCells };
      expect(() => normalize(candidate)).not.toThrow();
    }
    for (const ricochet of [
      { maxBounces: 0, rangeCells: 1 }, { maxBounces: 5, rangeCells: 1 },
      { maxBounces: 1.5, rangeCells: 1 }, { maxBounces: 1, rangeCells: 0 },
      { maxBounces: 1, rangeCells: 257 }, { maxBounces: 1, rangeCells: 1.5 },
      { maxBounces: 1, rangeCells: 1, extra: true }
    ]) {
      const candidate = validProfile();
      candidate.projectiles.towers.cannon.ricochet = ricochet;
      expect(() => normalize(candidate)).toThrow(/ricochet|bounce|range|integer|closed|unknown/i);
    }
  });

  it("enforces non-empty true-only surface records and their exact 64-entry budgets", () => {
    for (const [field, prefix] of [["terrainTags", "tag"], ["armorTypes", "armor"]] as const) {
      const exact = validProfile();
      exact.projectiles.ricochet = {
        [field]: Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`${prefix}_${index}`, true]))
      };
      if (field === "terrainTags") {
        exact.projectiles.clearance.terrainBlockerHeights = Object.fromEntries(
          Array.from({ length: 64 }, (_, index) => [`${prefix}_${index}`, 0])
        );
      }
      expect(() => normalize(exact)).not.toThrow();

      const over = validProfile();
      over.projectiles.ricochet = {
        [field]: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`${prefix}_${index}`, true]))
      };
      expect(() => normalize(over)).toThrow(/ricochet|surface|64|limit|maximum/i);
    }
    for (const surfaces of [
      {}, { terrainTags: {} }, { armorTypes: {} },
      { terrainTags: { reflective_rock: false } },
      { terrainTags: { reflective_rock: 1 } },
      { terrainTags: { reflective_rock: true }, extra: true }
    ]) {
      const candidate = validProfile();
      candidate.projectiles.ricochet = surfaces;
      expect(() => normalize(candidate)).toThrow(/ricochet|surface|true|empty|closed|unknown|required/i);
    }
  });

  it("rejects hostile own-data at every new nesting level without executing accessors", () => {
    let calls = 0;
    const accessor = validProfile();
    Object.defineProperty(accessor.projectiles.ricochet.terrainTags, "reflective_rock", {
      enumerable: true, get: () => { calls += 1; return true; }
    });
    expect(() => normalize(accessor)).toThrow(/accessor|own data|inspect|reflective/i);
    expect(calls).toBe(0);

    const proxy = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
    const proxyCandidate = validProfile();
    proxyCandidate.projectiles.ricochet.armorTypes = proxy;
    expect(() => normalize(proxyCandidate)).toThrow(/inspect|safe|plain/i);

    for (const hostile of [
      Object.assign(new Array(2), { 1: true }),
      Object.assign(Object.create({ plated: true }), {}),
      Object.assign({ plated: true }, { [Symbol("hidden")]: true })
    ]) {
      const candidate = validProfile();
      candidate.projectiles.ricochet.armorTypes = hostile;
      expect(() => normalize(candidate)).toThrow(/array|plain|prototype|symbol|field/i);
    }
    const cyclic = validProfile();
    cyclic.projectiles.ricochet.loop = cyclic;
    expect(() => normalize(cyclic)).toThrow(/closed|unknown|cycle/i);
  });

  it("validates terrain/clearance, Combat armor, and bound-tower cross references", () => {
    expect(validation()).toEqual({ ok: true, issues: [] });
    const cases: any[] = [];

    const noClearance = validProfile();
    delete noClearance.projectiles.clearance;
    cases.push(noClearance);
    const missingClearanceTag = validProfile();
    missingClearanceTag.projectiles.clearance.terrainBlockerHeights = { other: 0 };
    cases.push(missingClearanceTag);
    const unknownTerrainTag = validProfile();
    unknownTerrainTag.projectiles.ricochet.terrainTags = { missing_terrain_tag: true };
    unknownTerrainTag.projectiles.clearance.terrainBlockerHeights.missing_terrain_tag = 0;
    cases.push(unknownTerrainTag);
    const noBoundTower = validProfile();
    delete noBoundTower.projectiles.towers.cannon.ricochet;
    cases.push(noBoundTower);
    for (const candidate of cases) {
      const result = validation(candidate);
      expect(result.ok).toBe(false);
      expect(hasIssue(result, "error", /ricochet|surface|clearance|terrain|tower.*binding/i)).toBe(true);
    }

    const missingArmor = validation(validProfile(), "active", {
      damageTypes: { physical: { label: "Physical" } }, armorTypes: {}, armorAssignments: { enemies: {} }
    });
    expect(missingArmor.ok).toBe(false);
    expect(hasIssue(missingArmor, "error", /ricochet.*plated|plated.*combat|armor.*surface/i)).toBe(true);
  });

  it("downgrades inactive failures to warnings and rejects future v2 before nested getters", () => {
    const malformed = validProfile();
    malformed.projectiles.ricochet.terrainTags.reflective_rock = false;
    for (const activation of ["disabled", "unselected"] as const) {
      const result = validation(malformed, activation);
      expect(result.ok).toBe(true);
      expect(hasIssue(result, "warning", /ricochet|surface|true/i)).toBe(true);
      expect((Engine as any).resolveActiveBallisticsMechanics(registry(malformed, activation), "ricochet_lab"))
        .toBeUndefined();
    }

    let calls = 0;
    const projectiles = { towers: {} } as Record<string, unknown>;
    Object.defineProperty(projectiles, "ricochet", {
      enumerable: true, get: () => { calls += 1; return { terrainTags: { reflective_rock: true } }; }
    });
    const result = validation({ projectiles }, "future");
    expect(result.ok).toBe(false);
    expect(hasIssue(result, "error", /ballistics.*version|schemaVersion.*unsupported/i)).toBe(true);
    expect(calls).toBe(0);
  });
});
